import type { AgentDocumentProposal, AgentRuntimeEvent } from "@/domains/agent/api/agent";
import { refreshWorkspaceStateFromBackend } from "@/domains/agent/lib/runtime-shared";
import { useAgentStore } from "@/domains/agent/stores";
import { getEditorHandle } from "@/domains/documents/lib/editor-registry";
import {
	createDocumentOperation,
	type DocumentOperation,
} from "@/domains/documents/lib/operations";
import {
	type DocumentOperationSource,
	type MarkdownDocument,
	useDocumentsStore,
} from "@/domains/documents/stores";

// Applies agent-driven document mutations: streaming edit events routed to
// the local block editor or the documents store, and whole-document proposals.

export type StreamingDocumentEditRuntimeEvent = Extract<
	AgentRuntimeEvent,
	{
		type:
			| "agent.document.edit.started"
			| "agent.document.edit.delta"
			| "agent.document.edit.checkpoint"
			| "agent.document.edit.completed"
			| "agent.document.edit.failed";
	}
>;

export const isStreamingDocumentEditEvent = (
	event: AgentRuntimeEvent,
): event is StreamingDocumentEditRuntimeEvent =>
	event.type === "agent.document.edit.started" ||
	event.type === "agent.document.edit.delta" ||
	event.type === "agent.document.edit.checkpoint" ||
	event.type === "agent.document.edit.completed" ||
	event.type === "agent.document.edit.failed";

export const handleStreamingDocumentEditEvent = (
	event: StreamingDocumentEditRuntimeEvent,
	context: {
		anchorText: string;
		isSelectionScoped: boolean;
		projectId: string | null;
		runId?: string;
	},
) => {
	const edit = event.documentEdit;
	if (!edit.documentId) return;

	const agentStore = useAgentStore.getState();
	const documentsStore = useDocumentsStore.getState();
	const title = edit.title || "生成中文档";
	const anchorText = edit.anchorText?.trim() || context.anchorText || title;
	const editorHandle = getEditorHandle();
	const editorMatchesDocument = editorHandle?.documentId === edit.documentId;
	const canUseLocalBlockEditor =
		editorMatchesDocument && (Boolean(edit.anchorText?.trim()) || context.isSelectionScoped);
	const isLocalBlockStreaming = canUseLocalBlockEditor && editorHandle?.hasPendingBlockDelta();

	if (event.type === "agent.document.edit.delta") {
		const nextContent = edit.content ?? edit.delta;
		let appliedInEditor = false;
		if (canUseLocalBlockEditor && anchorText && nextContent) {
			appliedInEditor =
				editorHandle?.applyBlockDelta(anchorText, nextContent, {
					fullDocument: edit.content !== undefined,
					blockId: edit.blockId,
				}) ?? false;
		}

		if (!appliedInEditor) {
			documentsStore.applyStreamingDocumentEdit(edit);
		}
	} else if (event.type === "agent.document.edit.completed") {
		if (editorMatchesDocument) {
			editorHandle?.commitBlockDelta();
		}
		documentsStore.applyStreamingDocumentEdit(edit);
	} else if (event.type === "agent.document.edit.checkpoint") {
		if (!isLocalBlockStreaming) {
			documentsStore.applyStreamingDocumentEdit(edit);
		}
	} else {
		documentsStore.applyStreamingDocumentEdit(edit);
	}

	if (event.type === "agent.document.edit.started") {
		return;
	}

	if (event.type === "agent.document.edit.delta") {
		return;
	}

	if (event.type === "agent.document.edit.checkpoint") {
		return;
	}

	if (event.type === "agent.document.edit.completed") {
		void refreshWorkspaceStateFromBackend(event.projectId ?? context.projectId ?? undefined);
		return;
	}

	if (event.type === "agent.document.edit.failed") {
		agentStore.recordActivity(
			"runtime",
			"流式编辑失败",
			edit.summary || event.message,
			context.runId,
		);
	}
};

export const applyDocumentProposal = (
	activeDocument: MarkdownDocument,
	proposal: AgentDocumentProposal,
) => {
	const operations: DocumentOperation[] = [];
	if (proposal.title && proposal.title !== activeDocument.title) {
		operations.push(
			createDocumentOperation<DocumentOperation>({
				type: "update_document_metadata",
				summary: "已更新文档标题。",
				target: {},
				payload: { title: proposal.title },
			}),
		);
	}
	if (proposal.content && proposal.content.trim() !== activeDocument.content.trim()) {
		operations.push(
			createDocumentOperation<DocumentOperation>({
				type: "replace_text",
				summary: proposal.summary || "已替换文档内容。",
				target: {
					anchor: {
						quote: activeDocument.content.trim(),
						contextBefore: "",
						contextAfter: "",
					},
				},
				payload: { replacement: proposal.content },
			}),
		);
	}
	if (operations.length === 0) return;

	useDocumentsStore.getState().applyOperations(activeDocument.id, operations, {
		source: agentSource("orchestrator"),
		summary: proposal.summary || "已应用智能体文档方案。",
	});
	useAgentStore.getState().recordDocumentUpdated(proposal.summary || "已应用智能体文档方案。");
};

export const agentSource = (role?: string): DocumentOperationSource => {
	const normalizedRole = role
		?.trim()
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.replace(/^[-_]+|[-_]+$/g, "");
	return normalizedRole ? `agent:${normalizedRole}` : "agent";
};
