import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	copyPromptPackEntries,
	createPromptPack,
	detachPromptPackEntry,
	exportPromptPack,
	getPromptPackContents,
	importPromptPackFile,
	listPromptPacks,
	removePromptPackEntry,
	resetPromptPackEntry,
	uninstallPromptPack,
	updatePromptPackEntry,
} from "@/domains/settings/api/packs";
import { createPromptPreset, listPromptPresets } from "@/domains/generation/api/prompt-presets";
import { listPromptCategories } from "@/domains/generation/api/prompt-categories";
import { createSkill, listSkills } from "@/domains/settings/api/skills";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { PromptPacksPanel } from "./PromptPacksPanel";

vi.mock("@/domains/settings/api/packs", () => ({
	copyPromptPackEntries: vi.fn(),
	createPromptPack: vi.fn(),
	detachPromptPackEntry: vi.fn(),
	exportPromptPack: vi.fn(),
	getPromptPackContents: vi.fn(),
	importPromptPackFile: vi.fn(),
	listPromptPacks: vi.fn(),
	promptPackContentsKey: (id: string) => `/packs/${id}/contents`,
	promptPacksKey: "/packs",
	resetPromptPack: vi.fn(),
	resetPromptPackEntry: vi.fn(),
	removePromptPackEntry: vi.fn(),
	setPromptPackEnabled: vi.fn(),
	uninstallPromptPack: vi.fn(),
	updatePromptPackEntry: vi.fn(),
}));

vi.mock("@/domains/settings/api/skills", () => ({
	createSkill: vi.fn(),
	deleteSkill: vi.fn(),
	listSkills: vi.fn(),
	skillsKey: "/skills",
}));

vi.mock("@/domains/generation/api/prompt-categories", () => ({
	listPromptCategories: vi.fn(),
	promptCategoriesKey: "/prompt-categories",
}));

vi.mock("@/domains/generation/api/prompt-presets", () => ({
	createPromptPreset: vi.fn(),
	deletePromptPreset: vi.fn(),
	listPromptPresets: vi.fn(),
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

vi.mock("./SettingsMarkdownEditor", () => ({
	SettingsMarkdownEditor: ({
		ariaLabel,
		onChange,
		value,
	}: {
		ariaLabel: string;
		onChange: (value: string) => void;
		value: string;
	}) => (
		<textarea
			aria-label={ariaLabel}
			value={value}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
	SettingsMarkdownPreview: ({ ariaLabel, value }: { ariaLabel: string; value: string }) => (
		<div aria-label={ariaLabel}>{value}</div>
	),
}));

describe("PromptPacksPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(listSkills).mockResolvedValue([]);
		vi.mocked(listPromptPresets).mockResolvedValue([]);
		vi.mocked(listPromptCategories).mockResolvedValue([]);
		vi.mocked(copyPromptPackEntries).mockResolvedValue([]);
		vi.mocked(detachPromptPackEntry).mockImplementation(async (_packId, entryId) => ({
			id: entryId,
			packId: "company.story-prompts",
			kind: "prompt",
			slug: "detached-prompt",
			name: "Detached Prompt",
			body: "content",
			source: "user",
		}));
		vi.mocked(removePromptPackEntry).mockResolvedValue();
		vi.mocked(createPromptPreset).mockImplementation(async (input) => ({
			...input,
			source: "user",
		}));
		vi.mocked(updatePromptPackEntry).mockImplementation(async (packId, entryId, input) => ({
			id: entryId,
			packId,
			kind: "prompt",
			slug: "updated-prompt",
			name: input.name || "Updated Prompt",
			body: input.body,
			metadata: input.metadata,
			source: "user",
		}));
		vi.mocked(resetPromptPackEntry).mockResolvedValue({
			id: "com.example.test/prompt/imported-prompt",
			packId: "com.example.test",
			releaseId: "release-1",
			kind: "prompt",
			slug: "imported-prompt",
			name: "导入提示词",
			body: "正式包内容",
			metadata: { category: "extra" },
			source: "pack",
		});
		vi.mocked(createSkill).mockResolvedValue({
			name: "new-skill",
			description: "description",
			content: "content",
			source: "user",
		});
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
			{
				id: "company.story-prompts",
				name: "剧情创作包",
				version: "1.0.0",
				source: "local",
				enabled: true,
			},
		]);
		vi.mocked(getPromptPackContents).mockImplementation(async (id) => ({
			pack: {
				id,
				name: id === "company.story-prompts" ? "剧情创作包" : "测试包",
				version: "1.0.0",
				source: id === "company.story-prompts" ? "local" : "imported",
				enabled: true,
			},
			entries: [],
		}));
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("keeps v1 export controls in the community build", async () => {
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: /管理/ }));
		await screen.findAllByText("默认包");

		expect(screen.getAllByRole("button", { name: "导出提示词包" })).not.toHaveLength(0);
		expect(
			screen.queryByRole("button", { name: /启用提示词包|停用提示词包/ }),
		).not.toBeInTheDocument();
		expect(screen.queryByText("已启用")).not.toBeInTheDocument();
		expect(exportPromptPack).not.toHaveBeenCalled();
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

	it("keeps global content editors while publishing stays under the selected pack", async () => {
		renderPanel();

		expect(screen.getByRole("tab", { name: "全部技能" })).toHaveAttribute("data-state", "active");
		expect(screen.getByText("Skills editor")).toBeInTheDocument();
		selectTab("全部提示词");
		expect(screen.getByText("Prompt library editor")).toBeInTheDocument();

		selectTab("词包");
		expect(await screen.findByRole("button", { name: "新建词包" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "发布" })).not.toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: /Skills/ })).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "查看与编辑 测试包" }));
		expect(await screen.findByRole("tab", { name: "Skills (0)" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "发布" })).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "返回词包列表" }));

		fireEvent.click(screen.getByRole("button", { name: "编辑 剧情创作包" }));

		expect(await screen.findByRole("tab", { name: "Skills (0)" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "提示词 (0)" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "发布" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "新建词包" })).not.toBeInTheDocument();
	});

	it("edits an imported entry locally and can restore the formal content", async () => {
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: {
				id: "com.example.test",
				name: "测试包",
				version: "1.0.0",
				releaseId: "release-1",
				source: "imported",
				enabled: true,
			},
			entries: [
				{
					id: "com.example.test:prompt:imported-prompt",
					packId: "com.example.test",
					releaseId: "release-1",
					kind: "prompt",
					slug: "imported-prompt",
					name: "导入提示词",
					body: "本机修改内容",
					metadata: { category: "extra" },
					source: "user",
					overriddenFrom: "com.example.test:prompt:imported-prompt:release-1",
				},
			],
		});
		vi.mocked(confirmDialog).mockImplementation(async (options) => {
			await options.onConfirm?.();
			return true;
		});

		renderPanel();
		selectTab("词包");
		fireEvent.click(await screen.findByRole("button", { name: "查看与编辑 测试包" }));
		await selectTabWhenReady("提示词 (1)");

		expect(await screen.findByText("本地修改")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		fireEvent.change(screen.getByLabelText("编辑提示词内容"), {
			target: { value: "更新后的本机内容" },
		});
		fireEvent.click(screen.getByRole("button", { name: "保存" }));

		await waitFor(() =>
			expect(updatePromptPackEntry).toHaveBeenCalledWith(
				"com.example.test",
				"com.example.test:prompt:imported-prompt",
				{
					name: "导入提示词",
					description: undefined,
					body: "更新后的本机内容",
					metadata: { category: "extra" },
				},
			),
		);
		fireEvent.click(await screen.findByRole("button", { name: "恢复原版" }));
		await waitFor(() =>
			expect(resetPromptPackEntry).toHaveBeenCalledWith(
				"com.example.test",
				"com.example.test:prompt:imported-prompt",
			),
		);
		expect(screen.queryByRole("button", { name: "新建提示词" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /移除/ })).not.toBeInTheDocument();
	});

	it("opens the new local pack in its editor after creation", async () => {
		const generatedUUID = "11111111-2222-4333-8444-555555555555";
		const generatedPackID = `local.${generatedUUID}`;
		vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(generatedUUID);
		vi.mocked(createPromptPack).mockResolvedValue({
			id: generatedPackID,
			name: "新词包",
			version: "1.0.0",
			source: "local",
			enabled: true,
		});
		vi.mocked(listPromptPacks)
			.mockResolvedValueOnce([])
			.mockResolvedValue([
				{
					id: generatedPackID,
					name: "新词包",
					version: "1.0.0",
					source: "local",
					enabled: true,
				},
			]);
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: {
				id: generatedPackID,
				name: "新词包",
				version: "1.0.0",
				source: "local",
				enabled: true,
			},
			entries: [],
		});

		renderPanel();
		selectTab("词包");
		fireEvent.click(await screen.findByRole("button", { name: "新建词包" }));
		expect(screen.queryByLabelText("Package ID")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("作者")).not.toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("名称"), { target: { value: "新词包" } });
		fireEvent.click(screen.getByRole("button", { name: "创建并编辑" }));

		await waitFor(() =>
			expect(createPromptPack).toHaveBeenCalledWith({
				id: generatedPackID,
				name: "新词包",
				version: "1.0.0",
			}),
		);
		await screen.findByRole("button", { name: "返回词包列表" });
	});

	it("returns to the pack list immediately after uninstalling the selected pack", async () => {
		vi.mocked(uninstallPromptPack).mockResolvedValue();
		vi.mocked(listPromptPacks)
			.mockResolvedValueOnce([
				{
					id: "company.story-prompts",
					name: "剧情创作包",
					version: "1.0.0",
					source: "local",
					enabled: true,
				},
			])
			.mockResolvedValue([]);
		vi.mocked(confirmDialog).mockImplementation(async (options) => {
			await options.onConfirm?.();
			return true;
		});

		renderPanel();
		selectTab("词包");
		fireEvent.click(await screen.findByRole("button", { name: "编辑 剧情创作包" }));
		expect(await screen.findByRole("button", { name: "返回词包列表" })).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: /管理/ }));
		fireEvent.click(await screen.findByRole("button", { name: "卸载提示词包" }));

		await waitFor(() => expect(uninstallPromptPack).toHaveBeenCalledWith("company.story-prompts"));
		expect(await screen.findByRole("button", { name: "新建词包" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "返回词包列表" })).not.toBeInTheDocument();
	});

	it("copies selected existing content into a local pack", async () => {
		vi.mocked(listSkills).mockResolvedValue([
			{
				name: "character-writer",
				title: "角色设定",
				description: "创建角色设定",
				source: "pack",
				packId: "builtin",
			},
		]);
		vi.mocked(copyPromptPackEntries).mockResolvedValue([
			{
				id: "company.story-prompts/skill/character-writer-copy",
				packId: "company.story-prompts",
				kind: "skill",
				slug: "character-writer-copy",
				name: "character-writer-copy",
				title: "角色设定",
				body: "content",
				source: "user",
			},
		]);

		renderPanel();
		selectTab("词包");
		fireEvent.click(await screen.findByRole("button", { name: "编辑 剧情创作包" }));
		fireEvent.click(await screen.findByRole("button", { name: "从已有内容添加" }));
		fireEvent.click(await screen.findByRole("checkbox", { name: /角色设定/ }));
		fireEvent.click(screen.getByRole("button", { name: "添加 1 项" }));

		await waitFor(() =>
			expect(copyPromptPackEntries).toHaveBeenCalledWith("company.story-prompts", [
				{ kind: "skill", packId: "builtin", slug: "character-writer" },
			]),
		);
	});

	it("creates prompt content directly inside a local pack", async () => {
		const generatedUUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
		vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(generatedUUID);

		renderPanel();
		selectTab("词包");
		fireEvent.click(await screen.findByRole("button", { name: "编辑 剧情创作包" }));
		fireEvent.click(await screen.findByRole("button", { name: "新建提示词" }));
		fireEvent.change(screen.getByLabelText("名称"), { target: { value: "雨夜街道" } });
		fireEvent.change(screen.getByLabelText("新建提示词内容"), {
			target: { value: "雨夜街道，霓虹倒影。" },
		});
		fireEvent.click(screen.getByRole("button", { name: "创建" }));

		await waitFor(() =>
			expect(createPromptPreset).toHaveBeenCalledWith({
				category: "extra",
				id: `prompt-${generatedUUID}`,
				name: "雨夜街道",
				packId: "company.story-prompts",
				prompt: "雨夜街道，霓虹倒影。",
			}),
		);
	});

	it("updates the canonical source when editing an editable linked prompt", async () => {
		mockLinkedPromptContents();

		renderPanel();
		selectTab("词包");
		fireEvent.click(await screen.findByRole("button", { name: "编辑 剧情创作包" }));
		await selectTabWhenReady("提示词 (1)");
		fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
		fireEvent.change(screen.getByLabelText("名称"), { target: { value: "更新后的名称" } });
		fireEvent.click(screen.getByRole("button", { name: "保存" }));

		await waitFor(() =>
			expect(updatePromptPackEntry).toHaveBeenCalledWith(
				"company.source",
				"company.source/prompt/source-prompt",
				{
					name: "更新后的名称",
					description: undefined,
					body: "source body",
					metadata: { category: "extra" },
				},
			),
		);
		expect(detachPromptPackEntry).not.toHaveBeenCalled();
	});

	it("detaches a linked prompt when editing only the current pack", async () => {
		mockLinkedPromptContents();

		renderPanel();
		selectTab("词包");
		fireEvent.click(await screen.findByRole("button", { name: "编辑 剧情创作包" }));
		await selectTabWhenReady("提示词 (1)");
		fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "仅修改当前词包" }));
		fireEvent.change(screen.getByLabelText("名称"), { target: { value: "词包专用名称" } });
		fireEvent.click(screen.getByRole("button", { name: "保存" }));

		await waitFor(() =>
			expect(detachPromptPackEntry).toHaveBeenCalledWith(
				"company.story-prompts",
				"company.story-prompts/prompt/source-prompt-copy",
			),
		);
		expect(updatePromptPackEntry).toHaveBeenCalledWith(
			"company.story-prompts",
			"company.story-prompts/prompt/source-prompt-copy",
			{
				name: "词包专用名称",
				description: undefined,
				body: "source body",
				metadata: { category: "extra" },
			},
		);
	});

	it("previews Skill and prompt content inside a pack", async () => {
		vi.mocked(getPromptPackContents).mockResolvedValue({
			pack: {
				id: "company.story-prompts",
				name: "剧情创作包",
				version: "1.0.0",
				source: "local",
				enabled: true,
			},
			entries: [
				{
					id: "company.story-prompts/skill/character-writer",
					packId: "company.story-prompts",
					kind: "skill",
					slug: "character-writer",
					name: "character-writer",
					title: "角色写作",
					description: "保持角色身份和视觉一致",
					body: "# 角色规则\n必须保留角色一致性。",
					source: "user",
				},
				{
					id: "company.story-prompts/skill/shot-writer",
					packId: "company.story-prompts",
					kind: "skill",
					slug: "shot-writer",
					name: "shot-writer",
					title: "镜头设计",
					body: "使用中景建立人物关系。",
					source: "user",
				},
				{
					id: "company.story-prompts/prompt/red-dress",
					packId: "company.story-prompts",
					kind: "prompt",
					slug: "red-dress",
					name: "服装提示词",
					body: "红色丝绸礼服，柔和侧光。",
					source: "user",
				},
			],
		});

		renderPanel();
		selectTab("词包");
		fireEvent.click(await screen.findByRole("button", { name: "编辑 剧情创作包" }));

		expect(await screen.findByLabelText("Skill 内容")).toHaveTextContent("必须保留角色一致性");
		fireEvent.click(screen.getByRole("button", { name: "查看 镜头设计" }));
		expect(await screen.findByLabelText("Skill 内容")).toHaveTextContent("使用中景建立人物关系");

		selectTab("提示词 (1)");
		expect(await screen.findByLabelText("提示词内容")).toHaveTextContent("红色丝绸礼服，柔和侧光");
	});
});

const renderPanel = () =>
	render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<PromptPacksPanel />
		</SWRConfig>,
	);

const selectTab = (name: string) => {
	const tab = screen.getByRole("tab", { name });
	fireEvent.mouseDown(tab, { button: 0 });
	fireEvent.click(tab);
};

const selectTabWhenReady = async (name: string) => {
	const tab = await screen.findByRole("tab", { name });
	fireEvent.mouseDown(tab, { button: 0 });
	fireEvent.click(tab);
};

const mockLinkedPromptContents = () => {
	vi.mocked(getPromptPackContents).mockResolvedValue({
		pack: {
			id: "company.story-prompts",
			name: "剧情创作包",
			version: "1.0.0",
			source: "local",
			enabled: true,
		},
		entries: [
			{
				id: "company.story-prompts/prompt/source-prompt-copy",
				packId: "company.story-prompts",
				kind: "prompt",
				slug: "source-prompt-copy",
				name: "Source Prompt",
				body: "source body",
				metadata: { category: "extra" },
				source: "user",
				linked: true,
				referenceEntryId: "company.source/prompt/source-prompt",
				referencePackId: "company.source",
				referenceSlug: "source-prompt",
				referenceSource: "user",
				referenceEditable: true,
			},
		],
	});
};
