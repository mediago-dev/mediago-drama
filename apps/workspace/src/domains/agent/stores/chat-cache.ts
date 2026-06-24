import type { AgentActivityItem, AgentConversationState } from "./types";

// Agent 聊天记录只存在内存里的 useAgentStore，刷新页面（桌面 webview 重载）会清空。
// 这里把当前项目的对话快照缓存到 localStorage，刷新后先从缓存即时恢复，
// 后端 getAgentChatState 拉到权威数据后再覆盖。按项目保留最近几份快照以支持快速切换。
export interface AgentChatCacheSnapshot {
	projectId: string;
	sessionId: string | null;
	rootRunId: string | null;
	lastEventId: string | null;
	conversations: Record<string, AgentConversationState>;
	activity: AgentActivityItem[];
	updatedAt: string;
}

interface AgentChatCachePayload {
	version: 2;
	snapshots: Record<string, AgentChatCacheSnapshot>;
}

const agentChatCacheKey = "agent-chat-cache.v1";
const maxCachedAgentProjects = 12;

const getStorage = (): Storage | null => {
	try {
		if (typeof window === "undefined") return null;
		return window.localStorage;
	} catch {
		return null;
	}
};

export const readAgentChatCache = (projectId: string): AgentChatCacheSnapshot | null => {
	const storage = getStorage();
	const trimmedProjectId = projectId.trim();
	if (!storage || !trimmedProjectId) return null;
	try {
		const payload = readCachePayload(storage);
		return payload?.snapshots[trimmedProjectId] ?? null;
	} catch {
		return null;
	}
};

export const writeAgentChatCache = (snapshot: AgentChatCacheSnapshot): void => {
	const storage = getStorage();
	const projectId = snapshot.projectId.trim();
	if (!storage || !projectId) return;
	const currentPayload = safelyReadCachePayload(storage);
	const payload = pruneCachePayload({
		version: 2,
		snapshots: {
			...currentPayload.snapshots,
			[projectId]: normalizeSnapshot({ ...snapshot, projectId }, projectId),
		},
	});
	if (persistCachePayload(storage, payload)) return;
	// 体积超出配额时退化为只保留消息正文的精简快照；仍失败则清掉缓存，避免残留脏数据。
	if (persistCachePayload(storage, pruneSnapshotPayload(payload))) return;
	clearAgentChatCache();
};

export const clearAgentChatCache = (): void => {
	const storage = getStorage();
	if (!storage) return;
	try {
		storage.removeItem(agentChatCacheKey);
	} catch {
		// localStorage 不可用时忽略。
	}
};

const safelyReadCachePayload = (storage: Storage): AgentChatCachePayload => {
	try {
		return readCachePayload(storage) ?? emptyCachePayload();
	} catch {
		return emptyCachePayload();
	}
};

const readCachePayload = (storage: Storage): AgentChatCachePayload | null => {
	const raw = storage.getItem(agentChatCacheKey);
	if (!raw) return null;
	const parsed = JSON.parse(raw) as unknown;
	const payload = cachePayloadFromValue(parsed);
	if (payload) return payload;
	const legacySnapshot = snapshotFromValue(parsed);
	return legacySnapshot
		? {
				version: 2,
				snapshots: {
					[legacySnapshot.projectId]: legacySnapshot,
				},
			}
		: null;
};

const cachePayloadFromValue = (value: unknown): AgentChatCachePayload | null => {
	if (!isRecord(value) || !isRecord(value.snapshots)) return null;
	const snapshots: Record<string, AgentChatCacheSnapshot> = {};
	for (const [projectId, snapshotValue] of Object.entries(value.snapshots)) {
		const snapshot = snapshotFromValue(snapshotValue, projectId);
		if (snapshot) snapshots[snapshot.projectId] = snapshot;
	}
	return {
		version: 2,
		snapshots: pruneSnapshots(snapshots),
	};
};

const snapshotFromValue = (
	value: unknown,
	fallbackProjectId?: string,
): AgentChatCacheSnapshot | null => {
	if (!isRecord(value)) return null;
	const projectId = stringValue(value.projectId) || fallbackProjectId?.trim() || "";
	if (!projectId || !isRecord(value.conversations)) return null;
	return normalizeSnapshot(
		{
			projectId,
			sessionId: stringValue(value.sessionId),
			rootRunId: stringValue(value.rootRunId),
			lastEventId: stringValue(value.lastEventId),
			conversations: value.conversations as Record<string, AgentConversationState>,
			activity: Array.isArray(value.activity) ? (value.activity as AgentActivityItem[]) : [],
			updatedAt: stringValue(value.updatedAt) || new Date().toISOString(),
		},
		projectId,
	);
};

const normalizeSnapshot = (
	snapshot: AgentChatCacheSnapshot,
	projectId: string,
): AgentChatCacheSnapshot => ({
	...snapshot,
	projectId,
	sessionId: snapshot.sessionId?.trim() || null,
	rootRunId: snapshot.rootRunId?.trim() || null,
	lastEventId: snapshot.lastEventId?.trim() || null,
	updatedAt: snapshot.updatedAt || new Date().toISOString(),
});

const emptyCachePayload = (): AgentChatCachePayload => ({
	version: 2,
	snapshots: {},
});

const pruneCachePayload = (payload: AgentChatCachePayload): AgentChatCachePayload => ({
	version: 2,
	snapshots: pruneSnapshots(payload.snapshots),
});

const pruneSnapshots = (snapshots: Record<string, AgentChatCacheSnapshot>) =>
	Object.fromEntries(
		Object.entries(snapshots)
			.sort(([, left], [, right]) => snapshotTimestamp(right) - snapshotTimestamp(left))
			.slice(0, maxCachedAgentProjects),
	);

const pruneSnapshotPayload = (payload: AgentChatCachePayload): AgentChatCachePayload => ({
	version: 2,
	snapshots: Object.fromEntries(
		Object.entries(payload.snapshots).map(([projectId, snapshot]) => [
			projectId,
			pruneSnapshot(snapshot),
		]),
	),
});

const persistCachePayload = (storage: Storage, payload: AgentChatCachePayload): boolean => {
	try {
		storage.setItem(agentChatCacheKey, JSON.stringify(payload));
		return true;
	} catch {
		return false;
	}
};

const pruneSnapshot = (snapshot: AgentChatCacheSnapshot): AgentChatCacheSnapshot => ({
	...snapshot,
	activity: [],
	conversations: Object.fromEntries(
		Object.entries(snapshot.conversations).map(([runId, conversation]) => [
			runId,
			{
				...conversation,
				messages: conversation.messages.map((message) => ({
					id: message.id,
					role: message.role,
					content: message.content,
					kind: message.kind,
					title: message.title,
					createdAt: message.createdAt,
					status: message.status,
				})),
			},
		]),
	),
});

const snapshotTimestamp = (snapshot: AgentChatCacheSnapshot) => {
	const value = Date.parse(snapshot.updatedAt);
	return Number.isFinite(value) ? value : 0;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value && typeof value === "object" && !Array.isArray(value));

const stringValue = (value: unknown) => (typeof value === "string" ? value : null);
