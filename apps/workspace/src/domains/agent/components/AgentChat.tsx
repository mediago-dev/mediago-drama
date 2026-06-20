import type React from "react";
import { useEffect, useRef, useState } from "react";
import useSWR, { mutate as mutateSWR } from "swr";
import type { A2uiClientAction } from "@a2ui/web_core/v0_9";
import {
	type AgentACPConfigSelection,
	agentRuntimeConfigKey,
	getAgentRuntimeConfig,
} from "@/domains/agent/api/agent";
import { agentDisplayPrompt } from "@/domains/agent/lib/display-prompt";
import { actionContextString } from "@/domains/agent/lib/a2ui-actions";
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
	buildRuntimeConfigSelections,
	getRuntimeConfigError,
	normalizeRuntimeConfigValue,
} from "@/domains/agent/components/chat/AgentRuntimeConfigControls";
import {
	appendAttachmentContext,
	createAttachmentDecisionA2UIPayload,
	createAttachmentDecisionBatchId,
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
	type AgentMessage,
	type AgentMessageMetadata,
} from "@/domains/agent/stores";
import {
	selectActiveDocumentOpenComments,
	type DocumentComment,
	useDocumentsStore,
} from "@/domains/documents/stores";
import { useProjectStore } from "@/domains/projects/stores";

export const AgentChat: React.FC = () => {
	const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
	const [composerContext, setComposerContext] = useState<ComposerContext>("default");
	const [composerState, setComposerState] = useState<AgentComposerState>({
		hasText: false,
		referenceCount: 0,
	});
	const [isStopping, setIsStopping] = useState(false);
	const [selections, setSelections] = useState<Record<string, string>>({});
	const [pendingAttachmentDecisionId, setPendingAttachmentDecisionId] = useState<string | null>(
		null,
	);
	const messages = useAgentStore(selectAgentMessages);
	const isRunning = useAgentStore(selectAgentIsRunning);
	const runtimeAlerts = useAgentStore(selectAgentRuntimeAlerts);
	const composerSeed = useAgentStore(selectAgentComposerSeed);
	const consumeComposerSeed = useAgentStore(selectConsumeAgentComposerSeed);
	const openComments = useDocumentsStore(selectActiveDocumentOpenComments);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const deleteComment = useDocumentsStore((state) => state.deleteComment);
	const projectId = useProjectStore((state) => state.activeProjectId);
	const composerRef = useRef<AgentComposerHandle>(null);
	const pendingAttachmentSendRef = useRef<PendingAttachmentSend | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const hasUploadingAttachment = attachments.some(
		(attachment) => attachment.status === "uploading",
	);
	const readyAttachments = uniqueAgentAttachments(
		attachments.filter((attachment) => attachment.status === "ready"),
	);
	const hasOpenComments = openComments.length > 0;
	const runtimeConfigKey = agentRuntimeConfigKey(projectId);
	const {
		data: runtimeConfig,
		error: runtimeConfigError,
		isLoading: isRuntimeConfigLoading,
	} = useSWR(runtimeConfigKey, () => getAgentRuntimeConfig(projectId), {
		revalidateOnFocus: false,
	});
	const canSubmit =
		Boolean(
			composerState.hasText ||
			composerState.referenceCount > 0 ||
			readyAttachments.length > 0 ||
			hasOpenComments,
		) &&
		!hasUploadingAttachment &&
		!pendingAttachmentDecisionId;

	useEffect(() => {
		setSelections((current) => {
			const next: Record<string, string> = {};
			for (const option of runtimeConfig?.options ?? []) {
				const key = option.configId ?? "";
				next[key] = normalizeRuntimeConfigValue(option, current[key] ?? "");
			}
			return next;
		});
	}, [runtimeConfig]);

	useEffect(() => {
		if (!composerSeed) return;
		setComposerContext(
			composerSeed.reference?.category === "source-material" ? "source-material" : "default",
		);

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
			pendingAttachmentDecisionId
		) {
			return;
		}

		const effectivePrompt = prompt || defaultAgentPrompt(readyAttachments);
		const pendingSend: PendingAttachmentSend = {
			attachments: readyAttachments,
			displayPrompt: agentDisplayPrompt({
				prompt: displayText || effectivePrompt || (hasOpenComments ? "处理未解决批注" : ""),
				references: composerValue.references,
			}),
			displayMetadata: attachmentDisplayMetadata(readyAttachments),
			selections: buildRuntimeConfigSelections(runtimeConfig, selections),
			promptWithAttachments: appendAttachmentContext(effectivePrompt, readyAttachments),
			references: composerValue.references,
			comments: openComments,
		};

		if (readyAttachments.length > 0) {
			const batchId = createAttachmentDecisionBatchId();
			const nextPendingSend = { ...pendingSend, batchId, reuseCurrentRun: true };
			pendingAttachmentSendRef.current = nextPendingSend;
			setPendingAttachmentDecisionId(batchId);
			const agentState = useAgentStore.getState();
			agentState.addUserMessage(pendingSend.displayPrompt, pendingSend.displayMetadata);
			agentState.addA2UIMessage(
				createAttachmentDecisionA2UIPayload(batchId, readyAttachments),
				"请选择附件处理方式。",
			);
			composerRef.current?.clear();
			setAttachments([]);
			setComposerContext("default");
			return;
		}

		await startAgentPrompt(pendingSend);
	};

	const startAgentPrompt = async (pendingSend: PendingAttachmentSend) => {
		const run = runAgentPrompt(pendingSend.promptWithAttachments, {
			displayMetadata: pendingSend.displayMetadata,
			displayPrompt: pendingSend.displayPrompt,
			selections: pendingSend.selections,
			comments: pendingSend.comments,
			references: pendingSend.references,
			reuseCurrentRun: pendingSend.reuseCurrentRun,
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

	const handleA2UIAction = async (_message: AgentMessage, action: A2uiClientAction) => {
		if (actionContextString(action, "kind") !== "attachment_import_decision") return false;

		const batchId = actionContextString(action, "batchId");
		const decision = actionContextString(action, "decision");
		const pendingSend = pendingAttachmentSendRef.current;
		if (!pendingSend || pendingSend.batchId !== batchId) {
			useAgentStore
				.getState()
				.recordActivity("runtime", "附件处理失败", "附件批次已失效，请重新选择文件。");
			return true;
		}

		if (decision === "cancel") {
			pendingAttachmentSendRef.current = null;
			setPendingAttachmentDecisionId(null);
			useAgentStore.getState().recordActivity("runtime", "附件已取消", "已取消本次附件导入。");
			return true;
		}

		if (decision === "add_to_library") {
			try {
				const uploadedAssets = await Promise.all(
					pendingSend.attachments.map((attachment) =>
						uploadSourceMaterialAsset(attachment, projectId),
					),
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
						"素材保存失败",
						err instanceof Error ? err.message : "附件写入素材库失败。",
					);
				return true;
			}
		}

		pendingAttachmentSendRef.current = null;
		setPendingAttachmentDecisionId(null);
		await startAgentPrompt(pendingSend);
		return true;
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
		if (
			composerContext === "source-material" &&
			!nextState.hasText &&
			nextState.referenceCount === 0
		) {
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
					onA2UIAction={handleA2UIAction}
				/>
			</div>
			<PendingPermissionRequests />
			<AgentChatComposerForm
				attachments={attachments}
				canSubmit={canSubmit}
				composerContext={composerContext}
				composerRef={composerRef}
				disabled={isRunning}
				fileInputRef={fileInputRef}
				isRuntimeConfigLoading={isRuntimeConfigLoading}
				isStopping={isStopping}
				openComments={openComments}
				runtimeConfig={runtimeConfig}
				runtimeConfigErrorMessage={
					runtimeConfigError ? getRuntimeConfigError(runtimeConfigError) : ""
				}
				selections={selections}
				onAttachFiles={(event) => void attachFiles(event)}
				onComposerChange={handleComposerChange}
				onRemoveAttachment={removeAttachment}
				onRemoveComment={removeComment}
				onRunPrompt={() => void runPrompt()}
				onSelectionChange={(configId, value) =>
					setSelections((current) => ({ ...current, [configId]: value }))
				}
				onStopRun={() => void stopRun()}
				onSubmit={submit}
			/>
		</section>
	);
};

interface PendingAttachmentSend {
	batchId?: string;
	attachments: AgentAttachment[];
	displayMetadata?: AgentMessageMetadata;
	displayPrompt: string;
	selections: AgentACPConfigSelection[];
	promptWithAttachments: string;
	references: AgentComposerValue["references"];
	comments: DocumentComment[];
	reuseCurrentRun?: boolean;
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

const uploadSourceMaterialAsset = async (attachment: AgentAttachment, projectId: string | null) => {
	if (!projectId) throw new Error("请先进入项目后再添加素材库。");
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
	return `${prompt}\n\n已保存到素材库的原始文件：\n${assetContext}`;
};
