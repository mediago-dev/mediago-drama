import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPromptPack,
	createPromptPackCategory,
	createPromptPackEntry,
	deletePromptPackCategory,
	exportPromptPack,
	forkPromptPack,
	getPromptPackContents,
	listPromptPacks,
	resetPromptPackEntry,
	savePromptPackDraft,
	setPromptPackEnabled,
	uninstallPromptPack,
	updatePromptPackCategory,
	updatePromptPackEntry,
	updatePromptPackMetadata,
} from "@/domains/settings/api/packs";
import { usePromptPackDraftStore } from "@/domains/settings/stores/prompt-pack-drafts";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import type { PromptPackEditorCloseRequest } from "@/shared/desktop/types";
import { PromptPackEditor } from "./PromptPackEditor";

const toastError = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

const ensurePointerCaptureMocks = () => {
	const pointerCaptureMethods = {
		hasPointerCapture: () => false,
		releasePointerCapture: () => undefined,
		scrollIntoView: () => undefined,
		setPointerCapture: () => undefined,
	};

	for (const [methodName, implementation] of Object.entries(pointerCaptureMethods)) {
		if (methodName in HTMLElement.prototype) continue;
		Object.defineProperty(HTMLElement.prototype, methodName, {
			configurable: true,
			value: implementation,
		});
	}
};

vi.mock("@/domains/settings/api/packs", () => ({
	createPromptPack: vi.fn(),
	createPromptPackCategory: vi.fn(),
	createPromptPackEntry: vi.fn(),
	deletePromptPackCategory: vi.fn(),
	exportPromptPack: vi.fn(),
	forkPromptPack: vi.fn(),
	getPromptPackContents: vi.fn(),
	listPromptPacks: vi.fn(),
	promptPackContentsKey: (id: string) => `/packs/${id}/contents`,
	promptPacksKey: "/packs",
	removePromptPackEntry: vi.fn(),
	resetPromptPack: vi.fn(),
	resetPromptPackEntry: vi.fn(),
	savePromptPackDraft: vi.fn(),
	setPromptPackEnabled: vi.fn(),
	uninstallPromptPack: vi.fn(),
	updatePromptPackCategory: vi.fn(),
	updatePromptPackEntry: vi.fn(),
	updatePromptPackMetadata: vi.fn(),
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
		localStorage.clear();
		usePromptPackDraftStore.setState({ draftsByPackId: {} });
		ensurePointerCaptureMocks();
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
		vi.mocked(savePromptPackDraft).mockImplementation(async (packId, input) => ({
			categories: input.categories,
			entries: input.entries,
			pack: { ...localPack, id: packId },
			revision: "saved-revision",
		}));
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllEnvs();
		delete window.mediagoDesktop;
	});

	it("keeps the active draft locally and allows Electron to close without formal save", async () => {
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
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "关闭前保存" }));
		fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
		fireEvent.change(await screen.findByLabelText("提示词名称"), {
			target: { value: "已经保存" },
		});
		closeRequested?.({ requestId: "close-1" });

		expect(savePromptPackDraft).not.toHaveBeenCalled();
		expect(updatePromptPackEntry).not.toHaveBeenCalled();
		expect(
			usePromptPackDraftStore.getState().draftsByPackId[localPack.id]?.working.entries[0],
		).toMatchObject({ name: "已经保存" });
		await waitFor(() =>
			expect(completePromptPackEditorClose).toHaveBeenCalledWith({
				allow: true,
				requestId: "close-1",
			}),
		);
	});

	it("reopens in read mode and lets the user resume or abandon a persisted draft", async () => {
		const skillEntry = {
			body: "原始正文",
			description: "原始描述",
			id: "local.test-pack/skill/recoverable",
			kind: "skill" as const,
			name: "可恢复 Skill",
			packId: localPack.id,
			slug: "recoverable",
			source: "user" as const,
			title: "可恢复 Skill",
		};
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: localPack,
			entries: [skillEntry],
			revision: "revision-1",
		});
		const firstRender = renderEditor("/prompt-pack-editor?packId=local.test-pack");
		fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
		fireEvent.change(await screen.findByLabelText("Skill 描述"), {
			target: { value: "保存在本地的描述" },
		});
		expect(localStorage.getItem("prompt-pack-drafts.v1")).toContain("保存在本地的描述");
		firstRender.unmount();

		renderEditor("/prompt-pack-editor?packId=local.test-pack");
		expect(await screen.findByText("发现未保存草稿")).toBeInTheDocument();
		expect(screen.getByLabelText("Skill 描述")).toHaveAttribute("readonly");
		fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
		expect(await screen.findByLabelText("Skill 描述")).toHaveValue("保存在本地的描述");
		expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();

		vi.mocked(confirmDialog).mockImplementation(async (options) => {
			await options.onConfirm?.();
			return true;
		});
		fireEvent.click(screen.getByRole("button", { name: "放弃草稿" }));
		await waitFor(() =>
			expect(usePromptPackDraftStore.getState().draftsByPackId[localPack.id]).toBeUndefined(),
		);
		expect(await screen.findByRole("button", { name: "编辑" })).toBeInTheDocument();
		expect(screen.getByLabelText("Skill 描述")).toHaveValue("原始描述");
	});

	it("allows a changed persisted draft to be saved immediately after resuming", async () => {
		const skillEntry = {
			body: "原始正文",
			description: "原始描述",
			id: "local.test-pack/skill/resume-save",
			kind: "skill" as const,
			name: "恢复后直接保存",
			packId: localPack.id,
			slug: "resume-save",
			source: "user" as const,
			title: "恢复后直接保存",
		};
		const contents = {
			pack: localPack,
			entries: [skillEntry],
			revision: "revision-1",
		};
		vi.mocked(getPromptPackContents).mockResolvedValue(contents);
		usePromptPackDraftStore.getState().startDraft(contents);
		const draft = usePromptPackDraftStore.getState().draftsByPackId[localPack.id];
		usePromptPackDraftStore.getState().updateWorking(localPack.id, {
			...draft.working,
			entries: draft.working.entries.map((entry) =>
				entry.id === skillEntry.id ? { ...entry, description: "草稿中的描述" } : entry,
			),
		});

		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		expect(await screen.findByText("发现未保存草稿")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
		const saveButton = await screen.findByRole("button", { name: "保存" });
		expect(saveButton).toBeEnabled();
		fireEvent.click(saveButton);

		await waitFor(() => expect(savePromptPackDraft).toHaveBeenCalledTimes(1));
		expect(savePromptPackDraft).toHaveBeenCalledWith(
			localPack.id,
			expect.objectContaining({ baseRevision: "revision-1" }),
		);
	});

	it("keeps an entry read-only until edit and saves only from the explicit action", async () => {
		const skillEntry = {
			body: "原始正文",
			description: "原始描述",
			id: "skill-explicit-save",
			kind: "skill" as const,
			name: "分镜写作",
			packId: localPack.id,
			slug: "storyboard-writer",
			source: "user" as const,
		};
		vi.mocked(getPromptPackContents).mockResolvedValue({ pack: localPack, entries: [skillEntry] });
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "分镜写作" }));
		const nameInput = await screen.findByLabelText("Skill 名称");
		const descriptionInput = screen.getByLabelText("Skill 描述");
		expect(screen.getByText("Skill 正文")).toBeInTheDocument();
		expect(
			screen.queryByText("Skill", { selector: "span.rounded-control" }),
		).not.toBeInTheDocument();
		expect(nameInput).not.toHaveClass("mt-4");
		expect(descriptionInput.parentElement).not.toHaveClass("border-b");
		expect(descriptionInput).toHaveAttribute("rows", "1");
		expect(descriptionInput).toHaveClass(
			"min-h-6",
			"resize-none",
			"overflow-hidden",
			"[field-sizing:content]",
		);
		expect(nameInput).toHaveAttribute("readonly");
		expect(descriptionInput).toHaveAttribute("readonly");
		expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		expect(nameInput).not.toHaveAttribute("readonly");
		expect(descriptionInput).not.toHaveAttribute("readonly");
		expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
		fireEvent.change(descriptionInput, { target: { value: "更新后的描述" } });
		expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
		await new Promise((resolve) => window.setTimeout(resolve, 750));
		expect(updatePromptPackEntry).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() =>
			expect(savePromptPackDraft).toHaveBeenCalledWith(
				localPack.id,
				expect.objectContaining({
					entries: expect.arrayContaining([
						expect.objectContaining({
							description: "更新后的描述",
							id: skillEntry.id,
						}),
					]),
				}),
			),
		);
		await waitFor(() => expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument());
	});

	it("retains the complete local draft when the atomic save fails", async () => {
		const skillEntry = {
			body: "原始正文",
			description: "原始描述",
			id: "local.test-pack/skill/save-failure",
			kind: "skill" as const,
			name: "保存失败 Skill",
			packId: localPack.id,
			slug: "save-failure",
			source: "user" as const,
			title: "保存失败 Skill",
		};
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: localPack,
			entries: [skillEntry],
			revision: "revision-1",
		});
		vi.mocked(savePromptPackDraft).mockRejectedValue(new Error("network unavailable"));
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
		fireEvent.change(await screen.findByLabelText("Skill 描述"), {
			target: { value: "尚未提交的描述" },
		});
		fireEvent.click(screen.getByRole("button", { name: "保存" }));

		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("技能包保存失败", {
				description: "network unavailable",
			}),
		);
		expect(screen.getByRole("button", { name: "放弃草稿" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
		expect(
			usePromptPackDraftStore.getState().draftsByPackId[localPack.id]?.working.entries[0],
		).toMatchObject({ description: "尚未提交的描述" });
	});

	it("keeps drafts across entries and saves all prompt-pack changes together", async () => {
		const firstSkill = {
			body: "第一项正文",
			description: "第一项描述",
			id: "skill-first",
			kind: "skill" as const,
			name: "角色写作",
			packId: localPack.id,
			slug: "character-writer",
			source: "user" as const,
		};
		const secondSkill = {
			...firstSkill,
			body: "第二项正文",
			description: "第二项描述",
			id: "skill-second",
			name: "场景写作",
			slug: "scene-writer",
		};
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: localPack,
			entries: [firstSkill, secondSkill],
		});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "角色写作" }));
		await screen.findByLabelText("Skill 名称");
		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		fireEvent.change(screen.getByLabelText("Skill 描述"), {
			target: { value: "更新角色描述" },
		});
		fireEvent.click(screen.getByRole("button", { name: "场景写作" }));
		await waitFor(() => expect(screen.getByLabelText("Skill 名称")).toHaveValue("场景写作"));
		fireEvent.change(screen.getByLabelText("Skill 描述"), {
			target: { value: "更新场景描述" },
		});

		expect(updatePromptPackEntry).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "保存" }));

		await waitFor(() => expect(savePromptPackDraft).toHaveBeenCalledTimes(1));
		expect(savePromptPackDraft).toHaveBeenCalledWith(
			localPack.id,
			expect.objectContaining({
				entries: expect.arrayContaining([
					expect.objectContaining({ id: firstSkill.id, description: "更新角色描述" }),
					expect.objectContaining({ id: secondSkill.id, description: "更新场景描述" }),
				]),
			}),
		);
	});

	it("switches from a Skill to a prompt safely while the pack is editing", async () => {
		const skillEntry = {
			body: "Skill 正文",
			description: "Skill 描述",
			id: "skill-switch",
			kind: "skill" as const,
			name: "角色写作",
			packId: localPack.id,
			slug: "character-writer",
			source: "user" as const,
		};
		const promptEntry = {
			body: "提示词正文",
			id: "prompt-switch",
			kind: "prompt" as const,
			metadata: { category: "other" },
			name: "画面提示词",
			packId: localPack.id,
			slug: "image-prompt",
			source: "user" as const,
		};
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: localPack,
			entries: [skillEntry, promptEntry],
		});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "角色写作" }));
		await screen.findByLabelText("Skill 名称");
		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		fireEvent.click(screen.getByRole("tab", { name: "提示词 1" }));
		fireEvent.click(screen.getByRole("button", { name: "画面提示词" }));

		expect(await screen.findByLabelText("提示词名称")).toHaveValue("画面提示词");
		const promptBody = screen.getByLabelText("编辑提示词内容");
		expect(promptBody.tagName).toBe("TEXTAREA");
		expect(promptBody).toHaveValue("提示词正文");
		expect(screen.queryByText(/Cannot read properties of null/)).not.toBeInTheDocument();
	});

	it("opens directly in pack creation mode from the route", async () => {
		renderEditor("/prompt-pack-editor?mode=create");

		expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "创建本地技能包" })).toBeInTheDocument();
	});

	it("uses the shared resizable sidebar shell and keeps the title in the white content pane", async () => {
		renderEditor();

		const navigator = await screen.findByRole("navigation", { name: "技能包管理导航" });
		const title = screen.getByRole("heading", { name: "技能包管理" });
		const resizeHandle = screen.getByRole("separator", {
			name: "调整技能包管理侧边栏宽度",
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

	it("separates imported packs and exposes only lifecycle actions", async () => {
		const importedPack = {
			...localPack,
			description: "来自审核市场的视觉能力。",
			id: "marketplace.visual-pack",
			name: "视觉增强包",
			source: "imported" as const,
		};
		vi.mocked(listPromptPacks).mockResolvedValue([
			{
				...localPack,
				id: "builtin",
				name: "默认技能包",
				source: "default",
				updatedAt: "2020-01-01T00:00:00Z",
			},
			importedPack,
			{ ...localPack, updatedAt: "2026-01-01T00:00:00Z" },
		]);

		renderEditor();

		expect(await screen.findByRole("heading", { name: "技能包管理" })).toBeInTheDocument();
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
		const navigator = screen.getByRole("navigation", { name: "技能包管理导航" });
		expect(within(navigator).getByText("技能包")).toBeInTheDocument();
		expect(within(navigator).getByText("已导入")).toBeInTheDocument();
		expect(within(navigator).getByRole("button", { name: "默认技能包" })).toBeInTheDocument();
		const importedRow = within(navigator).getByRole("button", { name: "视觉增强包" });
		expect(importedRow).toBeDisabled();
		expect(importedRow).not.toHaveTextContent("已导入");
		expect(screen.queryByRole("button", { name: "打开技能包 视觉增强包" })).not.toBeInTheDocument();
		expect(within(navigator).getByRole("button", { name: "本地草稿" })).toBeInTheDocument();
		const manageableNavigationRows = within(navigator)
			.getAllByRole("button")
			.filter((button) =>
				["默认技能包", "本地草稿"].includes(button.getAttribute("aria-label") ?? ""),
			);
		expect(manageableNavigationRows.map((button) => button.getAttribute("aria-label"))).toEqual([
			"默认技能包",
			"本地草稿",
		]);
		fireEvent.click(importedRow);
		expect(getPromptPackContents).not.toHaveBeenCalledWith(importedPack.id);

		const manageableSection = screen.getByRole("region", { name: "默认和本地技能包" });
		expect(
			within(manageableSection)
				.getAllByRole("article")
				.map((article) => within(article).getByRole("heading", { level: 3 }).textContent),
		).toEqual(["默认技能包", "本地草稿"]);
		for (const article of within(manageableSection).getAllByRole("article")) {
			expect(article).not.toHaveClass("hover:-translate-y-0.5");
			expect(article).toHaveClass("transition-[border-color,box-shadow]");
		}
		expect(
			within(manageableSection).queryByRole("button", { name: "卸载技能包 默认技能包" }),
		).not.toBeInTheDocument();
		expect(
			within(manageableSection).getByRole("button", { name: "复制技能包 默认技能包" }),
		).toBeInTheDocument();
		expect(
			within(manageableSection).queryByRole("button", {
				name: "编辑技能包信息 默认技能包",
			}),
		).not.toBeInTheDocument();
		expect(
			within(manageableSection).getByRole("button", { name: "复制技能包 本地草稿" }),
		).toBeInTheDocument();
		expect(
			within(manageableSection).getByRole("button", { name: "卸载技能包 本地草稿" }),
		).toBeInTheDocument();
		expect(
			within(manageableSection).getByRole("button", { name: "卸载技能包 本地草稿" }).textContent,
		).toBe("");
		expect(within(manageableSection).queryByText("打开")).not.toBeInTheDocument();
		expect(
			within(manageableSection).getByText("这是系统内置的默认技能包，包含常用的 Skill 和提示词。"),
		).toBeInTheDocument();
		expect(within(manageableSection).getByText("这个技能包还没有描述。")).toBeInTheDocument();
		expect(within(manageableSection).queryByText(localPack.id)).not.toBeInTheDocument();

		const importedSection = screen.getByRole("region", { name: "已导入技能包" });
		expect(within(importedSection).getByText(importedPack.name)).toBeInTheDocument();
		expect(within(importedSection).getByText(importedPack.description)).toBeInTheDocument();
		const importedArticle = within(importedSection).getByRole("article");
		expect(importedArticle).toHaveClass("min-h-40", "flex-col", "p-4");
		expect(importedArticle).not.toHaveClass("min-h-24", "pb-10");
		expect(within(importedArticle).getByText("已导入")).toBeInTheDocument();
		expect(within(importedArticle).getByText("0 Skills")).toBeInTheDocument();
		expect(within(importedArticle).getByText("0 提示词")).toBeInTheDocument();
		expect(within(importedArticle).getByText("v1.0.0")).toBeInTheDocument();
		const disableSwitch = within(importedSection).getByRole("switch", {
			name: "停用技能包 视觉增强包",
		});
		expect(
			within(importedSection).getByRole("button", { name: "卸载技能包 视觉增强包" }),
		).toBeInTheDocument();
		expect(
			within(importedSection).queryByRole("button", { name: "复制技能包 视觉增强包" }),
		).not.toBeInTheDocument();
		expect(
			within(importedSection).queryByRole("button", { name: "编辑技能包信息 视觉增强包" }),
		).not.toBeInTheDocument();
		expect(
			within(importedSection).getByRole("button", { name: "卸载技能包 视觉增强包" }).textContent,
		).toBe("");
		vi.mocked(setPromptPackEnabled).mockResolvedValue({ ...importedPack, enabled: false });
		fireEvent.click(disableSwitch);
		await waitFor(() => expect(setPromptPackEnabled).toHaveBeenCalledWith(importedPack.id, false));

		vi.mocked(confirmDialog).mockImplementation(async (options) => {
			await options.onConfirm?.();
			return true;
		});
		vi.mocked(uninstallPromptPack).mockResolvedValue();
		fireEvent.click(within(importedSection).getByRole("button", { name: "卸载技能包 视觉增强包" }));
		await waitFor(() => expect(uninstallPromptPack).toHaveBeenCalledWith(importedPack.id));
		expect(confirmDialog).toHaveBeenCalledWith(
			expect.objectContaining({ confirmLabel: "卸载技能包", title: "卸载技能包？" }),
		);
	});

	it("uses a fixed Chinese description when an imported pack has no description", async () => {
		const importedPack = {
			...localPack,
			description: "   ",
			id: "marketplace.no-description",
			name: "无描述导入包",
			source: "imported" as const,
		};
		vi.mocked(listPromptPacks).mockResolvedValue([importedPack]);

		renderEditor();

		const importedSection = await screen.findByRole("region", { name: "已导入技能包" });
		expect(within(importedSection).getByText("这个导入技能包还没有描述。")).toBeInTheDocument();
		expect(within(importedSection).queryByText(importedPack.id)).not.toBeInTheDocument();
	});

	it("translates the legacy built-in English description on pack cards", async () => {
		const copiedLegacyPack = {
			...localPack,
			description: "Default agent skills, reusable prompt presets, and visual styles.",
			name: "历史复制包",
		};
		vi.mocked(listPromptPacks).mockResolvedValue([copiedLegacyPack]);

		renderEditor();

		expect(
			await screen.findByText("这是系统内置的默认技能包，包含常用的 Skill 和提示词。"),
		).toBeInTheDocument();
		expect(screen.queryByText(copiedLegacyPack.description)).not.toBeInTheDocument();
	});

	it("rejects a direct imported-pack URL without loading its contents", async () => {
		const importedPack = {
			...localPack,
			id: "marketplace.visual-pack",
			name: "视觉增强包",
			source: "imported" as const,
		};
		vi.mocked(listPromptPacks).mockResolvedValue([importedPack]);

		renderEditor("/prompt-pack-editor?packId=marketplace.visual-pack");

		expect(await screen.findByRole("button", { name: importedPack.name })).toBeDisabled();
		await waitFor(() => expect(screen.queryByText("加载技能包内容")).not.toBeInTheDocument());
		expect(getPromptPackContents).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
	});

	it("keeps pack enablement only on management cards", async () => {
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		expect(await screen.findByRole("button", { name: "编辑" })).toBeInTheDocument();
		expect(screen.queryByRole("switch", { name: "停用技能包 本地草稿" })).not.toBeInTheDocument();
		expect(screen.queryByText("已启用")).not.toBeInTheDocument();
		expect(setPromptPackEnabled).not.toHaveBeenCalled();
	});

	it("controls pack enablement directly from each management card", async () => {
		vi.mocked(setPromptPackEnabled).mockResolvedValue({ ...localPack, enabled: false });
		renderEditor();

		fireEvent.click(await screen.findByRole("switch", { name: "停用技能包 本地草稿" }));

		await waitFor(() => expect(setPromptPackEnabled).toHaveBeenCalledWith(localPack.id, false));
		const cardTarget = screen.getByRole("button", { name: `打开技能包 ${localPack.name}` });
		expect(cardTarget).toBeEnabled();
		expect(cardTarget.textContent).toBe("");
		fireEvent.click(cardTarget);
		await waitFor(() => expect(getPromptPackContents).toHaveBeenCalledWith(localPack.id));
	});

	it("copies a local pack from its management card without exporting it", async () => {
		const copiedPack = {
			...localPack,
			id: "local.copied-pack",
			name: "本地草稿副本",
		};
		vi.mocked(forkPromptPack).mockResolvedValue(copiedPack);
		renderEditor();

		fireEvent.click(await screen.findByRole("button", { name: "复制技能包 本地草稿" }));
		expect(await screen.findByRole("heading", { name: "复制技能包" })).toBeInTheDocument();
		expect(screen.getByLabelText("名称")).toHaveValue("本地草稿副本");
		fireEvent.click(screen.getByRole("button", { name: "复制" }));

		await waitFor(() =>
			expect(forkPromptPack).toHaveBeenCalledWith(localPack.id, {
				description: "",
				name: "本地草稿副本",
				version: localPack.version,
			}),
		);
		expect(exportPromptPack).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(toastSuccess).toHaveBeenCalledWith("技能包已复制", {
				description: copiedPack.name,
			}),
		);
	});

	it("edits local pack metadata from its card only", async () => {
		const updatedPack = {
			...localPack,
			description: "更新后的描述",
			name: "更新后的技能包",
		};
		vi.mocked(updatePromptPackMetadata).mockResolvedValue(updatedPack);
		renderEditor();

		fireEvent.click(await screen.findByRole("button", { name: "编辑技能包信息 本地草稿" }));
		expect(await screen.findByRole("heading", { name: "编辑技能包信息" })).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("名称"), { target: { value: " 更新后的技能包 " } });
		fireEvent.change(screen.getByLabelText("描述"), { target: { value: " 更新后的描述 " } });
		fireEvent.click(screen.getByRole("button", { name: "保存" }));

		await waitFor(() =>
			expect(updatePromptPackMetadata).toHaveBeenCalledWith(localPack.id, {
				description: "更新后的描述",
				name: "更新后的技能包",
			}),
		);
		expect(await screen.findByRole("heading", { name: updatedPack.name })).toBeInTheDocument();
		expect(screen.getByText(updatedPack.description)).toBeInTheDocument();
	});

	it("shows no duplicated actions in the default pack detail header", async () => {
		const defaultPack = {
			...localPack,
			id: "builtin",
			name: "默认技能包",
			source: "default" as const,
		};
		vi.mocked(listPromptPacks).mockResolvedValue([defaultPack]);
		vi.mocked(getPromptPackContents).mockResolvedValue({ pack: defaultPack, entries: [] });
		renderEditor("/prompt-pack-editor?packId=builtin");

		expect(await screen.findByRole("heading", { name: "技能包中还没有内容" })).toBeInTheDocument();
		expect(screen.queryByRole("switch", { name: "停用技能包 默认技能包" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "卸载技能包" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "复制技能包" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "恢复默认" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /导出/ })).not.toBeInTheDocument();
	});

	it("keeps entries in the default pack read-only", async () => {
		const defaultPack = {
			...localPack,
			id: "builtin",
			name: "默认技能包",
			source: "default" as const,
		};
		const entry = {
			body: "默认正文",
			description: "默认说明",
			id: "builtin:skill:character-writer",
			kind: "skill" as const,
			name: "character-writer",
			packId: defaultPack.id,
			slug: "character-writer",
			source: "pack" as const,
			title: "角色写作",
		};
		vi.mocked(listPromptPacks).mockResolvedValue([defaultPack]);
		vi.mocked(getPromptPackContents).mockResolvedValue({ pack: defaultPack, entries: [entry] });
		renderEditor("/prompt-pack-editor?packId=builtin");

		expect(await screen.findByText("角色写作")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "恢复默认 角色写作" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "删除 角色写作" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "新建 Skill" })).not.toBeInTheDocument();
		expect(resetPromptPackEntry).not.toHaveBeenCalled();
	});

	it("uses the management page max width with responsive horizontal padding", async () => {
		renderEditor();

		const maxWidthContainer = await screen.findByRole("region", { name: "技能包列表" });
		const scrollContainer = maxWidthContainer?.parentElement;

		expect(screen.queryByRole("heading", { name: "选择技能包" })).not.toBeInTheDocument();
		expect(screen.queryByText("全部已安装与本地创作")).not.toBeInTheDocument();
		expect(maxWidthContainer).toHaveClass("max-w-5xl");
		expect(scrollContainer).toHaveClass("px-6", "py-8", "xl:px-8");
		const manageableRegion = screen.getByRole("region", { name: "默认和本地技能包" });
		expect(manageableRegion.querySelector(".grid")).toHaveClass("lg:grid-cols-2");
		expect(screen.getAllByRole("article")).toHaveLength(1);
		expect(
			screen.getByRole("button", { name: `打开技能包 ${localPack.name}` }),
		).toBeInTheDocument();
	});

	it("removes the overview page and shows a content-only empty state", async () => {
		renderEditor();

		fireEvent.click(await screen.findByRole("button", { name: "本地草稿" }));
		expect(await screen.findByRole("heading", { name: "技能包中还没有内容" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "技能包概览" })).not.toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: localPack.name })).not.toBeInTheDocument();
	});

	it("uses the main-window sidebar hierarchy animation for pack details", async () => {
		renderEditor();

		const navigator = await screen.findByRole("navigation", { name: "技能包管理导航" });
		const libraryScreen = navigator.querySelector('[data-sidebar-screen="pack-library"]');
		expect(libraryScreen).toHaveAttribute("aria-hidden", "false");

		fireEvent.click(screen.getByRole("button", { name: "本地草稿" }));
		await screen.findByRole("button", { name: "返回技能包列表" });
		const detailScreen = navigator.querySelector('[data-sidebar-screen="pack-detail"]');
		expect(detailScreen).toHaveAttribute("aria-hidden", "false");
		expect(detailScreen).toHaveClass("transition-transform", "translate-x-0");

		fireEvent.click(screen.getByRole("button", { name: "返回技能包列表" }));
		await waitFor(() => expect(libraryScreen).toHaveAttribute("aria-hidden", "false"));
		expect(detailScreen).toHaveClass("transition-transform", "translate-x-full", "z-20");
	});

	it("creates a local draft without asking for author or package ID", async () => {
		vi.mocked(createPromptPack).mockResolvedValue(localPack);
		renderEditor();
		fireEvent.click(await screen.findByRole("button", { name: "新建技能包" }));

		expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "创建本地技能包" })).toBeInTheDocument();
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

	it("reopens skill-pack creation from the sidebar without a search action", async () => {
		renderEditor();

		fireEvent.click(await screen.findByRole("button", { name: "新建技能包" }));
		expect(await screen.findByRole("heading", { name: "创建本地技能包" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "取消" }));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

		expect(screen.queryByRole("button", { name: "搜索技能包" })).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "新建技能包" }));
		expect(await screen.findByRole("heading", { name: "创建本地技能包" })).toBeInTheDocument();
	});

	it("shows contextual creation actions at the bottom of the sidebar", async () => {
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		expect(screen.queryByRole("button", { name: "新建内容" })).not.toBeInTheDocument();
		fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
		const navigator = screen.getByRole("navigation", { name: "技能包管理导航" });
		const createSkillButton = await screen.findByRole("button", { name: "新建 Skill" });
		expect(navigator).toContainElement(createSkillButton);
		expect(screen.queryByRole("button", { name: "新建内容" })).not.toBeInTheDocument();
		const skillTab = screen.getByRole("tab", { name: "Skill 0" });
		expect(screen.queryByRole("button", { name: "技能包概览" })).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "返回技能包列表" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "搜索当前技能包" })).not.toBeInTheDocument();
		expect(skillTab).toHaveAttribute("aria-selected", "true");
		expect(screen.getByRole("tab", { name: "提示词 0" })).toHaveAttribute("aria-selected", "false");
		expect(screen.getAllByText("本地草稿").length).toBeGreaterThan(0);

		fireEvent.click(screen.getByRole("tab", { name: "提示词 0" }));
		const createCategoryButton = await screen.findByRole("button", { name: "新建分组" });
		expect(navigator).toContainElement(createCategoryButton);
		expect(screen.queryByRole("button", { name: "新建 Skill" })).not.toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "新建技能包内容" })).not.toBeInTheDocument();
	});

	it("allows opening an empty prompt tab when the pack already has Skills", async () => {
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: { ...localPack, skillCount: 1 },
			entries: [
				{
					body: "Skill content",
					description: "Skill description",
					id: "skill-only",
					kind: "skill",
					name: "skill-only",
					packId: localPack.id,
					slug: "skill-only",
					source: "user",
					title: "唯一 Skill",
				},
			],
			categories: [],
		});
		vi.mocked(confirmDialog).mockImplementation(async (options) => {
			await options.onConfirm?.();
			return true;
		});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		const promptTab = await screen.findByRole("tab", { name: "提示词 0" });
		fireEvent.click(promptTab);

		await waitFor(() => expect(promptTab).toHaveAttribute("aria-selected", "true"));
		expect(screen.queryByRole("button", { name: "分组管理" })).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		expect(await screen.findByRole("button", { name: "新建分组" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "放弃草稿" }));
		expect(screen.queryByRole("button", { name: "分组管理" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "唯一 Skill" })).not.toBeInTheDocument();
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
		expect(toastSuccess).not.toHaveBeenCalledWith("技能包已导出", expect.anything());
		completeSave?.({ canceled: false, path: "/tmp/draft.mgpack" });
		const completionDialog = await screen.findByRole("alertdialog");
		expect(screen.getByRole("heading", { name: "技能包已导出" })).toBeInTheDocument();
		expect(completionDialog).toHaveTextContent(
			"“draft.mgpack”已保存。前往 MediaGo「我的技能包」上传，设置公开售卖或席位分发并提交审核。",
		);
		expect(openExternal).not.toHaveBeenCalled();
		expect(toastSuccess).not.toHaveBeenCalledWith("技能包已导出", expect.anything());

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
		expect(toastSuccess).not.toHaveBeenCalledWith("技能包已导出", expect.anything());
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
				"https://mediago.torchstellar.com/account#promptPacks",
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
			expect(toastError).toHaveBeenCalledWith("未配置技能包发布地址", {
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
			expect(toastError).toHaveBeenCalledWith("请完善技能包内容", {
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
			expect(toastError).toHaveBeenCalledWith("请完善技能包内容", {
				description: "当前 Skill 缺少用途描述，请补充后再导出。",
			}),
		);
		expect(JSON.stringify(toastError.mock.calls)).not.toContain("skill-70c8a8cb");
	});

	it("keeps a newly created prompt in the local draft", async () => {
		const categories = [
			{ id: "style", label: "风格", order: 0, packId: localPack.id, source: "user" as const },
			{ id: "extra", label: "其他", order: 1, packId: localPack.id, source: "user" as const },
		];
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: localPack,
			entries: [],
			categories,
		});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");
		fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
		fireEvent.click(screen.getByRole("tab", { name: "提示词 0" }));
		fireEvent.click(await screen.findByRole("button", { name: "在其他分组中新建提示词" }));

		expect(createPromptPackEntry).not.toHaveBeenCalled();
		expect(await screen.findByLabelText("提示词名称")).toHaveValue("未命名提示词");
		expect(
			usePromptPackDraftStore
				.getState()
				.draftsByPackId[localPack.id]?.working.entries.find((entry) => entry.kind === "prompt"),
		).toMatchObject({ metadata: { category: "extra" }, name: "未命名提示词" });
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "新建内容" })).not.toBeInTheDocument();
	});

	it("creates a group from the sidebar and then adds a prompt from that group", async () => {
		const existingCategory = {
			id: "style",
			label: "风格",
			order: 0,
			packId: localPack.id,
			source: "user" as const,
		};
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: localPack,
			entries: [],
			categories: [existingCategory],
		});

		renderEditor("/prompt-pack-editor?packId=local.test-pack");
		fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
		fireEvent.click(screen.getByRole("tab", { name: "提示词 0" }));
		fireEvent.click(await screen.findByRole("button", { name: "新建分组" }));
		fireEvent.change(screen.getByLabelText("分组名称"), { target: { value: "分镜" } });
		fireEvent.click(screen.getByRole("button", { name: "创建分组" }));

		expect(createPromptPackCategory).not.toHaveBeenCalled();
		const createdCategory = usePromptPackDraftStore
			.getState()
			.draftsByPackId[localPack.id]?.working.categories.find(
				(category) => category.label === "分镜",
			);
		expect(createdCategory).toBeDefined();
		fireEvent.click(await screen.findByRole("button", { name: "在分镜分组中新建提示词" }));
		expect(createPromptPackEntry).not.toHaveBeenCalled();
		expect(
			usePromptPackDraftStore
				.getState()
				.draftsByPackId[localPack.id]?.working.entries.find((entry) => entry.kind === "prompt"),
		).toMatchObject({ metadata: { category: createdCategory?.id } });
	});

	it("deletes a local pack from its management card", async () => {
		vi.mocked(confirmDialog).mockImplementation(async (options) => {
			await options.onConfirm?.();
			return true;
		});
		vi.mocked(uninstallPromptPack).mockResolvedValue();
		renderEditor();

		fireEvent.click(await screen.findByRole("button", { name: "卸载技能包 本地草稿" }));

		await waitFor(() => expect(uninstallPromptPack).toHaveBeenCalledWith(localPack.id));
		expect(confirmDialog).toHaveBeenCalledWith(
			expect.objectContaining({
				confirmLabel: "删除技能包",
				title: "删除本地技能包？",
				variant: "destructive",
			}),
		);
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "技能包管理" })).toBeInTheDocument(),
		);
		expect(await screen.findByRole("heading", { name: "还没有技能包" })).toBeInTheDocument();
	});

	it("hides copy and delete actions inside a local pack detail", async () => {
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		expect(await screen.findByRole("heading", { name: "技能包中还没有内容" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "复制技能包" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "删除技能包" })).not.toBeInTheDocument();
	});

	it("separates Skill and prompt tabs and groups prompts by category", async () => {
		const entries = [
			{
				body: "Skill 正文",
				description: "Skill 描述",
				id: "skill-grouped",
				kind: "skill" as const,
				name: "skill-grouped",
				packId: localPack.id,
				slug: "skill-grouped",
				source: "user" as const,
				title: "场景写作",
			},
			{
				body: "风格正文",
				id: "prompt-style",
				kind: "prompt" as const,
				metadata: { category: "style" },
				name: "电影风格",
				packId: localPack.id,
				slug: "prompt-style",
				source: "user" as const,
			},
			{
				body: "其他正文",
				id: "prompt-extra",
				kind: "prompt" as const,
				metadata: { category: "extra" },
				name: "运镜提示",
				packId: localPack.id,
				slug: "prompt-extra",
				source: "user" as const,
			},
		];
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: localPack,
			entries,
			categories: [
				{ id: "style", label: "风格", order: 0, packId: localPack.id, source: "user" },
				{ id: "extra", label: "其他", order: 1, packId: localPack.id, source: "user" },
			],
		});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		expect(await screen.findByRole("tab", { name: "Skill 1" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		expect(screen.getByRole("button", { name: "场景写作" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "电影风格" })).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("tab", { name: "提示词 2" }));
		const navigator = screen.getByRole("navigation", { name: "技能包管理导航" });
		expect(await within(navigator).findByText("风格")).toBeInTheDocument();
		expect(within(navigator).getByText("其他")).toBeInTheDocument();
		expect(screen.queryByText("风格 · 1")).not.toBeInTheDocument();
		expect(screen.queryByText("其他 · 1")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "电影风格" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "运镜提示" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		expect(screen.getByRole("button", { name: "拖动提示词 电影风格" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "拖动提示词 运镜提示" })).toBeInTheDocument();
		expect(screen.getByRole("region", { name: "提示词分组 风格" })).toBeInTheDocument();
		expect(screen.getByRole("region", { name: "提示词分组 其他" })).toBeInTheDocument();
	});

	it("creates, renames, and deletes prompt groups from the sidebar", async () => {
		const categories = [
			{
				builtin: true,
				id: "style",
				label: "风格",
				order: 0,
				packId: localPack.id,
				source: "pack" as const,
			},
			{
				builtin: true,
				id: "extra",
				label: "其他",
				order: 1,
				packId: localPack.id,
				source: "pack" as const,
			},
		];
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: localPack,
			entries: [],
			categories,
		});
		vi.mocked(confirmDialog).mockImplementation(async (options) => {
			await options.onConfirm?.();
			return true;
		});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("tab", { name: "提示词 0" }));
		expect(screen.queryByRole("button", { name: "分组管理" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "拖动分组 风格" })).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		fireEvent.click(screen.getByRole("button", { name: "新建分组" }));
		expect(await screen.findByRole("heading", { name: "新建提示词分组" })).toBeInTheDocument();
		const createDialog = screen.getByRole("alertdialog");
		fireEvent.change(within(createDialog).getByLabelText("分组名称"), {
			target: { value: "角色风格" },
		});
		fireEvent.click(within(createDialog).getByRole("button", { name: "创建分组" }));
		expect(createPromptPackCategory).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(screen.queryByRole("heading", { name: "新建提示词分组" })).not.toBeInTheDocument(),
		);
		expect(screen.getByText("角色风格")).toBeInTheDocument();

		expect(screen.queryByText("风格 · 0")).not.toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "提示词分组管理" })).not.toBeInTheDocument();
		expect(
			screen.queryByText("管理当前技能包已有的提示词分类、显示顺序和删除迁移规则。"),
		).not.toBeInTheDocument();
		expect(screen.queryByText("ID：style")).not.toBeInTheDocument();
		expect(screen.queryByText("ID：extra")).not.toBeInTheDocument();

		expect(screen.queryByRole("button", { name: "上移分组 风格" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "下移分组 风格" })).not.toBeInTheDocument();
		expect(screen.getByText("拖拽移动分组")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "拖动分组 风格" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "拖动分组 其他" })).toBeInTheDocument();
		fireEvent.keyDown(screen.getByRole("button", { name: "拖动分组 其他" }), {
			key: "ArrowUp",
		});
		expect(
			[
				...(usePromptPackDraftStore.getState().draftsByPackId[localPack.id]?.working.categories ??
					[]),
			]
				.sort((first, second) => (first.order ?? 0) - (second.order ?? 0))
				.map((category) => category.id)
				.slice(0, 2),
		).toEqual(["extra", "style"]);
		expect(updatePromptPackCategory).not.toHaveBeenCalled();

		expect(screen.queryByLabelText("分组名称 风格")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "修改分组 风格" }));
		expect(await screen.findByRole("heading", { name: "修改分组名称" })).toBeInTheDocument();
		const editDialog = screen.getByRole("alertdialog");
		expect(within(editDialog).getByLabelText("新的分组名称")).toHaveValue("风格");
		fireEvent.change(within(editDialog).getByLabelText("新的分组名称"), {
			target: { value: "视觉风格" },
		});
		fireEvent.click(within(editDialog).getByRole("button", { name: "保存修改" }));
		expect(updatePromptPackCategory).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(screen.queryByRole("heading", { name: "修改分组名称" })).not.toBeInTheDocument(),
		);
		expect(screen.getByText("视觉风格")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "删除分组 视觉风格" }));
		expect(await screen.findByRole("heading", { name: "删除提示词分组？" })).toBeInTheDocument();
		const deleteDialog = screen.getByRole("alertdialog");
		expect(within(deleteDialog).getByRole("combobox", { name: "删除后移动到" })).toHaveTextContent(
			"其他",
		);
		fireEvent.click(within(deleteDialog).getByRole("button", { name: "删除分组" }));
		expect(deletePromptPackCategory).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(screen.queryByRole("heading", { name: "删除提示词分组？" })).not.toBeInTheDocument(),
		);
		expect(screen.queryByText("视觉风格")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(savePromptPackDraft).toHaveBeenCalledTimes(1));
		expect(savePromptPackDraft).toHaveBeenCalledWith(
			localPack.id,
			expect.objectContaining({
				categories: expect.arrayContaining([
					expect.objectContaining({ id: "extra", label: "其他" }),
					expect.objectContaining({ label: "角色风格" }),
				]),
			}),
		);
		expect(
			vi
				.mocked(savePromptPackDraft)
				.mock.calls[0]?.[1].categories.some((category) => category.id === "style"),
		).toBe(false);
	});

	it("moves a prompt to another group by dragging and keeps the change in the edit draft", async () => {
		const promptEntry = {
			body: "风格正文",
			id: "prompt-drag-category",
			kind: "prompt" as const,
			metadata: { category: "style" },
			name: "电影风格",
			packId: localPack.id,
			slug: "prompt-drag-category",
			source: "user" as const,
		};
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: localPack,
			entries: [promptEntry],
			categories: [
				{ id: "style", label: "风格", order: 0, packId: localPack.id, source: "user" },
				{ id: "extra", label: "其他", order: 1, packId: localPack.id, source: "user" },
			],
		});
		vi.mocked(confirmDialog).mockImplementation(async (options) => {
			await options.onConfirm?.();
			return true;
		});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("tab", { name: "提示词 1" }));
		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		const dragHandle = screen.getByRole("button", { name: "拖动提示词 电影风格" });
		const sourceGroup = screen.getByRole("region", { name: "提示词分组 风格" });
		const targetGroup = screen.getByRole("region", { name: "提示词分组 其他" });
		fireEvent.keyDown(dragHandle, { key: "ArrowDown" });

		await waitFor(() =>
			expect(within(targetGroup).getByRole("button", { name: "电影风格" })).toBeInTheDocument(),
		);
		expect(updatePromptPackEntry).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "放弃草稿" }));
		await waitFor(() =>
			expect(within(sourceGroup).getByRole("button", { name: "电影风格" })).toBeInTheDocument(),
		);

		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		fireEvent.keyDown(screen.getByRole("button", { name: "拖动提示词 电影风格" }), {
			key: "ArrowDown",
		});
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(savePromptPackDraft).toHaveBeenCalledTimes(1));
		expect(savePromptPackDraft).toHaveBeenCalledWith(
			localPack.id,
			expect.objectContaining({
				entries: expect.arrayContaining([
					expect.objectContaining({
						id: promptEntry.id,
						metadata: { category: "extra" },
					}),
				]),
			}),
		);
	});

	it("keeps sidebar-managed prompt category controls out of the content editor", async () => {
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
			categories: [
				{ id: "style", label: "风格", order: 0, packId: localPack.id, source: "user" },
				{ id: "extra", label: "其他", order: 1, packId: localPack.id, source: "user" },
			],
		});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "旧提示词" }));
		const nameInput = await screen.findByLabelText("提示词名称");
		const bodyInput = screen.getByLabelText("编辑提示词内容");
		expect(screen.queryByRole("combobox", { name: "分类" })).not.toBeInTheDocument();
		expect(screen.queryByText("分类", { selector: "label" })).not.toBeInTheDocument();
		expect(
			screen.queryByText("提示词", { selector: "span.rounded-control" }),
		).not.toBeInTheDocument();
		expect(bodyInput.previousElementSibling).toBe(nameInput);
		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		fireEvent.change(nameInput, {
			target: { value: "新名称" },
		});
		fireEvent.keyDown(window, { key: "s", metaKey: true });

		await waitFor(() => expect(savePromptPackDraft).toHaveBeenCalledTimes(1));
		expect(savePromptPackDraft).toHaveBeenCalledWith(
			localPack.id,
			expect.objectContaining({
				entries: expect.arrayContaining([
					expect.objectContaining({
						id: promptEntry.id,
						metadata: { category: "style", legacyFlag: "keep" },
						name: "新名称",
					}),
				]),
			}),
		);
	});

	it("does not render prompt category controls outside pack edit mode", async () => {
		const promptEntry = {
			body: "内置提示词内容",
			id: "prompt-direct-category",
			kind: "prompt" as const,
			metadata: { category: "style", legacyFlag: "keep" },
			name: "可直接分类的提示词",
			packId: localPack.id,
			slug: "prompt-direct-category",
			source: "pack" as const,
		};
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: localPack,
			entries: [promptEntry],
			categories: [
				{ id: "style", label: "风格", order: 0, packId: localPack.id, source: "pack" },
				{ id: "extra", label: "其他", order: 1, packId: localPack.id, source: "pack" },
			],
		});
		renderEditor("/prompt-pack-editor?packId=local.test-pack");

		fireEvent.click(await screen.findByRole("button", { name: "可直接分类的提示词" }));
		expect(screen.queryByRole("combobox", { name: "分类" })).not.toBeInTheDocument();
		expect(screen.queryByText("分类", { selector: "label" })).not.toBeInTheDocument();
		expect(updatePromptPackEntry).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
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
