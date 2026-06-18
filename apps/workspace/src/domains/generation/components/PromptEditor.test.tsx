import { fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it, vi } from "vitest";
import { PromptEditor, PromptMarkdownPreview, promptEditorTestInternals } from "./PromptEditor";
import {
	PromptSlashMenu,
	promptSlashCommandTestInternals,
	type PromptInsertItem,
} from "./PromptSlashCommand";

const slashItems: PromptInsertItem[] = [
	{
		id: "cinematic-style",
		layerLabel: "风格",
		name: "电影感柔光",
		prompt: "**电影感柔光**\n\n- 保持自然肤色\n- 低对比暖光",
		sourceLabel: "内置",
	},
	{
		id: "character-extra",
		layerLabel: "其他",
		name: "角色多视图",
		prompt: "同一角色三视图，正面、侧面、背面保持服饰一致。",
		sourceLabel: "用户",
	},
];

describe("PromptEditor", () => {
	it("renders editable prompt markdown as rich content", () => {
		render(
			<PromptEditor
				value={"# 角色设定\n\n- 沈闯保持湿透水状态"}
				placeholder="描述要生成的图片素材"
				onChange={vi.fn()}
			/>,
		);

		expect(screen.getByRole("heading", { name: "角色设定" })).toBeTruthy();
		expect(screen.getByText("沈闯保持湿透水状态")).toBeTruthy();
		expect(screen.queryByText("# 角色设定")).toBeNull();
	});

	it("renders readonly prompt markdown as rich content", () => {
		const { container } = render(<PromptMarkdownPreview value={"**重点**\n\n1. 镜头运动自然"} />);

		expect(container.querySelector("strong")?.textContent).toBe("重点");
		expect(screen.getByText("镜头运动自然")).toBeTruthy();
	});

	it("filters slash prompt insertions by name and prompt body", () => {
		const filteredByName = promptSlashCommandTestInternals.filterPromptInsertItems(
			slashItems,
			"电影",
		);
		const filteredByBody = promptSlashCommandTestInternals.filterPromptInsertItems(
			slashItems,
			"三视图",
		);

		expect(filteredByName.map((item) => item.id)).toEqual(["cinematic-style"]);
		expect(filteredByBody.map((item) => item.id)).toEqual(["character-extra"]);
	});

	it("inserts selected slash prompt markdown into the editor", () => {
		const editor = new Editor({
			content: "/",
			contentType: "markdown",
			extensions: [
				StarterKit.configure({}),
				Markdown.configure({
					indentation: {
						style: "space",
						size: 2,
					},
				}),
			],
		});

		try {
			promptSlashCommandTestInternals.insertPromptItem(editor, { from: 1, to: 2 }, slashItems[0]);

			expect(editor.getMarkdown()).toContain("**电影感柔光**");
			expect(editor.getMarkdown()).toContain("- 保持自然肤色");
			expect(editor.getMarkdown()).not.toContain("/");
		} finally {
			editor.destroy();
		}
	});

	it("flushes pending editor DOM changes before emitting on blur", () => {
		let markdown = "第一行\n\n第二行";
		const flush = vi.fn(() => {
			markdown = "第一行";
		});
		const getMarkdown = vi.fn(() => markdown);
		const onChange = vi.fn();

		promptEditorTestInternals.emitPromptMarkdownChange(
			{
				getMarkdown,
				view: {
					domObserver: { flush },
				},
			} as unknown as Editor,
			{ current: "第一行\n\n第二行" },
			{ current: onChange },
			{ flushDom: true },
		);

		expect(flush).toHaveBeenCalled();
		expect(getMarkdown).toHaveBeenCalled();
		expect(onChange).toHaveBeenCalledWith("第一行");
	});

	it("selects a slash prompt item through the menu", () => {
		const onSelect = vi.fn();

		render(
			<PromptSlashMenu
				items={slashItems}
				position={{ left: 16, placement: "bottom", top: 16 }}
				selectedIndex={0}
				onHover={vi.fn()}
				onSelect={onSelect}
			/>,
		);

		const option = screen.getByText("电影感柔光").closest("button");
		expect(option).toBeTruthy();

		fireEvent.mouseDown(option as HTMLButtonElement);

		expect(onSelect).toHaveBeenCalledWith(slashItems[0]);
	});
});
