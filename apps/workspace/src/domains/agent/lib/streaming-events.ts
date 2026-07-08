import { createAgentEventSource, type AgentRuntimeEvent } from "@/domains/agent/api/agent";
import { refreshAgentChatTranscript } from "@/domains/agent/lib/chat-sync";
import {
	handleStreamingDocumentEditEvent,
	applyDocumentProposal,
	isStreamingDocumentEditEvent,
} from "@/domains/agent/lib/document-streaming";
import type { RemoteAgentRuntimeEventMeta } from "@/domains/agent/lib/remote-runtime";
import { runtimeEventTypes } from "@/domains/agent/lib/remote-runtime";
import {
	acpRuntimeStatus,
	debugAgentError,
	eventRunId,
	fallbackAgentDocument,
	isCurrentAgentProject,
	refreshWorkspaceStateFromBackend,
} from "@/domains/agent/lib/runtime-shared";
import {
	acpRuntimeLogText,
	containsRuntimeLogMarkers,
	isACPToolRuntimeLog,
} from "@/domains/agent/lib/runtime-log";
import { syncAgentSessionStatus } from "@/domains/agent/lib/session-sync";
import { inferToolKind } from "@/domains/agent/lib/tool-kind";
import { useAgentStore } from "@/domains/agent/stores";
import { pendingRootRunId } from "@/domains/agent/stores/constants";
import { getEditorHandle } from "@/domains/documents/lib/editor-registry";
import {
	type MarkdownDocument,
	selectActiveDocument,
	useDocumentsStore,
} from "@/domains/documents/stores";

// Routes live and resumed SSE runtime events into the agent store: assistant
// delta buffering, ACP updates, document streaming, run lifecycle, and the
// resumed-session event streams.

const resumedEventStreams = new Map<string, () => void>();
const assistantDeltaFlushDelayMs = 40;
const pendingAssistantDeltas = new Map<
	string,
	{ content: string; runId?: string; timer: ReturnType<typeof setTimeout> | null }
>();

const resumedEventStreamKey = (projectId: string, sessionId: string) => `${projectId}:${sessionId}`;
const assistantDeltaBufferKey = (runId?: string) => runId?.trim() || "__default__";

const queueAssistantDelta = (content: string, runId?: string) => {
	if (!content) return;
	const key = assistantDeltaBufferKey(runId);
	const pending = pendingAssistantDeltas.get(key);
	if (pending) {
		pending.content += content;
		return;
	}
	const next = {
		content,
		runId,
		timer: setTimeout(() => flushAssistantDelta(runId), assistantDeltaFlushDelayMs),
	};
	pendingAssistantDeltas.set(key, next);
};

const flushAssistantDelta = (runId?: string) => {
	const key = assistantDeltaBufferKey(runId);
	const pending = pendingAssistantDeltas.get(key);
	if (!pending) return;
	pendingAssistantDeltas.delete(key);
	if (pending.timer) clearTimeout(pending.timer);
	useAgentStore.getState().appendAssistantDelta(pending.content, pending.runId);
};

const flushAllAssistantDeltas = () => {
	for (const pending of pendingAssistantDeltas.values()) {
		if (pending.timer) clearTimeout(pending.timer);
		useAgentStore.getState().appendAssistantDelta(pending.content, pending.runId);
	}
	pendingAssistantDeltas.clear();
};

export const closeResumedAgentEventStream = (sessionId: string, projectId: string | null) => {
	if (!projectId) return;
	resumedEventStreams.get(resumedEventStreamKey(projectId, sessionId.trim()))?.();
};

export const closeAllResumedAgentEventStreams = () => {
	for (const close of resumedEventStreams.values()) {
		close();
	}
	flushAllAssistantDeltas();
};

const transcriptResyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const transcriptResyncDelayMs = 300;

// Debounced authoritative re-sync triggered when a live event sequence gap reveals
// a missed event (e.g. one dropped from a full subscriber buffer). Coalesces bursts
// per session so a run of gaps issues a single transcript fetch.
const scheduleTranscriptResync = (
	sessionId: string | null | undefined,
	projectId: string | null,
) => {
	const trimmedSessionId = sessionId?.trim();
	if (!trimmedSessionId || !projectId) return;
	const key = resumedEventStreamKey(projectId, trimmedSessionId);
	const existing = transcriptResyncTimers.get(key);
	if (existing) clearTimeout(existing);
	transcriptResyncTimers.set(
		key,
		setTimeout(() => {
			transcriptResyncTimers.delete(key);
			void refreshAgentChatTranscript(trimmedSessionId, projectId).catch((error) =>
				debugAgentError("failed to resync transcript after sequence gap", error),
			);
		}, transcriptResyncDelayMs),
	);
};

export type StreamingEventContext = Parameters<typeof handleStreamingAgentEvent>[1];

// Builds the per-stream context handed to handleStreamingAgentEvent, owning the
// rolling `latestDelta` tail. Shared by the live run connection and the resume
// stream so both feed events through one consistent shape.
export const createStreamingEventContext = (input: {
	activeDocument: MarkdownDocument;
	anchorText: string;
	isSelectionScoped: boolean;
	projectId: string | null;
}): StreamingEventContext => {
	let latestDelta = "";
	return {
		anchorText: input.anchorText,
		activeDocument: input.activeDocument,
		getLatestDelta: () => latestDelta,
		isSelectionScoped: input.isSelectionScoped,
		projectId: input.projectId,
		setLatestDelta: (delta: string) => {
			latestDelta = delta;
		},
	};
};

export const resumeAgentSessionEventStream = (
	sessionId: string,
	projectId: string | null,
	afterEventId?: string | null,
) => {
	const trimmedSessionId = sessionId.trim();
	if (!trimmedSessionId || !projectId) return;
	const key = resumedEventStreamKey(projectId, trimmedSessionId);
	if (resumedEventStreams.has(key)) return;

	const eventSource = createAgentEventSource(trimmedSessionId, projectId, afterEventId);
	const close = () => {
		for (const eventType of runtimeEventTypes) {
			eventSource.removeEventListener(eventType, listener);
		}
		eventSource.close();
		resumedEventStreams.delete(key);
	};
	resumedEventStreams.set(key, close);
	const activeDocument = selectActiveDocument() ?? fallbackAgentDocument();
	const context = createStreamingEventContext({
		activeDocument,
		anchorText: activeDocument.title || activeDocument.id,
		isSelectionScoped: false,
		projectId,
	});
	function listener(event: MessageEvent) {
		const parsed = JSON.parse(event.data) as AgentRuntimeEvent;
		// Dedup is centralized in handleStreamingAgentEvent via applyEventSequence,
		// so the resume stream no longer keeps its own seen-sequence set.
		handleStreamingAgentEvent(parsed, context);
		if (
			parsed.type === "agent.run.completed" ||
			parsed.type === "agent.run.cancelled" ||
			parsed.type === "agent.run.failed"
		) {
			window.setTimeout(() => {
				if (!useAgentStore.getState().isRunning) close();
			}, 0);
		}
	}
	for (const eventType of runtimeEventTypes) {
		eventSource.addEventListener(eventType, listener);
	}
};

const handleACPAgentEvent = (event: Extract<AgentRuntimeEvent, { type: "agent.acp" }>) => {
	const agentStore = useAgentStore.getState();
	const acp = event.acp;
	const runId = eventRunId(event);
	if (!acp) {
		agentStore.recordActivity("runtime", "ACP", event.message || "ACP 更新缺少负载。", runId);
		return;
	}

	if (acp.kind === "thought") {
		agentStore.appendThought(acp.thought || event.message, runId);
		return;
	}

	if (acp.kind === "runtimeLog" || isACPToolRuntimeLog(acp)) {
		agentStore.recordRuntimeLog(
			{
				content: acpRuntimeLogText(acp) || event.message,
				outputBlocks: acp.content,
				outputJson: acp.rawOutput,
				status: acp.status,
				toolCallId: acp.toolCallId?.trim() || event.id,
			},
			runId,
		);
		return;
	}

	if (acp.kind === "toolCall" || acp.kind === "toolCallUpdate") {
		const toolCallId = acp.toolCallId?.trim() || event.id;
		const title = acp.title?.trim();
		const displayTitle = displayACPToolTitle(title, toolCallId);
		agentStore.upsertToolCallMessage(
			toolCallId,
			{
				title: displayTitle,
				toolName: displayTitle,
				acpKind: acp.toolKind || (displayTitle ? inferToolKind(displayTitle) : undefined),
				status: acp.status,
				inputJson: acp.rawInput,
				outputJson: acp.rawOutput,
				outputBlocks: acp.content,
				locations: acp.locations,
				content: event.message,
			},
			runId,
		);
		return;
	}

	if (acp.kind === "plan") {
		agentStore.setPlan(acp.plan ?? [], runId);
		return;
	}

	if (acp.kind === "permissionRequest" && acp.permissionRequest) {
		agentStore.addPermissionRequest(acp.permissionRequest);
		return;
	}

	if (acp.kind === "permissionResolved" || acp.kind === "permissionExpired") {
		const requestId = acp.permissionRequest?.requestId?.trim();
		if (requestId) {
			agentStore.removePermissionRequest(requestId);
		}
		if (acp.status === "expired") {
			agentStore.recordActivity(
				"runtime",
				"权限请求超时",
				event.message || "权限请求长时间未确认，已自动取消。",
				runId,
			);
		}
		return;
	}

	if ((acp.kind === "mcpUnavailable" || acp.kind === "runtimeError") && acp.runtimeAlert) {
		agentStore.addRuntimeAlert(acp.runtimeAlert, runId);
		return;
	}

	agentStore.recordActivity("runtime", "ACP", event.message || `ACP 更新：${acp.kind}`, runId);
};

const displayACPToolTitle = (title: string | undefined, toolCallId: string) => {
	const trimmed = title?.trim();
	if (
		!trimmed ||
		trimmed === toolCallId ||
		trimmed === "工具调用" ||
		trimmed === "ACP 工具调用" ||
		trimmed === "tool call" ||
		trimmed === "tool_call" ||
		/^\d{4}-\d{2}-\d{2}T\d{2}/.test(trimmed)
	) {
		return undefined;
	}
	return trimmed;
};

export const handleStreamingAgentEvent = (
	event: AgentRuntimeEvent,
	context: {
		anchorText: string;
		activeDocument: MarkdownDocument;
		getLatestDelta: () => string;
		isSelectionScoped: boolean;
		meta?: RemoteAgentRuntimeEventMeta;
		projectId: string | null;
		setLatestDelta: (delta: string) => void;
	},
) => {
	if (!isCurrentAgentProject(context.projectId)) return;
	if (event.projectId && event.projectId !== context.projectId) return;

	const agentStore = useAgentStore.getState();
	// Central sequence reconciliation for both the live run stream and the resume
	// stream: skip events already applied, and re-sync the authoritative transcript
	// when a sequence gap reveals a missed (e.g. buffer-dropped) event.
	const { duplicate, gap } = agentStore.applyEventSequence(event.sequence);
	if (duplicate) return;
	if (gap) scheduleTranscriptResync(event.sessionId || agentStore.sessionId, context.projectId);
	const runId = eventRunId(event);
	// A transcript hydrate during a live run collapses the store onto the
	// `pending-root` placeholder (the backend chat state carries no runId), which
	// would otherwise strand every later live event in a separate conversation and
	// make lifecycle events fail isLifecycleEventForCurrentRun — leaving the
	// timeline frozen until a manual page refresh. Re-bind the placeholder to the
	// live run id so updates land in the active conversation and the run can finish.
	if (runId && agentStore.isRunning && agentStore.rootRunId === pendingRootRunId) {
		agentStore.bindRootRun(runId);
	}
	if (event.type !== "agent.message.delta") {
		flushAssistantDelta(runId);
	}
	if (event.type === "agent.user.message") {
		return;
	}
	if (event.type === "agent.session.replay.completed") {
		// Replayed history may re-add permission requests the backend already
		// resolved or expired; reconcile against the live pending list.
		const sessionId = event.sessionId?.trim() || agentStore.sessionId;
		if (sessionId) {
			void syncAgentSessionStatus(sessionId, context.projectId, { applyTerminal: false }).catch(
				() => {},
			);
		}
		return;
	}
	if (event.type === "agent.message.accepted") {
		agentStore.recordActivity(
			"runtime",
			"请求已接收",
			event.message || "本地智能体已接收请求。",
			runId,
		);
		return;
	}

	if (event.type === "agent.run.started") {
		if (runId) agentStore.bindRootRun(runId);
		agentStore.recordActivity(
			"runtime",
			"运行开始",
			event.message || "本地智能体开始运行。",
			runId,
		);
		return;
	}

	if (event.type === "agent.message.delta" && event.delta) {
		queueAssistantDelta(event.delta, runId);
		const nextDelta = `${context.getLatestDelta()}${event.delta}`.slice(-180);
		context.setLatestDelta(nextDelta);
		return;
	}

	if (event.type === "agent.acp") {
		handleACPAgentEvent(event);
		return;
	}

	if (event.type === "agent.activity") {
		// Legacy/mock fallback: upgraded ACP runtimes send structured agent.acp events instead.
		if (containsRuntimeLogMarkers(event.message)) {
			agentStore.recordRuntimeLog(
				{
					content: event.message,
					status: "failed",
					toolCallId: event.id,
				},
				runId,
			);
			return;
		}
		const activity = splitActivityMessage(event.message);
		agentStore.recordActivity(
			isRuntimeActivity(event.message) ? "runtime" : "tool",
			activity.label,
			activity.detail,
			runId,
		);
		return;
	}

	if (event.type === "agent.message.completed") {
		agentStore.completeAssistantMessage(event.content || event.message, runId);
		return;
	}

	if (event.type === "agent.ui" && event.a2ui) {
		agentStore.addA2UIMessage(event.a2ui, event.message, runId);
		return;
	}

	if (event.type === "agent.ui" && event.form) {
		agentStore.addFormMessage(event.form, event.message, runId);
		return;
	}

	if (isStreamingDocumentEditEvent(event)) {
		handleStreamingDocumentEditEvent(event, { ...context, runId });
		return;
	}

	if (event.type === "agent.document.selection.set") {
		const selection = event.documentSelection;
		const editorHandle = getEditorHandle();
		if (selection && editorHandle?.documentId === selection.documentId) {
			editorHandle.setSelection(selection.selection);
		}
		return;
	}

	if (event.type === "agent.patch.proposed" && event.documentProposal) {
		agentStore.recordActivity(
			"patch",
			"文档方案",
			event.documentProposal.summary || "智能体已生成文档更新方案。",
			runId,
		);
		if (event.documents && event.documents.length > 0) {
			useDocumentsStore.getState().hydrateWorkspaceDocuments({
				workspaceDir: useDocumentsStore.getState().workspaceDir,
				projectId: event.projectId ?? context.projectId ?? undefined,
				documents: event.documents,
			});
			agentStore.recordDocumentUpdated(
				event.documentProposal.summary || "已由后端应用文档方案。",
				runId,
			);
		} else {
			applyDocumentProposal(context.activeDocument, event.documentProposal);
		}
		return;
	}

	if (event.type === "agent.run.failed") {
		if (context.meta?.replay || !isLifecycleEventForCurrentRun(event)) return;
		agentStore.failRun(event.message, runId);
		void refreshAgentChatTranscript(
			event.sessionId || agentStore.sessionId,
			context.projectId,
		).catch((error) => debugAgentError("failed to refresh transcript after run failure", error));
		return;
	}

	if (event.type === "agent.run.cancelled") {
		if (context.meta?.replay || !isLifecycleEventForCurrentRun(event)) return;
		agentStore.cancelRun(event.message || "智能体运行已中断。", runId);
		void refreshAgentChatTranscript(
			event.sessionId || agentStore.sessionId,
			context.projectId,
		).catch((error) =>
			debugAgentError("failed to refresh transcript after run cancellation", error),
		);
		return;
	}

	if (event.type === "agent.run.completed") {
		if (context.meta?.replay || !isLifecycleEventForCurrentRun(event)) return;
		agentStore.recordRuntimeStatus(acpRuntimeStatus);
		void refreshWorkspaceStateFromBackend(event.projectId ?? context.projectId ?? undefined);
		agentStore.finishRun(runId);
		void refreshAgentChatTranscript(
			event.sessionId || agentStore.sessionId,
			context.projectId,
		).catch((error) => debugAgentError("failed to refresh transcript after run completion", error));
	}
};

const isLifecycleEventForCurrentRun = (event: AgentRuntimeEvent) => {
	const runId = eventRunId(event);
	if (!runId) return true;
	const currentRunId = useAgentStore.getState().rootRunId?.trim();
	// `pending-root` is a placeholder, not a real run id; a terminal event must
	// still be accepted so the run can settle and the transcript can refresh.
	if (!currentRunId || currentRunId === pendingRootRunId) return true;
	return currentRunId === runId;
};

const splitActivityMessage = (message: string) => {
	const trimmed = message.trim();
	const separator = trimmed.search(/[：:]/);
	if (separator > 0 && separator < 18) {
		return {
			label: trimmed.slice(0, separator).trim(),
			detail: trimmed.slice(separator + 1).trim() || trimmed,
		};
	}

	return {
		label: "智能体动作",
		detail: trimmed || "智能体正在处理请求。",
	};
};

const isRuntimeActivity = (message: string) =>
	/(^|\s)(ACP|MCP)\b|会话|运行时|停止原因|stderr|旧会话|恢复失败|载入失败|刷新\s*mediago_drama/i.test(
		message,
	);
