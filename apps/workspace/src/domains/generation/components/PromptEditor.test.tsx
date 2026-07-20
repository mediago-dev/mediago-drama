import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptEditor, PromptMarkdownPreview, promptEditorTestInternals } from "./PromptEditor";
import {
	PromptSlashMenu,
	promptSlashCommandTestInternals,
	type PromptInsertItem,
} from "./PromptSlashCommand";

const slashItems: PromptInsertItem[] = [
	{
		id: "cinematic-style",
		categoryLabel: "风格",
		name: "电影感柔光",
		prompt: "**电影感柔光**\n\n- 保持自然肤色\n- 低对比暖光",
		sourceLabel: "来自包",
	},
	{
		id: "character-extra",
		categoryLabel: "其他",
		name: "角色多视图",
		prompt: "同一角色三视图，正面、侧面、背面保持服饰一致。",
		sourceLabel: "用户新增",
	},
];

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	document.querySelectorAll(".prompt-slash-menu-layer").forEach((element) => element.remove());
});

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

	it("treats a slash as an active prompt command anywhere when the query starts immediately after it", () => {
		const startMatch = promptEditorTestInternals.findPromptSlashMatchFromText("/电影", 4);
		const inlineMatch = promptEditorTestInternals.findPromptSlashMatchFromText("角色设定/电影", 8);
		const separatorMatch = promptEditorTestInternals.findPromptSlashMatchFromText(
			"主角 / 低阶散修",
			10,
		);

		expect(startMatch?.query).toBe("电影");
		expect(inlineMatch).toEqual({ query: "电影", range: { from: 5, to: 8 } });
		expect(separatorMatch).toBeNull();
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

	it("moves slash selection within a group and across groups", () => {
		const items: PromptInsertItem[] = [
			slashItems[0],
			{
				id: "watercolor-style",
				categoryLabel: "风格",
				name: "水彩",
				prompt: "水彩质感。",
				sourceLabel: "来自包",
			},
			slashItems[1],
		];

		expect(promptEditorTestInternals.movePromptSlashSelectionInGroup(items, 0, 1)).toBe(1);
		expect(promptEditorTestInternals.movePromptSlashSelectionInGroup(items, 1, 1)).toBe(0);
		expect(promptEditorTestInternals.movePromptSlashSelectionGroup(items, 0, 1)).toBe(2);
		expect(promptEditorTestInternals.movePromptSlashSelectionGroup(items, 2, -1)).toBe(0);
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

	it("switches slash prompt groups through the cascader source list", () => {
		const onHover = vi.fn();

		render(
			<PromptSlashMenu
				items={slashItems}
				position={{ left: 16, placement: "bottom", top: 16 }}
				selectedIndex={0}
				onHover={onHover}
				onSelect={vi.fn()}
			/>,
		);

		expect(screen.getByText("分类")).toBeTruthy();
		expect(screen.getByText("提示词")).toBeTruthy();
		expect(screen.getByText("电影感柔光")).toBeTruthy();
		expect(screen.queryByText("角色多视图")).toBeNull();

		const extraGroup = screen.getByRole("button", { name: "其他 1 项" });
		fireEvent.pointerEnter(extraGroup);

		expect(onHover).toHaveBeenCalledWith(1);
	});

	it("keeps the active slash group while the pointer crosses the forward safe triangle", () => {
		vi.useFakeTimers();
		const onHover = vi.fn();

		render(
			<PromptSlashMenu
				items={slashItems}
				position={{ left: 16, placement: "bottom", top: 16 }}
				selectedIndex={0}
				onHover={onHover}
				onSelect={vi.fn()}
			/>,
		);

		const activeGroup = screen.getByRole("button", { name: "风格 1 项" });
		const crossedGroup = screen.getByRole("button", { name: "其他 1 项" });
		const submenu = document.querySelector<HTMLElement>(".prompt-slash-secondary");
		expect(submenu).toBeTruthy();
		vi.spyOn(activeGroup, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 124, left: 20, right: 200, top: 80 }),
		);
		vi.spyOn(submenu as HTMLElement, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 260, left: 220, right: 520, top: 40 }),
		);

		fireEvent.pointerEnter(activeGroup, { clientX: 150, clientY: 96 });
		fireEvent.pointerMove(activeGroup, { clientX: 160, clientY: 112 });
		fireEvent.pointerEnter(crossedGroup, { clientX: 172, clientY: 136 });

		expect(onHover).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(179));
		expect(onHover).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(1));
		expect(onHover).toHaveBeenCalledWith(1);
	});

	it("debounces slash group changes when the pointer returns from the submenu", () => {
		vi.useFakeTimers();
		const onHover = vi.fn();

		render(
			<PromptSlashMenu
				items={slashItems}
				position={{ left: 16, placement: "bottom", top: 16 }}
				selectedIndex={0}
				onHover={onHover}
				onSelect={vi.fn()}
			/>,
		);

		const submenu = document.querySelector<HTMLElement>(".prompt-slash-secondary");
		const crossedGroup = screen.getByRole("button", { name: "其他 1 项" });
		expect(submenu).toBeTruthy();

		fireEvent.pointerLeave(submenu as HTMLElement);
		fireEvent.pointerEnter(crossedGroup, { clientX: 180, clientY: 136 });

		expect(onHover).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(149));
		expect(onHover).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(1));
		expect(onHover).toHaveBeenCalledWith(1);
	});
});

const testRect = ({
	bottom,
	left,
	right,
	top,
}: {
	bottom: number;
	left: number;
	right: number;
	top: number;
}): DOMRect => ({
	bottom,
	height: bottom - top,
	left,
	right,
	top,
	width: right - left,
	x: left,
	y: top,
	toJSON: () => ({}),
});
