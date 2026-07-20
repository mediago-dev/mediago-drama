import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsMarkdownEditor } from "./SettingsMarkdownEditor";

afterEach(() => {
	vi.useRealTimers();
});

describe("SettingsMarkdownEditor", () => {
	it("renders stored Markdown headings, emphasis, lists, and tables", () => {
		const value = [
			"# 一级标题",
			"",
			"包含 **重点**。",
			"",
			"- 第一项",
			"",
			"| 因素 | 权重 |",
			"| --- | --- |",
			"| 节奏 | 30% |",
		].join("\n");
		render(
			<SettingsMarkdownEditor
				ariaLabel="测试 Markdown"
				cacheKey="preview-test"
				editable={false}
				onChange={() => undefined}
				variant="document"
				value={value}
			/>,
		);

		const editor = screen.getByLabelText("测试 Markdown");
		expect(editor).toHaveClass("tiptap-content");
		expect(editor).not.toHaveClass("settings-markdown-prosemirror");
		expect(within(editor).getByRole("heading", { level: 1, name: "一级标题" })).toBeInTheDocument();
		expect(editor.querySelector("strong")).toHaveTextContent("重点");
		expect(within(editor).getByRole("list")).toHaveTextContent("第一项");
		expect(within(editor).getByRole("table")).toHaveTextContent("节奏30%");
	});

	it("parses pasted Markdown and batches serialization for large edits", () => {
		vi.useFakeTimers();
		const onChange = vi.fn();
		render(
			<SettingsMarkdownEditor ariaLabel="粘贴 Markdown" editable onChange={onChange} value="" />,
		);

		const editor = screen.getByLabelText("粘贴 Markdown");
		expect(editor).toHaveClass("settings-markdown-prosemirror");
		const markdown = [
			"# Seedance 2.0",
			"",
			"具备 **动作指导** 能力。",
			"",
			"- 攻防逻辑设计",
			"- 运镜指导",
		].join("\n");
		fireEvent.paste(editor, {
			clipboardData: {
				getData: (type: string) => (type === "text/plain" ? markdown : ""),
			},
		});

		expect(
			within(editor).getByRole("heading", { level: 1, name: "Seedance 2.0" }),
		).toBeInTheDocument();
		expect(editor.querySelector("strong")).toHaveTextContent("动作指导");
		expect(within(editor).getByRole("list")).toHaveTextContent("攻防逻辑设计");
		expect(onChange).not.toHaveBeenCalled();

		act(() => vi.advanceTimersByTime(160));
		expect(onChange).toHaveBeenCalledOnce();
		expect(onChange.mock.lastCall?.[0]).toContain("# Seedance 2.0");
		expect(onChange.mock.lastCall?.[0]).toContain("**动作指导**");
	});

	it("keeps the editor instance when switching from edit mode to preview mode", () => {
		const { rerender } = render(
			<SettingsMarkdownEditor
				ariaLabel="切换编辑状态"
				editable
				onChange={() => undefined}
				value="正文"
			/>,
		);
		const editor = screen.getByLabelText("切换编辑状态");

		rerender(
			<SettingsMarkdownEditor
				ariaLabel="切换编辑状态"
				editable={false}
				onChange={() => undefined}
				value="正文"
			/>,
		);

		expect(screen.getByLabelText("切换编辑状态")).toBe(editor);
		expect(editor).toHaveAttribute("contenteditable", "false");
	});

	it("reuses cached JSON when returning to previously rendered content", () => {
		vi.useFakeTimers();
		const { rerender } = render(
			<SettingsMarkdownEditor
				ariaLabel="缓存切换"
				cacheKey="first"
				editable={false}
				onChange={() => undefined}
				value="# 第一篇"
			/>,
		);
		act(() => vi.runOnlyPendingTimers());

		rerender(
			<SettingsMarkdownEditor
				ariaLabel="缓存切换"
				cacheKey="second"
				editable={false}
				onChange={() => undefined}
				value="# 第二篇"
			/>,
		);
		act(() => vi.runOnlyPendingTimers());

		rerender(
			<SettingsMarkdownEditor
				ariaLabel="缓存切换"
				cacheKey="first"
				editable={false}
				onChange={() => undefined}
				value="# 第一篇"
			/>,
		);

		expect(screen.getByRole("heading", { level: 1, name: "第一篇" })).toBeInTheDocument();
	});
});
