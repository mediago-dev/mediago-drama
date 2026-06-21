import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentModelProfilesResponse } from "@/domains/settings/api/settings";
import {
	clearAgentModelProfileAPIKey,
	createAgentModelProfile,
	deleteAgentModelProfile,
	getAgentModelProfiles,
	saveAgentModelProfileAPIKey,
} from "@/domains/settings/api/settings";
import { ConfirmDialog } from "@/shared/components/callable/ConfirmDialog";
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

	it("confirms before deleting a model profile", async () => {
		vi.mocked(getAgentModelProfiles).mockResolvedValue(responseWithMiniMax());
		vi.mocked(deleteAgentModelProfile).mockResolvedValue(emptyResponse());

		renderPanel();

		const deleteButton = await screen.findByRole("button", { name: "删除" });
		fireEvent.click(deleteButton);

		expect(deleteAgentModelProfile).not.toHaveBeenCalled();
		const dialog = await screen.findByRole("alertdialog", { name: "删除模型配置？" });
		fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

		await waitFor(() => expect(deleteAgentModelProfile).toHaveBeenCalledWith("minimax"));
		expect(within(dialog).getByText(/确定要删除/)).toBeTruthy();
	});

	it("confirms before clearing the model profile API key", async () => {
		vi.mocked(getAgentModelProfiles).mockResolvedValue(responseWithMiniMax(true));
		vi.mocked(clearAgentModelProfileAPIKey).mockResolvedValue(responseWithMiniMax(false));

		renderPanel();

		const clearButton = await screen.findByRole("button", { name: "清除" });
		fireEvent.click(clearButton);

		expect(clearAgentModelProfileAPIKey).not.toHaveBeenCalled();
		const dialog = await screen.findByRole("alertdialog", { name: "清除 API Key？" });
		fireEvent.click(within(dialog).getByRole("button", { name: "清除" }));

		await waitFor(() => expect(clearAgentModelProfileAPIKey).toHaveBeenCalledWith("minimax"));
		expect(within(dialog).getByText(/重新填写/)).toBeTruthy();
	});
});

const renderPanel = () =>
	render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<ConfirmDialog />
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
	temperature: 0,
};
