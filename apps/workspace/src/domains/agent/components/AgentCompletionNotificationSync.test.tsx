import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AgentCompletionNotificationSync } from "@/domains/agent/components/AgentCompletionNotificationSync";
import { showAgentCompletionSystemNotification } from "@/domains/agent/lib/completion-notifications";
import { useAgentStore } from "@/domains/agent/stores";
import type { AgentConversationState, AgentConversationStatus } from "@/domains/agent/stores/types";

const mocks = vi.hoisted(() => ({
	toastInfo: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/domains/agent/lib/completion-notifications", () => ({
	showAgentCompletionSystemNotification: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		info: mocks.toastInfo,
		error: mocks.toastError,
	}),
}));

const conversation = (status: AgentConversationStatus): Record<string, AgentConversationState> => ({
	"run-1": {
		runId: "run-1",
		status,
		messages: [],
		streamingMessageId: null,
		children: [],
		createdAt: "2024-01-01T00:00:00.000Z",
		updatedAt: "2024-01-01T00:00:00.000Z",
	},
});

const renderSync = (isAgentSurfaceActive: boolean) =>
	render(
		<MemoryRouter>
			<AgentCompletionNotificationSync
				isAgentSurfaceActive={isAgentSurfaceActive}
				projectId="project-1"
			/>
		</MemoryRouter>,
	);

const completeRun = (status: AgentConversationStatus = "completed") => {
	act(() => {
		useAgentStore.setState({
			isRunning: false,
			conversations: conversation(status),
			rootRunId: "run-1",
		});
	});
};

describe("AgentCompletionNotificationSync", () => {
	beforeEach(() => {
		vi.spyOn(document, "hasFocus").mockReturnValue(true);
		useAgentStore.setState({
			isRunning: true,
			conversations: conversation("running"),
			rootRunId: "run-1",
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.mocked(showAgentCompletionSystemNotification).mockReset();
		mocks.toastInfo.mockReset();
		mocks.toastError.mockReset();
		useAgentStore.setState({ isRunning: false, conversations: {}, rootRunId: null });
	});

	it("notifies when a run completes outside the agent surface", async () => {
		vi.mocked(showAgentCompletionSystemNotification).mockResolvedValue("shown");
		renderSync(false);

		completeRun("completed");

		await waitFor(() => {
			expect(showAgentCompletionSystemNotification).toHaveBeenCalledTimes(1);
		});
		expect(vi.mocked(showAgentCompletionSystemNotification).mock.calls[0]?.[0]).toBe("completed");
	});

	it("does not notify while the window is active on the agent surface", async () => {
		vi.mocked(showAgentCompletionSystemNotification).mockResolvedValue("shown");
		renderSync(true);

		completeRun("completed");

		await waitFor(() => {
			expect(showAgentCompletionSystemNotification).not.toHaveBeenCalled();
		});
	});

	it("stays silent for user-cancelled runs", async () => {
		vi.mocked(showAgentCompletionSystemNotification).mockResolvedValue("shown");
		renderSync(false);

		completeRun("cancelled");

		await waitFor(() => {
			expect(showAgentCompletionSystemNotification).not.toHaveBeenCalled();
		});
	});

	it("falls back to an in-app toast when the system notification is unavailable", async () => {
		vi.mocked(showAgentCompletionSystemNotification).mockResolvedValue("fallback");
		renderSync(false);

		completeRun("completed");

		await waitFor(() => {
			expect(mocks.toastInfo).toHaveBeenCalledWith("Agent 调用完成", {
				description: "智能体已完成本次运行。",
			});
		});
	});
});
