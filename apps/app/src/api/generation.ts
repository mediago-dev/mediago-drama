import httpClient from "@/lib/http";
import type { GenerationKind } from "@/lib/stores/generation-draft";

export type { GenerationKind };

export interface GenerationParamOption {
	label: string;
	value: string;
}

export interface GenerationParam {
	name: string;
	label: string;
	type: "select" | "number" | "boolean" | "text";
	default?: unknown;
	options?: GenerationParamOption[];
	required?: boolean;
	min?: number;
	max?: number;
	help?: string;
}

export type GenerationProvider =
	| "openai"
	| "google"
	| "volcengine"
	| "dmx"
	| "openrouter"
	| "jimeng";
export type GenerationProviderType = "official" | "aggregator" | "local";
export type GenerationRouteStatus = "available" | "planned" | "gated";

export interface GenerationProviderInfo {
	id: GenerationProvider;
	label: string;
	providerType: GenerationProviderType;
}

export interface GenerationRoute {
	id: string;
	familyId: string;
	versionId: string;
	label: string;
	kind: GenerationKind;
	provider: GenerationProvider;
	model: string;
	adapter: string;
	docUrl: string;
	async: boolean;
	supportsReferenceUrls: boolean;
	status: GenerationRouteStatus;
	statusReason?: string;
	params: GenerationParam[];
	legacyModelId?: string;
	configured?: boolean;
}

export interface GenerationFamily {
	id: string;
	label: string;
	kind: GenerationKind;
	description?: string;
}

export interface GenerationVersion {
	id: string;
	familyId: string;
	label: string;
	kind: GenerationKind;
	canonicalModel: string;
	capabilities: {
		async: boolean;
		supportsReferenceUrls: boolean;
	};
}

export interface GenerationModel {
	id: string;
	label: string;
	kind: GenerationKind;
	provider: string;
	model: string;
	adapter: string;
	docUrl: string;
	async: boolean;
	supportsReferenceUrls: boolean;
	params: GenerationParam[];
}

export interface GenerationModelsResponse {
	families: GenerationFamily[];
	versions: GenerationVersion[];
	routes: GenerationRoute[];
	models: GenerationModel[];
	providers: GenerationProviderInfo[];
}

export interface GenerationAsset {
	kind: GenerationKind;
	url?: string;
	base64?: string;
	mimeType?: string;
}

export interface GenerationUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export interface GenerationMessageRequest {
	kind: GenerationKind;
	conversationId?: string;
	sessionId?: string;
	scopeId?: string;
	routeId: string;
	familyId?: string;
	versionId?: string;
	provider?: GenerationProvider;
	modelId: string;
	model: string;
	prompt: string;
	referenceUrls: string[];
	referenceAssetIds: string[];
	params: Record<string, unknown>;
}

export interface GenerationMessageResponse {
	id: string;
	role: "assistant";
	status: string;
	message: string;
	assets: GenerationAsset[];
	usage: GenerationUsage;
	error?: string;
}

export interface GenerationTask {
	id: string;
	conversationId?: string;
	sessionId?: string;
	kind: GenerationKind;
	routeId: string;
	familyId: string;
	versionId: string;
	provider: GenerationProvider;
	modelId: string;
	model: string;
	prompt: string;
	referenceUrls: string[];
	referenceAssetIds: string[];
	params: Record<string, unknown>;
	status: string;
	message: string;
	assets: GenerationAsset[];
	usage: GenerationUsage;
	error?: string;
	createdAt: string;
	updatedAt: string;
	durationMs?: number;
	attempts?: GenerationTaskAttempt[];
	retryCount: number;
	lastAttemptAt?: string;
}

export interface GenerationTaskAttempt {
	id: string;
	taskId: string;
	action: string;
	status: string;
	message?: string;
	error?: string;
	createdAt: string;
}

export interface GenerationTasksResponse {
	tasks: GenerationTask[];
}

export interface GenerationConversation {
	id: string;
	sessionId?: string;
	scopeId: string;
	kind: GenerationKind;
	title: string;
	taskCount: number;
	latestPrompt?: string;
	createdAt: string;
	updatedAt: string;
}

export interface GenerationConversationsResponse {
	conversations: GenerationConversation[];
}

export interface CreateGenerationConversationRequest {
	sessionId?: string;
	scopeId?: string;
	kind: GenerationKind;
	title: string;
}

export const generationModelsKey = "/generation/models";
export const generationTasksKey = "/generation/tasks";
export const generationConversationsKey = "/generation/sessions";
export const defaultGenerationConversationScopeId = "studio";
const generationRequestTimeoutMs = 1_000_000;

export const getGenerationModels = async () => {
	const response = await httpClient.get<GenerationModelsResponse>(generationModelsKey);
	return response.data;
};

export const generationTasksQueryKey = (
	conversationId?: string | null,
	kind?: GenerationKind,
	scopeId = defaultGenerationConversationScopeId,
) => [generationTasksKey, scopeId, conversationId?.trim() || "", kind ?? ""] as const;

export const generationConversationsQueryKey = (
	kind?: GenerationKind,
	scopeId = defaultGenerationConversationScopeId,
) => [generationConversationsKey, scopeId, kind ?? ""] as const;

export const generationTaskQueryKey = (id: string) => [generationTasksKey, id] as const;

export const getGenerationTasks = async (
	conversationId?: string | null,
	kind?: GenerationKind,
	scopeId = defaultGenerationConversationScopeId,
) => {
	void scopeId;
	const sessionId = conversationId?.trim();
	const response = await httpClient.get<GenerationTasksResponse>(
		sessionId
			? `${generationConversationsKey}/${encodeURIComponent(sessionId)}/tasks`
			: generationTasksKey,
		{
		params: {
			...(kind ? { kind } : {}),
		},
		},
	);
	return { ...response.data, tasks: response.data.tasks.map(normalizeGenerationTask) };
};

export const getGenerationTask = async (id: string) => {
	const response = await httpClient.get<GenerationTask>(
		`${generationTasksKey}/${encodeURIComponent(id)}`,
	);
	return response.data;
};

export const getGenerationConversations = async (
	kind?: GenerationKind,
	scopeId = defaultGenerationConversationScopeId,
) => {
	void scopeId;
	const response = await httpClient.get<GenerationConversationsResponse>(
		generationConversationsKey,
		{
			params: {
				...(kind ? { kind } : {}),
			},
		},
	);
	const sessions =
		(response.data as { sessions?: GenerationConversation[]; conversations?: GenerationConversation[] })
			.sessions ??
		(response.data as { sessions?: GenerationConversation[]; conversations?: GenerationConversation[] })
			.conversations ??
		[];
	return { ...response.data, conversations: sessions.map(normalizeGenerationConversation) };
};

export const createGenerationConversation = async (
	request: CreateGenerationConversationRequest,
) => {
	const rawRequest = request as CreateGenerationConversationRequest & { id?: string };
	const response = await httpClient.post<GenerationConversation>(
		generationConversationsKey,
		{
			sessionId: request.sessionId ?? rawRequest.id,
			kind: request.kind,
			title: request.title,
		},
	);
	return normalizeGenerationConversation(response.data);
};

export const sendGenerationMessage = async (request: GenerationMessageRequest) => {
	const payload = generationMessagePayload(request);
	const response = await httpClient.post<GenerationMessageResponse>(
		`${generationConversationsKey}/${encodeURIComponent(payload.sessionId)}/messages`,
		payload,
		{
			timeout: generationRequestTimeoutMs,
		},
	);
	return response.data;
};

const generationMessagePayload = (request: GenerationMessageRequest) => {
	const sessionId =
		request.sessionId?.trim() ||
		request.conversationId?.trim() ||
		defaultGenerationConversationScopeId;
	const payload = { ...request };
	delete payload.conversationId;
	delete payload.scopeId;
	return { ...payload, sessionId };
};

const normalizeGenerationConversation = (conversation: GenerationConversation) => {
	const sessionId = conversation.sessionId ?? conversation.id;
	return {
		...conversation,
		id: sessionId,
		sessionId,
		scopeId: conversation.scopeId ?? sessionId,
	};
};

const normalizeGenerationTask = (task: GenerationTask) => {
	const sessionId = task.sessionId ?? task.conversationId ?? "";
	return {
		...task,
		sessionId,
		conversationId: sessionId,
	};
};
