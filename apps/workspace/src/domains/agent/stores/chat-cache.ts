import type { AgentActivityItem, AgentConversationState } from "./types";

// Agent 聊天记录只存在内存里的 useAgentStore，刷新页面（Tauri webview 重载）会清空。
// 这里把当前项目的对话快照缓存到 localStorage，刷新后先从缓存即时恢复，
// 后端 getAgentChatState 拉到权威数据后再覆盖。只保留“最近一个项目”的快照以控制体积。
export interface AgentChatCacheSnapshot {
	projectId: string;
	sessionId: string | null;
	rootRunId: string | null;
	lastEventId: string | null;
	conversations: Record<string, AgentConversationState>;
	activity: AgentActivityItem[];
	updatedAt: string;
}

const agentChatCacheKey = "agent-chat-cache.v1";

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
		const raw = storage.getItem(agentChatCacheKey);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<AgentChatCacheSnapshot> | null;
		if (!parsed || parsed.projectId !== trimmedProjectId) return null;
		if (!parsed.conversations || typeof parsed.conversations !== "object") return null;
		return {
			projectId: trimmedProjectId,
			sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
			rootRunId: typeof parsed.rootRunId === "string" ? parsed.rootRunId : null,
			lastEventId: typeof parsed.lastEventId === "string" ? parsed.lastEventId : null,
			conversations: parsed.conversations as Record<string, AgentConversationState>,
			activity: Array.isArray(parsed.activity) ? (parsed.activity as AgentActivityItem[]) : [],
			updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
		};
	} catch {
		return null;
	}
};

export const writeAgentChatCache = (snapshot: AgentChatCacheSnapshot): void => {
	const storage = getStorage();
	if (!storage || !snapshot.projectId.trim()) return;
	if (persistSnapshot(storage, snapshot)) return;
	// 体积超出配额时退化为只保留消息正文的精简快照；仍失败则清掉缓存，避免残留脏数据。
	if (persistSnapshot(storage, pruneSnapshot(snapshot))) return;
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

const persistSnapshot = (storage: Storage, snapshot: AgentChatCacheSnapshot): boolean => {
	try {
		storage.setItem(agentChatCacheKey, JSON.stringify(snapshot));
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
