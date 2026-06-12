import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listPromptPresets } from "@/domains/generation/api/prompt-presets";
import { PromptLibraryEditorPanel } from "./PromptLibraryEditorPanel";

vi.mock("@/domains/generation/api/prompt-presets", () => ({
	createPromptPreset: vi.fn(),
	deletePromptPreset: vi.fn(),
	listPromptPresets: vi.fn(),
	promptPresetsKey: "/prompt-presets",
	resetPromptPreset: vi.fn(),
	updatePromptPreset: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		error: vi.fn(),
		success: vi.fn(),
	}),
}));

describe("PromptLibraryEditorPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(listPromptPresets).mockResolvedValue([
			{
				id: "anime-2d",
				name: "2D动漫",
				layer: "style",
				prompt: "2D anime style",
				source: "builtin",
				builtin: true,
			},
		]);
	});

	afterEach(() => {
		cleanup();
	});

	it("opens a modal form when creating a prompt preset", async () => {
		renderPanel();

		await screen.findByText("2D动漫");
		fireEvent.click(screen.getByRole("button", { name: "新建" }));

		const dialog = await screen.findByRole("dialog", { name: "新建提示词" });
		expect(within(dialog).getByText("创建可复用的分层提示词预设。")).toBeTruthy();
		expect(within(dialog).getByText("层")).toBeTruthy();
		expect(within(dialog).getByText("名称")).toBeTruthy();
		expect(within(dialog).getByText("提示词")).toBeTruthy();
	});
});

const renderPanel = () =>
	render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<PromptLibraryEditorPanel />
		</SWRConfig>,
	);
