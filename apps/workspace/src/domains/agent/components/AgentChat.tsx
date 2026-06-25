import type React from "react";
import { useEffect, useRef, useState } from "react";
import useSWR, { mutate as mutateSWR } from "swr";
import { agentRuntimeConfigKey, getAgentRuntimeConfig } from "@/domains/agent/api/agent";
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
import { listPromptTemplates, promptTemplatesKey } from "@/domains/settings/api/prompt-templates";
import { markdownSection } from "@/domains/settings/lib/prompt-template-sections";
import {
	appendAttachmentContext,
	createPendingAttachment,
	defaultAgentPrompt,
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
	type AgentDisplayAttachment,
	type AgentMessageMetadata,
} from "@/domains/agent/stores";
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
	const [selectedModel, setSelectedModel] = useState("");
	const [selectedReasoning, setSelectedReasoning] = useState("");
	const [selectedPermission, setSelectedPermission] = useState("");
	const messages = useAgentStore(selectAgentMessages);
	const isRunning = useAgentStore(selectAgentIsRunning);
	const runtimeAlerts = useAgentStore(selectAgentRuntimeAlerts);
	const composerSeed = useAgentStore(selectAgentComposerSeed);
	const consumeComposerSeed = useAgentStore(selectConsumeAgentComposerSeed);
	const openComments = useDocumentsStore(selectActiveDocumentOpenComments);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const deleteComment = useDocumentsStore((state) => state.deleteComment);
	const storedProjectId = useProjectStore((state) => state.activeProjectId);
	const projectId = routeProjectId ?? storedProjectId;
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
	const { data: promptTemplates = [] } = useSWR(promptTemplatesKey, listPromptTemplates);
	const toolsTemplate = promptTemplates.find((template) => template.id === "TOOLS")?.content ?? "";
	const attachmentDefaultPrompt = markdownSection(toolsTemplate, [
		"内部模板（代码读取）",
		"附件默认用户请求",
	]);
	const attachmentContextTitle = markdownSection(toolsTemplate, [
		"内部模板（代码读取）",
		"附件上下文标题",
	]);
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
		setSelectedModel((current) => normalizeRuntimeConfigValue(runtimeConfig?.model, current));
		setSelectedReasoning((current) =>
			normalizeRuntimeConfigValue(runtimeConfig?.reasoning, current),
		);
		setSelectedPermission((current) =>
			normalizeRuntimeConfigValue(runtimeConfig?.permission, current),
		);
	}, [runtimeConfig]);

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

		const effectivePrompt = prompt || defaultAgentPrompt(readyAttachments, attachmentDefaultPrompt);
		const pendingSend: PendingAttachmentSend = {
			attachments: readyAttachments,
			displayPrompt: agentDisplayPrompt({
				prompt: displayText || effectivePrompt || (hasOpenComments ? "处理未解决批注" : ""),
				references: composerValue.references,
			}),
			displayMetadata: attachmentDisplayMetadata(readyAttachments),
			model: buildRuntimeConfigSelection(runtimeConfig?.model, selectedModel),
			permission: buildRuntimeConfigSelection(runtimeConfig?.permission, selectedPermission),
			promptWithAttachments: appendAttachmentContext(
				effectivePrompt,
				readyAttachments,
				attachmentContextTitle,
			),
			references: composerValue.references,
			reasoning: buildRuntimeConfigSelection(runtimeConfig?.reasoning, selectedReasoning),
			comments: openComments,
		};

		if (readyAttachments.length > 0) {
			setIsSavingAttachments(true);
			try {
				const uploadedAssets = await Promise.all(
					readyAttachments.map((attachment) => uploadAttachmentAsset(attachment, projectId)),
				);
				await refreshProjectAssets(projectId);
				pendingSend.promptWithAttachments = appendUploadedAssetContext(
					pendingSend.promptWithAttachments,
					uploadedAssets,
				);
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
		const run = runAgentPrompt(pendingSend.promptWithAttachments, {
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
				isRuntimeConfigLoading={isRuntimeConfigLoading}
				isStopping={isStopping}
				openComments={openComments}
				permissionValue={selectedPermission}
				reasoningValue={selectedReasoning}
				runtimeConfig={runtimeConfig}
				runtimeConfigErrorMessage={
					runtimeConfigError ? getRuntimeConfigError(runtimeConfigError) : ""
				}
				selectedModel={selectedModel}
				onAttachFiles={(event) => void attachFiles(event)}
				onComposerChange={handleComposerChange}
				onModelChange={setSelectedModel}
				onPermissionChange={setSelectedPermission}
				onReasoningChange={setSelectedReasoning}
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

interface PendingAttachmentSend {
	attachments: AgentAttachment[];
	displayMetadata?: AgentMessageMetadata;
	displayPrompt: string;
	model: RuntimeConfigSelection;
	permission: RuntimeConfigSelection;
	promptWithAttachments: string;
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

const attachmentDisplayMetadata = (
	attachments: AgentAttachment[],
): AgentMessageMetadata | undefined => {
	const displayAttachments = attachments.map(
		(attachment): AgentDisplayAttachment => ({
			id: attachment.id,
			kind: attachment.kind,
			mimeType: attachment.mimeType,
			name: attachment.name,
			size: attachment.size,
			url: attachment.url,
		}),
	);
	return displayAttachments.length > 0 ? { displayAttachments } : undefined;
};

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

const appendUploadedAssetContext = (prompt: string, assets: ProjectAsset[]) => {
	if (assets.length === 0) return prompt;
	const assetContext = assets
		.map((asset, index) =>
			[
				`${index + 1}. ${asset.filename}`,
				`类型：${asset.kind}`,
				`MIME：${asset.mimeType}`,
				`大小：${asset.sizeBytes} bytes`,
				`URL：${new URL(asset.url, window.location.origin).toString()}`,
			].join("\n"),
		)
		.join("\n\n");
	return `${prompt}\n\n已保存到资料的原始文件：\n${assetContext}`;
};
