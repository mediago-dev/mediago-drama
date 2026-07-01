import type React from "react";
import { useEffect, useRef, useState } from "react";
import useSWR, { mutate as mutateSWR } from "swr";
import {
	agentRuntimeConfigKey,
	getAgentRuntimeConfig,
	type AgentReference,
	type AgentRuntimeConfigPayload,
} from "@/domains/agent/api/agent";
import { agentDisplayPrompt } from "@/domains/agent/lib/display-prompt";
import { uploadProjectAsset, type ProjectAsset } from "@/domains/workspace/api/project-assets";
import { getWorkspaceDocuments, workspaceDocumentsKey } from "@/domains/workspace/api/workspace";
import {
	type AgentComposerHandle,
	type AgentComposerState,
	type AgentComposerValue,
} from "@/domains/agent/components/AgentComposer";
import {
	AgentChatComposerForm,
	type ComposerContext,
} from "@/domains/agent/components/chat/AgentChatComposerForm";
import {
	buildRuntimeConfigSelection,
	getRuntimeConfigError,
	normalizeRuntimeConfigValue,
} from "@/domains/agent/components/chat/AgentRuntimeConfigControls";
import { listSkills, skillsKey } from "@/domains/settings/api/skills";
import { buildAgentDisplayMetadata } from "@/domains/agent/lib/display-attachments";
import {
	createPendingAttachment,
	getAttachmentError,
	readAgentAttachment,
	type AgentAttachment,
} from "@/domains/agent/components/chat/AgentAttachments";
import { AgentTimeline } from "@/domains/agent/components/AgentTimeline";
import { PendingPermissionRequests } from "@/domains/agent/components/PendingPermissionRequests";
import { runAgentPrompt, stopAgentRun } from "@/domains/agent/lib/controller";
import {
	selectAgentComposerSeed,
	selectAgentIsRunning,
	selectAgentMessages,
	selectAgentRuntimeAlerts,
	selectConsumeAgentComposerSeed,
	useAgentStore,
	type AgentMessageMetadata,
} from "@/domains/agent/stores";
import {
	type AgentRuntimeConfigField,
	useAgentPersistenceStore,
} from "@/domains/agent/stores/persistence";
import {
	selectActiveDocumentOpenComments,
	type DocumentComment,
	useDocumentsStore,
} from "@/domains/documents/stores";
import { useProjectStore } from "@/domains/projects/stores";

interface AgentChatProps {
	projectId?: string | null;
}

export const AgentChat: React.FC<AgentChatProps> = ({ projectId: routeProjectId }) => {
	const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
	const [composerContext, setComposerContext] = useState<ComposerContext>("default");
	const [composerState, setComposerState] = useState<AgentComposerState>({
		hasText: false,
		referenceCount: 0,
	});
	const [isStopping, setIsStopping] = useState(false);
	const [isSavingAttachments, setIsSavingAttachments] = useState(false);
	const messages = useAgentStore(selectAgentMessages);
	const isRunning = useAgentStore(selectAgentIsRunning);
	const isChatHydrating = useAgentStore((state) => state.isChatHydrating);
	const runtimeAlerts = useAgentStore(selectAgentRuntimeAlerts);
	const composerSeed = useAgentStore(selectAgentComposerSeed);
	const consumeComposerSeed = useAgentStore(selectConsumeAgentComposerSeed);
	const openComments = useDocumentsStore(selectActiveDocumentOpenComments);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const deleteComment = useDocumentsStore((state) => state.deleteComment);
	const storedProjectId = useProjectStore((state) => state.activeProjectId);
	const projectId = routeProjectId ?? storedProjectId;
	const persistedRuntimeConfig = useAgentPersistenceStore((state) =>
		projectId ? state.runtimeConfigByProject[projectId] : undefined,
	);
	const persistedRuntimeConfigDefaults = useAgentPersistenceStore(
		(state) => state.runtimeConfigDefaults,
	);
	const setRuntimeConfigValue = useAgentPersistenceStore((state) => state.setRuntimeConfigValue);
	const composerRef = useRef<AgentComposerHandle>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const hasUploadingAttachment = attachments.some(
		(attachment) => attachment.status === "uploading",
	);
	const readyAttachments = uniqueAgentAttachments(
		attachments.filter((attachment) => attachment.status === "ready"),
	);
	const hasOpenComments = openComments.length > 0;
	const runtimeConfigKey = projectId ? agentRuntimeConfigKey(projectId) : null;
	const {
		data: runtimeConfig,
		error: runtimeConfigError,
		isLoading: isRuntimeConfigLoading,
	} = useSWR(runtimeConfigKey, () => getAgentRuntimeConfig(projectId), {
		revalidateOnFocus: false,
	});
	const isAgentPersistenceHydrated = useAgentPersistenceHydrated();
	const resolvedRuntimeConfig = isAgentPersistenceHydrated ? runtimeConfig : undefined;
	const {
		data: skillItems = [],
		error: skillsError,
		isLoading: isSkillsLoading,
	} = useSWR(skillsKey, listSkills, {
		revalidateOnFocus: false,
	});
	const selectedModel = normalizeRuntimeConfigValue(
		resolvedRuntimeConfig?.model,
		persistedRuntimeConfig?.model ?? persistedRuntimeConfigDefaults.model ?? "",
	);
	const runtimeConfigForSelectedModel = runtimeConfigFilteredForSelectedModel(
		resolvedRuntimeConfig,
		selectedModel,
	);
	const selectedReasoning = normalizeRuntimeConfigValue(
		runtimeConfigForSelectedModel?.reasoning,
		persistedRuntimeConfig?.reasoning ?? persistedRuntimeConfigDefaults.reasoning ?? "",
	);
	const selectedPermission = normalizeRuntimeConfigValue(
		runtimeConfigForSelectedModel?.permission,
		persistedRuntimeConfig?.permission ?? persistedRuntimeConfigDefaults.permission ?? "",
	);
	const canSubmit =
		Boolean(
			composerState.hasText ||
			composerState.referenceCount > 0 ||
			readyAttachments.length > 0 ||
			hasOpenComments,
		) &&
		!hasUploadingAttachment &&
		!isSavingAttachments;

	useEffect(() => {
		if (!composerSeed) return;
		setComposerContext(composerSeed.reference?.category === "reference" ? "reference" : "default");

		const applySeed = () => {
			const inserted = composerRef.current?.seed({
				reference: composerSeed.reference,
				text: composerSeed.text,
			});
			if (!inserted) return false;
			if (composerSeed.focus ?? true) composerRef.current?.focus();
			consumeComposerSeed();
			return true;
		};

		if (applySeed()) return;

		const timeout = window.setTimeout(applySeed, 50);
		return () => window.clearTimeout(timeout);
	}, [composerSeed, consumeComposerSeed]);

	const runPrompt = async () => {
		const composerValue = composerRef.current?.getValue() ?? {
			displayText: "",
			references: [],
			text: "",
		};
		const prompt = composerValue.text.trim();
		const displayText = composerValue.displayText.trim();
		if (
			(!prompt &&
				composerValue.references.length === 0 &&
				readyAttachments.length === 0 &&
				!hasOpenComments) ||
			isRunning ||
			hasUploadingAttachment ||
			isSavingAttachments
		) {
			return;
		}

		const effectivePrompt = prompt;
		const pendingSend: PendingAttachmentSend = {
			displayPrompt: agentDisplayPrompt({
				prompt: displayText || effectivePrompt || (hasOpenComments ? "处理未解决批注" : ""),
				references: composerValue.references,
			}),
			displayMetadata: buildAgentDisplayMetadata(readyAttachments, composerValue.references),
			model: buildRuntimeConfigSelection(runtimeConfigForSelectedModel?.model, selectedModel),
			permission: buildRuntimeConfigSelection(
				runtimeConfigForSelectedModel?.permission,
				selectedPermission,
			),
			prompt: effectivePrompt,
			references: composerValue.references,
			reasoning: buildRuntimeConfigSelection(
				runtimeConfigForSelectedModel?.reasoning,
				selectedReasoning,
			),
			comments: openComments,
		};

		if (readyAttachments.length > 0) {
			setIsSavingAttachments(true);
			try {
				const uploadedAssets = await Promise.all(
					readyAttachments.map((attachment) => uploadAttachmentAsset(attachment, projectId)),
				);
				await refreshProjectAssets(projectId);
				pendingSend.references = uniqueAgentReferences([
					...pendingSend.references,
					...uploadedAssets.map(projectAssetReference),
				]);
				pendingSend.displayPrompt = agentDisplayPrompt({
					prompt: displayText || effectivePrompt || (hasOpenComments ? "处理未解决批注" : ""),
					references: pendingSend.references,
				});
			} catch (err) {
				useAgentStore
					.getState()
					.recordActivity(
						"runtime",
						"资料保存失败",
						err instanceof Error ? err.message : "附件写入资料失败。",
					);
				return;
			} finally {
				setIsSavingAttachments(false);
			}
		}

		await startAgentPrompt(pendingSend);
	};

	const startAgentPrompt = async (pendingSend: PendingAttachmentSend) => {
		const run = runAgentPrompt(pendingSend.prompt, {
			displayMetadata: pendingSend.displayMetadata,
			displayPrompt: pendingSend.displayPrompt,
			model: pendingSend.model,
			comments: pendingSend.comments,
			references: pendingSend.references,
			reasoning: pendingSend.reasoning,
			permission: pendingSend.permission,
		});
		composerRef.current?.clear();
		setAttachments([]);
		setComposerContext("default");
		await run;
	};

	const stopRun = async () => {
		if (!isRunning || isStopping) return;
		setIsStopping(true);
		try {
			await stopAgentRun();
		} finally {
			setIsStopping(false);
		}
	};

	const attachFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files ?? []);
		event.target.value = "";
		if (files.length === 0) return;

		const nextAttachments = files.map(createPendingAttachment);
		setAttachments((items) => [...items, ...nextAttachments]);

		await Promise.all(
			files.map(async (file, index) => {
				const pending = nextAttachments[index];
				try {
					const attachment = await readAgentAttachment(file, pending.id, projectId);
					setAttachments((items) =>
						items.map((item) => (item.id === pending.id ? attachment : item)),
					);
				} catch (err) {
					setAttachments((items) =>
						items.map((item) =>
							item.id === pending.id
								? {
										...item,
										status: "error" as const,
										error: getAttachmentError(err),
									}
								: item,
						),
					);
				}
			}),
		);
	};

	const updateRuntimeConfigValue = (field: AgentRuntimeConfigField, value: string) => {
		if (!projectId) return;
		setRuntimeConfigValue(projectId, field, value);
	};

	const removeAttachment = (id: string) => {
		setAttachments((items) => items.filter((item) => item.id !== id));
	};

	const removeComment = (id: string) => {
		if (!activeDocumentId) return;
		deleteComment(activeDocumentId, id);
	};

	const submit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canSubmit || isRunning) return;
		void runPrompt();
	};

	const handleComposerChange = (nextState: AgentComposerState) => {
		setComposerState(nextState);
		if (composerContext === "reference" && !nextState.hasText && nextState.referenceCount === 0) {
			setComposerContext("default");
		}
	};

	return (
		<section className="agent-chat-shell flex h-full min-h-0 flex-col bg-ide-panel">
			<div className="min-h-0 flex-1 overflow-hidden">
				<AgentTimeline
					className="h-full"
					messages={messages}
					isRunning={isRunning}
					isHydrating={isChatHydrating}
					runtimeAlerts={runtimeAlerts}
				/>
			</div>
			<PendingPermissionRequests />
			<AgentChatComposerForm
				attachments={attachments}
				canSubmit={canSubmit}
				composerContext={composerContext}
				composerRef={composerRef}
				disabled={isRunning || isSavingAttachments}
				fileInputRef={fileInputRef}
				isRuntimeConfigLoading={isRuntimeConfigLoading || !isAgentPersistenceHydrated}
				isSkillsLoading={isSkillsLoading}
				isStopping={isStopping}
				openComments={openComments}
				permissionValue={selectedPermission}
				reasoningValue={selectedReasoning}
				runtimeConfig={runtimeConfigForSelectedModel}
				runtimeConfigErrorMessage={
					runtimeConfigError ? getRuntimeConfigError(runtimeConfigError) : ""
				}
				selectedModel={selectedModel}
				skillItems={skillItems}
				skillsErrorMessage={skillsError ? "Skill 列表加载失败" : ""}
				onAttachFiles={(event) => void attachFiles(event)}
				onComposerChange={handleComposerChange}
				onModelChange={(value) => updateRuntimeConfigValue("model", value)}
				onPermissionChange={(value) => updateRuntimeConfigValue("permission", value)}
				onReasoningChange={(value) => updateRuntimeConfigValue("reasoning", value)}
				onRemoveAttachment={removeAttachment}
				onRemoveComment={removeComment}
				onRunPrompt={() => void runPrompt()}
				onStopRun={() => void stopRun()}
				onSubmit={submit}
			/>
		</section>
	);
};

type RuntimeConfigSelection = ReturnType<typeof buildRuntimeConfigSelection>;

const OPENCODE_THINKING_FALLBACK_SOURCE = "opencodeThinkingFallback";

const runtimeConfigFilteredForSelectedModel = (
	config: AgentRuntimeConfigPayload | undefined,
	modelValue: string,
): AgentRuntimeConfigPayload | undefined => {
	if (!config?.reasoning || config.reasoning.source !== OPENCODE_THINKING_FALLBACK_SOURCE) {
		return config;
	}
	if (agentRuntimeModelSupportsOpenCodeThinking(modelValue)) return config;
	return {
		...config,
		reasoning: undefined,
	};
};

const agentRuntimeModelSupportsOpenCodeThinking = (value: string) => {
	const trimmed = value.trim();
	const separator = trimmed.indexOf("/");
	if (separator <= 0 || separator >= trimmed.length - 1) return false;
	const provider = trimmed.slice(0, separator).trim().toLowerCase();
	const model = trimmed
		.slice(separator + 1)
		.trim()
		.toLowerCase();
	switch (provider) {
		case "minimax-cn":
			return model.includes("minimax-m3");
		case "mediago":
			return model.includes("minimax-m3") || model.includes("minimax m3");
		default:
			return false;
	}
};

const useAgentPersistenceHydrated = () => {
	const [isHydrated, setIsHydrated] = useState(() =>
		useAgentPersistenceStore.persist.hasHydrated(),
	);

	useEffect(() => {
		if (useAgentPersistenceStore.persist.hasHydrated()) {
			setIsHydrated(true);
			return;
		}
		const unsubscribe = useAgentPersistenceStore.persist.onFinishHydration(() =>
			setIsHydrated(true),
		);
		void useAgentPersistenceStore.persist.rehydrate();
		return unsubscribe;
	}, []);

	return isHydrated;
};

interface PendingAttachmentSend {
	displayMetadata?: AgentMessageMetadata;
	displayPrompt: string;
	model: RuntimeConfigSelection;
	permission: RuntimeConfigSelection;
	prompt: string;
	reasoning: RuntimeConfigSelection;
	references: AgentComposerValue["references"];
	comments: DocumentComment[];
}

const uniqueAgentAttachments = (attachments: AgentAttachment[]) => {
	const seen = new Set<string>();
	return attachments.filter((attachment) => {
		const key = agentAttachmentFingerprint(attachment);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

const agentAttachmentFingerprint = (attachment: AgentAttachment) =>
	[
		attachment.name.trim().toLowerCase(),
		attachment.size,
		attachment.mimeType.trim().toLowerCase(),
		attachment.kind,
	].join("\u0000");

const uploadAttachmentAsset = async (attachment: AgentAttachment, projectId: string | null) => {
	if (!projectId) throw new Error("请先进入项目后再添加资料。");
	return uploadProjectAsset(projectId, attachment.file);
};

const refreshProjectAssets = async (projectId: string | null) => {
	if (!projectId) return;
	const state = await getWorkspaceDocuments(projectId);
	if (useProjectStore.getState().activeProjectId === projectId) {
		useDocumentsStore.getState().hydrateWorkspaceDocuments(state);
	}
	await mutateSWR(workspaceDocumentsKey(projectId));
};

const projectAssetReference = (asset: ProjectAsset): AgentReference => ({
	kind: "asset",
	documentId: asset.id,
	assetId: asset.id,
	assetKind: asset.kind,
	category: "reference",
	mimeType: asset.mimeType,
	title: asset.filename,
	url: new URL(asset.url, window.location.origin).toString(),
});

const uniqueAgentReferences = (references: AgentReference[]) => {
	const seen = new Set<string>();
	return references.filter((reference) => {
		const key =
			reference.kind === "asset"
				? `asset:${reference.assetId ?? reference.documentId}`
				: `${reference.documentId}:${reference.kind === "section" ? (reference.blockId ?? "") : ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};
