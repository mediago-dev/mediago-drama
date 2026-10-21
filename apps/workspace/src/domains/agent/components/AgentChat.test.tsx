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
			currentValue: "gpt-5.4-mini",
			options: [
				{ name: "GPT 5.4", value: "gpt-5.4" },
				{ name: "GPT 5.4 Mini", value: "gpt-5.4-mini" },
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
	livePlanProps: undefined as { isRunning: boolean; messages: Array<{ id: string }> } | undefined,
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
				<button type="button" onClick={() => onModelChange("gpt-5.4")}>
					Select GPT 5.4
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

vi.mock("@/domains/agent/components/chat/AgentLivePlan", () => ({
	AgentLivePlan: (props: { isRunning: boolean; messages: Array<{ id: string }> }) => {
		testState.livePlanProps = props;
		return <div data-testid="agent-live-plan" />;
	},
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
		currentValue: "gpt-5.4-mini",
		options: [
			{ name: "GPT 5.4", value: "gpt-5.4" },
			{ name: "GPT 5.4 Mini", value: "gpt-5.4-mini" },
		],
	},
	permission: {
		configId: "permission",
		currentValue: "build",
		options: [{ name: "build", value: "build" }],
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
		testState.livePlanProps = undefined;
		vi.resetModules();
	});

	it("places the live plan between the timeline and composer", async () => {
		vi.resetModules();
		const { AgentChat } = await import("./AgentChat");
		renderAgentChat(AgentChat);

		const timeline = screen.getByTestId("agent-timeline");
		const livePlan = screen.getByTestId("agent-live-plan");
		const composer = screen.getByTestId("composer-form");
		expect(
			timeline.compareDocumentPosition(livePlan) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			livePlan.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(testState.livePlanProps).toMatchObject({ isRunning: false, messages: [] });
	});

	it("uses the last saved model instead of the backend current value after reload", async () => {
		vi.resetModules();
		persistAgentState({
			runtimeConfigDefaults: { model: "gpt-5.4" },
			runtimeConfigByProject: {},
		});

		const { AgentChat } = await import("./AgentChat");
		renderAgentChat(AgentChat);

		await waitFor(() => {
			expect(screen.getByTestId("composer-form").dataset.selectedModel).toBe("gpt-5.4");
		});
	});

	it("writes model changes to both global defaults and project overrides", async () => {
		vi.resetModules();
		const { AgentChat } = await import("./AgentChat");
		renderAgentChat(AgentChat);

		fireEvent.click(screen.getByRole("button", { name: "Select GPT 5.4" }));

		expect(persistedAgentState().state).toMatchObject({
			runtimeConfigDefaults: { model: "gpt-5.4" },
			runtimeConfigByProject: {
				"project-1": { model: "gpt-5.4" },
			},
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

		expect(testState.setSettingsTab).toHaveBeenCalledWith("codex-access");
		expect(screen.getByTestId("location-probe")).toHaveTextContent("/settings");
	});

	it("opens Codex settings for a stale backend selection", async () => {
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

		expect(testState.setSettingsTab).toHaveBeenCalledWith("codex-access");
		expect(screen.getByTestId("location-probe")).toHaveTextContent("/settings");
	});
});
