import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPromptCategory,
	listPromptCategories,
} from "@/domains/generation/api/prompt-categories";
import {
	createPromptPreset,
	deletePromptPreset,
	listPromptPresets,
	resetPromptPreset,
} from "@/domains/generation/api/prompt-presets";
import { listPromptPacks } from "@/domains/settings/api/packs";
import { ConfirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { PromptPackActionsSlotProvider } from "./PromptPackActionsSlot";
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

vi.mock("@/domains/settings/api/packs", () => ({
	listPromptPacks: vi.fn(),
	promptPacksKey: "/packs",
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
		vi.mocked(listPromptPacks).mockResolvedValue([
			{
				id: "builtin",
				name: "MediaGo 默认技能包",
				version: "1.0.0",
				source: "default",
				enabled: true,
			},
		]);
		vi.mocked(listPromptCategories).mockResolvedValue([
			{
				id: "style",
				label: "风格",
				source: "pack",
				builtin: true,
			},
			{
				id: "extra",
				label: "其他",
				source: "pack",
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
				packId: "builtin",
				prompt: "2D anime style",
				source: "pack",
				builtin: true,
			},
		]);
	});

	it("shows the owning prompt pack in the global prompt list and details", async () => {
		renderPanel();

		await screen.findByText("2D动漫");
		expect(screen.getAllByLabelText("所属技能包：默认技能包")).toHaveLength(2);
		expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
	});

	it("keeps the prompt name and right-aligned metadata on one row", async () => {
		renderPanel();

		const name = await screen.findByText("2D动漫");
		const listItem = name.closest("button");
		const membershipBadge = screen.getAllByLabelText("所属技能包：默认技能包")[0];
		const metadata = membershipBadge.parentElement;

		expect(listItem).toHaveClass("items-center");
		expect(name).toHaveClass("flex-1", "truncate");
		expect(metadata).toHaveClass("shrink-0");
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
		const categorySelect = within(dialog).getByRole("combobox", { name: "分类" });
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

	it("keeps the current category filter after creating from all prompts", async () => {
		vi.mocked(createPromptPreset).mockResolvedValue({
			id: "new-style",
			name: "新风格",
			category: "style",
			prompt: "new style prompt",
			source: "user",
		});

		renderPanel();

		await screen.findByText("2D动漫");
		const allFilter = screen.getByRole("button", { name: "全部" });
		expect(allFilter.getAttribute("aria-pressed")).toBe("true");

		fireEvent.click(screen.getByRole("button", { name: "新建" }));

		const dialog = await screen.findByRole("dialog", { name: "新建提示词" });
		const fields = within(dialog).getAllByRole("textbox");
		fireEvent.change(fields[0], { target: { value: "新风格" } });
		fireEvent.change(fields[1], { target: { value: "new style prompt" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

		await waitFor(() => expect(createPromptPreset).toHaveBeenCalled());
		expect(allFilter.getAttribute("aria-pressed")).toBe("true");
	});

	it("confirms before deleting a user prompt preset", async () => {
		vi.mocked(listPromptPresets).mockResolvedValue([
			{
				id: "custom-style",
				name: "自定义风格",
				category: "style",
				prompt: "custom style",
				source: "user",
			},
		]);
		vi.mocked(deletePromptPreset).mockResolvedValue(undefined);

		renderPanel();

		await screen.findByText("自定义风格");
		fireEvent.click(screen.getByRole("button", { name: "删除" }));

		expect(deletePromptPreset).not.toHaveBeenCalled();
		const dialog = await screen.findByRole("alertdialog", { name: "删除提示词预设？" });
		fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

		await waitFor(() => expect(deletePromptPreset).toHaveBeenCalledWith("custom-style"));
	});

	it("confirms before resetting a pack prompt preset", async () => {
		vi.mocked(resetPromptPreset).mockResolvedValue({
			id: "anime-2d",
			name: "2D动漫",
			category: "style",
			prompt: "default 2D anime style",
			source: "pack",
			builtin: true,
		});

		renderPanel();

		await screen.findByText("2D动漫");
		fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));

		expect(resetPromptPreset).not.toHaveBeenCalled();
		const dialog = await screen.findByRole("alertdialog", { name: "恢复提示词默认？" });
		fireEvent.click(within(dialog).getByRole("button", { name: "恢复默认" }));

		await waitFor(() => expect(resetPromptPreset).toHaveBeenCalledWith("anime-2d"));
	});
});

const renderPanel = () =>
	render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<ConfirmDialog />
			<PromptLibraryEditorPanelHarness />
		</SWRConfig>,
	);

const PromptLibraryEditorPanelHarness = () => {
	const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);

	return (
		<PromptPackActionsSlotProvider slotEl={slotEl}>
			<div ref={setSlotEl} />
			<PromptLibraryEditorPanel />
		</PromptPackActionsSlotProvider>
	);
};
