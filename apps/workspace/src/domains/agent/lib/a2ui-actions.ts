import type { A2uiClientAction } from "@a2ui/web_core/v0_9";
import {
	decideAgentPermission,
	decideAgentSelection,
	decideDocumentToolApproval,
} from "@/domains/agent/api/agent";
import type { AgentSelection } from "@/domains/agent/api/agent";
import type { AgentMessage } from "@/domains/agent/stores";
import { useAgentStore } from "@/domains/agent/stores";
import { useAgentPersistenceStore } from "@/domains/agent/stores/persistence";
import { useDocumentsStore } from "@/domains/documents/stores";
import { useProjectStore } from "@/domains/projects/stores";
import { getWorkspaceDocuments } from "@/domains/workspace/api/workspace";

export type AgentA2UIActionHandler = (
	message: AgentMessage,
	action: A2uiClientAction,
) => boolean | void | Promise<boolean | void>;

export const handleDeterministicA2UIAction = async (
	message: AgentMessage,
	action: A2uiClientAction,
) => {
	const kind = actionContextString(action, "kind");
	if (kind === "agent_permission") {
		await handleAgentPermissionAction(message, action);
		return true;
	}
	if (kind === "document_tool_approval") {
		await handleDocumentToolApprovalAction(action);
		return true;
	}
	if (kind === "agent_selection") {
		await handleAgentSelectionAction(message, action);
		return true;
	}
	return false;
};

const handleAgentPermissionAction = async (message: AgentMessage, action: A2uiClientAction) => {
	const agentStore = useAgentStore.getState();
	const sessionId = actionContextString(action, "sessionId") || agentStore.sessionId;
	const requestId = actionContextString(action, "requestId");
	const projectId =
		actionContextString(action, "projectId") || useProjectStore.getState().activeProjectId;
	const optionId = actionContextString(action, "optionId");
	const cancelled = actionContextBoolean(action, "cancelled");
	if (!projectId || !sessionId || !requestId || (!optionId && !cancelled)) {
		recordA2UIActionError("权限确认失败", "确认信息不完整，无法提交权限选择。");
		return;
	}
	try {
		await decideAgentPermission({ projectId, sessionId, requestId, optionId, cancelled });
		const detail = permissionDecisionSummary(requestId, optionId, cancelled);
		const store = useAgentStore.getState();
		store.removePermissionRequest(requestId);
		store.replaceMessage(message.id, {
			content: detail,
			kind: "message",
			title: "工具权限",
			status: "complete",
			metadata: {
				permissionDecision: {
					cancelled,
					optionId,
					requestId,
				},
			},
		});
		store.recordActivity("runtime", "权限已确认", detail);
	} catch (err) {
		recordA2UIActionError("权限确认失败", getActionError(err));
	}
};

const handleDocumentToolApprovalAction = async (action: A2uiClientAction) => {
	const approvalId = actionContextString(action, "approvalId");
	const decision = actionContextString(action, "decision");
	const projectId =
		actionContextString(action, "projectId") || useProjectStore.getState().activeProjectId;
	if (!approvalId || (decision !== "approved" && decision !== "rejected")) {
		recordA2UIActionError("文档确认失败", "确认信息不完整，无法提交文档操作选择。");
		return;
	}
	try {
		await decideDocumentToolApproval(approvalId, decision, projectId);
		useAgentStore
			.getState()
			.recordActivity(
				"runtime",
				decision === "approved" ? "已确认文档操作" : "已拒绝文档操作",
				decision === "approved" ? "已提交危险操作确认。" : "已拒绝危险操作。",
			);
		if (decision === "approved" && projectId) {
			const state = await getWorkspaceDocuments(projectId);
			if (useProjectStore.getState().activeProjectId === projectId) {
				useDocumentsStore.getState().hydrateWorkspaceDocuments(state);
			}
		}
	} catch (err) {
		recordA2UIActionError("文档确认失败", getActionError(err));
	}
};

const handleAgentSelectionAction = async (message: AgentMessage, action: A2uiClientAction) => {
	const selectionId = actionContextString(action, "selectionId");
	const projectId =
		actionContextString(action, "projectId") || useProjectStore.getState().activeProjectId;
	const optionId = actionContextString(action, "optionId");
	const cancelled = actionContextBoolean(action, "cancelled");
	if (!projectId || !selectionId || (!optionId && !cancelled)) {
		recordA2UIActionError("选择提交失败", "选择信息不完整，无法提交。");
		return;
	}
	try {
		const record = await decideAgentSelection(
			selectionId,
			cancelled ? { cancelled: true } : { optionId },
			projectId,
		);
		const detail = selectionDecisionSummary(record);
		const store = useAgentStore.getState();
		store.replaceMessage(message.id, {
			content: detail,
			kind: "message",
			title: record.title || "用户选择",
			status: "complete",
			metadata: {
				selectionDecision: {
					optionId: record.decision?.optionId,
					selectionId,
					status: record.status,
				},
			},
		});
		// Persist the decision so the card stays frozen after a transcript
		// hydrate re-materializes the original interactive A2UI payload.
		useAgentPersistenceStore.getState().markSelectionResolved(selectionId, {
			status: record.status,
			summary: detail,
			title: record.title || "用户选择",
		});
		store.recordActivity("runtime", "选择已提交", detail);
	} catch (err) {
		recordA2UIActionError("选择提交失败", getActionError(err));
	}
};

// The decide endpoint is idempotent: clicking a card that was already decided
// (or expired) returns the current record, so the summary reflects the real
// outcome instead of double-submitting.
const selectionDecisionSummary = (record: AgentSelection) => {
	switch (record.status) {
		case "selected": {
			const option = record.options.find((item) => item.id === record.decision?.optionId);
			const label = option?.label || record.decision?.optionId || "";
			return label ? `已选择：${label}` : "选择已提交。";
		}
		case "custom":
			return "已选择自定义描述，请在对话中说明你的需求。";
		case "cancelled":
			return "已取消选择。";
		case "expired":
			return "该选择已过期，请让 Agent 重新发起。";
		default:
			return "选择已提交。";
	}
};

export const actionContextString = (action: A2uiClientAction, key: string) => {
	const value = action.context?.[key];
	return typeof value === "string" ? value.trim() : "";
};

export const actionContextBoolean = (action: A2uiClientAction, key: string) => {
	const value = action.context?.[key];
	return typeof value === "boolean" ? value : false;
};

const recordA2UIActionError = (label: string, detail: string) => {
	useAgentStore.getState().recordActivity("runtime", label, detail);
};

const getActionError = (err: unknown) => (err instanceof Error ? err.message : "操作提交失败。");

const permissionDecisionSummary = (requestId: string, optionId: string, cancelled: boolean) => {
	if (cancelled) return "用户已取消权限请求。";
	const option = useAgentStore
		.getState()
		.permissionRequests.find((request) => request.requestId === requestId)
		?.options.find((item) => item.optionId === optionId);
	const label = permissionOptionLabel(option?.kind, option?.name, optionId);
	return `用户已${label}。`;
};

const permissionOptionLabel = (kind?: string, name?: string, optionId?: string) => {
	const normalized = `${kind ?? ""} ${optionId ?? ""} ${name ?? ""}`.toLowerCase();
	if (normalized.includes("allow") && isPersistentPermission(normalized)) return "始终允许";
	if (normalized.includes("allow")) return "允许一次";
	if (normalized.includes("reject") && isPersistentPermission(normalized)) return "始终拒绝";
	if (normalized.includes("reject")) return "拒绝";
	const trimmedName = name?.trim();
	if (trimmedName) return `选择 ${trimmedName}`;
	const trimmedOption = optionId?.trim();
	return trimmedOption ? `选择 ${trimmedOption}` : "确认权限选择";
};

const isPersistentPermission = (value: string) =>
	value.includes("always") || value.includes("permanent") || value.includes("forever");
