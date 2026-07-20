import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import useSWR, { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexRelaySettingsResponse } from "@/domains/settings/api/settings";
import {
	checkCodexRelaySettings,
	getCodexRelaySettings,
	saveCodexRelayProfileAPIKey,
	saveCodexRelaySettings,
} from "@/domains/settings/api/settings";
import { type CodexOfficialChannel, CodexRelayPanel } from "./CodexRelayPanel";

const toastMock = vi.hoisted(() => ({
	error: vi.fn(),
	success: vi.fn(),
}));

vi.mock("@/domains/settings/api/settings", () => ({
	checkCodexRelaySettings: vi.fn(),
	codexRelaySettingsKey: "/settings/codex-relay",
	clearCodexRelayProfileAPIKey: vi.fn(),
	getCodexRelaySettings: vi.fn(),
	saveCodexRelayProfileAPIKey: vi.fn(),
	saveCodexRelaySettings: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => toastMock,
}));

describe("CodexRelayPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(checkCodexRelaySettings).mockResolvedValue({
			ok: true,
			profileId: "relay",
			baseURL: "https://relay.example.com/v1",
			statusCode: 200,
			models: [],
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("auto-saves relay enabled state from the header switch", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelaySettings).mockResolvedValue(responseWithRelay({}, { enabled: false }));

		renderPanel();

		const enabledSwitch = await screen.findByRole("switch", { name: "Codex 中转启用状态" });
		expect(enabledSwitch.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(enabledSwitch);

		await waitFor(() =>
			expect(saveCodexRelaySettings).toHaveBeenCalledWith({
				enabled: false,
				activeProfileId: "relay",
				profiles: [
					{
						id: "relay",
						name: "Relay",
						baseURL: "https://relay.example.com/v1",
						model: "gpt-5.5",
						protocol: "responses",
						enabled: true,
					},
				],
			}),
		);
		await waitFor(() => expect(enabledSwitch.getAttribute("aria-checked")).toBe("false"));
		expect(checkCodexRelaySettings).not.toHaveBeenCalled();
		expect(toastMock.success).toHaveBeenCalledWith("已切换到 ChatGPT 官方订阅");
	});

	it("rolls back the header switch and shows the save error when settings are invalid", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelaySettings).mockRejectedValue(new Error("Base URL 不合法"));

		renderPanel();

		const enabledSwitch = await screen.findByRole("switch", { name: "Codex 中转启用状态" });
		fireEvent.click(enabledSwitch);

		await waitFor(() => expect(saveCodexRelaySettings).toHaveBeenCalled());
		await waitFor(() => expect(enabledSwitch.getAttribute("aria-checked")).toBe("true"));
		expect(toastMock.error).toHaveBeenCalledWith("保存失败", {
			description: "Base URL 不合法",
		});
	});

	it("shows the API error message when enabling relay check fails", async () => {
		const runtimeConfigFetcher = vi.fn().mockResolvedValue({});
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay({}, { enabled: false }));
		vi.mocked(saveCodexRelaySettings)
			.mockResolvedValueOnce(responseWithRelay())
			.mockResolvedValueOnce(responseWithRelay({}, { enabled: false }));
		vi.mocked(checkCodexRelaySettings).mockRejectedValue({
			message: "Codex 中转配置不可用：上游返回 401，请检查 API Key 和 Base URL",
		});

		renderPanel(runtimeConfigFetcher);
		await waitFor(() => expect(runtimeConfigFetcher).toHaveBeenCalledTimes(1));

		const enabledSwitch = await screen.findByRole("switch", { name: "Codex 中转启用状态" });
		expect(enabledSwitch.getAttribute("aria-checked")).toBe("false");
		fireEvent.click(enabledSwitch);

		await waitFor(() => expect(checkCodexRelaySettings).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(enabledSwitch.getAttribute("aria-checked")).toBe("false"));
		expect(toastMock.error).toHaveBeenCalledWith("启用失败", {
			description: "Codex 中转配置不可用：上游返回 401，请检查 API Key 和 Base URL",
		});
		await act(async () => Promise.resolve());
		await waitFor(() => expect(runtimeConfigFetcher).toHaveBeenCalledTimes(2));
	});

	it("marks the active relay profile as the current channel", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay());

		renderPanel();

		const relayCard = await screen.findByTestId("relay-channel-relay");
		const currentChannelBadge = within(relayCard).getByText("当前渠道");
		expect(currentChannelBadge).toBeInTheDocument();
		expect(currentChannelBadge).toHaveClass(
			"border-success-border",
			"bg-success-surface",
			"text-success-foreground",
		);
		expect(within(relayCard).getByText("需要路由")).toBeInTheDocument();
	});

	it("shows the official login as the current channel when routing is disabled", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay({}, { enabled: false }));

		renderPanel(undefined, officialChannel());

		const officialCard = await screen.findByTestId("official-channel-card");
		expect(within(officialCard).getByText("ChatGPT 官方订阅")).toBeInTheDocument();
		expect(within(officialCard).getByText("Codex 登录")).toBeInTheDocument();
		expect(within(officialCard).getByText("当前渠道")).toBeInTheDocument();
	});

	it("switches from a relay to the official login when the official card is clicked", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelaySettings).mockResolvedValue(responseWithRelay({}, { enabled: false }));

		renderPanel(undefined, officialChannel());

		const officialCard = await screen.findByTestId("official-channel-card");
		fireEvent.click(within(officialCard).getByRole("button", { name: "使用 ChatGPT 官方订阅" }));

		await waitFor(() =>
			expect(saveCodexRelaySettings).toHaveBeenCalledWith({
				enabled: false,
				activeProfileId: "relay",
				profiles: [
					{
						id: "relay",
						name: "Relay",
						baseURL: "https://relay.example.com/v1",
						model: "gpt-5.5",
						protocol: "responses",
						enabled: true,
					},
				],
			}),
		);
		expect(checkCodexRelaySettings).not.toHaveBeenCalled();
	});

	it("runs a manual connectivity check for the active relay", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay({}, { enabled: false }));
		vi.mocked(saveCodexRelaySettings).mockResolvedValue(responseWithRelay({}, { enabled: false }));
		vi.mocked(checkCodexRelaySettings).mockResolvedValue({
			ok: true,
			profileId: "relay",
			baseURL: "https://relay.example.com/v1",
			statusCode: 200,
			models: [],
		});

		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "测试连通性" }));

		await waitFor(() =>
			expect(saveCodexRelaySettings).toHaveBeenCalledWith({
				enabled: false,
				activeProfileId: "relay",
				profiles: [
					{
						id: "relay",
						name: "Relay",
						baseURL: "https://relay.example.com/v1",
						model: "gpt-5.5",
						protocol: "responses",
						enabled: true,
					},
				],
			}),
		);
		await waitFor(() =>
			expect(checkCodexRelaySettings).toHaveBeenCalledWith({ profileId: "relay" }),
		);
		expect(toastMock.success).toHaveBeenCalledWith("连通性测试通过", {
			description: "https://relay.example.com/v1",
		});
	});

	it("runs a manual connectivity check for an inactive relay without activating it", async () => {
		const settings = responseWithTwoRelays();
		vi.mocked(getCodexRelaySettings).mockResolvedValue(settings);
		vi.mocked(saveCodexRelaySettings).mockResolvedValue(settings);
		vi.mocked(checkCodexRelaySettings).mockResolvedValue({
			ok: true,
			profileId: "relay-2",
			baseURL: "https://relay-two.example.com/v1",
			statusCode: 200,
			models: [],
		});

		renderPanel();

		const relayCard = await screen.findByTestId("relay-channel-relay-2");
		fireEvent.click(within(relayCard).getByRole("button", { name: "测试连通性" }));

		await waitFor(() =>
			expect(saveCodexRelaySettings).toHaveBeenCalledWith({
				enabled: true,
				activeProfileId: "relay",
				profiles: [
					{
						id: "relay",
						name: "Relay",
						baseURL: "https://relay.example.com/v1",
						model: "gpt-5.5",
						protocol: "responses",
						enabled: true,
					},
					{
						id: "relay-2",
						name: "Relay 2",
						baseURL: "https://relay-two.example.com/v1",
						model: "gpt-5.5",
						protocol: "responses",
						enabled: true,
					},
				],
			}),
		);
		await waitFor(() =>
			expect(checkCodexRelaySettings).toHaveBeenCalledWith({ profileId: "relay-2" }),
		);
		expect(toastMock.success).toHaveBeenCalledWith("连通性测试通过", {
			description: "https://relay-two.example.com/v1",
		});
	});

	it("switches channels when a relay card is clicked", async () => {
		const settings = responseWithTwoRelays();
		vi.mocked(getCodexRelaySettings).mockResolvedValue(settings);
		vi.mocked(saveCodexRelaySettings).mockResolvedValue({
			...settings,
			activeProfileId: "relay-2",
		});

		renderPanel();

		const relayCard = await screen.findByTestId("relay-channel-relay-2");
		fireEvent.click(within(relayCard).getByRole("button", { name: "使用中转渠道 Relay 2" }));

		await waitFor(() =>
			expect(saveCodexRelaySettings).toHaveBeenCalledWith({
				enabled: true,
				activeProfileId: "relay-2",
				profiles: [
					{
						id: "relay",
						name: "Relay",
						baseURL: "https://relay.example.com/v1",
						model: "gpt-5.5",
						protocol: "responses",
						enabled: true,
					},
					{
						id: "relay-2",
						name: "Relay 2",
						baseURL: "https://relay-two.example.com/v1",
						model: "gpt-5.5",
						protocol: "responses",
						enabled: true,
					},
				],
			}),
		);
		expect(toastMock.success).toHaveBeenCalledWith("已切换 Codex 渠道", {
			description: "Relay 2",
		});
		expect(checkCodexRelaySettings).toHaveBeenCalledTimes(1);
	});

	it("opens one editor for relay settings and the configured API key", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(
			responseWithRelay({
				apiKey: {
					configured: true,
					masked: "sk-V••••Zzl3",
					source: "settings",
				},
			}),
		);

		renderPanel();

		const relayCard = await screen.findByTestId("relay-channel-relay");
		expect(within(relayCard).queryByRole("button", { name: "编辑 Key" })).toBeNull();
		fireEvent.click(within(relayCard).getByRole("button", { name: "编辑 Relay" }));

		const dialog = await screen.findByRole("dialog", { name: "编辑中转渠道" });
		expect(within(dialog).getByLabelText("名称")).toHaveValue("Relay");
		expect(within(dialog).getByLabelText("Base URL")).toHaveValue("https://relay.example.com/v1");
		expect(within(dialog).getByLabelText("API Key")).toHaveValue("");
		expect(within(dialog).queryByText("sk-V••••Zzl3")).not.toBeInTheDocument();
		expect(within(dialog).getByRole("button", { name: "清除已保存 Key" })).toBeEnabled();
	});

	it("saves relay settings and API key from the unified editor", async () => {
		const runtimeConfigFetcher = vi.fn().mockResolvedValue({});
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelayProfileAPIKey).mockResolvedValue(
			responseWithRelay({ apiKey: { configured: true, source: "settings" } }),
		);

		renderPanel(runtimeConfigFetcher);
		await waitFor(() => expect(runtimeConfigFetcher).toHaveBeenCalledTimes(1));

		fireEvent.click(await screen.findByRole("button", { name: "编辑 Relay" }));
		const dialog = await screen.findByRole("dialog", { name: "编辑中转渠道" });
		const input = within(dialog).getByLabelText("API Key") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "sk-relay-secret" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "保存配置" }));

		await waitFor(() =>
			expect(saveCodexRelayProfileAPIKey).toHaveBeenCalledWith("relay", "sk-relay-secret"),
		);
		expect(checkCodexRelaySettings).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑中转渠道" })).toBeNull());
		await waitFor(() => expect(runtimeConfigFetcher).toHaveBeenCalledTimes(2));
	});

	it("clears dormant runtime config data after persisted relay changes", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelayProfileAPIKey).mockResolvedValue(
			responseWithRelay({ apiKey: { configured: true, source: "settings" } }),
		);
		const cache = new Map();
		const warmRuntimeConfig = vi.fn().mockResolvedValue({ model: { options: ["gpt-5.5"] } });
		const view = render(
			<SWRConfig value={{ dedupingInterval: 0, provider: () => cache }}>
				<RuntimeConfigProbe fetcher={warmRuntimeConfig} />
			</SWRConfig>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("runtime-config-probe")).toHaveTextContent("loaded"),
		);

		view.rerender(
			<SWRConfig value={{ dedupingInterval: 0, provider: () => cache }}>
				<CodexRelayPanel />
			</SWRConfig>,
		);
		fireEvent.click(await screen.findByRole("button", { name: "编辑 Relay" }));
		const dialog = await screen.findByRole("dialog", { name: "编辑中转渠道" });
		fireEvent.change(within(dialog).getByLabelText("API Key"), {
			target: { value: "sk-relay-secret" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "保存配置" }));
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑中转渠道" })).toBeNull());

		const pendingRuntimeConfig = vi.fn(() => new Promise<unknown>(() => {}));
		view.rerender(
			<SWRConfig value={{ dedupingInterval: 0, provider: () => cache }}>
				<RuntimeConfigProbe fetcher={pendingRuntimeConfig} />
			</SWRConfig>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("runtime-config-probe")).toHaveTextContent("empty"),
		);
	});

	it("keeps the unified editor open when the active relay check fails", async () => {
		const runtimeConfigFetcher = vi.fn().mockResolvedValue({});
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelayProfileAPIKey).mockResolvedValue(
			responseWithRelay({ apiKey: { configured: true, source: "settings" } }),
		);
		vi.mocked(checkCodexRelaySettings).mockRejectedValue(
			new Error("Codex 中转配置不可用：上游返回 401，请检查 API Key 和 Base URL"),
		);

		renderPanel(runtimeConfigFetcher);
		await waitFor(() => expect(runtimeConfigFetcher).toHaveBeenCalledTimes(1));

		fireEvent.click(await screen.findByRole("button", { name: "编辑 Relay" }));
		const dialog = await screen.findByRole("dialog", { name: "编辑中转渠道" });
		fireEvent.change(within(dialog).getByLabelText("API Key"), {
			target: { value: "sk-invalid-relay" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "保存配置" }));

		await waitFor(() => expect(checkCodexRelaySettings).toHaveBeenCalledTimes(1));
		expect(screen.getByRole("dialog", { name: "编辑中转渠道" })).toBeInTheDocument();
		expect(toastMock.error).toHaveBeenCalledWith("保存失败", {
			description: "Codex 中转配置不可用：上游返回 401，请检查 API Key 和 Base URL",
		});
		await waitFor(() => expect(runtimeConfigFetcher).toHaveBeenCalledTimes(2));
	});

	it("persists a new relay and its API key from one dialog", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(emptyResponse());
		vi.mocked(saveCodexRelaySettings).mockResolvedValue(responseWithDefault());
		vi.mocked(saveCodexRelayProfileAPIKey).mockResolvedValue(
			responseWithDefault({ apiKey: { configured: true, source: "settings" } }),
		);

		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "新增中转" }));
		const profileDialog = await screen.findByRole("dialog", { name: "新增中转渠道" });
		fireEvent.change(within(profileDialog).getByLabelText("Base URL"), {
			target: { value: "https://jojocode.com/v1" },
		});
		fireEvent.change(within(profileDialog).getByLabelText("API Key"), {
			target: { value: "sk-new-relay" },
		});
		fireEvent.click(within(profileDialog).getByRole("button", { name: "保存配置" }));
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "新增中转渠道" })).toBeNull());

		await waitFor(() =>
			expect(saveCodexRelaySettings).toHaveBeenCalledWith({
				enabled: false,
				activeProfileId: "default",
				profiles: [
					{
						id: "default",
						name: "默认中转",
						baseURL: "https://jojocode.com/v1",
						model: "gpt-5.5",
						protocol: "responses",
						enabled: true,
					},
				],
			}),
		);
		await waitFor(() =>
			expect(saveCodexRelayProfileAPIKey).toHaveBeenCalledWith("default", "sk-new-relay"),
		);
		expect(checkCodexRelaySettings).not.toHaveBeenCalled();
		expect(vi.mocked(saveCodexRelaySettings).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(saveCodexRelayProfileAPIKey).mock.invocationCallOrder[0],
		);
	});
});

const runtimeConfigKey = "/projects/project-1/agent/runtime-config";

const RuntimeConfigProbe: React.FC<{ fetcher: () => Promise<unknown> }> = ({ fetcher }) => {
	const { data } = useSWR(runtimeConfigKey, fetcher);
	return (
		<output data-testid="runtime-config-probe">{data === undefined ? "empty" : "loaded"}</output>
	);
};

const renderPanel = (
	runtimeConfigFetcher?: () => Promise<unknown>,
	official?: CodexOfficialChannel,
) =>
	render(
		<SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
			<CodexRelayPanel officialChannel={official} />
			{runtimeConfigFetcher ? <RuntimeConfigProbe fetcher={runtimeConfigFetcher} /> : null}
		</SWRConfig>,
	);

const officialChannel = (): CodexOfficialChannel => ({
	busy: false,
	detail: "ChatGPT Pro · /Users/test/.codex",
	email: "user@example.com",
	onCancel: vi.fn(),
	onLogin: vi.fn(),
	onLogout: vi.fn(),
	onReopen: vi.fn(),
	status: "loggedIn",
});

const responseWithRelay = (
	overrides: Partial<CodexRelaySettingsResponse["profiles"][number]> = {},
	responseOverrides: Partial<CodexRelaySettingsResponse> = {},
): CodexRelaySettingsResponse => ({
	enabled: true,
	activeProfileId: "relay",
	profiles: [
		{
			id: "relay",
			name: "Relay",
			baseURL: "https://relay.example.com/v1",
			model: "gpt-5.5",
			protocol: "responses",
			enabled: true,
			apiKey: {
				configured: false,
				source: "none",
			},
			...overrides,
		},
	],
	...responseOverrides,
});

const responseWithTwoRelays = (): CodexRelaySettingsResponse => ({
	enabled: true,
	activeProfileId: "relay",
	profiles: [
		{
			id: "relay",
			name: "Relay",
			baseURL: "https://relay.example.com/v1",
			model: "gpt-5.5",
			protocol: "responses",
			enabled: true,
			apiKey: {
				configured: false,
				source: "none",
			},
		},
		{
			id: "relay-2",
			name: "Relay 2",
			baseURL: "https://relay-two.example.com/v1",
			model: "gpt-5.5",
			protocol: "responses",
			enabled: false,
			apiKey: {
				configured: false,
				source: "none",
			},
		},
	],
});

const responseWithDefault = (
	overrides: Partial<CodexRelaySettingsResponse["profiles"][number]> = {},
): CodexRelaySettingsResponse => ({
	enabled: false,
	activeProfileId: "default",
	profiles: [
		{
			id: "default",
			name: "默认中转",
			baseURL: "https://jojocode.com/v1",
			model: "gpt-5.5",
			protocol: "responses",
			enabled: true,
			apiKey: {
				configured: false,
				source: "none",
			},
			...overrides,
		},
	],
});

const emptyResponse = (): CodexRelaySettingsResponse => ({
	enabled: false,
	activeProfileId: "",
	profiles: [],
});
