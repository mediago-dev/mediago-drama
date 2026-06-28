import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const runtimeConfig = {
	model: {
		configId: "model",
		currentValue: "volc/glm-5.2",
		options: [
			{ name: "OpenCode Zen/Big Pickle", value: "opencode/big-pickle" },
			{ name: "Volcano Engine (Agent Plan)/glm-5.2", value: "volc/glm-5.2" },
		],
	},
	permission: {
		configId: "permission",
		currentValue: "build",
		options: [{ name: "build", value: "build" }],
	},
};

vi.mock("swr", () => ({
	default: (key: string | null) => {
		if (key?.endsWith("/runtime-config")) {
			return { data: runtimeConfig, error: null, isLoading: false };
		}
		if (key === "/skills") {
			return { data: [], error: null, isLoading: false };
		}
		return { data: undefined, error: null, isLoading: false };
	},
	mutate: vi.fn(),
}));

vi.mock("@/domains/agent/components/chat/AgentChatComposerForm", () => ({
	AgentChatComposerForm: ({
		onModelChange,
		selectedModel,
	}: {
		onModelChange: (value: string) => void;
		selectedModel: string;
	}) => (
		<div data-testid="composer-form" data-selected-model={selectedModel}>
			<button type="button" onClick={() => onModelChange("opencode/big-pickle")}>
				Select Big Pickle
			</button>
		</div>
	),
}));

vi.mock("@/domains/agent/components/AgentTimeline", () => ({
	AgentTimeline: () => <div data-testid="agent-timeline" />,
}));

vi.mock("@/domains/agent/components/PendingPermissionRequests", () => ({
	PendingPermissionRequests: () => null,
}));

vi.mock("@/domains/agent/lib/controller", () => ({
	runAgentPrompt: vi.fn(),
	stopAgentRun: vi.fn(),
}));

const persistAgentState = (state: Record<string, unknown>) => {
	localStorage.setItem("agent-persistence.v1", JSON.stringify({ state, version: 1 }));
};

const persistedAgentState = () =>
	JSON.parse(localStorage.getItem("agent-persistence.v1") ?? "{}") as {
		state?: {
			runtimeConfigDefaults?: Record<string, string>;
			runtimeConfigByProject?: Record<string, Record<string, string>>;
		};
	};

describe("AgentChat runtime config persistence", () => {
	afterEach(() => {
		cleanup();
		localStorage.clear();
		vi.resetModules();
	});

	it("uses the last saved model instead of the backend current value after reload", async () => {
		vi.resetModules();
		persistAgentState({
			runtimeConfigDefaults: { model: "opencode/big-pickle" },
			runtimeConfigByProject: {},
		});

		const { AgentChat } = await import("./AgentChat");
		render(<AgentChat projectId="project-1" />);

		await waitFor(() => {
			expect(screen.getByTestId("composer-form").dataset.selectedModel).toBe("opencode/big-pickle");
		});
	});

	it("writes model changes to both global defaults and project overrides", async () => {
		vi.resetModules();
		const { AgentChat } = await import("./AgentChat");
		render(<AgentChat projectId="project-1" />);

		fireEvent.click(screen.getByRole("button", { name: "Select Big Pickle" }));

		expect(persistedAgentState().state).toMatchObject({
			runtimeConfigDefaults: { model: "opencode/big-pickle" },
			runtimeConfigByProject: {
				"project-1": { model: "opencode/big-pickle" },
			},
		});
	});
});
