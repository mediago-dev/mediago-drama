import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
	runAgentPrompt: vi.fn(),
	runtimeConfig: {
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
	},
}));

vi.mock("swr", () => ({
	default: (key: string | null) => {
		if (key?.endsWith("/runtime-config")) {
			return { data: testState.runtimeConfig, error: null, isLoading: false };
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
		composerRef,
		onModelChange,
		onRunPrompt,
		reasoningValue,
		runtimeConfig,
		selectedModel,
	}: {
		composerRef: { current: unknown };
		onModelChange: (value: string) => void;
		onRunPrompt: () => void;
		reasoningValue: string;
		runtimeConfig?: { reasoning?: unknown };
		selectedModel: string;
	}) => {
		composerRef.current = {
			clear: vi.fn(),
			focus: vi.fn(),
			getValue: () => ({
				displaySegments: [{ type: "text", text: "hello" }],
				displayText: "hello",
				references: [],
				text: "hello",
			}),
			seed: vi.fn(),
		};
		return (
			<div
				data-testid="composer-form"
				data-has-reasoning={runtimeConfig?.reasoning ? "true" : "false"}
				data-reasoning-value={reasoningValue}
				data-selected-model={selectedModel}
			>
				<button type="button" onClick={() => onModelChange("opencode/big-pickle")}>
					Select Big Pickle
				</button>
				<button type="button" onClick={onRunPrompt}>
					Run Prompt
				</button>
			</div>
		);
	},
}));

vi.mock("@/domains/agent/components/AgentTimeline", () => ({
	AgentTimeline: () => <div data-testid="agent-timeline" />,
}));

vi.mock("@/domains/agent/components/PendingPermissionRequests", () => ({
	PendingPermissionRequests: () => null,
}));

vi.mock("@/domains/agent/lib/controller", () => ({
	runAgentPrompt: testState.runAgentPrompt,
	stopAgentRun: vi.fn(),
}));

const defaultRuntimeConfig = () => ({
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
});

const runtimeConfigWithOpenCodeThinkingFallback = (currentValue: string) => ({
	model: {
		configId: "model",
		currentValue,
		options: [
			{ name: "MediaGo/MiniMax M3", value: "mediago/MiniMax-M3" },
			{ name: "MediaGo/Qwen3.5 27B", value: "mediago/qwen3.5-27b" },
		],
	},
	permission: {
		configId: "permission",
		currentValue: "build",
		options: [{ name: "build", value: "build" }],
	},
	reasoning: {
		configId: "effort",
		currentValue: "thinking",
		options: [
			{ name: "None", value: "none" },
			{ name: "Thinking", value: "thinking" },
		],
		source: "opencodeThinkingFallback",
	},
});

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
		testState.runAgentPrompt.mockReset();
		testState.runAgentPrompt.mockResolvedValue(undefined);
		testState.runtimeConfig = defaultRuntimeConfig();
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

	it("sends fallback thinking only for supported MediaGo MiniMax M3 models", async () => {
		vi.resetModules();
		testState.runtimeConfig = runtimeConfigWithOpenCodeThinkingFallback("mediago/MiniMax-M3");
		const { AgentChat } = await import("./AgentChat");
		render(<AgentChat projectId="project-1" />);

		await waitFor(() => {
			expect(screen.getByTestId("composer-form").dataset.hasReasoning).toBe("true");
		});
		fireEvent.click(screen.getByRole("button", { name: "Run Prompt" }));

		await waitFor(() => {
			expect(testState.runAgentPrompt).toHaveBeenCalledWith(
				"hello",
				expect.objectContaining({
					reasoning: {
						configId: "effort",
						source: "opencodeThinkingFallback",
						value: "thinking",
					},
				}),
			);
		});
	});

	it("does not send fallback thinking for unsupported MediaGo models", async () => {
		vi.resetModules();
		testState.runtimeConfig = runtimeConfigWithOpenCodeThinkingFallback("mediago/qwen3.5-27b");
		const { AgentChat } = await import("./AgentChat");
		render(<AgentChat projectId="project-1" />);

		await waitFor(() => {
			expect(screen.getByTestId("composer-form").dataset.hasReasoning).toBe("false");
		});
		fireEvent.click(screen.getByRole("button", { name: "Run Prompt" }));

		await waitFor(() => {
			expect(testState.runAgentPrompt).toHaveBeenCalledWith(
				"hello",
				expect.objectContaining({
					reasoning: undefined,
				}),
			);
		});
	});
});
