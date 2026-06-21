import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPromptCategory,
	listPromptCategories,
} from "@/domains/generation/api/prompt-categories";
import { listPromptPresets } from "@/domains/generation/api/prompt-presets";
import { PromptLibraryEditorPanel } from "./PromptLibraryEditorPanel";

vi.mock("@/domains/generation/api/prompt-categories", () => ({
	createPromptCategory: vi.fn(),
	listPromptCategories: vi.fn(),
	promptCategoriesKey: "/prompt-categories",
}));

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
		vi.mocked(listPromptCategories).mockResolvedValue([
			{
				id: "style",
				label: "风格",
				source: "builtin",
				builtin: true,
			},
			{
				id: "extra",
				label: "其他",
				source: "builtin",
				builtin: true,
			},
		]);
		vi.mocked(createPromptCategory).mockResolvedValue({
			id: "镜头",
			label: "镜头",
			source: "user",
		});
		vi.mocked(listPromptPresets).mockResolvedValue([
			{
				id: "anime-2d",
				name: "2D动漫",
				category: "style",
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
		expect(within(dialog).getByText("创建可复用的分类提示词预设。")).toBeTruthy();
		expect(within(dialog).getByText("分类")).toBeTruthy();
		const categorySelect = within(dialog).getByRole("combobox");
		expect(categorySelect.textContent).toContain("风格");
		expect(categorySelect.textContent).not.toContain("style");
		expect(within(dialog).getByText("名称")).toBeTruthy();
		expect(within(dialog).getByText("提示词")).toBeTruthy();
	});

	it("creates a category from the category picker button", async () => {
		renderPanel();

		await screen.findByText("2D动漫");
		fireEvent.click(screen.getByRole("button", { name: "新建" }));

		const promptDialog = await screen.findByRole("dialog", { name: "新建提示词" });
		fireEvent.click(within(promptDialog).getByRole("button", { name: "新建分类" }));

		const categoryDialog = await screen.findByRole("dialog", { name: "新建分类" });
		fireEvent.change(within(categoryDialog).getByLabelText("分类名称"), {
			target: { value: "镜头" },
		});
		fireEvent.click(within(categoryDialog).getByRole("button", { name: "创建" }));

		await waitFor(() => {
			expect(within(promptDialog).getAllByText("镜头").length).toBeGreaterThan(0);
		});
	});
});

const renderPanel = () =>
	render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<PromptLibraryEditorPanel />
		</SWRConfig>,
	);
