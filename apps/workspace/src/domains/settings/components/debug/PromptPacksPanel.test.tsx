import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	exportPromptPack,
	importPromptPackFile,
	listPromptPacks,
} from "@/domains/settings/api/packs";
import { PromptPacksPanel } from "./PromptPacksPanel";

vi.mock("@/domains/settings/api/packs", () => ({
	exportPromptPack: vi.fn(),
	importPromptPackFile: vi.fn(),
	listPromptPacks: vi.fn(),
	promptPacksKey: "/packs",
	resetPromptPack: vi.fn(),
	setPromptPackEnabled: vi.fn(),
	uninstallPromptPack: vi.fn(),
}));

vi.mock("@/domains/settings/api/skills", () => ({
	skillsKey: "/skills",
}));

vi.mock("@/domains/generation/api/prompt-categories", () => ({
	promptCategoriesKey: "/prompt-categories",
}));

vi.mock("@/domains/generation/api/prompt-presets", () => ({
	promptPresetsKey: "/prompt-presets",
}));

vi.mock("@/domains/workspace/lib/desktop-window-drag", () => ({
	useDesktopWindowDrag: () => vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		error: vi.fn(),
		success: vi.fn(),
	}),
}));

vi.mock("@/shared/components/callable/ConfirmDialog", () => ({
	confirmDialog: vi.fn(),
}));

vi.mock("./SkillsEditorPanel", () => ({
	SkillsEditorPanel: () => <div>Skills editor</div>,
}));

vi.mock("./PromptLibraryEditorPanel", () => ({
	PromptLibraryEditorPanel: () => <div>Prompt library editor</div>,
}));

describe("PromptPacksPanel", () => {
	const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(listPromptPacks).mockResolvedValue([
			{
				id: "builtin",
				name: "默认包",
				version: "1.0.0",
				source: "default",
				enabled: true,
			},
			{
				id: "com.example.test",
				name: "测试包",
				version: "1.0.0",
				source: "imported",
				enabled: true,
			},
		]);
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: vi.fn(() => "blob:prompt-pack"),
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: vi.fn(),
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("downloads the default prompt pack as mgpack", async () => {
		vi.mocked(exportPromptPack).mockResolvedValue({
			blob: new Blob(["MGPK"], { type: "application/octet-stream" }),
			fileName: "mediago.default-prompts-1.0.0.mgpack",
		});

		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: /管理/ }));
		await screen.findAllByText("默认包");
		fireEvent.click(screen.getAllByRole("button", { name: "导出提示词包" })[0]);

		await waitFor(() => expect(exportPromptPack).toHaveBeenCalledWith("builtin"));
		expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
		expect(clickSpy).toHaveBeenCalled();
	});

	it("imports a selected mgpack file", async () => {
		vi.mocked(importPromptPackFile).mockResolvedValue({
			id: "com.example.imported",
			name: "导入包",
			version: "1.0.0",
			source: "imported",
			enabled: true,
		});

		renderPanel();
		const input = screen.getByLabelText("导入提示词包文件");
		const file = new File(["MGPK"], "mediago-prompt-pack.mgpack", {
			type: "application/octet-stream",
		});
		fireEvent.change(input, {
			target: {
				files: [file],
			},
		});

		await waitFor(() => expect(importPromptPackFile).toHaveBeenCalledWith(file));
	});
});

const renderPanel = () =>
	render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<PromptPacksPanel />
		</SWRConfig>,
	);
