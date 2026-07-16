import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPromptPack,
	createPromptPackEntry,
	exportPromptPack,
	getPromptPackContents,
	listPromptPacks,
	uninstallPromptPack,
	updatePromptPackEntry,
} from "@/domains/settings/api/packs";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import type { PromptPackEditorCloseRequest } from "@/shared/desktop/types";
import { PromptPackEditor } from "./PromptPackEditor";

const toastError = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("@/domains/settings/api/packs", () => ({
	createPromptPack: vi.fn(),
	createPromptPackEntry: vi.fn(),
	exportPromptPack: vi.fn(),
	getPromptPackContents: vi.fn(),
	listPromptPacks: vi.fn(),
	promptPackContentsKey: (id: string) => `/packs/${id}/contents`,
	promptPacksKey: "/packs",
	removePromptPackEntry: vi.fn(),
	uninstallPromptPack: vi.fn(),
	updatePromptPackEntry: vi.fn(),
}));

vi.mock("@/domains/generation/api/prompt-categories", () => ({
	listPromptCategories: vi.fn().mockResolvedValue([]),
	promptCategoriesKey: "/prompt-categories",
}));

vi.mock("@/domains/workspace/lib/desktop-window-drag", () => ({
	useDesktopWindowDrag: () => vi.fn(),
	useDesktopWindowTopRegionDrag: () => vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ error: toastError, info: toastInfo, success: toastSuccess }),
}));

vi.mock("@/shared/components/callable/ConfirmDialog", () => ({
	confirmDialog: vi.fn(),
}));

describe("PromptPackEditor", () => {
	let closeRequested: ((request: PromptPackEditorCloseRequest) => void) | undefined;
	const completePromptPackEditorClose = vi.fn();
	const openExternal = vi.fn();
	const revealPath = vi.fn();
	const savePromptPack = vi.fn();
	const localPack = {
		id: "local.test-pack",
		name: "本地草稿",
		version: "1.0.0",
		source: "local" as const,
		enabled: true,
		skillCount: 0,
		promptCount: 0,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		closeRequested = undefined;
		completePromptPackEditorClose.mockResolvedValue(undefined);
		openExternal.mockResolvedValue(undefined);
		revealPath.mockResolvedValue(undefined);
		savePromptPack.mockResolvedValue({ canceled: false, path: "/tmp/draft.mgpack" });
		vi.stubEnv("VITE_MEDIAGO_PROMPT_PACK_PUBLISH_URL", "http://localhost:4321/account#promptPacks");
		window.mediagoDesktop = {
			isElectron: true,
			onPromptPackEditorCloseRequested: (
				callback: (request: PromptPackEditorCloseRequest) => void,
			) => {
				closeRequested = callback;
				return () => {
					if (closeRequested === callback) closeRequested = undefined;
				};
			},
			completePromptPackEditorClose,
			openExternal,
			revealPath,
			savePromptPack,
		} as unknown as typeof window.mediagoDesktop;
		vi.mocked(listPromptPacks).mockResolvedValue([localPack]);
		vi.mocked(getPromptPackContents).mockResolvedValue({ pack: localPack, entries: [] });
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllEnvs();
		delete window.mediagoDesktop;
	});

	it("flushes the active draft before allowing Electron to close the editor", async () => {
		const promptEntry = {
			body: "原始内容",
			id: "prompt-close",
			kind: "prompt" as const,
			metadata: { category: "other" },
			name: "关闭前保存",
			packId: localPack.id,
			slug: "prompt-close",
			source: "user" as const,
		};
		vi.mocked(getPromptPackContents).mockResolvedValue({ pack: localPack, entries: [promptEntry] });
		vi.mocked(updatePromptPackEntry).mockResolvedValue({ ...promptEntry, name: "已经保存" });
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "关闭前保存" }));
		fireEvent.change(await screen.findByLabelText("提示词名称"), {
			target: { value: "已经保存" },
		});
		closeRequested?.({ requestId: "close-1" });

		await waitFor(() => expect(updatePromptPackEntry).toHaveBeenCalled());
		await waitFor(() =>
			expect(completePromptPackEditorClose).toHaveBeenCalledWith({
				allow: true,
				requestId: "close-1",
			}),
		);
	});

	it("opens directly in pack creation mode from the route", async () => {
		renderEditor("/prompt-pack-editor?mode=create");

		expect(await screen.findByRole("heading", { name: "创建一个本地词包" })).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "词包管理" })).not.toBeInTheDocument();
	});

	it("uses the shared resizable sidebar shell and keeps the title in the white content pane", async () => {
		renderEditor();

		const navigator = await screen.findByRole("navigation", { name: "提示词包编辑器导航" });
		const title = screen.getByRole("heading", { name: "提示词包编辑器" });
		const resizeHandle = screen.getByRole("separator", {
			name: "调整词包编辑器侧边栏宽度",
		});

		expect(navigator).toHaveClass("bg-ide-sidebar");
		expect(navigator).not.toContainElement(title);
		expect(title.closest("header")).toHaveClass("bg-ide-editor");
		fireEvent.keyDown(resizeHandle, { key: "Home" });
		expect(resizeHandle).toHaveAttribute("aria-valuenow", "220");
		fireEvent.keyDown(resizeHandle, { key: "ArrowRight" });
		expect(resizeHandle).toHaveAttribute("aria-valuenow", "232");
		fireEvent.pointerDown(resizeHandle, { clientX: 232 });
		fireEvent.pointerMove(window, { clientX: 300 });
		expect(resizeHandle).toHaveAttribute("aria-valuenow", "300");
		fireEvent.pointerUp(window);
	});

	it("creates a local draft without asking for author or package ID", async () => {
		vi.mocked(createPromptPack).mockResolvedValue(localPack);
		renderEditor();
		fireEvent.click(await screen.findByRole("button", { name: "新建词包" }));

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(await screen.findByRole("heading", { name: "创建一个本地词包" })).toBeInTheDocument();
		expect(screen.queryByLabelText("作者")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("Package ID")).not.toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("名称"), { target: { value: "新草稿" } });
		fireEvent.change(screen.getByLabelText("简介"), { target: { value: "角色视觉规范" } });
		fireEvent.click(screen.getByRole("button", { name: "创建并开始编辑" }));

		await waitFor(() =>
			expect(createPromptPack).toHaveBeenCalledWith(
				expect.objectContaining({
					description: "角色视觉规范",
					id: expect.stringMatching(/^local\./),
					name: "新草稿",
					version: "1.0.0",
				}),
			),
		);
	});

	it("keeps pack creation and search states mutually exclusive", async () => {
		renderEditor();

		fireEvent.click(await screen.findByRole("button", { name: "新建词包" }));
		expect(await screen.findByRole("heading", { name: "创建一个本地词包" })).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "搜索词包" }));
		expect(await screen.findByLabelText("搜索本地词包")).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "创建一个本地词包" })).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "新建词包" }));
		expect(screen.queryByLabelText("搜索本地词包")).not.toBeInTheDocument();
		expect(await screen.findByRole("heading", { name: "创建一个本地词包" })).toBeInTheDocument();
	});

	it("opens a type dialog from the single new-content toolbar action", async () => {
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		const createButton = await screen.findByRole("button", { name: "新建内容" });
		expect(screen.getByRole("button", { name: "词包概览" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "返回词包列表" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "搜索当前词包" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "列表视图" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "分组视图" })).toBeInTheDocument();
		expect(screen.getAllByText("本地草稿").length).toBeGreaterThan(0);

		fireEvent.click(createButton);
		expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "新建词包内容" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: /提示词/ })).toHaveAttribute("aria-checked", "true");
		expect(screen.getByRole("radio", { name: /Skill/ })).toHaveAttribute("aria-checked", "false");
		expect(screen.getByRole("button", { name: "创建提示词" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "从已有内容添加" })).not.toBeInTheDocument();
	});

	it("exports a plain mgpack without a commercial publishing form", async () => {
		let completeSave: ((result: { canceled: boolean; path?: string }) => void) | undefined;
		savePromptPack.mockReturnValueOnce(
			new Promise((resolve) => {
				completeSave = resolve;
			}),
		);
		vi.mocked(exportPromptPack).mockResolvedValue({
			blob: new Blob(["MGPK"]),
			fileName: "draft.mgpack",
		});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");
		fireEvent.click(await screen.findByRole("button", { name: "导出" }));

		await waitFor(() =>
			expect(savePromptPack).toHaveBeenCalledWith({
				data: expect.any(Uint8Array),
				filename: "draft.mgpack",
			}),
		);
		expect(toastSuccess).not.toHaveBeenCalledWith("词包已导出", expect.anything());
		completeSave?.({ canceled: false, path: "/tmp/draft.mgpack" });
		const completionDialog = await screen.findByRole("alertdialog");
		expect(screen.getByRole("heading", { name: "词包已导出" })).toBeInTheDocument();
		expect(completionDialog).toHaveTextContent(
			"“draft.mgpack”已保存。前往 MediaGo「我的词包」上传，设置公开售卖或席位分发并提交审核。",
		);
		expect(openExternal).not.toHaveBeenCalled();
		expect(toastSuccess).not.toHaveBeenCalledWith("词包已导出", expect.anything());

		fireEvent.click(screen.getByRole("button", { name: "在文件夹中显示" }));
		await waitFor(() => expect(revealPath).toHaveBeenCalledWith("/tmp/draft.mgpack"));
		fireEvent.click(screen.getByRole("button", { name: "前往发布" }));
		await waitFor(() =>
			expect(openExternal).toHaveBeenCalledWith("http://localhost:4321/account#promptPacks"),
		);
		await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
		expect(screen.queryByRole("radio", { name: "公开售卖" })).not.toBeInTheDocument();
		expect(screen.queryByRole("radio", { name: "席位分发" })).not.toBeInTheDocument();
	});

	it("does not announce success when the native save dialog is canceled", async () => {
		savePromptPack.mockResolvedValueOnce({ canceled: true });
		vi.mocked(exportPromptPack).mockResolvedValue({
			blob: new Blob(["MGPK"]),
			fileName: "draft.mgpack",
		});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "导出" }));

		await waitFor(() => expect(savePromptPack).toHaveBeenCalled());
		await waitFor(() => expect(screen.getByRole("button", { name: "导出" })).toBeEnabled());
		expect(toastSuccess).not.toHaveBeenCalledWith("词包已导出", expect.anything());
		expect(toastInfo).not.toHaveBeenCalled();
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
	});

	it("keeps the publish page closed when export follow-up is deferred", async () => {
		vi.mocked(exportPromptPack).mockResolvedValue({
			blob: new Blob(["MGPK"]),
			fileName: "draft.mgpack",
		});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "导出" }));
		fireEvent.click(await screen.findByRole("button", { name: "稍后处理" }));

		await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
		expect(openExternal).not.toHaveBeenCalled();
	});

	it("uses the production publish page when no override is configured", async () => {
		vi.stubEnv("VITE_MEDIAGO_PROMPT_PACK_PUBLISH_URL", "");
		vi.mocked(exportPromptPack).mockResolvedValue({
			blob: new Blob(["MGPK"]),
			fileName: "draft.mgpack",
		});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "导出" }));
		fireEvent.click(await screen.findByRole("button", { name: "前往发布" }));

		await waitFor(() =>
			expect(openExternal).toHaveBeenCalledWith(
				"https://mediago-api.torchstellar.com/account#promptPacks",
			),
		);
	});

	it("rejects a non-http publish URL instead of handing it to Electron", async () => {
		vi.stubEnv("VITE_MEDIAGO_PROMPT_PACK_PUBLISH_URL", "javascript:alert(1)");
		vi.mocked(exportPromptPack).mockResolvedValue({
			blob: new Blob(["MGPK"]),
			fileName: "draft.mgpack",
		});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "导出" }));
		fireEvent.click(await screen.findByRole("button", { name: "前往发布" }));

		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("未配置词包发布地址", {
				description: "请设置 VITE_MEDIAGO_PROMPT_PACK_PUBLISH_URL 后重试。",
			}),
		);
		expect(openExternal).not.toHaveBeenCalled();
		expect(screen.getByRole("alertdialog")).toBeInTheDocument();
	});

	it("opens an incomplete entry and explains which fields block export", async () => {
		const incompleteSkill = {
			body: "",
			description: "",
			id: "skill-incomplete",
			kind: "skill" as const,
			name: "未命名 Skill",
			packId: localPack.id,
			slug: "skill-internal-uuid",
			source: "user" as const,
		};
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: localPack,
			entries: [incompleteSkill],
		});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "导出" }));

		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("请完善词包内容", {
				description: "“未命名 Skill”缺少用途描述和正文内容，请补充后再导出。",
			}),
		);
		expect(await screen.findByLabelText("Skill 名称")).toHaveValue("未命名 Skill");
		expect(exportPromptPack).not.toHaveBeenCalled();
	});

	it("does not expose backend entry IDs when export validation races the client", async () => {
		const validSkill = {
			body: "完整正文",
			description: "完整描述",
			id: "skill-valid",
			kind: "skill" as const,
			name: "完整 Skill",
			packId: localPack.id,
			slug: "skill-valid",
			source: "user" as const,
		};
		vi.mocked(getPromptPackContents).mockResolvedValue({ pack: localPack, entries: [validSkill] });
		vi.mocked(exportPromptPack).mockRejectedValue(
			new Error(
				'invalid prompt pack: skill "skill-70c8a8cb-3622-4b9a-a764-dc619311470b" description is required',
			),
		);
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "导出" }));

		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("请完善词包内容", {
				description: "当前 Skill 缺少用途描述，请补充后再导出。",
			}),
		);
		expect(JSON.stringify(toastError.mock.calls)).not.toContain("skill-70c8a8cb");
	});

	it("persists a new prompt before opening the normal autosave editor", async () => {
		const createdPrompt = {
			body: "",
			id: `${localPack.id}/prompt/prompt-new`,
			kind: "prompt" as const,
			metadata: { category: "extra" },
			name: "未命名提示词",
			packId: localPack.id,
			slug: "prompt-new",
			source: "user" as const,
		};
		vi.mocked(createPromptPackEntry).mockResolvedValue(createdPrompt);
		vi.mocked(getPromptPackContents)
			.mockResolvedValueOnce({ pack: localPack, entries: [] })
			.mockResolvedValue({
				pack: { ...localPack, promptCount: 1 },
				entries: [createdPrompt],
			});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");
		fireEvent.click(await screen.findByRole("button", { name: "新建内容" }));
		fireEvent.click(await screen.findByRole("button", { name: "创建提示词" }));

		await waitFor(() =>
			expect(createPromptPackEntry).toHaveBeenCalledWith(
				localPack.id,
				expect.objectContaining({
					kind: "prompt",
					slug: expect.stringMatching(/^prompt-/),
				}),
			),
		);
		expect(await screen.findByLabelText("提示词名称")).toHaveValue("未命名提示词");
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
		expect(screen.queryByText("新建提示词")).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "创建" })).not.toBeInTheDocument();
	});

	it("deletes the selected local pack and returns to the pack picker", async () => {
		vi.mocked(confirmDialog).mockImplementation(async (options) => {
			await options.onConfirm?.();
			return true;
		});
		vi.mocked(uninstallPromptPack).mockResolvedValue();
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "删除词包" }));

		await waitFor(() => expect(uninstallPromptPack).toHaveBeenCalledWith(localPack.id));
		expect(confirmDialog).toHaveBeenCalledWith(
			expect.objectContaining({
				confirmLabel: "删除词包",
				title: "删除本地词包？",
				variant: "destructive",
			}),
		);
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "词包管理" })).toBeInTheDocument(),
		);
		expect(screen.getByRole("heading", { name: "还没有本地词包" })).toBeInTheDocument();
	});

	it("keeps legacy prompt metadata while hiding category from the editor", async () => {
		const promptEntry = {
			body: "原始内容",
			id: "prompt-1",
			kind: "prompt" as const,
			metadata: { category: "style", legacyFlag: "keep" },
			name: "旧提示词",
			packId: localPack.id,
			slug: "prompt-1",
			source: "user" as const,
		};
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: localPack,
			entries: [promptEntry],
		});
		vi.mocked(updatePromptPackEntry).mockResolvedValue({ ...promptEntry, name: "新名称" });
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "旧提示词" }));
		expect(screen.queryByLabelText("分类")).not.toBeInTheDocument();
		fireEvent.change(await screen.findByLabelText("提示词名称"), {
			target: { value: "新名称" },
		});
		fireEvent.keyDown(window, { key: "s", metaKey: true });

		await waitFor(() =>
			expect(updatePromptPackEntry).toHaveBeenCalledWith(
				localPack.id,
				promptEntry.id,
				expect.objectContaining({
					metadata: { category: "style", legacyFlag: "keep" },
					name: "新名称",
				}),
			),
		);
	});
});

const renderEditor = (entry = "/prompt-pack-editor") =>
	render(
		<MemoryRouter initialEntries={[entry]}>
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<PromptPackEditor />
			</SWRConfig>
		</MemoryRouter>,
	);
