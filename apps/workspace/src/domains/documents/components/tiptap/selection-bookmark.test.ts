import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { SectionIdAnchor } from "@/domains/documents/components/extensions/section-id-anchor";
import {
	createVisibleTextSelectionBookmark,
	restoreVisibleTextSelectionBookmark,
	visibleTextFromDoc,
} from "./selection-bookmark";

describe("visible text selection bookmark", () => {
	it("restores the cursor after hidden section-id anchors are inserted", () => {
		const editor = new Editor({
			extensions: [StarterKit, SectionIdAnchor, Markdown],
			content: [
				"# 角色设定",
				"",
				"## 陈远",
				"",
				"陈远是一名在校大学生。",
				"",
				"## 林书彤",
				"",
				"林书彤长相出众，班花级。",
				"",
				"## 徐乐乐",
				"",
				"徐乐乐外表清爽。",
			].join("\n"),
			contentType: "markdown",
		});
		const cursorVisiblePrefix = "角色设定陈远陈远是一名在校大学生。林书彤林书彤长相出众，";
		editor.commands.setTextSelection(positionAfterVisibleText(editor, cursorVisiblePrefix));
		const bookmark = createVisibleTextSelectionBookmark(editor);

		editor.commands.setContent(
			[
				"# 角色设定",
				"",
				"<!-- section-id: section_chenyuan -->",
				"## 陈远",
				"",
				"陈远是一名在校大学生。",
				"",
				"<!-- section-id: section_linshutong -->",
				"## 林书彤",
				"",
				"林书彤长相出众，班花级。",
				"",
				"<!-- section-id: section_xulele -->",
				"## 徐乐乐",
				"",
				"徐乐乐外表清爽。",
			].join("\n"),
			{ contentType: "markdown", emitUpdate: false },
		);
		restoreVisibleTextSelectionBookmark(editor, bookmark);

		expect(textBeforeSelection(editor)).toBe(cursorVisiblePrefix);
		editor.destroy();
	});

	it("keeps boundary cursors at the start of their original textblock", () => {
		const editor = new Editor({
			extensions: [StarterKit, SectionIdAnchor, Markdown],
			content: [
				"# 角色设定",
				"",
				"## 陈远",
				"",
				"陈远是一名在校大学生。",
				"",
				"## 林书彤",
				"",
				"林书彤长相出众，班花级。",
			].join("\n"),
			contentType: "markdown",
		});
		editor.commands.setTextSelection(positionAtTextBlockStart(editor, "林书彤"));
		const bookmark = createVisibleTextSelectionBookmark(editor);

		editor.commands.setContent(
			[
				"# 角色设定",
				"",
				"<!-- section-id: section_chenyuan -->",
				"## 陈远",
				"",
				"陈远是一名在校大学生。",
				"",
				"<!-- section-id: section_linshutong -->",
				"## 林书彤",
				"",
				"林书彤长相出众，班花级。",
			].join("\n"),
			{ contentType: "markdown", emitUpdate: false },
		);
		restoreVisibleTextSelectionBookmark(editor, bookmark);

		expect(editor.state.selection.$from.parent.textContent).toBe("林书彤");
		expect(editor.state.selection.$from.parentOffset).toBe(0);
		editor.destroy();
	});
});

const textBeforeSelection = (editor: Editor) =>
	editor.state.doc.textBetween(0, editor.state.selection.from, "", "");

const positionAfterVisibleText = (editor: Editor, prefix: string) => {
	const target = prefix.length;
	const visibleText = visibleTextFromDoc(editor.state.doc);
	expect(visibleText.startsWith(prefix)).toBe(true);

	let consumed = 0;
	let fallback = editor.state.doc.content.size;
	let found = false;
	editor.state.doc.descendants((node, position) => {
		if (found) return false;
		if (!node.isText) return true;

		const textLength = node.text?.length ?? 0;
		const nextConsumed = consumed + textLength;
		if (target <= nextConsumed) {
			fallback = position + target - consumed;
			found = true;
			return false;
		}
		consumed = nextConsumed;
		return true;
	});
	return fallback;
};

const positionAtTextBlockStart = (editor: Editor, text: string) => {
	let fallback = editor.state.doc.content.size;
	let found = false;
	editor.state.doc.descendants((node, position) => {
		if (found) return false;
		if (!node.isTextblock) return true;
		if (node.textContent !== text) return false;

		fallback = position + 1;
		found = true;
		return false;
	});
	return fallback;
};
