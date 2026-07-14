import type { AgentRuntimeACPPermissionRequest } from "@/domains/agent/api/agent";
import type { AgentActionContext, AgentActions } from "./action-types";
import { pendingRootRunId } from "./constants";
import {
	agentMessageId,
	appendMessageToConversation,
	appendTraceForTarget,
	appendTraceToConversation,
	bindLatestTurnIdentity,
	completeConversationAssistantMessage,
	createConversation,
	createId,
	deriveIsRunning,
	findLastMessageIndexByIdentity,
	finishConversation,
	hasAgentItemIdentity,
	isTerminalConversationStatus,
	latestStreamingAssistantMessageId,
	latestConversationRunId,
	mapConversations,
	nonTerminalConversationStatus,
	normalizeAgentActivity,
	normalizeAgentConversations,
	normalizeAgentItemIdentity,
	normalizeAgentMessages,
	normalizeEventSequence,
	prependActivity,
	resolveTargetRunId,
	rootConversation,
	statePatchWithConversations,
	updateConversationMessages,
	withAgentItemIdentity,
} from "./conversation";
import type { AgentConversationState, AgentItemIdentity, AgentMessage } from "./types";

type LifecycleActions = Pick<
	AgentActions,
	| "addA2UIMessage"
	| "addFormMessage"
	| "addAssistantMessage"
	| "addUserMessage"
	| "beginPendingRun"
	| "addPermissionRequest"
	| "appendAssistantDelta"
	| "bindRootRun"
	| "cancelRun"
	| "clearPermissionRequests"
	| "collapse"
	| "completeAssistantMessage"
	| "consumeComposerSeed"
	| "expand"
	| "failRun"
	| "finishRun"
	| "hydrateAgentChatState"
	| "markConnected"
	| "applyEventSequence"
	| "removeMessage"
	| "replaceMessage"
	| "removePermissionRequest"
	| "resetSession"
	| "seedComposer"
	| "setRuntimeMode"
	| "setSessionId"
	| "startRun"
	| "syncPermissionRequests"
>;

export const createAgentLifecycleActions = ({
	set,
	get,
}: AgentActionContext): LifecycleActions => ({
	addPermissionRequest: (request) => {
		const requestId = request.requestId.trim();
		if (!requestId) return;
		set((state) => {
			const normalized = {
				...request,
				requestId,
				createdAt: request.createdAt ?? new Date().toISOString(),
			};
			const exists = state.permissionRequests.some((item) => item.requestId === requestId);
			return {
				permissionRequests: exists
					? state.permissionRequests.map((item) =>
							item.requestId === requestId ? normalized : item,
						)
					: [...state.permissionRequests, normalized],
			};
		});
	},
	appendAssistantDelta: (content, runId, identity) => {
		if (!content) return;

		set((state) => {
			const targetRunId = resolveTargetRunId(state, runId);
			const itemIdentity = normalizeAgentItemIdentity(identity, {
				turnId: targetRunId,
				phase: "final_answer",
			});
			const usesSemanticRouting = hasAgentItemIdentity(identity);
			const conversations = updateConversationMessages(state, targetRunId, (conversation) => {
				let streamingIndex = usesSemanticRouting
					? findLastMessageIndexByIdentity(
							conversation.messages,
							itemIdentity,
							(message) =>
								message.role === "assistant" &&
								(message.kind ?? "message") === "message" &&
								(Boolean(itemIdentity.itemId) || message.status === "streaming"),
						)
					: -1;
				if (streamingIndex < 0 && !usesSemanticRouting && conversation.streamingMessageId) {
					streamingIndex = conversation.messages.findIndex(
						(message) => message.id === conversation.streamingMessageId,
					);
				}
				const existing = streamingIndex >= 0 ? conversation.messages[streamingIndex] : undefined;
				const streamingMessageId =
					existing?.id ?? agentMessageId(itemIdentity, createId("assistant"));
				const streamingMessage = withAgentItemIdentity(
					{
						id: streamingMessageId,
						role: "assistant" as const,
						content: (existing?.content ?? "") + content,
						kind: "message" as const,
						createdAt: existing?.createdAt ?? new Date().toISOString(),
						status: "streaming" as const,
						metadata: existing?.metadata,
					},
					itemIdentity,
					{
						turnId: existing?.turnId,
						itemId: existing?.itemId ?? streamingMessageId,
						phase: existing?.phase ?? "final_answer",
					},
				);
				const messages = existing
					? conversation.messages.map((message, index) =>
							index === streamingIndex ? streamingMessage : message,
						)
					: [...conversation.messages, streamingMessage];

				return {
					...conversation,
					messages,
					streamingMessageId,
					status: nonTerminalConversationStatus(conversation.status),
					updatedAt: new Date().toISOString(),
				};
			});

			return statePatchWithConversations(state, conversations);
		});
	},
	bindRootRun: (runId) => {
		const trimmed = runId.trim();
		if (!trimmed) return;

		set((state) => {
			if (state.rootRunId === trimmed && state.conversations[trimmed]) return state;

			const pending = state.conversations[pendingRootRunId];
			const existing = state.conversations[trimmed];
			const now = new Date().toISOString();
			const source = pending ?? existing ?? createConversation(trimmed, { name: "主智能体" });
			const rootConversation: AgentConversationState = {
				...source,
				runId: trimmed,
				status: nonTerminalConversationStatus((pending ?? existing)?.status ?? "running"),
				messages: pending ? bindLatestTurnIdentity(source.messages, trimmed) : source.messages,
				updatedAt: now,
			};
			const conversations = { ...state.conversations, [trimmed]: rootConversation };
			delete conversations[pendingRootRunId];

			return {
				rootRunId: trimmed,
				conversations,
				streamingMessageId: rootConversation.streamingMessageId,
				isRunning: deriveIsRunning(conversations),
			};
		});
	},
	cancelRun: (message = "智能体运行已中断。", runId) => {
		set((state) => {
			if (!state.isRunning && !runId && !deriveIsRunning(state.conversations)) return state;

			const targetRunId = resolveTargetRunId(state, runId);
			const conversations = mapConversations(state.conversations, (conversation) => {
				if (isTerminalConversationStatus(conversation.status)) return conversation;

				const nextConversation =
					!runId || conversation.runId === targetRunId
						? appendTraceToConversation(conversation, "runtime", "运行已终止", message)
						: conversation;
				return finishConversation(nextConversation, "cancelled");
			});

			const activity = prependActivity(state.activity, "runtime", "运行已终止", message);

			return {
				conversations,
				isRunning: deriveIsRunning(conversations),
				streamingMessageId:
					rootConversation(conversations, state.rootRunId)?.streamingMessageId ?? null,
				activity,
				permissionRequests: [],
			};
		});
	},
	clearPermissionRequests: () => set({ permissionRequests: [] }),
	collapse: () => set({ isCollapsed: true }),
	completeAssistantMessage: (content, runId, identity) => {
		set((state) => {
			const targetRunId = resolveTargetRunId(state, runId);
			const conversations = updateConversationMessages(state, targetRunId, (conversation) => {
				const messages = completeConversationAssistantMessage(conversation, content, identity, {
					turnId: targetRunId,
					phase: "final_answer",
				});
				return {
					...conversation,
					messages,
					streamingMessageId: latestStreamingAssistantMessageId(messages),
					updatedAt: new Date().toISOString(),
				};
			});

			return statePatchWithConversations(state, conversations);
		});
	},
	consumeComposerSeed: () => set({ composerSeed: null }),
	expand: () => set({ isCollapsed: false }),
	failRun: (message, runId) => {
		set((state) => {
			const targetRunId = resolveTargetRunId(state, runId);
			const conversationsWithFailure = updateConversationMessages(
				state,
				targetRunId,
				(conversation) =>
					finishConversation(
						appendMessageToConversation(conversation, {
							id: createId("assistant-error"),
							role: "assistant",
							content: message,
							kind: "runtime",
							title: "运行失败",
							createdAt: new Date().toISOString(),
							status: "error",
						}),
						"failed",
					),
			);
			const conversations = finishNonTerminalConversations(conversationsWithFailure, "failed");
			const activity = prependActivity(state.activity, "runtime", "运行失败", message);

			return {
				conversations,
				isRunning: deriveIsRunning(conversations),
				streamingMessageId:
					rootConversation(conversations, state.rootRunId)?.streamingMessageId ?? null,
				activity,
				permissionRequests: [],
			};
		});
	},
	finishRun: (runId) => {
		set((state) => {
			const targetRunId = resolveTargetRunId(state, runId);
			const conversationsWithCompletion = updateConversationMessages(
				state,
				targetRunId,
				(conversation) => finishConversation(conversation, "completed"),
			);
			const conversations = finishNonTerminalConversations(
				conversationsWithCompletion,
				"completed",
			);

			return {
				conversations,
				isRunning: deriveIsRunning(conversations),
				streamingMessageId:
					rootConversation(conversations, state.rootRunId)?.streamingMessageId ?? null,
				permissionRequests: [],
			};
		});
	},
	hydrateAgentChatState: (messages, activity, options) => {
		let conversations = normalizeAgentConversations(options?.conversations ?? {});
		// Normalization re-keys conversations by their runId, so a backend rootRunId can fail to
		// match even when the data is present. Fall back to the latest conversation instead of null,
		// which would make selectAgentMessages render an empty timeline.
		let rootRunId =
			options?.rootRunId && conversations[options.rootRunId]
				? options.rootRunId
				: latestConversationRunId(conversations);
		const normalizedMessages = normalizeAgentMessages(messages);
		const isRunning = options?.running ?? deriveIsRunning(conversations);
		if (!rootRunId && normalizedMessages.length > 0) {
			const fallbackRootRunId = pendingRootRunId;
			conversations = {
				...conversations,
				[fallbackRootRunId]: createConversation(fallbackRootRunId, {
					name: "主智能体",
					status: isRunning ? "running" : "completed",
					messages: normalizedMessages,
				}),
			};
			rootRunId = fallbackRootRunId;
		}
		const root = rootRunId ? conversations[rootRunId] : undefined;
		set({
			isRunning,
			sessionId: options?.sessionId ?? null,
			lastEventId: normalizeEventSequence(options?.lastEventId),
			rootRunId,
			conversations,
			streamingMessageId: root?.streamingMessageId ?? null,
			activity: normalizeAgentActivity(activity),
			permissionRequests: isRunning ? (options?.pendingPermissions ?? []) : [],
			runtimeAlerts: [],
		});
	},
	markConnected: () => {
		set((state) => {
			if (state.isConnected) return state;

			const conversations = appendTraceForTarget(
				state,
				resolveTargetRunId(state),
				"runtime",
				"已连接",
				"已连接到本地 ACP 事件流。",
			);
			return {
				isConnected: true,
				conversations,
				activity: prependActivity(state.activity, "runtime", "已连接", "已连接到本地 ACP 事件流。"),
			};
		});
	},
	applyEventSequence: (sequence) => {
		const next = normalizeEventSequence(sequence);
		// Unsequenced events (streaming deltas, control frames) carry no cursor and
		// are always applied without dedup or gap detection.
		if (!next) return { duplicate: false, gap: false };

		const current = normalizeEventSequence(get().lastEventId);
		if (!current) {
			set({ lastEventId: next });
			return { duplicate: false, gap: false };
		}

		const currentNumber = Number(current);
		const nextNumber = Number(next);
		if (nextNumber <= currentNumber) return { duplicate: true, gap: false };

		set({ lastEventId: next });
		return { duplicate: false, gap: nextNumber > currentNumber + 1 };
	},
	removeMessage: (messageId) => {
		const trimmed = messageId.trim();
		if (!trimmed) return;
		set((state) => {
			const conversations = mapConversations(state.conversations, (conversation) => ({
				...conversation,
				messages: conversation.messages.filter((message) => message.id !== trimmed),
				updatedAt: new Date().toISOString(),
			}));
			const root = rootConversation(conversations, state.rootRunId);
			return {
				conversations,
				streamingMessageId:
					root?.streamingMessageId ??
					(state.streamingMessageId === trimmed ? null : state.streamingMessageId),
			};
		});
	},
	replaceMessage: (messageId, patch) => {
		const trimmed = messageId.trim();
		if (!trimmed) return;
		set((state) => {
			const conversations = mapConversations(state.conversations, (conversation) => {
				let conversationReplaced = false;
				const messages = conversation.messages.map((message) => {
					if (message.id !== trimmed) return message;
					conversationReplaced = true;
					return {
						...message,
						...patch,
						id: message.id,
						createdAt: patch.createdAt ?? message.createdAt,
					};
				});
				return {
					...conversation,
					messages,
					updatedAt: conversationReplaced ? new Date().toISOString() : conversation.updatedAt,
				};
			});
			const root = rootConversation(conversations, state.rootRunId);
			return {
				conversations,
				streamingMessageId:
					root?.streamingMessageId ??
					(state.streamingMessageId === trimmed ? null : state.streamingMessageId),
			};
		});
	},
	removePermissionRequest: (requestId) => {
		const trimmed = requestId.trim();
		if (!trimmed) return;
		set((state) => ({
			permissionRequests: state.permissionRequests.filter((item) => item.requestId !== trimmed),
		}));
	},
	syncPermissionRequests: (requests) => {
		set({ permissionRequests: normalizePermissionRequests(requests) });
	},
	seedComposer: (composerSeed) => {
		set({ composerSeed });
	},
	setSessionId: (sessionId) => set({ sessionId }),
	addUserMessage: (content, metadata) => {
		set((state) => {
			const id = createId("user");
			const message: AgentMessage = {
				id,
				itemId: id,
				role: "user",
				content,
				kind: "message",
				createdAt: new Date().toISOString(),
				status: "complete",
				metadata,
			};
			const conversation = createPendingRootConversation(state, {
				status: "completed",
				message,
			});
			const conversations = { ...state.conversations, [pendingRootRunId]: conversation };

			return {
				rootRunId: pendingRootRunId,
				conversations,
				streamingMessageId: null,
				activity: prependActivity(state.activity, "message", "用户请求", content),
				permissionRequests: [],
				runtimeAlerts: [],
			};
		});
	},
	beginPendingRun: () => {
		set((state) => {
			const conversation = state.conversations[pendingRootRunId];
			if (!conversation) return state;
			const conversations = {
				...state.conversations,
				[pendingRootRunId]: {
					...conversation,
					status: "running" as const,
					updatedAt: new Date().toISOString(),
				},
			};
			return {
				rootRunId: pendingRootRunId,
				conversations,
				isRunning: deriveIsRunning(conversations),
				streamingMessageId: null,
				permissionRequests: [],
				runtimeAlerts: [],
			};
		});
	},
	startRun: (content, metadata) => {
		set((state) => {
			const id = createId("user");
			const message: AgentMessage = {
				id,
				itemId: id,
				role: "user",
				content,
				kind: "message",
				createdAt: new Date().toISOString(),
				status: "complete",
				metadata,
			};
			const conversation = createPendingRootConversation(state, {
				status: "running",
				message,
			});
			const conversations = { ...state.conversations, [pendingRootRunId]: conversation };

			return {
				isRunning: true,
				rootRunId: pendingRootRunId,
				conversations,
				streamingMessageId: null,
				activity: prependActivity(state.activity, "message", "用户请求", content),
				permissionRequests: [],
				runtimeAlerts: [],
			};
		});
	},
	addA2UIMessage: (payload, content = "Agent 已生成交互界面。", runId, identity) => {
		set((state) => {
			const targetRunId = resolveTargetRunId(state, runId);
			const itemIdentity = normalizeAgentItemIdentity(identity, { turnId: targetRunId });
			const isStandaloneUI = !runId?.trim() && !state.rootRunId;
			const conversations = updateConversationMessages(state, targetRunId, (conversation) => {
				const id = agentMessageId(itemIdentity, createId("assistant-ui"));
				const nextConversation = upsertIdentityMessageInConversation(
					conversation,
					withAgentItemIdentity(
						{
							id,
							role: "assistant",
							content,
							kind: "message",
							createdAt: new Date().toISOString(),
							status: "complete",
							metadata: {
								a2ui: payload,
								runId: targetRunId,
							},
						},
						itemIdentity,
						{ itemId: id },
					),
					itemIdentity,
				);
				return isStandaloneUI ? { ...nextConversation, status: "completed" } : nextConversation;
			});

			return statePatchWithConversations(state, conversations);
		});
	},
	addFormMessage: (payload, content = "需要你确认参数。", runId, identity) => {
		set((state) => {
			const targetRunId = resolveTargetRunId(state, runId);
			const itemIdentity = normalizeAgentItemIdentity(identity, { turnId: targetRunId });
			const conversations = updateConversationMessages(state, targetRunId, (conversation) =>
				upsertIdentityMessageInConversation(
					conversation,
					withAgentItemIdentity(
						{
							id: agentMessageId(itemIdentity, createId("assistant-form")),
							role: "assistant",
							content,
							kind: "message",
							createdAt: new Date().toISOString(),
							status: "complete",
							metadata: {
								form: payload,
								runId: targetRunId,
							},
						},
						itemIdentity,
					),
					itemIdentity,
				),
			);
			return statePatchWithConversations(state, conversations);
		});
	},
	addAssistantMessage: (content, runId, identity) => {
		set((state) => {
			const targetRunId = resolveTargetRunId(state, runId);
			const itemIdentity = normalizeAgentItemIdentity(identity, {
				turnId: targetRunId,
				phase: "final_answer",
			});
			const conversations = updateConversationMessages(state, targetRunId, (conversation) =>
				upsertIdentityMessageInConversation(
					conversation,
					withAgentItemIdentity(
						{
							id: agentMessageId(itemIdentity, createId("assistant")),
							role: "assistant",
							content,
							kind: "message",
							createdAt: new Date().toISOString(),
							status: "complete",
						},
						itemIdentity,
						{ phase: "final_answer" },
					),
					itemIdentity,
				),
			);

			return statePatchWithConversations(state, conversations);
		});
	},
	resetSession: () =>
		set({
			sessionId: null,
			lastEventId: null,
			isConnected: false,
			isRunning: false,
			rootRunId: null,
			conversations: {},
			streamingMessageId: null,
			permissionRequests: [],
			runtimeAlerts: [],
		}),
	setRuntimeMode: (runtimeMode) => {
		set({ runtimeMode });
	},
});

const upsertIdentityMessageInConversation = (
	conversation: AgentConversationState,
	message: AgentMessage,
	identity: AgentItemIdentity,
) => {
	if (!identity.itemId) return appendMessageToConversation(conversation, message);
	const existingIndex = findLastMessageIndexByIdentity(conversation.messages, identity);
	if (existingIndex < 0) return appendMessageToConversation(conversation, message);
	const existing = conversation.messages[existingIndex];
	const messages = [...conversation.messages];
	messages[existingIndex] = {
		...message,
		id: existing.id,
		createdAt: existing.createdAt ?? message.createdAt,
	};
	return {
		...conversation,
		messages,
		updatedAt: new Date().toISOString(),
	};
};

const createPendingRootConversation = (
	state: {
		conversations: Record<string, AgentConversationState>;
		rootRunId: string | null;
	},
	{
		message,
		status,
	}: {
		message: AgentMessage;
		status: AgentConversationState["status"];
	},
) => {
	const currentRoot = rootConversation(state.conversations, state.rootRunId);
	return createConversation(pendingRootRunId, {
		children: currentRoot?.children ?? [],
		createdAt: currentRoot?.createdAt,
		messages: [...(currentRoot?.messages ?? []), message],
		name: currentRoot?.name ?? "主智能体",
		prompt: currentRoot?.prompt,
		status,
		streamingMessageId: null,
	});
};

const normalizePermissionRequests = (
	requests: AgentRuntimeACPPermissionRequest[],
): AgentRuntimeACPPermissionRequest[] => {
	const seen = new Set<string>();
	const normalized: AgentRuntimeACPPermissionRequest[] = [];
	for (const request of requests) {
		const requestId = request.requestId.trim();
		if (!requestId || seen.has(requestId)) continue;
		seen.add(requestId);
		normalized.push({
			...request,
			requestId,
			createdAt: request.createdAt ?? new Date().toISOString(),
		});
	}
	return normalized;
};

const finishNonTerminalConversations = (
	conversations: Record<string, AgentConversationState>,
	status: Extract<AgentConversationState["status"], "completed" | "failed" | "cancelled">,
) =>
	// The backend permits only one active run per session. Once that session
	// reaches a terminal state, every locally stale waiting/running projection
	// must converge too or the global isRunning selector remains stuck forever.
	mapConversations(conversations, (conversation) =>
		isTerminalConversationStatus(conversation.status)
			? conversation
			: finishConversation(conversation, status),
	);
