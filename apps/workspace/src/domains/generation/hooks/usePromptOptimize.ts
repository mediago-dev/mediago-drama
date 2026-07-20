import { useCallback, useRef, useState } from "react";
import {
	createGenerationConversation,
	type GenerationFamily,
	type GenerationContentSourceRef,
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
import { useCodexTextAvailability } from "./useCodexTextAvailability";

export interface PromptOptimizeInput {
	currentPrompt: string;
	referenceId?: string;
	referencePrompt: string;
	referenceName: string;
	sourceRefs?: GenerationContentSourceRef[];
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

const promptOptimizeSystemInstruction = [
	"你是提示词优化助手，负责把“用户的输入”改写成一条可直接用于生成的高质量提示词。",
	"以“优化 prompt”为风格基准，把其中的媒介、画风和质量要求融入改写结果。",
	"保留“用户的输入”中的主体、动作、场景等核心内容，不要引入无关的新主体。",
	"严格保持原有媒介与画风（如 2D 动漫、插画、写实摄影等），不得改成另一种风格方向。",
	"只输出优化后的提示词正文，不要任何解释、标题、寒暄、标签、Markdown、代码块、JSON、思考过程或额外信息。",
].join("\n");

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
	const codexAvailable = useCodexTextAvailability();

	const textRoute = route ?? resolveTextRoute(catalog);
	const textExecutor = textRoute ? "route" : codexAvailable ? "codex" : null;
	const optimize = useCallback(
		async (input: PromptOptimizeInput) => {
			if (!textExecutor) {
				setError("没有可用的文本生成模型，请配置文本模型或登录 Codex。");
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
				const opaqueReference = !input.referencePrompt.trim() && Boolean(input.referenceId?.trim());
				await ensurePromptOptimizeConversation({
					conversationId,
					conversationScopeId,
					conversationTitle,
				});
				await streamGenerationText(
					{
						kind: "text",
						textExecutor,
						conversationId: conversationId?.trim() || undefined,
						scopeId: conversationScopeId?.trim() || undefined,
						projectId: normalizedProjectId,
						capabilityId,
						familyId: textRoute?.familyId,
						versionId: textRoute?.versionId,
						routeId: textRoute?.id ?? "",
						provider: textRoute?.provider,
						modelId: textRoute?.legacyModelId ?? "",
						model: textRoute?.model ?? "",
						prompt: opaqueReference ? input.currentPrompt : buildPromptOptimizeUserPrompt(input),
						promptOptimization: opaqueReference
							? {
									model: textRoute?.model ?? "",
									referenceId: input.referenceId?.trim() || undefined,
									referenceName: input.referenceName,
									referencePrompt: input.referencePrompt,
									routeId: textRoute?.id,
								}
							: undefined,
						sourceRefs: input.sourceRefs,
						params: {
							system_instruction: promptOptimizeSystemInstruction,
						},
						referenceUrls: [],
						referenceAssetIds: [],
					},
					{
						signal: controller.signal,
						onDelta: (delta) => {
							accumulated += delta;
							const cleanedPrompt = cleanPromptOptimizeOutput(accumulated);
							if (cleanedPrompt) onOptimized(cleanedPrompt);
						},
						onDone: (message) => {
							const finalPrompt = cleanPromptOptimizeOutput(
								message.text?.trim() || message.message?.trim() || "",
							);
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
				const optimizedPrompt =
					finalOptimizedPrompt || cleanPromptOptimizeOutput(accumulated.trim());
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
			textExecutor,
			textRoute,
		],
	);

	const cancel = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		setIsOptimizing(false);
	}, []);

	return {
		canOptimize: Boolean(textExecutor),
		codexAvailable,
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

const buildPromptOptimizeUserPrompt = (input: PromptOptimizeInput) => {
	const currentPrompt = input.currentPrompt.trim();
	const referencePrompt = input.referencePrompt.trim();
	return `优化 prompt：
${referencePrompt}

用户的输入：
${currentPrompt}

请按“优化 prompt”的风格和质量要求改写“用户的输入”，只输出优化后的提示词正文，不要任何解释或额外内容。`;
};

const cleanPromptOptimizeOutput = (value: string) => {
	let text = stripThinkTags(value).trim();
	text = stripWrappingCodeFence(text);
	text = stripPromptOptimizeLabel(text);
	text = stripWrappingCodeFence(text);
	return text.trim();
};

const stripThinkTags = (value: string) =>
	value.replace(/<think>[\s\S]*?<\/think>/giu, "").replace(/<think>[\s\S]*$/iu, "");

// Also strips an unterminated opening fence so streamed partial output stays clean.
const stripWrappingCodeFence = (value: string) => {
	const trimmed = value.trim();
	if (!trimmed.startsWith("```")) return trimmed;
	if (!trimmed.includes("\n")) return "";
	return trimmed
		.replace(/^```[^\n]*\n/u, "")
		.replace(/\n```$/u, "")
		.trim();
};

const stripPromptOptimizeLabel = (value: string) => {
	let text = value.trim();
	const labelPattern =
		/^(?:[#*\s>_-]*(?:优化后的?提示词|优化后 prompt|optimized prompt|优化 prompt|提示词|prompt)\s*[:：]\s*[*\s]*)/iu;
	while (labelPattern.test(text)) {
		text = text.replace(labelPattern, "").trim();
	}
	return text;
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
