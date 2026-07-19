import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSkill, listSkills } from "@/domains/settings/api/skills";
import { listPromptPacks } from "@/domains/settings/api/packs";
import { SkillsEditorPanel } from "./SkillsEditorPanel";

vi.mock("@/domains/settings/api/skills", () => ({
	createSkill: vi.fn(),
	deleteSkill: vi.fn(),
	getSkill: vi.fn(),
	listSkills: vi.fn(),
	resetSkill: vi.fn(),
	skillsKey: "/skills",
	updateSkill: vi.fn(),
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

vi.mock("@/shared/components/callable/ConfirmDialog", () => ({
	confirmDialog: vi.fn(),
}));

vi.mock("./SettingsMarkdownEditor", () => ({
	SettingsMarkdownEditor: () => null,
	SettingsMarkdownPreview: ({ className, value }: { className?: string; value: string }) => (
		<div aria-label="Skill Markdown 预览" className={className}>
			{value}
		</div>
	),
}));

describe("SkillsEditorPanel layout", () => {
	beforeEach(() => {
		vi.mocked(listPromptPacks).mockResolvedValue([
			{
				id: "builtin",
				name: "MediaGo 默认技能包",
				version: "1.0.0",
				source: "default",
				enabled: true,
			},
			{
				id: "local.story-tools",
				name: "本地写作包",
				version: "1.0.0",
				source: "local",
				enabled: true,
			},
			{
				id: "marketplace.hidden-pack",
				name: "导入包",
				version: "1.0.0",
				source: "imported",
				enabled: true,
			},
		]);
		vi.mocked(listSkills).mockResolvedValue([
			{
				description: "图片生成指导",
				name: "image-generation",
				packId: "builtin",
				source: "pack",
				title: "图片生成与选片",
			},
			{
				description: "场景写作指导",
				name: "scene-writing",
				packId: "local.story-tools",
				source: "user",
				title: "场景写作",
			},
			{
				description: "不应展示",
				name: "unnamed-imported-skill",
				packId: "marketplace.hidden-pack",
				source: "pack",
				title: "未命名 Skill",
			},
		]);
		vi.mocked(getSkill).mockImplementation(async (name) => {
			if (name === "scene-writing") {
				return {
					content:
						"---\nname: scene-writing\ndescription: 场景写作指导\n---\n# 场景写作\n\n场景正文",
					description: "场景写作指导",
					name,
					packId: "local.story-tools",
					source: "user",
					title: "场景写作",
				};
			}
			return {
				content:
					"---\nname: image-generation\ndescription: 图片生成指导\n---\n# 图片生成与选片\n\n正文",
				description: "图片生成指导",
				name: "image-generation",
				packId: "builtin",
				source: "pack",
				title: "图片生成与选片",
			};
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("renders a left skill list and a right scrollable detail pane", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map() }}>
				<SkillsEditorPanel />
			</SWRConfig>,
		);

		const preview = await screen.findByLabelText("Skill Markdown 预览");
		const navigation = screen.getByRole("navigation", { name: "Skill 列表" });
		const detail = screen.getByRole("region", { name: "Skill 详情" });

		expect(screen.queryByRole("combobox", { name: "当前 Skill" })).not.toBeInTheDocument();
		expect(
			within(navigation).getByRole("button", { name: "查看 Skill 图片生成与选片" }),
		).toBeInTheDocument();
		expect(
			within(navigation).getByRole("button", { name: "查看 Skill 场景写作" }),
		).toBeInTheDocument();
		const importedSkill = within(navigation).getByRole("button", {
			name: "查看 Skill 未命名 Skill",
		});
		expect(importedSkill).toBeDisabled();
		expect(importedSkill).toHaveTextContent("未命名 Skill");
		expect(screen.getByText("图片生成指导")).toBeInTheDocument();
		expect(screen.getAllByLabelText("所属技能包：默认技能包")).toHaveLength(2);
		expect(preview).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
		expect(navigation).toHaveClass("overflow-y-auto", "rounded-md", "border", "border-border");
		expect(detail).toHaveClass(
			"min-w-0",
			"overflow-y-auto",
			"rounded-md",
			"border",
			"border-border",
		);
		expect(
			within(navigation).getByRole("button", { name: "查看 Skill 图片生成与选片" }),
		).toHaveClass("border-l-2", "border-primary", "bg-ide-list-hover");

		const bodySection = preview.parentElement;
		expect(bodySection).toHaveClass("flex", "min-h-0", "flex-1", "flex-col");
		const detailRequestCount = vi.mocked(getSkill).mock.calls.length;
		fireEvent.click(importedSkill);
		expect(getSkill).toHaveBeenCalledTimes(detailRequestCount);

		fireEvent.click(within(navigation).getByRole("button", { name: "查看 Skill 场景写作" }));
		await waitFor(() => expect(getSkill).toHaveBeenLastCalledWith("scene-writing"));
		expect(await screen.findByText("场景写作指导")).toBeInTheDocument();
	});
});
