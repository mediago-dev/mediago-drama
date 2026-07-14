import type {
	AgentReference,
	AgentA2UIPayload,
	AgentFormPayload,
	AgentRuntimeACPPermissionRequest,
	AgentRuntimeACPRuntimeAlert,
} from "@/domains/agent/api/agent";

export type AgentMessageRole = "user" | "assistant";
export type AgentMessagePhase = "commentary" | "final_answer";
export type AgentTurnLifecycle = "pending" | "in_progress" | "waiting" | "completed";
export type AgentTurnOutcome = "succeeded" | "failed" | "interrupted" | "cancelled" | "refused";
export type AgentMessageKind =
	| "message"
	| "thought"
	| "tool"
	| "file"
	| "plan"
	| "patch"
	| "terminal"
	| "diff"
	| "runtime";
export type ActivityKind = "message" | "tool" | "patch" | "runtime";
export type AgentRuntimeMode = "mock" | "remote";
export type AgentToolCallStatus = "pending" | "in_progress" | "completed" | "failed" | string;
export type AgentConversationStatus =
	| "pending"
	| "running"
	| "waiting"
	| "completed"
	| "failed"
	| "interrupted"
	| "paused"
	| "cancelled";

export interface AgentACPContentBlock {
	type: "text" | "diff" | "terminal" | string;
	text?: string;
	path?: string;
	oldText?: string;
	newText?: string;
	exitCode?: number;
	terminalId?: string;
}

export interface AgentACPLocation {
	path: string;
	line?: number;
}

export interface AgentACPPlanEntry {
	content: string;
	status: "pending" | "in_progress" | "completed" | string;
	priority?: string;
}

export interface AgentDisplayAttachment {
	id?: string;
	kind?: "image" | "file" | string;
	mimeType?: string;
	name: string;
	size?: number;
	url?: string;
}

// Structured rendering of a user prompt: plain text interleaved with the
// mention / skill chips the user placed in the composer. Persisted alongside
// the message so the chat bubble can re-render chips after a transcript reload.
export type AgentDisplaySegment =
	| { type: "text"; text: string }
	| { type: "mention"; title: string; category?: string; kind?: string }
	| { type: "skill"; name: string; title?: string };

export interface AgentMessageMetadata {
	toolName?: string;
	filePath?: string;
	lineRange?: [number, number];
	inputArgs?: string;
	outputResult?: string;
	acpKind?: string;
	runtimeLog?: boolean;
	toolCallId?: string;
	status?: AgentToolCallStatus;
	durationMs?: number;
	inputJson?: unknown;
	outputJson?: unknown;
	outputBlocks?: AgentACPContentBlock[];
	locations?: AgentACPLocation[];
	planEntries?: AgentACPPlanEntry[];
	bytes?: number;
	lines?: number;
	startedAt?: string;
	a2ui?: AgentA2UIPayload;
	form?: AgentFormPayload;
	displayAttachments?: AgentDisplayAttachment[];
	displaySegments?: AgentDisplaySegment[];
	[key: string]: unknown;
}

export interface AgentMessage {
	id: string;
	/** Stable identity of the item inside its agent turn. Falls back to `id` for legacy records. */
	itemId?: string;
	/** Stable turn identity. The server maps this to the run that accepted the user request. */
	turnId?: string;
	role: AgentMessageRole;
	content: string;
	kind?: AgentMessageKind;
	/** Distinguishes collapsible process narration from the durable final answer. */
	phase?: AgentMessagePhase;
	title?: string;
	createdAt?: string;
	status?: "streaming" | "complete" | "error";
	metadata?: AgentMessageMetadata;
}

/** Stable protocol identity used to route and upsert one item inside an agent turn. */
export interface AgentItemIdentity {
	turnId?: string;
	itemId?: string;
	phase?: AgentMessagePhase;
}

export interface AgentActivityItem {
	id: string;
	kind: ActivityKind;
	label: string;
	detail: string;
	createdAt?: string;
}

export interface AgentConversationState {
	runId: string;
	name?: string;
	prompt?: string;
	status: AgentConversationStatus;
	messages: AgentMessage[];
	streamingMessageId: string | null;
	children: string[];
	createdAt: string;
	updatedAt: string;
}

export interface AgentRuntimeStatus {
	runtime: "acp" | "mock" | "frontend-mock" | "unknown";
	fallback: boolean;
	validated: boolean;
	diagnostic?: string;
}

export interface AgentComposerSeed {
	focus?: boolean;
	reference?: AgentReference;
	text?: string;
}

export interface AgentChatHydrationOptions {
	sessionId?: string | null;
	rootRunId?: string | null;
	lastEventId?: string | null;
	running?: boolean;
	conversations?: Record<string, AgentConversationState>;
	pendingPermissions?: AgentRuntimeACPPermissionRequest[];
}

export type AgentRuntimeAlert = AgentRuntimeACPRuntimeAlert & {
	id: string;
	createdAt?: string;
};

export interface AgentState {
	isCollapsed: boolean;
	isConnected: boolean;
	isRunning: boolean;
	// True while the chat transcript is being fetched from the server and the
	// store has nothing to show yet. Drives a loading state instead of a cache.
	isChatHydrating: boolean;
	sessionId: string | null;
	lastEventId: string | null;
	rootRunId: string | null;
	conversations: Record<string, AgentConversationState>;
	streamingMessageId: string | null;
	activity: AgentActivityItem[];
	permissionRequests: AgentRuntimeACPPermissionRequest[];
	runtimeAlerts: AgentRuntimeAlert[];
	composerSeed: AgentComposerSeed | null;
	runtimeMode: AgentRuntimeMode;
	lastRuntimeStatus: AgentRuntimeStatus;
	addPermissionRequest: (request: AgentRuntimeACPPermissionRequest) => void;
	addRuntimeAlert: (alert: AgentRuntimeACPRuntimeAlert, runId?: string) => void;
	appendAssistantDelta: (content: string, runId?: string, identity?: AgentItemIdentity) => void;
	bindRootRun: (runId: string) => void;
	cancelRun: (message?: string, runId?: string) => void;
	clearPermissionRequests: () => void;
	clearRuntimeAlerts: () => void;
	collapse: () => void;
	completeAssistantMessage: (content: string, runId?: string, identity?: AgentItemIdentity) => void;
	consumeComposerSeed: () => void;
	expand: () => void;
	failRun: (message: string, runId?: string) => void;
	finishRun: (runId?: string) => void;
	hydrateAgentChatState: (
		messages: AgentMessage[],
		activity: AgentActivityItem[],
		options?: AgentChatHydrationOptions,
	) => void;
	markConnected: () => void;
	/**
	 * Records a server event sequence as the resume cursor and classifies it
	 * against what has already been applied. `duplicate` events (sequence at or
	 * below the cursor) should be skipped; a `gap` (sequence beyond cursor+1)
	 * means an event was missed and the transcript should be re-synced.
	 */
	applyEventSequence: (sequence?: number | null) => { duplicate: boolean; gap: boolean };
	removeMessage: (messageId: string) => void;
	replaceMessage: (messageId: string, patch: Partial<AgentMessage>) => void;
	removePermissionRequest: (requestId: string) => void;
	syncPermissionRequests: (requests: AgentRuntimeACPPermissionRequest[]) => void;
	seedComposer: (seed: AgentComposerSeed) => void;
	setSessionId: (sessionId: string) => void;
	startRun: (content: string, metadata?: AgentMessageMetadata) => void;
	addUserMessage: (content: string, metadata?: AgentMessageMetadata) => void;
	beginPendingRun: () => void;
	addA2UIMessage: (
		payload: AgentA2UIPayload,
		content?: string,
		runId?: string,
		identity?: AgentItemIdentity,
	) => void;
	addFormMessage: (
		payload: AgentFormPayload,
		content?: string,
		runId?: string,
		identity?: AgentItemIdentity,
	) => void;
	addAssistantMessage: (content: string, runId?: string, identity?: AgentItemIdentity) => void;
	appendThought: (thought: string, runId?: string, identity?: AgentItemIdentity) => void;
	setPlan: (entries: AgentACPPlanEntry[], runId?: string, identity?: AgentItemIdentity) => void;
	upsertToolCallMessage: (
		toolCallId: string,
		patch: Partial<AgentMessageMetadata> & {
			title?: string;
			content?: string;
			status?: AgentToolCallStatus;
			outputBlocks?: AgentACPContentBlock[];
		},
		runId?: string,
		identity?: AgentItemIdentity,
	) => void;
	recordActivity: (kind: ActivityKind, label: string, detail: string, runId?: string) => void;
	recordDocumentUpdated: (detail: string, runId?: string) => void;
	recordRuntimeLog: (
		input: {
			content?: string;
			outputBlocks?: AgentACPContentBlock[];
			outputJson?: unknown;
			status?: AgentToolCallStatus;
			toolCallId?: string;
		},
		runId?: string,
		identity?: AgentItemIdentity,
	) => void;
	recordRuntimeStatus: (status: AgentRuntimeStatus) => void;
	resetSession: () => void;
	setRuntimeMode: (mode: AgentRuntimeMode) => void;
	recordPatchApplied: () => void;
	recordPatchRejected: () => void;
}
