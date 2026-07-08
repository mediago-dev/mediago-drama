import type {
	AgentACPContentBlock as GeneratedAgentACPContentBlock,
	AgentACPEvent as GeneratedAgentACPEvent,
	AgentACPLocation as GeneratedAgentACPLocation,
	AgentACPPlanEntry as GeneratedAgentACPPlanEntry,
	AgentACPPermissionOption as GeneratedAgentACPPermissionOption,
	AgentACPPermissionRequest as GeneratedAgentACPPermissionRequest,
	AgentACPRuntimeAlert as GeneratedAgentACPRuntimeAlert,
	AgentACPToolCallSummary as GeneratedAgentACPToolCallSummary,
	AgentA2UIPayload as GeneratedAgentA2UIPayload,
	AgentBackendsPayload,
	AgentChatAppendRequest as GeneratedAgentChatAppendRequest,
	AgentChatStateResponse,
	AgentDocumentContext as GeneratedAgentDocumentContext,
	AgentDocumentEditEvent as GeneratedAgentDocumentEditEvent,
	AgentDocumentProposal,
	AgentDocumentToolApproval,
	AgentDocumentToolApprovalDecisionPayload,
	AgentEvent as GeneratedAgentEvent,
	AgentMessageRequest as GeneratedAgentMessageRequest,
	AgentMessageResponse,
	AgentReference as GeneratedAgentReference,
	AgentRuntimeConfigResponse,
	AgentSelection,
	AgentSelectionDecisionRequest,
	AgentSessionResponse,
	AgentSessionsResponse,
	AgentSessionStatus,
} from "@/api/types/agent";
import httpClient from "@/shared/lib/http";
import type { DocumentComment, MarkdownDocument } from "@/domains/documents/stores";
import type {
	AgentActivityItem,
	AgentConversationState,
	AgentMessage,
	AgentMessageMetadata,
} from "@/domains/agent/stores";
import { ManagedEventSource } from "@/shared/lib/sse/managed-event-source";
import { apiURL } from "@/shared/lib/api-base";
import type {
	AgentDocumentSelectionEvent as ProtocolAgentDocumentSelectionEvent,
	DocumentHeadingNode as ProtocolDocumentHeadingNode,
	DocumentRangeSelection as ProtocolDocumentRangeSelection,
	DocumentTextRange as ProtocolDocumentTextRange,
} from "@/api/types/document-tools";

export type { AgentDocumentToolName } from "@/api/types/document-tools";

export type {
	AgentACPConfigSelection,
	AgentDocumentProposal,
	AgentDocumentToolApproval,
	AgentDocumentToolApprovalDecisionPayload,
	AgentFinalResponse,
	AgentRuntimeSelectConfig,
	AgentRuntimeSelectOption,
	AgentFormField,
	AgentFormFieldOption,
	AgentFormPayload,
	AgentSelection,
	AgentSelectionDecisionRequest,
	AgentSelectionOption,
	AgentSessionStatus,
	AgentSessionSummary,
} from "@/api/types/agent";

export type AgentSession = AgentSessionResponse;

export type AgentSessionsPayload = AgentSessionsResponse;

export type AgentMessageAccepted = AgentMessageResponse;

export type AgentRuntimeConfigPayload = AgentRuntimeConfigResponse;

export type AgentReference = Omit<GeneratedAgentReference, "category" | "kind"> & {
	kind: "document" | "section" | "asset";
	category?: MarkdownDocument["category"];
};

export type AgentDocumentContext = Omit<GeneratedAgentDocumentContext, "category" | "parentId"> & {
	category?: MarkdownDocument["category"];
	parentId?: string | null;
};

export type AgentMessageRequest = Omit<
	GeneratedAgentMessageRequest,
	"comments" | "displayMetadata" | "document" | "documents" | "references"
> & {
	comments?: DocumentComment[];
	displayMetadata?: AgentMessageMetadata;
	document?: AgentDocumentContext;
	documents?: AgentDocumentContext[];
	references?: AgentReference[];
};

export type AgentChatStatePayload = Omit<AgentChatStateResponse, "activity" | "messages"> & {
	messages: AgentMessage[];
	activity: AgentActivityItem[];
	rootRunId?: string | null;
	conversations?: Record<string, AgentConversationState>;
};

export type AgentChatAppendRequest = Omit<GeneratedAgentChatAppendRequest, "messages"> & {
	messages: AgentMessage[];
};

const projectAgentPath = (projectId: string | null | undefined, path: string) => {
	const id = projectId?.trim();
	if (!id) throw new Error("projectId is required");
	return `/projects/${encodeURIComponent(id)}/agent${path}`;
};

export type AgentRuntimeACPLocation = GeneratedAgentACPLocation;

export type AgentRuntimeACPContentBlock = GeneratedAgentACPContentBlock;

export type AgentRuntimeACPPlanEntry = GeneratedAgentACPPlanEntry;

export type AgentRuntimeACPToolCallSummary = GeneratedAgentACPToolCallSummary;

export type AgentA2UIPayload = GeneratedAgentA2UIPayload;

export type AgentRuntimeACPPermissionOption = GeneratedAgentACPPermissionOption;

export type AgentRuntimeACPPermissionRequest = GeneratedAgentACPPermissionRequest;

export type AgentRuntimeACPRuntimeAlert = GeneratedAgentACPRuntimeAlert;

export type AgentRuntimeACPEvent = GeneratedAgentACPEvent;

export type AgentDocumentEditEvent = GeneratedAgentDocumentEditEvent;

export type DocumentTextRange = ProtocolDocumentTextRange;

export type DocumentHeadingNode = ProtocolDocumentHeadingNode;

export type DocumentRangeSelection = ProtocolDocumentRangeSelection;

export type AgentDocumentSelectionEvent = ProtocolAgentDocumentSelectionEvent;

type AgentRuntimeEventBase = Omit<
	GeneratedAgentEvent,
	| "acp"
	| "content"
	| "delta"
	| "documentEdit"
	| "documentProposal"
	| "documentSelection"
	| "documents"
	| "type"
>;

type AgentDocumentEditRuntimeEvent = AgentRuntimeEventBase & {
	type:
		| "agent.document.edit.started"
		| "agent.document.edit.delta"
		| "agent.document.edit.checkpoint"
		| "agent.document.edit.completed"
		| "agent.document.edit.failed";
	documentEdit: AgentDocumentEditEvent;
};

type AgentDocumentSelectionRuntimeEvent = AgentRuntimeEventBase & {
	type: "agent.document.selection.set";
	documentSelection: AgentDocumentSelectionEvent;
};

export type AgentRuntimeEvent =
	| (AgentRuntimeEventBase & { type: "agent.session.connected" })
	| (AgentRuntimeEventBase & { type: "agent.session.replay.completed" })
	| (AgentRuntimeEventBase & { type: "agent.user.message" })
	| (AgentRuntimeEventBase & { type: "agent.message.accepted" })
	| (AgentRuntimeEventBase & { type: "agent.run.started" })
	| (AgentRuntimeEventBase & { type: "agent.activity" })
	| (AgentRuntimeEventBase & { type: "agent.acp"; acp?: AgentRuntimeACPEvent })
	| (AgentRuntimeEventBase & { type: "agent.message.delta"; delta: string })
	| (AgentRuntimeEventBase & { type: "agent.message.completed"; content?: string })
	| (AgentRuntimeEventBase & { type: "agent.ui"; a2ui?: AgentA2UIPayload })
	| (AgentRuntimeEventBase & {
			type: "agent.patch.proposed";
			documentProposal?: AgentDocumentProposal;
			documents?: MarkdownDocument[];
	  })
	| AgentDocumentEditRuntimeEvent
	| AgentDocumentSelectionRuntimeEvent
	| (AgentRuntimeEventBase & { type: "agent.run.cancelled" })
	| (AgentRuntimeEventBase & { type: "agent.run.failed" })
	| (AgentRuntimeEventBase & { type: "agent.run.completed" });

export const toAgentDocumentSnapshot = (document: MarkdownDocument): AgentDocumentContext => ({
	id: document.id,
	title: document.title,
	content: document.content,
	category: document.category,
	parentId: document.parentId,
	sortOrder: document.sortOrder,
	version: document.version,
});

export const createAgentSession = async (projectId?: string | null, newSession = false) => {
	const response = await httpClient.post<AgentSession>(projectAgentPath(projectId, "/sessions"), {
		newSession,
	});
	return response.data;
};

export const agentBackendsKey = "/agent/backends";

export const getAgentBackends = async () => {
	const response = await httpClient.get<AgentBackendsPayload>(agentBackendsKey);
	return response.data;
};

export const agentRuntimeConfigKey = (projectId?: string | null) =>
	projectAgentPath(projectId, "/runtime-config");

export const getAgentRuntimeConfig = async (projectId?: string | null) => {
	const response = await httpClient.get<AgentRuntimeConfigPayload>(
		agentRuntimeConfigKey(projectId),
	);
	return response.data;
};

export const getAgentSessionStatus = async (sessionId: string, projectId?: string | null) => {
	const response = await httpClient.get<AgentSessionStatus>(
		projectAgentPath(projectId, `/sessions/${encodeURIComponent(sessionId)}/status`),
		noStoreGetConfig(),
	);
	return response.data;
};

export const cancelAgentSession = async (sessionId: string, projectId?: string | null) => {
	const response = await httpClient.post<AgentSessionStatus>(
		projectAgentPath(projectId, `/sessions/${encodeURIComponent(sessionId)}/cancel`),
	);
	return response.data;
};

export const decideAgentPermission = async (input: {
	projectId?: string | null;
	sessionId: string;
	requestId: string;
	optionId?: string;
	cancelled?: boolean;
}) => {
	const response = await httpClient.post<AgentSessionStatus>(
		projectAgentPath(
			input.projectId,
			`/sessions/${encodeURIComponent(input.sessionId)}/permission-requests/${encodeURIComponent(
				input.requestId,
			)}/decision`,
		),
		{ optionId: input.optionId, cancelled: input.cancelled },
	);
	return response.data;
};

export const agentSessionsKey = (projectId?: string | null) =>
	projectAgentPath(projectId, "/sessions");

export const listAgentSessions = async (projectId?: string | null) => {
	const response = await httpClient.get<AgentSessionsPayload>(
		agentSessionsKey(projectId),
		noStoreGetConfig(),
	);
	return response.data.sessions;
};

export const sendAgentMessage = async (request: AgentMessageRequest, projectId?: string | null) => {
	const response = await httpClient.post<AgentMessageAccepted>(
		projectAgentPath(
			projectId ?? request.projectId,
			`/sessions/${encodeURIComponent(request.sessionId)}/messages`,
		),
		request,
	);
	return response.data;
};

export const agentChatKey = (projectId?: string | null, sessionId?: string | null) => {
	if (sessionId?.trim()) {
		return projectAgentPath(projectId, `/sessions/${encodeURIComponent(sessionId.trim())}/chat`);
	}
	return projectAgentPath(projectId, "/chat");
};

export const getAgentChatState = async (projectId?: string | null, sessionId?: string | null) => {
	const response = await httpClient.get<AgentChatStatePayload>(
		agentChatKey(projectId, sessionId),
		noStoreGetConfig(),
	);
	return response.data;
};

export const appendAgentMessages = async (
	payload: AgentChatAppendRequest,
	projectId?: string | null,
) => {
	const response = await httpClient.post<AgentChatStatePayload>(
		projectAgentPath(projectId, "/chat/messages"),
		payload,
	);
	return response.data;
};

export const clearAgentChatState = async (projectId?: string | null) => {
	const response = await httpClient.delete<AgentChatStatePayload>(
		projectAgentPath(projectId, "/chat"),
	);
	return response.data;
};

export const createAgentEventSource = (
	sessionId: string,
	projectId?: string | null,
	afterEventId?: string | null,
) => {
	const initialLastEventId = afterEventId?.trim() || null;
	return new ManagedEventSource({
		initialLastEventId,
		url: (lastEventId) => agentEventSourceURL(sessionId, projectId, lastEventId),
	});
};

const agentEventSourceURL = (
	sessionId: string,
	projectId?: string | null,
	afterEventId?: string | null,
) => {
	const params = new URLSearchParams({ sessionId });
	if (afterEventId) params.set("after", afterEventId);
	const after = params.get("after");
	const query = after ? `?after=${encodeURIComponent(after)}` : "";
	return apiURL(
		projectAgentPath(projectId, `/sessions/${encodeURIComponent(sessionId)}/events`) + query,
	);
};

const noStoreGetConfig = () => ({
	params: { _: Date.now().toString() },
});

export const listDocumentToolApprovals = async (projectId?: string | null) => {
	const response = await httpClient.get<AgentDocumentToolApproval[]>(
		projectAgentPath(projectId, "/document-tool-approvals"),
	);
	return response.data;
};

export const decideDocumentToolApproval = async (
	approvalId: string,
	decision: "approved" | "rejected",
	projectId?: string | null,
	payload?: AgentDocumentToolApprovalDecisionPayload,
) => {
	const response = await httpClient.post<AgentDocumentToolApproval>(
		projectAgentPath(
			projectId,
			`/document-tool-approvals/${encodeURIComponent(approvalId)}/decision`,
		),
		{ decision, payload },
	);
	return response.data;
};

export const listAgentSelections = async (projectId?: string | null) => {
	const response = await httpClient.get<AgentSelection[]>(
		projectAgentPath(projectId, "/selections"),
	);
	return response.data;
};

export const decideAgentSelection = async (
	selectionId: string,
	decision: AgentSelectionDecisionRequest,
	projectId?: string | null,
) => {
	const response = await httpClient.post<AgentSelection>(
		projectAgentPath(projectId, `/selections/${encodeURIComponent(selectionId)}/decision`),
		decision,
	);
	return response.data;
};
