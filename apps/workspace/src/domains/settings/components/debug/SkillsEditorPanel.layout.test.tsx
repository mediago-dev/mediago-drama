import { cleanup, render, screen } from "@testing-library/react";
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
				name: "MediaGo 默认词包",
				version: "1.0.0",
				source: "default",
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
		]);
		vi.mocked(getSkill).mockResolvedValue({
			content:
				"---\nname: image-generation\ndescription: 图片生成指导\n---\n# 图片生成与选片\n\n正文",
			description: "图片生成指导",
			name: "image-generation",
			packId: "builtin",
			source: "pack",
			title: "图片生成与选片",
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("keeps the skill header fixed while the Markdown preview scrolls", async () => {
		render(
			<SWRConfig value={{ provider: () => new Map() }}>
				<SkillsEditorPanel />
			</SWRConfig>,
		);

		const preview = await screen.findByLabelText("Skill Markdown 预览");
		expect(screen.getByText("图片生成指导")).toBeInTheDocument();
		expect(screen.getByLabelText("所属词包：默认词包")).toBeInTheDocument();
		expect(preview).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");

		const bodySection = preview.parentElement;
		expect(bodySection).toHaveClass("flex", "min-h-0", "flex-1", "flex-col");
		expect(bodySection?.parentElement).toHaveClass("h-full", "min-h-0", "flex-col");
		expect(bodySection?.parentElement?.parentElement).not.toHaveClass("overflow-y-auto");
	});
});
