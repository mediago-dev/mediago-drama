import type { AgentActionContext, AgentActions } from "./action-types";
import {
	agentMessageId,
	appendThoughtToConversation,
	appendTraceForTarget,
	createId,
	findCurrentTurnPlanMessage,
	nonTerminalConversationStatus,
	normalizeAgentItemIdentity,
	prependActivity,
	resolveTargetRunId,
	runtimeLabel,
	statePatchWithConversations,
	updateConversationMessages,
	withAgentItemIdentity,
} from "./conversation";
import { upsertRuntimeLogInConversation } from "./runtime-log";
import { upsertToolCallInConversation } from "./tool-metadata";
import type { AgentMessage } from "./types";

type ActivityActions = Pick<
	AgentActions,
	| "appendThought"
	| "addRuntimeAlert"
	| "clearRuntimeAlerts"
	| "recordActivity"
	| "recordDocumentUpdated"
	| "recordPatchApplied"
	| "recordPatchRejected"
	| "recordRuntimeLog"
	| "recordRuntimeStatus"
	| "setPlan"
	| "upsertToolCallMessage"
>;

export const createAgentActivityActions = ({ set }: AgentActionContext): ActivityActions => ({
	addRuntimeAlert: (alert, runId) => {
		const message = alert.message.trim();
		if (!message) return;

		set((state) => {
			const id = `${alert.reason || alert.title || "runtime-alert"}-${Date.now()}`;
			const normalized = {
				...alert,
				id,
				title: alert.title || "运行时警告",
				message,
				createdAt: new Date().toISOString(),
			};
			const conversations = appendTraceForTarget(
				state,
				resolveTargetRunId(state, runId),
				"runtime",
				normalized.title,
				message,
			);
			return {
				runtimeAlerts: [...state.runtimeAlerts, normalized],
				conversations,
				activity: prependActivity(state.activity, "runtime", normalized.title, message),
			};
		});
	},
	clearRuntimeAlerts: () => set({ runtimeAlerts: [] }),
	appendThought: (thought, runId, identity) => {
		if (!thought.trim()) return;

		set((state) => {
			const targetRunId = resolveTargetRunId(state, runId);
			const itemIdentity = normalizeAgentItemIdentity(identity, {
				turnId: targetRunId,
				phase: "commentary",
			});
			const conversations = updateConversationMessages(state, targetRunId, (conversation) =>
				appendThoughtToConversation(conversation, thought, itemIdentity),
			);

			return statePatchWithConversations(state, conversations);
		});
	},
	setPlan: (entries, runId, identity) => {
		set((state) => {
			const targetRunId = resolveTargetRunId(state, runId);
			const itemIdentity = normalizeAgentItemIdentity(identity, {
				turnId: targetRunId,
				phase: "commentary",
			});
			const conversations = updateConversationMessages(state, targetRunId, (conversation) => {
				const createdAt = new Date().toISOString();
				const content = entries.map((entry) => entry.content).join("\n");
				const existing = findCurrentTurnPlanMessage(conversation.messages, itemIdentity);
				const id = existing?.id ?? agentMessageId(itemIdentity, createId("plan"));
				const planMessage: AgentMessage = withAgentItemIdentity(
					{
						id,
						role: "assistant",
						content,
						kind: "plan",
						title: "计划",
						createdAt: existing?.createdAt ?? createdAt,
						status: "complete",
						metadata: {
							...existing?.metadata,
							planEntries: entries,
						},
					},
					itemIdentity,
					{
						turnId: existing?.turnId,
						itemId: existing?.itemId ?? id,
						phase: existing?.phase ?? "commentary",
					},
				);
				const messages = existing
					? conversation.messages.map((message) =>
							message.id === existing.id ? planMessage : message,
						)
					: [...conversation.messages, planMessage];
				return {
					...conversation,
					messages,
					status: nonTerminalConversationStatus(conversation.status),
					updatedAt: createdAt,
				};
			});

			return statePatchWithConversations(state, conversations);
		});
	},
	upsertToolCallMessage: (toolCallId, patch, runId, identity) => {
		const trimmedToolCallId = toolCallId.trim();
		if (!trimmedToolCallId) return;

		set((state) => {
			const targetRunId = resolveTargetRunId(state, runId);
			const itemIdentity = normalizeAgentItemIdentity(identity, {
				turnId: targetRunId,
				phase: "commentary",
			});
			const conversations = updateConversationMessages(state, targetRunId, (conversation) =>
				upsertToolCallInConversation(conversation, trimmedToolCallId, patch, itemIdentity),
			);

			return statePatchWithConversations(state, conversations);
		});
	},
	recordRuntimeLog: (input, runId, identity) => {
		const content = input.content?.trim() ?? "";
		if (!content && !input.outputBlocks?.length && input.outputJson === undefined) return;

		set((state) => {
			const targetRunId = resolveTargetRunId(state, runId);
			const itemIdentity = normalizeAgentItemIdentity(identity, {
				turnId: targetRunId,
				phase: "commentary",
			});
			const conversations = updateConversationMessages(state, targetRunId, (conversation) =>
				upsertRuntimeLogInConversation(conversation, input, itemIdentity),
			);
			const detail = content || "运行日志已更新。";

			return {
				...statePatchWithConversations(state, conversations),
				activity: prependActivity(state.activity, "runtime", "运行日志", detail),
			};
		});
	},
	recordActivity: (kind, label, detail, runId) => {
		set((state) => {
			const conversations = appendTraceForTarget(
				state,
				resolveTargetRunId(state, runId),
				kind,
				label,
				detail,
			);
			return {
				conversations,
				activity: prependActivity(state.activity, kind, label, detail),
			};
		});
	},
	recordDocumentUpdated: (detail, runId) => {
		set((state) => {
			const conversations = appendTraceForTarget(
				state,
				resolveTargetRunId(state, runId),
				"patch",
				"文档已更新",
				detail,
			);
			return {
				conversations,
				activity: prependActivity(state.activity, "patch", "文档已更新", detail),
			};
		});
	},
	recordRuntimeStatus: (status) => {
		const label = status.fallback
			? `${runtimeLabel(status.runtime)} 备用`
			: `${runtimeLabel(status.runtime)} 运行时`;
		const detail = status.diagnostic
			? status.diagnostic
			: status.validated
				? "操作响应已通过结构校验。"
				: "运行时响应未经过校验。";

		set((state) => {
			const conversations = appendTraceForTarget(
				state,
				resolveTargetRunId(state),
				"runtime",
				label,
				detail,
			);
			return {
				lastRuntimeStatus: status,
				conversations,
				activity: prependActivity(state.activity, "runtime", label, detail),
			};
		});
	},
	recordPatchApplied: () => {
		set((state) => {
			const conversations = appendTraceForTarget(
				state,
				resolveTargetRunId(state),
				"patch",
				"补丁已应用",
				"Markdown 源文档和时间线投影已更新。",
			);
			return {
				conversations,
				activity: prependActivity(
					state.activity,
					"patch",
					"补丁已应用",
					"Markdown 源文档和时间线投影已更新。",
				),
			};
		});
	},
	recordPatchRejected: () => {
		set((state) => {
			const conversations = appendTraceForTarget(
				state,
				resolveTargetRunId(state),
				"patch",
				"补丁已拒绝",
				"Markdown 源文档保持不变。",
			);
			return {
				conversations,
				activity: prependActivity(
					state.activity,
					"patch",
					"补丁已拒绝",
					"Markdown 源文档保持不变。",
				),
			};
		});
	},
});
