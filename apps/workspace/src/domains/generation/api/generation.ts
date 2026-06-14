import httpClient from "@/shared/lib/http";
import { apiURL } from "@/shared/lib/api-base";
import { ManagedEventSource } from "@/shared/lib/sse/managed-event-source";
import type {
	Capabilities,
	CreateGenerationConversationRequest as GeneratedCreateGenerationConversationRequest,
	GenerationAsset as GeneratedGenerationAsset,
	GenerationConversationRecord,
	GenerationConversationsResponse as GeneratedGenerationConversationsResponse,
	GenerationMessageRequest as GeneratedGenerationMessageRequest,
	GenerationMessageResponse as GeneratedGenerationMessageResponse,
	GenerationModelsResponse as GeneratedGenerationModelsResponse,
	GenerationNotificationEvent as GeneratedGenerationNotificationEvent,
	GenerationNotificationRecord,
	GenerationNotificationsResponse as GeneratedGenerationNotificationsResponse,
	GenerationNotificationTarget,
	GenerationPreferenceRecord,
	GenerationTaskAttemptRecord,
	GenerationTaskRecord,
	GenerationTasksResponse as GeneratedGenerationTasksResponse,
	GenerationTextStreamEvent as GeneratedGenerationTextStreamEvent,
	GenerationUsage as GeneratedGenerationUsage,
	Kind,
	ModelFamily,
	ParamCombo,
	ParamGroupID,
	ModelRoute,
	ModelSpec,
	ModelVersion,
	ParamOption,
	ParamSpec,
	RouteParamGroup,
	ProviderInfo,
	ProviderType,
	RouteStatus,
	UpdateGenerationPreferenceRequest as GeneratedUpdateGenerationPreferenceRequest,
} from "@/api/types/generation";

export type GenerationKind = Kind;
export type GenerationProvider = string;
export type GenerationProviderInfo = ProviderInfo;
export type GenerationProviderType = ProviderType;
export type GenerationRouteStatus = RouteStatus;
export type GenerationCapabilities = Capabilities;
export type GenerationParamCombo = ParamCombo;
export type GenerationParamGroupID = ParamGroupID;
export type GenerationRouteParamGroup = RouteParamGroup;
export type GenerationParamOption = ParamOption;
export type GenerationParam = ParamSpec;
export type GenerationFamily = ModelFamily;
export type GenerationVersion = ModelVersion;
export type GenerationRoute = ModelRoute;
export type GenerationModel = ModelSpec;
export type GenerationMessageRequest = Omit<GeneratedGenerationMessageRequest, "sessionId"> & {
	sessionId?: string;
	conversationId?: string;
	scopeId?: string;
};
export type GenerationAsset = GeneratedGenerationAsset;
export type GenerationUsage = GeneratedGenerationUsage;
export type GenerationMessageResponse = GeneratedGenerationMessageResponse;
export type GenerationNotification = GenerationNotificationRecord;
export type GenerationNotificationEvent = GeneratedGenerationNotificationEvent;
export type GenerationNotificationsResponse = GeneratedGenerationNotificationsResponse;
export type GenerationNotificationOpenTarget = GenerationNotificationTarget;
export type GenerationTask = GenerationTaskRecord & {
	conversationId?: string;
	sessionId?: string;
};
export type GenerationTaskAttempt = GenerationTaskAttemptRecord;
export type GenerationTasksResponse = Omit<GeneratedGenerationTasksResponse, "tasks"> & {
	tasks: GenerationTask[];
};
export type GenerationPreference = Omit<GenerationPreferenceRecord, "sessionId"> & {
	scopeId: string;
	sessionId?: string;
};
export type UpdateGenerationPreferenceRequest = Omit<
	GeneratedUpdateGenerationPreferenceRequest,
	"sessionId"
> & {
	sessionId?: string;
	scopeId?: string;
};
export type GenerationConversation = Omit<GenerationConversationRecord, "sessionId"> & {
	id: string;
	sessionId?: string;
	scopeId?: string;
};
export type GenerationConversationsResponse = Omit<
	GeneratedGenerationConversationsResponse,
	"conversations" | "sessions"
> & {
	conversations: GenerationConversation[];
	sessions?: GenerationConversation[];
};
export type CreateGenerationConversationRequest = Omit<
	GeneratedCreateGenerationConversationRequest,
	"sessionId"
> & {
	id?: string;
	sessionId?: string;
	scopeId?: string;
};
export type GenerationModelsResponse = GeneratedGenerationModelsResponse;
export type GenerationTextStreamEvent = GeneratedGenerationTextStreamEvent & {
	conversationId?: string;
};

export interface StreamGenerationTextHandlers {
	onStart?: (event: GenerationTextStreamEvent) => void;
	onDelta?: (delta: string, event: GenerationTextStreamEvent) => void;
	onDone?: (message: GenerationMessageResponse, event: GenerationTextStreamEvent) => void;
	onError?: (message: string, event?: GenerationTextStreamEvent) => void;
	signal?: AbortSignal;
}

export const generationModelsKey = "/generation/models";
export const generationPreferencesKey = "/generation/sessions";
export const generationTasksKey = "/generation/tasks";
export const generationConversationsKey = "/generation/sessions";
export const generationNotificationsKey = "/generation/notifications";
export const defaultGenerationConversationScopeId = "studio";
export const agentGenerationConversationScopeId = "agent";

export const generationProjectConversationScopeId = (projectId: string) => projectId.trim();

// 智能体项目的生成统一归到「每个项目 + 每种 kind 一个」的命名会话，
// 这样创作台（按 allScopes 列会话）能看到，而不同 kind 不会因共用 id 而撞 kind 校验。
export const projectGenerationConversationId = (projectId: string, kind: GenerationKind) =>
	`${projectId.trim()}-${kind}`;

const projectGenerationKindLabel: Record<GenerationKind, string> = {
	image: "图片",
	video: "视频",
	text: "文本",
};

export interface ProjectGenerationConversation {
	conversationId: string;
	conversationScopeId: string;
	conversationTitle: string;
	historyScopeId: string;
}

// 在项目内生成时使用：返回项目级命名会话的四要素（id / scope / 标题 / 本地缓存 scope）。
// 没有 projectId（非项目场景）时返回 undefined，调用方据此回退到自己的 scope。
export const projectGenerationConversation = (
	projectId: string | null | undefined,
	kind: GenerationKind,
	projectName?: string | null,
): ProjectGenerationConversation | undefined => {
	const cleanProjectId = projectId?.trim();
	if (!cleanProjectId) return undefined;

	const conversationId = projectGenerationConversationId(cleanProjectId, kind);
	return {
		conversationId,
		conversationScopeId: agentGenerationConversationScopeId,
		conversationTitle: `${projectName?.trim() || "项目"} · ${projectGenerationKindLabel[kind]}`,
		historyScopeId: conversationId,
	};
};

const generationRequestTimeoutMs = 1_000_000;
const generationPollTimeoutMs = 45_000;

export const getGenerationModels = async () => {
	const response = await httpClient.get<GenerationModelsResponse>(generationModelsKey);
	return response.data;
};

export const generationTasksQueryKey = (
	conversationId?: string | null,
	kind?: GenerationKind,
	scopeId = defaultGenerationConversationScopeId,
	projectId?: string | null,
) =>
	[
		generationTasksKey,
		scopeId,
		conversationId?.trim() || "",
		kind ?? "",
		projectId?.trim() || "",
	] as const;

export const generationConversationsQueryKey = (
	kind?: GenerationKind,
	scopeId = defaultGenerationConversationScopeId,
	options: { allScopes?: boolean } = {},
) => [generationConversationsKey, options.allScopes ? "*" : scopeId, kind ?? ""] as const;

export const generationPreferencesQueryKey = (scopeId: string) =>
	[generationPreferencesKey, scopeId] as const;

export const getGenerationTasks = async (
	conversationId?: string | null,
	kind?: GenerationKind,
	scopeId = defaultGenerationConversationScopeId,
	projectId?: string | null,
) => {
	// 非默认 scope（如文档章节）作为 sessionId 兜底，保证按 scope 隔离任务历史。
	const scopeSessionId =
		scopeId.trim() === defaultGenerationConversationScopeId ? "" : scopeId.trim();
	const sessionId = conversationId?.trim() || projectId?.trim() || scopeSessionId;
	const path = sessionId
		? `${generationConversationsKey}/${encodeURIComponent(sessionId)}/tasks`
		: generationTasksKey;
	const response = await httpClient.get<GenerationTasksResponse>(path, {
		params: kind ? { kind } : {},
	});
	return {
		...response.data,
		tasks: response.data.tasks.map(normalizeGenerationTask),
	};
};

export const getGenerationConversations = async (
	kind?: GenerationKind,
	scopeId = defaultGenerationConversationScopeId,
	options: { allScopes?: boolean } = {},
) => {
	const normalizedScopeId = scopeId.trim() || defaultGenerationConversationScopeId;
	const response = await httpClient.get<GenerationConversationsResponse>(
		generationConversationsKey,
		{
			params: {
				...(options.allScopes ? {} : { scopeId: normalizedScopeId }),
				...(kind ? { kind } : {}),
			},
		},
	);
	const sessions =
		(
			response.data as {
				sessions?: GenerationConversation[];
				conversations?: GenerationConversation[];
			}
		).sessions ??
		(
			response.data as {
				sessions?: GenerationConversation[];
				conversations?: GenerationConversation[];
			}
		).conversations ??
		[];
	const conversations = sessions.map(normalizeGenerationConversation);
	return {
		...response.data,
		sessions: conversations,
		conversations,
	} as GenerationConversationsResponse;
};

export const generationNotificationsQueryKey = (projectId?: string | null) =>
	[generationNotificationsKey, projectId?.trim() || ""] as const;

export const getGenerationNotifications = async (projectId?: string | null) => {
	const normalizedProjectId = projectId?.trim();
	const response = await httpClient.get<GenerationNotificationsResponse>(
		normalizedProjectId
			? `/projects/${encodeURIComponent(normalizedProjectId)}/generation/notifications`
			: generationNotificationsKey,
	);
	return response.data;
};

export const markGenerationNotificationRead = async (id: string) => {
	const response = await httpClient.patch<GenerationNotification>(
		`${generationNotificationsKey}/${encodeURIComponent(id)}/read`,
	);
	return response.data;
};

export const markAllGenerationNotificationsRead = async (projectId?: string | null) => {
	const normalizedProjectId = projectId?.trim();
	const response = await httpClient.patch<{ ok: boolean }>(
		normalizedProjectId
			? `/projects/${encodeURIComponent(normalizedProjectId)}/generation/notifications/read`
			: `${generationNotificationsKey}/read`,
	);
	return response.data;
};

export const generationNotificationEventsURL = (projectId?: string | null) => {
	const normalizedProjectId = projectId?.trim();
	return apiURL(
		normalizedProjectId
			? `/projects/${encodeURIComponent(normalizedProjectId)}/generation/notifications/events`
			: `${generationNotificationsKey}/events`,
	);
};

export const createGenerationNotificationEventSource = (projectId?: string | null) =>
	new ManagedEventSource({
		url: () => generationNotificationEventsURL(projectId),
	});

export const getGenerationPreferences = async (scopeId: string) => {
	const sessionId = scopeId.trim() || defaultGenerationConversationScopeId;
	const response = await httpClient.get<GenerationPreference>(
		`${generationPreferencesKey}/${encodeURIComponent(sessionId)}/preferences`,
	);
	return normalizeGenerationPreference(response.data);
};

export const updateGenerationPreferences = async (
	scopeId: string,
	preferences: Omit<UpdateGenerationPreferenceRequest, "scopeId">,
) => {
	const sessionId = scopeId.trim() || defaultGenerationConversationScopeId;
	const response = await httpClient.put<GenerationPreference>(
		`${generationPreferencesKey}/${encodeURIComponent(sessionId)}/preferences`,
		preferences,
	);
	return normalizeGenerationPreference(response.data);
};

export const createGenerationConversation = async (
	request: CreateGenerationConversationRequest,
) => {
	const rawRequest = request as CreateGenerationConversationRequest & {
		id?: string;
		sessionId?: string;
		scopeId?: string;
	};
	const response = await httpClient.post<GenerationConversation>(generationConversationsKey, {
		sessionId: rawRequest.sessionId ?? rawRequest.id,
		scopeId: rawRequest.scopeId,
		kind: request.kind,
		title: request.title,
	});
	return normalizeGenerationConversation(response.data);
};

export const deleteGenerationConversation = async (id: string) => {
	const response = await httpClient.delete<{ deleted: boolean }>(
		`${generationConversationsKey}/${encodeURIComponent(id)}`,
	);
	return response.data;
};

export const retryGenerationTask = async (id: string) => {
	const response = await httpClient.post<GenerationMessageResponse>(
		`/generation/tasks/${encodeURIComponent(id)}/retry`,
		undefined,
		{ timeout: generationRequestTimeoutMs },
	);
	return response.data;
};

export const deleteGenerationTask = async (id: string) => {
	const response = await httpClient.delete<GenerationTasksResponse>(
		`/generation/tasks/${encodeURIComponent(id)}`,
	);
	return response.data;
};

export const deleteGenerationTaskAsset = async (id: string, assetIndex: number) => {
	const response = await httpClient.delete<GenerationTask>(
		`/generation/tasks/${encodeURIComponent(id)}/assets/${assetIndex}`,
	);
	return normalizeGenerationTask(response.data);
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

export const streamGenerationText = async (
	request: GenerationMessageRequest,
	handlers: StreamGenerationTextHandlers = {},
) => {
	const payload = generationMessagePayload(request);
	const response = await fetch(
		apiURL(
			`${generationConversationsKey}/${encodeURIComponent(payload.sessionId)}/messages/stream`,
		),
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "text/event-stream",
			},
			body: JSON.stringify(payload),
			signal: handlers.signal,
		},
	);
	if (!response.ok) {
		const message = await response.text();
		throw new Error(message || `文本生成请求失败：${response.status}`);
	}
	if (!response.body) {
		throw new Error("浏览器不支持流式文本响应。");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let finalMessage: GenerationMessageResponse | null = null;

	const handleEvent = (event: GenerationTextStreamEvent) => {
		if (event.type === "start") {
			handlers.onStart?.(event);
			return;
		}
		if (event.type === "delta") {
			const delta = event.delta ?? "";
			if (delta) handlers.onDelta?.(delta, event);
			return;
		}
		if (event.type === "done") {
			if (event.message) {
				finalMessage = event.message;
				handlers.onDone?.(event.message, event);
			}
			return;
		}
		if (event.type === "error") {
			const message = event.error || event.message?.error || "文本生成失败。";
			handlers.onError?.(message, event);
			throw new Error(message);
		}
	};

	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const blocks = buffer.split(/\r?\n\r?\n/);
		buffer = blocks.pop() ?? "";
		for (const block of blocks) {
			const event = parseSSEBlock(block);
			if (event) handleEvent(event);
		}
	}

	buffer += decoder.decode();
	const trailingEvent = parseSSEBlock(buffer);
	if (trailingEvent) handleEvent(trailingEvent);
	if (!finalMessage) {
		throw new Error("文本生成流结束时未返回最终结果。");
	}

	return finalMessage;
};

export const getGenerationVideo = async (id: string) => {
	const response = await httpClient.get<GenerationMessageResponse>(
		`/generation/tasks/${encodeURIComponent(id)}/result`,
		{ timeout: generationPollTimeoutMs },
	);
	return response.data;
};

const generationMessagePayload = (request: GenerationMessageRequest) => {
	const raw = request as GenerationMessageRequest & {
		conversationId?: string;
		scopeId?: string;
		sessionId?: string;
	};
	const sessionId =
		raw.sessionId?.trim() ||
		raw.conversationId?.trim() ||
		raw.scopeId?.trim() ||
		raw.projectId?.trim() ||
		defaultGenerationConversationScopeId;
	const { conversationId: _conversationId, scopeId: _scopeId, ...payload } = raw;
	return {
		...payload,
		sessionId,
	};
};

const normalizeGenerationConversation = (
	conversation: GenerationConversationRecord | GenerationConversation,
): GenerationConversation => {
	const raw = conversation as GenerationConversationRecord & {
		id?: string;
		sessionId?: string;
		scopeId?: string;
	};
	const sessionId = raw.sessionId ?? raw.id ?? "";
	return {
		...conversation,
		id: sessionId,
		sessionId,
		scopeId: raw.scopeId?.trim() || sessionId,
	};
};

const normalizeGenerationTask = (task: GenerationTaskRecord): GenerationTask => {
	const raw = task as GenerationTaskRecord & { conversationId?: string; sessionId?: string };
	const sessionId = raw.sessionId ?? raw.conversationId ?? "";
	return {
		...task,
		sessionId,
		conversationId: sessionId,
	};
};

const normalizeGenerationPreference = (
	preference: GenerationPreferenceRecord | GenerationPreference,
): GenerationPreference => {
	const raw = preference as GenerationPreferenceRecord & { scopeId?: string; sessionId?: string };
	const sessionId = raw.sessionId ?? raw.scopeId ?? defaultGenerationConversationScopeId;
	return {
		...preference,
		sessionId,
		scopeId: sessionId,
	};
};

const parseSSEBlock = (block: string): GenerationTextStreamEvent | null => {
	if (!block.trim()) return null;

	let eventType = "";
	const dataLines: string[] = [];
	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith("event:")) {
			eventType = line.slice("event:".length).trim();
		} else if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trimStart());
		}
	}
	if (dataLines.length === 0) return null;

	const parsed = JSON.parse(dataLines.join("\n")) as GenerationTextStreamEvent;
	return {
		...parsed,
		type: parsed.type || eventType || "message",
	};
};
