import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentModelProfilesResponse } from "@/domains/settings/api/settings";
import {
	createAgentModelProfile,
	getAgentModelProfiles,
	saveAgentModelProfileAPIKey,
} from "@/domains/settings/api/settings";
import { AgentModelProfilesPanel } from "./AgentModelProfilesPanel";

vi.mock("@/domains/settings/api/settings", () => ({
	agentModelProfilesKey: "/settings/agent-model-profiles",
	clearAgentModelProfileAPIKey: vi.fn(),
	createAgentModelProfile: vi.fn(),
	deleteAgentModelProfile: vi.fn(),
	getAgentModelProfiles: vi.fn(),
	saveAgentModelProfileAPIKey: vi.fn(),
	setDefaultAgentModelProfile: vi.fn(),
	updateAgentModelProfile: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		error: vi.fn(),
		success: vi.fn(),
	}),
}));

describe("AgentModelProfilesPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it("creates a profile from the selected template", async () => {
		vi.mocked(getAgentModelProfiles).mockResolvedValue(emptyResponse());
		vi.mocked(createAgentModelProfile).mockResolvedValue(responseWithMiniMax());

		renderPanel();

		const createButton = (await screen.findByRole("button", { name: /新增/ })) as HTMLButtonElement;
		await waitFor(() => expect(createButton.disabled).toBe(false));
		fireEvent.click(createButton);

		await waitFor(() =>
			expect(createAgentModelProfile).toHaveBeenCalledWith({ templateId: "minimax" }),
		);
	});

	it("saves the profile API key and clears the password input", async () => {
		vi.mocked(getAgentModelProfiles).mockResolvedValue(responseWithMiniMax());
		vi.mocked(saveAgentModelProfileAPIKey).mockResolvedValue(responseWithMiniMax(true));

		renderPanel();

		const input = (await screen.findByLabelText("API Key")) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "sk-panel-secret" } });
		fireEvent.click(screen.getByRole("button", { name: /保存 Key/ }));

		await waitFor(() =>
			expect(saveAgentModelProfileAPIKey).toHaveBeenCalledWith("minimax", "sk-panel-secret"),
		);
		await waitFor(() => expect(input.value).toBe(""));
	});
});

const renderPanel = () =>
	render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<AgentModelProfilesPanel />
		</SWRConfig>,
	);

const emptyResponse = (): AgentModelProfilesResponse => ({
	defaultProfileId: "",
	profiles: [],
	templates: [minimaxTemplate],
});

const responseWithMiniMax = (configured = false): AgentModelProfilesResponse => ({
	defaultProfileId: "minimax",
	profiles: [
		{
			id: "minimax",
			name: "MiniMax 国内",
			providerId: "minimax-cn",
			providerLabel: "MiniMax 国内",
			baseURL: "https://api.minimaxi.com/v1",
			model: "MiniMax-M3",
			modelDisplayName: "MiniMax M3",
			enabled: true,
			isDefault: true,
			supportsImages: false,
			supportsTools: true,
			supportsReasoning: true,
			temperature: 0,
			apiKey: {
				configured,
				source: configured ? "settings" : "none",
				masked: configured ? "sk-p••••••••cret" : "",
			},
		},
	],
	templates: [minimaxTemplate],
});

const minimaxTemplate = {
	id: "minimax",
	name: "MiniMax 国内",
	providerId: "minimax-cn",
	providerLabel: "MiniMax 国内",
	baseURL: "https://api.minimaxi.com/v1",
	model: "MiniMax-M3",
	modelDisplayName: "MiniMax M3",
	supportsImages: false,
	supportsTools: true,
	supportsReasoning: true,
	temperature: 0,
};
