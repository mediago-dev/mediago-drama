import { afterEach, describe, expect, it, vi } from "vitest";
import { getAgentSessionStatus } from "@/domains/agent/api/agent";
import { refreshAgentChatTranscript } from "@/domains/agent/lib/chat-sync";
import { syncAgentSessionStatus } from "@/domains/agent/lib/session-sync";
import { useAgentStore } from "@/domains/agent/stores";

vi.mock("@/domains/agent/api/agent", () => ({
	getAgentSessionStatus: vi.fn(),
}));

vi.mock("@/domains/agent/lib/chat-sync", () => ({
	refreshAgentChatTranscript: vi.fn(),
}));

describe("syncAgentSessionStatus", () => {
	afterEach(() => {
		vi.mocked(getAgentSessionStatus).mockReset();
		vi.mocked(refreshAgentChatTranscript).mockReset();
		useAgentStore.getState().resetSession();
	});

	it("converges every local conversation when the backend session is terminal", async () => {
		useAgentStore.setState({
			isRunning: true,
			rootRunId: "run-current",
			sessionId: "session-1",
			conversations: {
				"run-stale": {
					runId: "run-stale",
					status: "waiting",
					messages: [],
					streamingMessageId: null,
					children: [],
					createdAt: "2026-07-13T00:00:00.000Z",
					updatedAt: "2026-07-13T00:00:01.000Z",
				},
				"run-current": {
					runId: "run-current",
					status: "running",
					messages: [],
					streamingMessageId: null,
					children: [],
					createdAt: "2026-07-13T00:00:02.000Z",
					updatedAt: "2026-07-13T00:00:03.000Z",
				},
			},
		});
		vi.mocked(getAgentSessionStatus).mockResolvedValue({
			sessionId: "session-1",
			running: false,
			lastStatus: "completed",
			lastMessage: "Agent 运行已完成。",
		});
		vi.mocked(refreshAgentChatTranscript).mockRejectedValue(new Error("transcript unavailable"));
		const settle = vi.fn();

		await syncAgentSessionStatus("session-1", "project-1", {
			applyTerminal: true,
			settle,
		});

		expect(useAgentStore.getState().isRunning).toBe(false);
		expect(useAgentStore.getState().conversations["run-current"]?.status).toBe("completed");
		expect(useAgentStore.getState().conversations["run-stale"]?.status).toBe("completed");
		expect(settle).toHaveBeenCalledTimes(1);
	});
});
