import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeConfigPayload } from "@/domains/agent/api/agent";

const testState = vi.hoisted(() => ({
	activeBackendId: "codex",
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
	} as AgentRuntimeConfigPayload | undefined,
	runtimeConfigError: null as unknown,
	runtimeIsValidating: false,
	runtimeMutate: vi.fn(),
	runtimeSWRConfig: undefined as { shouldRetryOnError?: boolean } | undefined,
	setSettingsTab: vi.fn(),
}));

vi.mock("swr", () => ({
	default: (key: string | null, _fetcher?: unknown, config?: { shouldRetryOnError?: boolean }) => {
		if (key?.endsWith("/runtime-config")) {
			testState.runtimeSWRConfig = config;
			return {
				data: testState.runtimeConfig,
				error: testState.runtimeConfigError,
				isLoading: false,
				isValidating: testState.runtimeIsValidating,
				mutate: testState.runtimeMutate,
			};
		}
		if (key === "/agent/backends") {
			return {
				data: {
					activeId: testState.activeBackendId,
					backends: [],
				},
				error: null,
				isLoading: false,
			};
		}
		if (key === "/skills") {
			return { data: [], error: null, isLoading: false };
		}
		return { data: undefined, error: null, isLoading: false };
	},
	mutate: vi.fn(),
}));

vi.mock("@/lib/stores/settings", () => ({
	useSettingsNavigationStore: (selector: (state: unknown) => unknown) =>
		selector({ activeTab: "appearance", setActiveTab: testState.setSettingsTab }),
}));

vi.mock("@/domains/agent/components/chat/AgentChatComposerForm", () => ({
	AgentChatComposerForm: ({
		composerRef,
		isRuntimeConfigLoading,
		onModelChange,
		onOpenRuntimeSettings,
		onRetryRuntimeConfig,
		onRunPrompt,
		reasoningValue,
		runtimeConfig,
		runtimeConfigErrorMessage,
		selectedModel,
	}: {
		composerRef: { current: unknown };
		isRuntimeConfigLoading: boolean;
		onModelChange: (value: string) => void;
		onOpenRuntimeSettings: () => void;
		onRetryRuntimeConfig: () => void;
		onRunPrompt: () => void;
		reasoningValue: string;
		runtimeConfig?: { reasoning?: unknown };
		runtimeConfigErrorMessage: string;
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
				data-runtime-config-loading={isRuntimeConfigLoading ? "true" : "false"}
				data-runtime-error={runtimeConfigErrorMessage}
				data-selected-model={selectedModel}
			>
				<button type="button" onClick={() => onModelChange("opencode/big-pickle")}>
					Select Big Pickle
				</button>
				<button type="button" onClick={onRunPrompt}>
					Run Prompt
				</button>
				{runtimeConfigErrorMessage ? (
					<>
						<button type="button" onClick={onRetryRuntimeConfig}>
							Retry runtime config
						</button>
						<button type="button" onClick={onOpenRuntimeSettings}>
							Open runtime settings
						</button>
					</>
				) : null}
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

const LocationProbe = () => {
	const location = useLocation();
	return <output data-testid="location-probe">{location.pathname}</output>;
};

const renderAgentChat = (AgentChat: (typeof import("./AgentChat"))["AgentChat"]) =>
	render(
		<MemoryRouter initialEntries={["/agent"]}>
			<AgentChat projectId="project-1" />
			<LocationProbe />
		</MemoryRouter>,
	);

describe("AgentChat runtime config persistence", () => {
	afterEach(() => {
		cleanup();
		localStorage.clear();
		testState.runAgentPrompt.mockReset();
		testState.runAgentPrompt.mockResolvedValue(undefined);
		testState.activeBackendId = "codex";
		testState.runtimeConfig = defaultRuntimeConfig();
		testState.runtimeConfigError = null;
		testState.runtimeIsValidating = false;
		testState.runtimeMutate.mockReset();
		testState.runtimeSWRConfig = undefined;
		testState.setSettingsTab.mockReset();
		vi.resetModules();
	});

	it("uses the last saved model instead of the backend current value after reload", async () => {
		vi.resetModules();
		persistAgentState({
			runtimeConfigDefaults: { model: "opencode/big-pickle" },
			runtimeConfigByProject: {},
		});

		const { AgentChat } = await import("./AgentChat");
		renderAgentChat(AgentChat);

		await waitFor(() => {
			expect(screen.getByTestId("composer-form").dataset.selectedModel).toBe("opencode/big-pickle");
		});
	});

	it("writes model changes to both global defaults and project overrides", async () => {
		vi.resetModules();
		const { AgentChat } = await import("./AgentChat");
		renderAgentChat(AgentChat);

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
		renderAgentChat(AgentChat);

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
		renderAgentChat(AgentChat);

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

	it("disables automatic retries and retries the runtime probe explicitly", async () => {
		vi.resetModules();
		testState.runtimeConfig = undefined;
		testState.runtimeConfigError = {
			code: 503,
			message: "Agent 尚未认证，请先配置凭据",
		};
		testState.runtimeIsValidating = true;
		const { AgentChat } = await import("./AgentChat");
		renderAgentChat(AgentChat);

		expect(testState.runtimeSWRConfig).toMatchObject({ shouldRetryOnError: false });
		expect(screen.getByTestId("composer-form").dataset.runtimeConfigLoading).toBe("true");
		expect(screen.getByTestId("composer-form").dataset.runtimeError).toBe(
			"Agent 尚未认证，请先配置凭据",
		);

		fireEvent.click(screen.getByRole("button", { name: "Retry runtime config" }));
		expect(testState.runtimeMutate).toHaveBeenCalledTimes(1);
	});

	it("opens Codex Relay settings from a Codex runtime error", async () => {
		vi.resetModules();
		testState.activeBackendId = "codex";
		testState.runtimeConfig = undefined;
		testState.runtimeConfigError = {
			code: 503,
			message: "Agent 尚未认证，请先配置凭据",
		};
		const { AgentChat } = await import("./AgentChat");
		renderAgentChat(AgentChat);

		fireEvent.click(screen.getByRole("button", { name: "Open runtime settings" }));

		expect(testState.setSettingsTab).toHaveBeenCalledWith("codex-relay");
		expect(screen.getByTestId("location-probe")).toHaveTextContent("/settings");
	});

	it("opens API key settings for a non-Codex runtime error", async () => {
		vi.resetModules();
		testState.activeBackendId = "opencode";
		testState.runtimeConfig = undefined;
		testState.runtimeConfigError = {
			code: 503,
			message: "Agent 运行时暂不可用",
		};
		const { AgentChat } = await import("./AgentChat");
		renderAgentChat(AgentChat);

		fireEvent.click(screen.getByRole("button", { name: "Open runtime settings" }));

		expect(testState.setSettingsTab).toHaveBeenCalledWith("api-keys");
		expect(screen.getByTestId("location-probe")).toHaveTextContent("/settings");
	});
});
