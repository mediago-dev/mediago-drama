import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import useSWR, { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	exportPromptPack,
	importPromptPackFile,
	listPromptPacks,
	setPromptPackEnabled,
} from "@/domains/settings/api/packs";
import { openPromptPackEditor } from "@/shared/desktop/actions";
import { PromptPacksPanel } from "./PromptPacksPanel";

vi.mock("@/domains/settings/api/packs", () => ({
	exportPromptPack: vi.fn(),
	importPromptPackFile: vi.fn(),
	listPromptPacks: vi.fn(),
	promptPackExportFileName: vi.fn((pack: { id: string }) => `${pack.id}.mgpack`),
	promptPacksKey: "/packs",
	resetPromptPack: vi.fn(),
	setPromptPackEnabled: vi.fn(),
	uninstallPromptPack: vi.fn(),
}));

vi.mock("@/shared/desktop/actions", () => ({
	openPromptPackEditor: vi.fn(),
}));

vi.mock("@/domains/workspace/lib/desktop-window-drag", () => ({
	useDesktopWindowDrag: () => vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

vi.mock("./SkillsEditorPanel", () => ({
	SkillsEditorPanel: () => <div>Skills editor</div>,
}));

vi.mock("./PromptLibraryEditorPanel", () => ({
	PromptLibraryEditorPanel: () => <div>Prompt library editor</div>,
}));

describe("PromptPacksPanel", () => {
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
				id: "local.test-pack",
				name: "本地草稿",
				version: "1.0.0",
				source: "local",
				enabled: false,
			},
			{
				id: "marketplace.test-pack",
				name: "商城导入包",
				version: "2.0.0",
				source: "imported",
				enabled: true,
				releaseId: "release-2",
			},
		]);
		vi.mocked(setPromptPackEnabled).mockImplementation(async (id, enabled) => ({
			id,
			name: id === "builtin" ? "默认包" : "本地草稿",
			version: "1.0.0",
			source: id === "builtin" ? "default" : "local",
			enabled,
		}));
	});

	afterEach(() => cleanup());

	it("keeps global Skill and prompt editors without an embedded pack tab", () => {
		renderPanel();

		expect(screen.getByRole("tab", { name: "技能" })).toHaveAttribute("data-state", "active");
		expect(screen.getByText("Skills editor")).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "词包" })).not.toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "提示词库" })).toBeInTheDocument();
	});

	it("imports a selected mgpack file", async () => {
		vi.mocked(importPromptPackFile).mockResolvedValue({
			id: "imported.test",
			name: "导入包",
			version: "1.0.0",
			source: "imported",
			enabled: true,
		});
		renderPanel(<PendingPromptPackCache />);

		const file = new File(["MGPK"], "test.mgpack", { type: "application/octet-stream" });
		fireEvent.change(screen.getByLabelText("导入提示词包文件"), {
			target: { files: [file] },
		});

		await waitFor(() => expect(importPromptPackFile).toHaveBeenCalledWith(file));
		await waitFor(() => expect(screen.getByRole("button", { name: "导入" })).toBeEnabled());
	});

	it("opens the dedicated editor from management", async () => {
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: /管理/ }));
		fireEvent.click(await screen.findByRole("button", { name: "制作" }));

		expect(openPromptPackEditor).toHaveBeenCalledWith({ mode: "create" });
	});

	it("keeps the default pack enabled and disables its switch", async () => {
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: /管理/ }));
		const toggle = await screen.findByRole("switch", {
			name: "默认提示词包不可停用 默认包",
		});

		expect(toggle).toBeChecked();
		expect(toggle).toBeDisabled();
		fireEvent.click(toggle);
		expect(setPromptPackEnabled).not.toHaveBeenCalled();
	});

	it("allows non-default packs to be toggled", async () => {
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: /管理/ }));
		const toggle = await screen.findByRole("switch", { name: "启用提示词包 本地草稿" });
		fireEvent.click(toggle);

		await waitFor(() => expect(setPromptPackEnabled).toHaveBeenCalledWith("local.test-pack", true));
	});

	it("uses compact rows with switches and overflow menus", async () => {
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: /管理/ }));

		expect(await screen.findAllByRole("switch")).toHaveLength(3);
		expect(screen.getAllByRole("button", { name: /更多操作/ })).toHaveLength(3);
		expect(screen.queryByRole("button", { name: "编辑提示词包 本地草稿" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "导出提示词包 本地草稿" })).not.toBeInTheDocument();

		fireEvent.pointerDown(screen.getByRole("button", { name: "更多操作 本地草稿" }), {
			button: 0,
			ctrlKey: false,
		});
		const uninstallItem = await screen.findByRole("menuitem", { name: "卸载" });
		expect(uninstallItem).toHaveClass("text-destructive");
	});

	it("opens a local draft directly in the dedicated editor", async () => {
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: /管理/ }));
		fireEvent.pointerDown(await screen.findByRole("button", { name: "更多操作 本地草稿" }), {
			button: 0,
			ctrlKey: false,
		});
		fireEvent.click(await screen.findByRole("menuitem", { name: "编辑" }));

		expect(openPromptPackEditor).toHaveBeenCalledWith({ packId: "local.test-pack" });
	});

	it("keeps plain mgpack export available in the community UI", async () => {
		vi.stubGlobal("URL", {
			...URL,
			createObjectURL: vi.fn(() => "blob:pack"),
			revokeObjectURL: vi.fn(),
		});
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
		vi.mocked(exportPromptPack).mockResolvedValue({
			blob: new Blob(["MGPK"]),
			fileName: "test.mgpack",
		});
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: /管理/ }));
		fireEvent.pointerDown(await screen.findByRole("button", { name: "更多操作 本地草稿" }), {
			button: 0,
			ctrlKey: false,
		});
		fireEvent.click(await screen.findByRole("menuitem", { name: "导出" }));

		await waitFor(() => expect(exportPromptPack).toHaveBeenCalledWith("local.test-pack"));
		vi.unstubAllGlobals();
	});

	it("exports an installed marketplace release as a plain mgpack snapshot", async () => {
		vi.stubGlobal("URL", {
			...URL,
			createObjectURL: vi.fn(() => "blob:pack"),
			revokeObjectURL: vi.fn(),
		});
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
		vi.mocked(exportPromptPack).mockResolvedValue({
			blob: new Blob(["MGPK"]),
			fileName: "marketplace.mgpack",
		});
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: /管理/ }));
		fireEvent.pointerDown(await screen.findByRole("button", { name: "更多操作 商城导入包" }), {
			button: 0,
			ctrlKey: false,
		});
		fireEvent.click(await screen.findByRole("menuitem", { name: "导出" }));

		await waitFor(() => expect(exportPromptPack).toHaveBeenCalledWith("marketplace.test-pack"));
		vi.unstubAllGlobals();
	});
});

const PendingPromptPackCache = () => {
	useSWR("/skills", () => new Promise<never>(() => undefined));
	return null;
};

const renderPanel = (extra?: React.ReactNode) =>
	render(
		<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
			<PromptPacksPanel />
			{extra}
		</SWRConfig>,
	);
