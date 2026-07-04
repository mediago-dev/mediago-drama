import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexRelaySettingsResponse } from "@/domains/settings/api/settings";
import {
	checkCodexRelaySettings,
	getCodexRelaySettings,
	saveCodexRelayProfileAPIKey,
	saveCodexRelaySettings,
} from "@/domains/settings/api/settings";
import { CodexRelayPanel } from "./CodexRelayPanel";

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
		expect(toastMock.success).toHaveBeenCalledWith("Codex 中转已停用");
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
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay({}, { enabled: false }));
		vi.mocked(saveCodexRelaySettings)
			.mockResolvedValueOnce(responseWithRelay())
			.mockResolvedValueOnce(responseWithRelay({}, { enabled: false }));
		vi.mocked(checkCodexRelaySettings).mockRejectedValue({
			message: "Codex 中转配置不可用：上游返回 401，请检查 API Key 和 Base URL",
		});

		renderPanel();

		const enabledSwitch = await screen.findByRole("switch", { name: "Codex 中转启用状态" });
		expect(enabledSwitch.getAttribute("aria-checked")).toBe("false");
		fireEvent.click(enabledSwitch);

		await waitFor(() => expect(checkCodexRelaySettings).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(enabledSwitch.getAttribute("aria-checked")).toBe("false"));
		expect(toastMock.error).toHaveBeenCalledWith("启用失败", {
			description: "Codex 中转配置不可用：上游返回 401，请检查 API Key 和 Base URL",
		});
	});

	it("marks the active relay profile as effective", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay());

		renderPanel();

		expect(await screen.findByText("已生效")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "使用当前配置" })).not.toBeInTheDocument();
		expect(screen.queryByText("启用此平台")).not.toBeInTheDocument();
		expect(screen.queryByText("当前协议")).not.toBeInTheDocument();
		expect(screen.queryByText(/responses \//)).not.toBeInTheDocument();
		expect(screen.queryByText("模型")).not.toBeInTheDocument();
		expect(screen.queryByText("gpt-5.5")).not.toBeInTheDocument();
	});

	it("runs a manual connectivity check for the active relay", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay({}, { enabled: false }));
		vi.mocked(saveCodexRelaySettings).mockResolvedValue(responseWithRelay({}, { enabled: false }));
		vi.mocked(checkCodexRelaySettings).mockResolvedValue({
			ok: true,
			profileId: "relay",
			baseURL: "https://relay.example.com/v1",
			statusCode: 200,
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

	it("runs a manual connectivity check for the selected relay without activating it", async () => {
		const settings = responseWithTwoRelays();
		vi.mocked(getCodexRelaySettings).mockResolvedValue(settings);
		vi.mocked(saveCodexRelaySettings).mockResolvedValue(settings);
		vi.mocked(checkCodexRelaySettings).mockResolvedValue({
			ok: true,
			profileId: "relay-2",
			baseURL: "https://relay-two.example.com/v1",
			statusCode: 200,
		});

		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: /Relay 2/ }));
		fireEvent.click(screen.getByRole("button", { name: "测试连通性" }));

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

	it("saves the selected relay as active when using the current config", async () => {
		const settings = responseWithTwoRelays();
		vi.mocked(getCodexRelaySettings).mockResolvedValue(settings);
		vi.mocked(saveCodexRelaySettings).mockResolvedValue({
			...settings,
			activeProfileId: "relay-2",
		});

		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: /Relay 2/ }));
		fireEvent.click(screen.getByRole("button", { name: "使用当前配置" }));

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
		expect(toastMock.success).toHaveBeenCalledWith("已使用当前配置", {
			description: "Relay 2",
		});
		expect(checkCodexRelaySettings).toHaveBeenCalledTimes(1);
	});

	it("opens the API key edit dialog for a configured relay key", async () => {
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

		expect(await screen.findByText("sk-V••••Zzl3")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "编辑 Key" }));

		const dialog = await screen.findByRole("dialog", { name: "编辑 API Key" });
		expect(within(dialog).queryByText("当前 Key")).not.toBeInTheDocument();
		expect(within(dialog).queryByText("sk-V••••Zzl3")).not.toBeInTheDocument();
		expect(within(dialog).getByRole("button", { name: "清除" })).toBeEnabled();
	});

	it("saves the selected relay API key and clears the password input", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelayProfileAPIKey).mockResolvedValue(
			responseWithRelay({ apiKey: { configured: true, source: "settings" } }),
		);

		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "添加 Key" }));
		const dialog = await screen.findByRole("dialog", { name: "编辑 API Key" });
		const input = within(dialog).getByLabelText("API Key") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "sk-relay-secret" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "保存 Key" }));

		await waitFor(() =>
			expect(saveCodexRelayProfileAPIKey).toHaveBeenCalledWith("relay", "sk-relay-secret"),
		);
		expect(checkCodexRelaySettings).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑 API Key" })).toBeNull());
	});

	it("keeps the API key dialog open when the active relay check fails", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelayProfileAPIKey).mockResolvedValue(
			responseWithRelay({ apiKey: { configured: true, source: "settings" } }),
		);
		vi.mocked(checkCodexRelaySettings).mockRejectedValue(
			new Error("Codex 中转配置不可用：上游返回 401，请检查 API Key 和 Base URL"),
		);

		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "添加 Key" }));
		const dialog = await screen.findByRole("dialog", { name: "编辑 API Key" });
		fireEvent.change(within(dialog).getByLabelText("API Key"), {
			target: { value: "sk-invalid-relay" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "保存 Key" }));

		await waitFor(() => expect(checkCodexRelaySettings).toHaveBeenCalledTimes(1));
		expect(screen.getByRole("dialog", { name: "编辑 API Key" })).toBeInTheDocument();
		expect(toastMock.error).toHaveBeenCalledWith("保存失败", {
			description: "Codex 中转配置不可用：上游返回 401，请检查 API Key 和 Base URL",
		});
	});

	it("persists a new draft relay before saving its API key", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(emptyResponse());
		vi.mocked(saveCodexRelaySettings).mockResolvedValue(responseWithDefault());
		vi.mocked(saveCodexRelayProfileAPIKey).mockResolvedValue(
			responseWithDefault({ apiKey: { configured: true, source: "settings" } }),
		);

		renderPanel();

		fireEvent.change((await screen.findByLabelText("Base URL")) as HTMLInputElement, {
			target: { value: "https://jojocode.com/v1" },
		});
		fireEvent.click(screen.getByRole("button", { name: "添加 Key" }));
		const dialog = await screen.findByRole("dialog", { name: "编辑 API Key" });
		const input = within(dialog).getByLabelText("API Key") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "sk-new-relay" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "保存 Key" }));

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

const renderPanel = () =>
	render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<CodexRelayPanel />
		</SWRConfig>,
	);

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
