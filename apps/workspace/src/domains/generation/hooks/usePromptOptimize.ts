import { useCallback, useRef, useState } from "react";
import {
	createGenerationConversation,
	type GenerationFamily,
	type GenerationModelsResponse,
	type GenerationRoute,
	type GenerationVersion,
	streamGenerationText,
} from "@/domains/generation/api/generation";
import {
	catalogOrFallback,
	isConfiguredRoute,
	preferredRoute,
} from "@/domains/generation/hooks/generationCatalog";
import { listPromptTemplates } from "@/domains/settings/api/prompt-templates";
import { markdownSection } from "@/domains/settings/lib/prompt-template-sections";

export interface PromptOptimizeInput {
	currentPrompt: string;
	referencePrompt: string;
	referenceName: string;
}

export interface PromptOptimizeModelOption {
	family: GenerationFamily;
	id: string;
	label: string;
	route: GenerationRoute;
	version: GenerationVersion;
}

export interface UsePromptOptimizeOptions {
	catalog?: GenerationModelsResponse;
	capabilityId?: string;
	conversationId?: string | null;
	conversationScopeId?: string | null;
	conversationTitle?: string | null;
	onOptimized: (prompt: string) => void;
	onSuccess?: () => void;
	projectId?: string | null;
	route?: GenerationRoute | null;
}

const promptOptimizeInstructionTemplateId = "TOOLS";
const promptOptimizeInternalHeading = "内部模板（代码读取）";
const promptOptimizeSystemHeading = "提示词优化系统提示";
const promptOptimizeUserHeading = "提示词优化用户提示";

export const usePromptOptimize = ({
	capabilityId,
	catalog,
	conversationId,
	conversationScopeId,
	conversationTitle,
	onSuccess,
	projectId,
	route,
	onOptimized,
}: UsePromptOptimizeOptions) => {
	const [isOptimizing, setIsOptimizing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const textRoute = route ?? resolveTextRoute(catalog);

	const optimize = useCallback(
		async (input: PromptOptimizeInput) => {
			if (!textRoute) {
				setError("没有可用的文本生成模型，请先配置 API Key。");
				return null;
			}

			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;

			setIsOptimizing(true);
			setError(null);

			let accumulated = "";
			let finalOptimizedPrompt = "";
			let failedMessage = "";
			const normalizedProjectId = projectId?.trim() || undefined;

			try {
				const templates = await loadPromptOptimizeInstructionTemplates();
				const userPrompt = renderPromptTemplate(templates.user, {
					CurrentPrompt: input.currentPrompt || "（空）",
					ReferenceName: input.referenceName,
					ReferencePrompt: input.referencePrompt,
				});
				await ensurePromptOptimizeConversation({
					conversationId,
					conversationScopeId,
					conversationTitle,
				});
				await streamGenerationText(
					{
						kind: "text",
						conversationId: conversationId?.trim() || undefined,
						scopeId: conversationScopeId?.trim() || undefined,
						projectId: normalizedProjectId,
						capabilityId,
						familyId: textRoute.familyId,
						versionId: textRoute.versionId,
						routeId: textRoute.id,
						provider: textRoute.provider,
						modelId: textRoute.legacyModelId ?? "",
						model: textRoute.model,
						prompt: userPrompt,
						params: {
							system_instruction: templates.system,
						},
						referenceUrls: [],
						referenceAssetIds: [],
					},
					{
						signal: controller.signal,
						onDelta: (delta) => {
							accumulated += delta;
							onOptimized(accumulated);
						},
						onDone: (message) => {
							const finalPrompt = message.text?.trim() || message.message?.trim();
							if (finalPrompt) {
								finalOptimizedPrompt = finalPrompt;
								onOptimized(finalPrompt);
							}
						},
						onError: (message) => {
							failedMessage = message || "提示词优化失败。";
							setError(failedMessage);
						},
					},
				);
				if (failedMessage) return null;
				const optimizedPrompt = finalOptimizedPrompt || accumulated.trim();
				if (!optimizedPrompt) return null;
				onSuccess?.();
				return optimizedPrompt;
			} catch (caught) {
				if (controller.signal.aborted) return null;
				setError(caught instanceof Error ? caught.message : "提示词优化失败，请稍后重试。");
				return null;
			} finally {
				if (abortRef.current === controller) {
					abortRef.current = null;
				}
				setIsOptimizing(false);
			}
		},
		[
			capabilityId,
			conversationId,
			conversationScopeId,
			conversationTitle,
			onOptimized,
			onSuccess,
			projectId,
			textRoute,
		],
	);

	const cancel = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		setIsOptimizing(false);
	}, []);

	return {
		canOptimize: Boolean(textRoute),
		error,
		isOptimizing,
		optimize,
		cancel,
	};
};

const resolveTextRoute = (catalog?: GenerationModelsResponse): GenerationRoute | null => {
	const textRoutes = promptOptimizeModelOptions(catalog).map((option) => option.route);
	if (textRoutes.length > 0) return preferredRoute(textRoutes) ?? textRoutes[0] ?? null;
	return null;
};

interface PromptOptimizeInstructionTemplates {
	system: string;
	user: string;
}

const loadPromptOptimizeInstructionTemplates =
	async (): Promise<PromptOptimizeInstructionTemplates> => {
		const templates = await listPromptTemplates();
		const toolsTemplate = templates.find(
			(template) => template.id === promptOptimizeInstructionTemplateId,
		);
		const system = markdownSection(toolsTemplate?.content ?? "", [
			promptOptimizeInternalHeading,
			promptOptimizeSystemHeading,
		]);
		const user = markdownSection(toolsTemplate?.content ?? "", [
			promptOptimizeInternalHeading,
			promptOptimizeUserHeading,
		]);
		if (!system || !user) {
			throw new Error("提示词优化模板不可用。");
		}
		return { system, user };
	};

const renderPromptTemplate = (template: string, values: Record<string, string>) => {
	let rendered = template;
	for (const [key, value] of Object.entries(values)) {
		rendered = rendered.replaceAll(`{{.${key}}}`, value);
	}
	return rendered.trim();
};

export const promptOptimizeModelOptions = (
	catalog?: GenerationModelsResponse,
): PromptOptimizeModelOption[] => {
	const resolved = catalogOrFallback(catalog);
	return resolved.routes
		.filter((route) => route.kind === "text" && isConfiguredRoute(route))
		.map((route) => {
			const family =
				resolved.families.find((item) => item.id === route.familyId) ??
				fallbackFamilyForRoute(route);
			const version =
				resolved.versions.find((item) => item.id === route.versionId) ??
				fallbackVersionForRoute(route);
			const providerLabel = route.label?.trim() || route.provider;
			const modelLabel = version?.label?.trim() || route.model;
			return {
				family,
				id: route.id,
				label: `${modelLabel} · ${providerLabel}`,
				route,
				version,
			};
		});
};

const fallbackFamilyForRoute = (route: GenerationRoute): GenerationFamily => ({
	id: route.familyId,
	label: route.familyId || "Text",
	kind: route.kind,
});

const fallbackVersionForRoute = (route: GenerationRoute): GenerationVersion => ({
	id: route.versionId,
	familyId: route.familyId,
	label: route.model || route.versionId,
	kind: route.kind,
	canonicalModel: route.model,
	capabilities: {
		async: route.async,
		supportsReferenceUrls: route.supportsReferenceUrls,
	},
});

const ensurePromptOptimizeConversation = async ({
	conversationId,
	conversationScopeId,
	conversationTitle,
}: {
	conversationId?: string | null;
	conversationScopeId?: string | null;
	conversationTitle?: string | null;
}) => {
	const id = conversationId?.trim();
	const scopeId = conversationScopeId?.trim();
	const title = conversationTitle?.trim();
	if (!id || !scopeId || !title) return;

	await createGenerationConversation({
		id,
		kind: "text",
		scopeId,
		title,
	});
};
