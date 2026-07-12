// Hand-written frontend API contracts mirrored by the Go agent DTOs.

import type {
	AgentDocumentSelectionEvent,
	DocumentComment,
	DocumentTextRange,
	WorkspaceDocument,
} from "@/api/types/document-tools";

import type { ProjectBrief } from "@/domains/projects/api/projects";

export interface AgentDocumentToolApproval {
	id: string;
	projectId?: string;
	toolName: string;
	documentId?: string;
	title?: string;
	summary?: string;
	status: string;
	request: AgentDocumentToolApprovalRequest;
	decisionPayload?: Record<string, unknown>;
	createdAt: string;
	decidedAt?: string;
}

export interface AgentDocumentToolApprovalRequest {
	id?: string;
	name: string;
	documentId?: string;
	title?: string;
	summary?: string;
}

export interface AgentDocumentToolApprovalDecisionPayload {
	config?: AgentDocumentToolApprovalConfig;
}

export interface AgentDocumentToolApprovalConfig {
	prompt?: string;
	saveSourceMaterial?: boolean;
}

export interface AgentSelectionOption {
	id: string;
	label: string;
	imageUrl?: string;
	description?: string;
}

export interface AgentSelectionDecision {
	optionId?: string;
	customText?: string;
	cancelled?: boolean;
	values?: Record<string, unknown>;
}

export interface AgentSelection {
	id: string;
	projectId?: string;
	sessionId?: string;
	runId?: string;
	kind?: string;
	title: string;
	prompt?: string;
	options: AgentSelectionOption[];
	allowCustom: boolean;
	status: string;
	decision?: AgentSelectionDecision;
	createdAt: string;
	decidedAt?: string;
	expiresAt?: string;
}

export interface AgentSelectionDecisionRequest {
	optionId?: string;
	customText?: string;
	cancelled?: boolean;
	values?: Record<string, unknown>;
}

export interface AgentBackend {
	id: string;
	name: string;
	command: string;
	description?: string;
	isBuiltin?: boolean;
}

export interface AgentBackendsPayload {
	backends: AgentBackend[];
	activeId: string;
}

export interface AgentSessionRequest {
	projectId?: string;
	newSession?: boolean;
}

export interface AgentSessionResponse {
	sessionId: string;
}

export interface AgentSessionSummary {
	sessionId: string;
	projectId?: string;
	title?: string;
	lastStatus?: string;
	lastMessage?: string;
	updatedAt?: string;
	running: boolean;
}

export interface AgentSessionsResponse {
	sessions: AgentSessionSummary[];
}

export interface AgentSessionStatus {
	sessionId: string;
	running: boolean;
	lastStatus?: string;
	lastMessage?: string;
	pendingPermissions?: AgentACPPermissionRequest[];
}

export interface AgentPermissionDecisionRequest {
	sessionId: string;
	requestId: string;
	optionId?: string;
	cancelled?: boolean;
}

export interface AgentDocumentContext {
	id: string;
	title: string;
	content: string;
	category?: string;
	parentId?: string;
	sortOrder?: number;
	version?: number;
}

export interface AgentChatStateResponse {
	projectId?: string;
	sessionId?: string;
	running?: boolean;
	messages: AgentChatMessageRecord[];
	activity: AgentChatActivityRecord[];
	pendingPermissions?: AgentACPPermissionRequest[];
	lastEventId?: string;
	updatedAt?: string;
}

export interface AgentChatAppendRequest {
	projectId?: string;
	messages: AgentChatMessageRecord[];
}

export interface AgentChatMessageRecord {
	id: string;
	role: string;
	content: string;
	kind?: string;
	title?: string;
	createdAt?: string;
	status?: string;
	metadata?: Record<string, unknown>;
}

export interface AgentChatActivityRecord {
	id: string;
	kind: string;
	label: string;
	detail: string;
	createdAt?: string;
}

export interface AgentConversationRecord {
	runId: string;
	name?: string;
	prompt?: string;
	status: string;
	messages: AgentChatMessageRecord[];
	streamingMessageId?: string;
	children: string[];
	createdAt: string;
	updatedAt: string;
}

export interface AgentRuntimeConfigResponse {
	model?: AgentRuntimeSelectConfig;
	reasoning?: AgentRuntimeSelectConfig;
	permission?: AgentRuntimeSelectConfig;
}

export interface AgentRuntimeSelectConfig {
	configId?: string;
	name?: string;
	source?: string;
	currentValue?: string;
	options: AgentRuntimeSelectOption[];
}

export interface AgentRuntimeSelectOption {
	value: string;
	name: string;
	description?: string;
}

export interface AgentEvent {
	id: string;
	sequence?: number;
	sessionId: string;
	projectId?: string;
	type: string;
	message: string;
	createdAt: string;
	runId?: string;
	delta?: string;
	content?: string;
	acpSessionId?: string;
	acp?: AgentACPEvent;
	documentEdit?: AgentDocumentEditEvent;
	documentSelection?: AgentDocumentSelectionEvent;
	documentProposal?: AgentDocumentProposal;
	documents?: WorkspaceDocument[];
	projectBrief?: ProjectBrief;
	a2ui?: AgentA2UIPayload;
	form?: AgentFormPayload;
}

export interface AgentA2UIPayload {
	version?: string;
	surfaceId?: string;
	messages: unknown;
}

export interface AgentFormFieldOption {
	value: string;
	label: string;
	description?: string;
}

export interface AgentFormField {
	id: string;
	label: string;
	type:
		| "select"
		| "toggle"
		| "number"
		| "text"
		| "generation_params"
		| "images"
		| "prompt_optimization";
	// generation_params only: which model catalog to render. Defaults to "image".
	kind?: "image" | "video" | "audio";
	description?: string;
	options?: AgentFormFieldOption[];
	default?: unknown;
	min?: number;
	max?: number;
	unit?: string;
	required?: boolean;
}

export interface AgentFormPayload {
	selectionId: string;
	projectId?: string;
	title: string;
	prompt?: string;
	submitLabel?: string;
	fields: AgentFormField[];
}

export interface AgentACPEvent {
	kind: string;
	toolCallId?: string;
	toolKind?: string;
	title?: string;
	status?: string;
	locations?: AgentACPLocation[];
	rawInput?: unknown;
	rawOutput?: unknown;
	content?: AgentACPContentBlock[];
	thought?: string;
	plan?: AgentACPPlanEntry[];
	permissionRequest?: AgentACPPermissionRequest;
	runtimeAlert?: AgentACPRuntimeAlert;
}

export interface AgentACPRuntimeAlert {
	severity?: string;
	title: string;
	message: string;
	reason?: string;
	detail?: string;
}

export interface AgentACPPermissionRequest {
	requestId: string;
	toolCall?: AgentACPToolCallSummary;
	options: AgentACPPermissionOption[];
	createdAt?: string;
}

export interface AgentACPToolCallSummary {
	id?: string;
	title?: string;
	kind?: string;
	status?: string;
}

export interface AgentACPPermissionOption {
	optionId: string;
	kind: string;
	name: string;
}

export interface AgentACPContentBlock {
	type: string;
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
	status: string;
	priority?: string;
}

export interface AgentDocumentEditEvent {
	documentId: string;
	streamId?: string;
	title?: string;
	parentId?: string;
	sortOrder?: number;
	mode?: string;
	delta?: string;
	content?: string;
	anchorText?: string;
	blockId?: string;
	op?: string;
	range?: DocumentTextRange;
	summary?: string;
	status?: string;
	updatedAt?: string;
	runId?: string;
	agentTag?: string;
}

export interface AgentDocumentProposal {
	documentId: string;
	title?: string;
	content?: string;
	summary?: string;
}

export interface AgentReference {
	kind: string;
	documentId: string;
	assetId?: string;
	assetKind?: string;
	blockId?: string;
	mimeType?: string;
	title: string;
	category?: string;
	url?: string;
}

export interface AgentMessageRequest {
	sessionId: string;
	projectId?: string;
	prompt: string;
	displayPrompt?: string;
	displayMetadata?: Record<string, unknown>;
	anchorText?: string;
	commentId?: string;
	comments?: DocumentComment[];
	document?: AgentDocumentContext;
	documents?: AgentDocumentContext[];
	references?: AgentReference[];
	selectionText?: string;
	model?: AgentACPConfigSelection;
	reasoning?: AgentACPConfigSelection;
	permission?: AgentACPConfigSelection;
}

export interface AgentFinalResponse {
	message: string;
	proposedDocument: AgentDocumentProposal;
	a2ui?: AgentA2UIPayload;
	form?: AgentFormPayload;
}

export interface AgentMessageResponse {
	accepted: boolean;
}

export interface AgentACPConfigSelection {
	configId?: string;
	source?: string;
	value?: string;
}
