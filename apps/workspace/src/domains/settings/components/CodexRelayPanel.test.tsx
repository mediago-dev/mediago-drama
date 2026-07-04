import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexRelaySettingsResponse } from "@/domains/settings/api/settings";
import {
	getCodexRelaySettings,
	saveCodexRelayProfileAPIKey,
	saveCodexRelaySettings,
} from "@/domains/settings/api/settings";
import { CodexRelayPanel } from "./CodexRelayPanel";

vi.mock("@/domains/settings/api/settings", () => ({
	codexRelaySettingsKey: "/settings/codex-relay",
	clearCodexRelayProfileAPIKey: vi.fn(),
	getCodexRelaySettings: vi.fn(),
	saveCodexRelayProfileAPIKey: vi.fn(),
	saveCodexRelaySettings: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		error: vi.fn(),
		success: vi.fn(),
	}),
}));

describe("CodexRelayPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it("saves relay profile settings", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelaySettings).mockResolvedValue(
			responseWithRelay({ baseURL: "https://next.example.com/v1" }),
		);

		renderPanel();

		const baseURLInput = (await screen.findByLabelText("Base URL")) as HTMLInputElement;
		fireEvent.change(baseURLInput, { target: { value: "https://next.example.com/v1" } });
		fireEvent.click(screen.getByRole("button", { name: "保存" }));

		await waitFor(() =>
			expect(saveCodexRelaySettings).toHaveBeenCalledWith({
				enabled: true,
				activeProfileId: "relay",
				profiles: [
					{
						id: "relay",
						name: "Relay",
						baseURL: "https://next.example.com/v1",
						model: "gpt-5.5",
						protocol: "responses",
						enabled: true,
					},
				],
			}),
		);
	});

	it("saves the selected relay API key and clears the password input", async () => {
		vi.mocked(getCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelaySettings).mockResolvedValue(responseWithRelay());
		vi.mocked(saveCodexRelayProfileAPIKey).mockResolvedValue(
			responseWithRelay({ apiKey: { configured: true, source: "settings" } }),
		);

		renderPanel();

		const input = (await screen.findByLabelText("API Key")) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "sk-relay-secret" } });
		fireEvent.click(screen.getByRole("button", { name: "保存 Key" }));

		await waitFor(() =>
			expect(saveCodexRelayProfileAPIKey).toHaveBeenCalledWith("relay", "sk-relay-secret"),
		);
		await waitFor(() => expect(input.value).toBe(""));
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
		const input = screen.getByLabelText("API Key") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "sk-new-relay" } });
		fireEvent.click(screen.getByRole("button", { name: "保存 Key" }));

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
