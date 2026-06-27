import { runDocumentAgent } from "@/domains/agent/lib/document-runtime";
import { refreshAgentChatTranscript } from "@/domains/agent/lib/chat-sync";
import {
	connectRemoteAgentRuntime,
	type RemoteAgentRuntimeEventMeta,
	runtimeEventTypes,
} from "@/domains/agent/lib/remote-runtime";
import { agentPromptWithReferences } from "@/domains/agent/lib/display-prompt";
import {
	acpRuntimeLogText,
	containsRuntimeLogMarkers,
	isACPToolRuntimeLog,
} from "@/domains/agent/lib/runtime-log";
import type { AgentExecutionContext } from "@/domains/agent/lib/types";
import { getEditorHandle } from "@/domains/documents/lib/editor-registry";
import {
	createDocumentOperation,
	type DocumentOperation,
} from "@/domains/documents/lib/operations";
import { inferToolKind } from "@/domains/agent/lib/tool-kind";
import {
	type AgentMessageMetadata,
	type AgentRuntimeStatus,
	useAgentStore,
} from "@/domains/agent/stores";
import { setPersistedAgentSessionId } from "@/domains/agent/stores/persistence";
import { pendingRootRunId } from "@/domains/agent/stores/constants";
import { getWorkspaceState } from "@/domains/workspace/api/workspace";
import {
	type DocumentComment,
	type DocumentOperationSource,
	type MarkdownDocument,
	selectActiveDocument,
	useDocumentsStore,
} from "@/domains/documents/stores";
import { useProjectStore } from "@/domains/projects/stores";
import {
	cancelAgentSession,
	createAgentEventSource,
	getAgentSessionStatus,
	type AgentACPConfigSelection,
	type AgentDocumentProposal,
	type AgentReference,
	type AgentRuntimeEvent,
	toAgentDocumentSnapshot,
} from "@/domains/agent/api/agent";

interface RunAgentPromptOptions {
	anchorText?: string;
	commentId?: string;
	comments?: DocumentComment[];
	displayPrompt?: string;
	displayMetadata?: AgentMessageMetadata;
	model?: AgentACPConfigSelection;
	reasoning?: AgentACPConfigSelection;
	permission?: AgentACPConfigSelection;
	references?: AgentReference[];
	reuseCurrentRun?: boolean;
	selection?: string;
	taskPrompt?: string;
}

export const runAgentPrompt = async (prompt: string, options: RunAgentPromptOptions = {}) => {
	const trimmed = prompt.trim();

	const agentStore = useAgentStore.getState();
	const context = buildExecutionContext(trimmed, options);
	if (!context) return;
	const optionTaskPrompt = options.taskPrompt?.trim() ?? "";
	const referencedPrompt = agentPromptWithReferences({
		prompt: trimmed,
		references: options.references,
	});
	const taskPrompt =
		referencedPrompt || optionTaskPrompt || defaultStructuredAgentDisplayPrompt(context);

	if (options.reuseCurrentRun) {
		agentStore.beginPendingRun();
	} else {
		agentStore.startRun(
			options.displayPrompt?.trim() ||
				referencedPrompt ||
				optionTaskPrompt ||
				defaultStructuredAgentDisplayPrompt(context),
			options.displayMetadata,
		);
	}

	try {
		if (agentStore.runtimeMode === "remote") {
			await runStreamingACPAgent(taskPrompt, context, options);
			resolveAppliedComment(context.activeDocument.id, context.commentId, taskPrompt);
			return;
		}

		await runLocalDocumentAgent(taskPrompt, context, taskPrompt);
	} catch (err) {
		agentStore.failRun(getErrorMessage(err));
	}
};

const buildExecutionContext = (
	trimmedPrompt: string,
	options: RunAgentPromptOptions,
): AgentExecutionContext | null => {
	const documentsStore = useDocumentsStore.getState();
	const activeDocument = selectActiveDocument() ?? fallbackAgentDocument();

	const ambientSelection =
		!trimmedPrompt &&
		documentsStore.selection &&
		documentsStore.selection.documentId === activeDocument.id
			? documentsStore.selection.text
			: "";
	const selection = (options.selection?.trim() || ambientSelection || "").trim();
	const comments = options.comments ?? activeDocument.comments;
	const firstOpenComment = comments.find((comment) => !comment.resolved);
	const hasOpenComments = Boolean(firstOpenComment);
	const hasReferences = (options.references?.length ?? 0) > 0;
	if (!trimmedPrompt && !selection && !options.commentId && !hasOpenComments && !hasReferences) {
		return null;
	}

	const anchorText = (
		options.anchorText ??
		(!trimmedPrompt ? firstOpenComment?.anchorText : undefined) ??
		""
	).trim();

	return {
		activeDocument,
		comments,
		documentSnapshots: documentsStore.documents.map(toAgentDocumentSnapshot),
		// Use the active project as the source of truth so the run and its streamed
		// events agree with the project filter in handleStreamingAgentEvent. documentsStore.projectId
		// lags behind navigation (it only updates after workspace state loads); preferring it here
		// would create the run against the previous project and drop every live event.
		projectId: useProjectStore.getState().activeProjectId ?? documentsStore.projectId,
		selection,
		anchorText,
		isStructuredScopedEdit: Boolean(
			selection || options.commentId || (!trimmedPrompt && hasOpenComments),
		),
		commentId: options.commentId,
	};
};

const runLocalDocumentAgent = async (
	prompt: string,
	context: AgentExecutionContext,
	commentResolutionPrompt: string,
) => {
	const agentStore = useAgentStore.getState();
	const result = await runDocumentAgent({
		prompt,
		document: context.activeDocument,
		anchorText: context.anchorText || undefined,
		selectionText: context.selection || undefined,
		comments: context.comments,
		commentId: context.commentId,
	});
	agentStore.recordRuntimeStatus(result.runtime);

	agentStore.recordActivity(
		"tool",
		"应用操作",
		`模拟运行时准备了 ${result.operations.length} 个文档操作。`,
	);
	const operationResult = useDocumentsStore
		.getState()
		.applyOperations(context.activeDocument.id, result.operations, {
			source: agentSource("agent"),
			summary: result.summary,
		});

	if (operationResult.applied > 0) {
		agentStore.recordDocumentUpdated(result.summary);
		resolveAppliedComment(context.activeDocument.id, context.commentId, commentResolutionPrompt);
		if (operationResult.rejected.length > 0) {
			agentStore.recordActivity(
				"patch",
				"模板约束拒绝",
				operationResult.rejected.map((item) => item.reason).join("\n"),
			);
		}
	} else if (operationResult.rejected.length > 0) {
		const reason = operationResult.rejected[0]?.reason ?? "模板标题受保护。";
		agentStore.recordActivity("patch", "模板约束拒绝", reason);
		agentStore.completeAssistantMessage(reason);
		agentStore.finishRun();
		return;
	} else {
		agentStore.recordActivity("patch", "文档无变化", "操作协议已运行，但没有内容发生变化。");
	}

	agentStore.completeAssistantMessage(result.message);
	agentStore.finishRun();
};

export const stopAgentRun = async () => {
	const agentStore = useAgentStore.getState();
	const sessionId = agentStore.sessionId;
	const projectId = useProjectStore.getState().activeProjectId;
	if (sessionId && projectId) {
		try {
			await cancelAgentSession(sessionId, projectId);
		} catch {
			agentStore.recordActivity("runtime", "终止请求失败", "后端未确认终止，但已释放前端输入。");
		}
	}
	agentStore.cancelRun("智能体运行已中断。");
};

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
	const seenSequences = new Set<number>();
	let latestDelta = "";
	const close = () => {
		for (const eventType of runtimeEventTypes) {
			eventSource.removeEventListener(eventType, listener);
		}
		eventSource.close();
		resumedEventStreams.delete(key);
	};
	resumedEventStreams.set(key, close);
	const activeDocument = selectActiveDocument() ?? fallbackAgentDocument();
	const context = {
		anchorText: activeDocument.title || activeDocument.id,
		activeDocument,
		getLatestDelta: () => latestDelta,
		isSelectionScoped: false,
		projectId,
		setLatestDelta: (delta: string) => {
			latestDelta = delta;
		},
	};
	function listener(event: MessageEvent) {
		const parsed = JSON.parse(event.data) as AgentRuntimeEvent;
		if (parsed.sequence && seenSequences.has(parsed.sequence)) return;
		if (parsed.sequence) seenSequences.add(parsed.sequence);
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

const runStreamingACPAgent = async (
	prompt: string,
	context: AgentExecutionContext,
	options: RunAgentPromptOptions,
) => {
	const agentStore = useAgentStore.getState();
	const { activeDocument, documentSnapshots, projectId, selection } = context;
	const agentAnchorText =
		context.anchorText || chooseAgentAnchor(activeDocument, "main", selection || undefined);
	const requestAnchorText = context.anchorText;
	let latestDelta = "";

	// The resumed stream and the runtime connection would otherwise hold two
	// SSE connections delivering the same session's events.
	if (agentStore.sessionId) {
		closeResumedAgentEventStream(agentStore.sessionId, projectId);
	}

	const connection = await connectRemoteAgentRuntime(
		(event, meta) => {
			handleStreamingAgentEvent(event, {
				anchorText: agentAnchorText,
				activeDocument,
				getLatestDelta: () => latestDelta,
				isSelectionScoped: context.isStructuredScopedEdit || Boolean(selection),
				meta,
				projectId,
				setLatestDelta: (delta) => {
					latestDelta = delta;
				},
			});
		},
		agentStore.sessionId,
		projectId,
		agentStore.lastEventId,
	);

	agentStore.setSessionId(connection.sessionId);
	if (projectId) {
		setPersistedAgentSessionId(projectId, connection.sessionId);
	}
	agentStore.markConnected();
	await syncAgentSessionStatus(connection.sessionId, projectId, { applyTerminal: false }).catch(
		() => {},
	);

	try {
		await connection.send({
			prompt,
			projectId: projectId ?? undefined,
			document: toAgentDocumentSnapshot(activeDocument),
			documents: documentSnapshots,
			references: options.references,
			anchorText: requestAnchorText || undefined,
			commentId: context.commentId,
			comments: context.comments,
			selectionText: selection || undefined,
			model: options.model,
			reasoning: options.reasoning,
			permission: options.permission,
		});

		await waitForStreamingRun(connection.sessionId, projectId);
	} finally {
		connection.close();
	}
};

const defaultStructuredAgentDisplayPrompt = (context: AgentExecutionContext) => {
	if (context.commentId) return "根据选中的批注修改文档";
	if (context.selection) return "优化选中文本";
	return "处理当前未解决批注";
};

type StreamingDocumentEditRuntimeEvent = Extract<
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

const isStreamingDocumentEditEvent = (
	event: AgentRuntimeEvent,
): event is StreamingDocumentEditRuntimeEvent =>
	event.type === "agent.document.edit.started" ||
	event.type === "agent.document.edit.delta" ||
	event.type === "agent.document.edit.checkpoint" ||
	event.type === "agent.document.edit.completed" ||
	event.type === "agent.document.edit.failed";

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
	agentStore.recordEventSequence(event.sequence);
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

const handleStreamingDocumentEditEvent = (
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

const isCurrentAgentProject = (projectId: string | null) =>
	useProjectStore.getState().activeProjectId === projectId;

const eventRunId = (event: AgentRuntimeEvent) => event.runId?.trim() || undefined;

const isLifecycleEventForCurrentRun = (event: AgentRuntimeEvent) => {
	const runId = eventRunId(event);
	if (!runId) return true;
	const currentRunId = useAgentStore.getState().rootRunId?.trim();
	// `pending-root` is a placeholder, not a real run id; a terminal event must
	// still be accepted so the run can settle and the transcript can refresh.
	if (!currentRunId || currentRunId === pendingRootRunId) return true;
	return currentRunId === runId;
};

const refreshWorkspaceStateFromBackend = async (projectId?: string) => {
	const targetProjectId = projectId ?? useProjectStore.getState().activeProjectId;
	if (!targetProjectId) return;
	try {
		const state = await getWorkspaceState(targetProjectId);
		if (!isCurrentAgentProject(targetProjectId)) return;
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState(
				state.documents,
				state.operationLog,
				state.workspaceDir,
				state.projectId ?? targetProjectId,
				state.assets,
			);
	} catch {
		useAgentStore
			.getState()
			.recordActivity("runtime", "文档同步失败", "智能体完成后刷新后端文档状态失败。");
	}
};

const syncAgentSessionStatus = async (
	sessionId: string,
	projectId: string | null,
	options: { applyTerminal: boolean; settle?: () => void },
) => {
	const status = await getAgentSessionStatus(sessionId, projectId);
	const agentStore = useAgentStore.getState();
	logPendingPermissionStatus(status, options.applyTerminal ? "poll" : "connect");
	agentStore.syncPermissionRequests(status.pendingPermissions ?? []);
	if (status.running || !options.applyTerminal) return;

	if (status.lastStatus === "cancelled") {
		agentStore.cancelRun(status.lastMessage || "智能体运行已中断。");
	} else if (status.lastStatus === "interrupted" || status.lastStatus === "paused") {
		agentStore.cancelRun(status.lastMessage || "上次运行已因应用重启暂停。");
	} else if (status.lastStatus === "failed") {
		agentStore.failRun(status.lastMessage || "智能体运行失败。");
	} else if (agentStore.isRunning) {
		agentStore.recordActivity(
			"runtime",
			"状态已同步",
			status.lastMessage || "后端运行已结束，已释放输入框。",
		);
		void refreshWorkspaceStateFromBackend(projectId ?? undefined);
		agentStore.finishRun();
	}
	await refreshAgentChatTranscript(sessionId, projectId).catch((error) =>
		debugAgentError("failed to refresh transcript after session status sync", error),
	);
	options.settle?.();
};

const debugAgentError = (message: string, error: unknown) => {
	if (!import.meta.env.DEV) return;
	console.debug(`[agent] ${message}`, error);
};

const logPendingPermissionStatus = (status: { pendingPermissions?: unknown[] }, source: string) => {
	if (!import.meta.env.DEV) return;
	console.debug("[agent] session status pendingPermissions", {
		source,
		count: status.pendingPermissions?.length ?? 0,
	});
};

const waitForStreamingRun = (sessionId: string, projectId: string | null) =>
	new Promise<void>((resolve) => {
		let settled = false;
		let isPolling = false;
		let unsubscribe = () => {};
		let interval: number | undefined;
		const settle = () => {
			if (settled) return;
			settled = true;
			unsubscribe();
			if (interval !== undefined) window.clearInterval(interval);
			resolve();
		};
		const shouldResolve = () => {
			const state = useAgentStore.getState();
			return !state.isRunning;
		};
		unsubscribe = useAgentStore.subscribe((state) => {
			if (!state.isRunning) {
				settle();
			}
		});
		if (shouldResolve()) {
			settle();
			return;
		}

		const syncStatus = async () => {
			if (settled || isPolling) return;
			if (!isCurrentAgentProject(projectId)) {
				settle();
				return;
			}
			isPolling = true;
			try {
				await syncAgentSessionStatus(sessionId, projectId, { applyTerminal: true, settle });
			} catch {
				// SSE is the primary path; polling only unlocks the UI if a terminal event is missed.
			} finally {
				isPolling = false;
			}
		};

		interval = window.setInterval(() => {
			void syncStatus();
		}, 1000);
		void syncStatus();
	});

const applyDocumentProposal = (
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

const acpRuntimeStatus: AgentRuntimeStatus = {
	runtime: "acp",
	fallback: false,
	validated: true,
};

export const agentSessionStorageKey = (projectId: string) =>
	`mediago_drama_agent_session_${projectId}`;

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

const chooseAgentAnchor = (
	document: MarkdownDocument,
	agentId: string,
	selection: string | undefined,
) => {
	if (selection?.trim()) return selection.trim();

	const matchers: Record<string, RegExp[]> = {
		characters: [/角色[^\n]*/u, /人物[^\n]*/u],
		scenes: [/场景[^\n]*/u, /空间[^\n]*/u],
		storyboard: [/分镜[^\n]*/u, /```video[\s\S]{0,120}?```/u],
		rating: [/剧情[^\n]*/u, /^#\s+.+$/mu],
		main: [/剧情[^\n]*/u, /^#\s+.+$/mu],
	};
	for (const matcher of matchers[agentId] ?? matchers.main) {
		const match = document.content.match(matcher);
		if (match?.[0]?.trim()) return compactAnchorText(match[0]);
	}

	return compactAnchorText(document.content);
};

const compactAnchorText = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, 120);

const fallbackAgentDocument = (): MarkdownDocument => ({
	id: "",
	title: "当前文档",
	content: "",
	parentId: null,
	sortOrder: 0,
	version: 1,
	updatedAt: new Date().toISOString(),
	isDirty: false,
	comments: [],
	workbenchDraft: null,
});

const agentSource = (role?: string): DocumentOperationSource => {
	const normalizedRole = role
		?.trim()
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.replace(/^[-_]+|[-_]+$/g, "");
	return normalizedRole ? `agent:${normalizedRole}` : "agent";
};

const resolveAppliedComment = (
	documentId: string,
	commentId: string | undefined,
	prompt: string,
) => {
	const documentsStore = useDocumentsStore.getState();
	const targetCommentId = commentId ?? inferFirstOpenCommentId(prompt);
	if (!targetCommentId) return;

	documentsStore.applyOperations(
		documentId,
		[
			createDocumentOperation<DocumentOperation>({
				type: "resolve_comment",
				summary: "已解决应用过的批注。",
				target: { commentId: targetCommentId },
				payload: {},
			}),
		],
		{
			source: "agent",
			summary: "已解决应用过的批注。",
		},
	);
	useAgentStore.getState().recordActivity("patch", "批注已解决", "编辑完成后已关闭对应批注。");
};

const inferFirstOpenCommentId = (prompt: string) => {
	if (
		!["评论", "批注", "反馈", "comment", "annotation"].some((keyword) => prompt.includes(keyword))
	) {
		return undefined;
	}

	const activeDocument = selectActiveDocument();
	return activeDocument?.comments.find((comment) => !comment.resolved)?.id;
};

const getErrorMessage = (err: unknown) => {
	if (err instanceof Error) return err.message;
	return "文档智能体运行失败。";
};
