import { afterEach, describe, expect, it } from "vitest";
import { readAgentChatCache, writeAgentChatCache, type AgentChatCacheSnapshot } from "./chat-cache";

const agentChatCacheKey = "agent-chat-cache.v1";

describe("agent chat cache", () => {
	afterEach(() => {
		localStorage.clear();
	});

	it("keeps cached transcripts for multiple projects", () => {
		writeAgentChatCache(agentChatCacheSnapshot("project-a", "session-a", "cached A"));
		writeAgentChatCache(agentChatCacheSnapshot("project-b", "session-b", "cached B"));

		expect(readAgentChatCache("project-a")?.sessionId).toBe("session-a");
		expect(
			readAgentChatCache("project-a")?.conversations["run-project-a"]?.messages[0]?.content,
		).toBe("cached A");
		expect(readAgentChatCache("project-b")?.sessionId).toBe("session-b");
		expect(
			readAgentChatCache("project-b")?.conversations["run-project-b"]?.messages[0]?.content,
		).toBe("cached B");
	});

	it("reads the legacy single-project cache payload", () => {
		localStorage.setItem(
			agentChatCacheKey,
			JSON.stringify(agentChatCacheSnapshot("project-legacy", "session-legacy", "legacy")),
		);

		expect(readAgentChatCache("project-legacy")?.sessionId).toBe("session-legacy");
		expect(
			readAgentChatCache("project-legacy")?.conversations["run-project-legacy"]?.messages[0]
				?.content,
		).toBe("legacy");
	});
});

const agentChatCacheSnapshot = (
	projectId: string,
	sessionId: string,
	content: string,
): AgentChatCacheSnapshot => ({
	projectId,
	sessionId,
	rootRunId: `run-${projectId}`,
	lastEventId: "1",
	conversations: {
		[`run-${projectId}`]: {
			runId: `run-${projectId}`,
			name: "主智能体",
			status: "completed",
			messages: [
				{
					id: `message-${projectId}`,
					role: "assistant",
					content,
					kind: "message",
					status: "complete",
				},
			],
			streamingMessageId: null,
			children: [],
			createdAt: "2026-06-09T00:00:00.000Z",
			updatedAt: "2026-06-09T00:00:00.000Z",
		},
	},
	activity: [],
	updatedAt: "2026-06-09T00:00:00.000Z",
});
