import type {
	AgentReference,
	AgentA2UIPayload,
	AgentRuntimeACPPermissionRequest,
	AgentRuntimeACPRuntimeAlert,
} from "@/domains/agent/api/agent";

export type AgentMessageRole = "user" | "assistant";
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
	displayAttachments?: AgentDisplayAttachment[];
	[key: string]: unknown;
}

export interface AgentMessage {
	id: string;
	role: AgentMessageRole;
	content: string;
	kind?: AgentMessageKind;
	title?: string;
	createdAt?: string;
	status?: "streaming" | "complete" | "error";
	metadata?: AgentMessageMetadata;
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
	appendAssistantDelta: (content: string, runId?: string) => void;
	bindRootRun: (runId: string) => void;
	cancelRun: (message?: string, runId?: string) => void;
	clearPermissionRequests: () => void;
	clearRuntimeAlerts: () => void;
	collapse: () => void;
	completeAssistantMessage: (content: string, runId?: string) => void;
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
	addA2UIMessage: (payload: AgentA2UIPayload, content?: string, runId?: string) => void;
	addAssistantMessage: (content: string, runId?: string) => void;
	appendThought: (thought: string, runId?: string) => void;
	setPlan: (entries: AgentACPPlanEntry[], runId?: string) => void;
	upsertToolCallMessage: (
		toolCallId: string,
		patch: Partial<AgentMessageMetadata> & {
			title?: string;
			content?: string;
			status?: AgentToolCallStatus;
			outputBlocks?: AgentACPContentBlock[];
		},
		runId?: string,
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
	) => void;
	recordRuntimeStatus: (status: AgentRuntimeStatus) => void;
	resetSession: () => void;
	setRuntimeMode: (mode: AgentRuntimeMode) => void;
	recordPatchApplied: () => void;
	recordPatchRejected: () => void;
}
