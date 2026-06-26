import { Editor, type Extensions } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { createLockedHeadingsExtension, LockedHeading } from "./locked-heading";

describe("LockedHeading", () => {
	it("creates a paragraph after an unlocked heading when pressing Enter at the end", () => {
		const editor = createEditor("# Scene\n\nBody");

		editor.commands.setTextSelection(headingContentEnd(editor));
		pressKey(editor, "Enter");

		expect(editor.getMarkdown()).toBe("# Scene\n\n\n\nBody");

		editor.destroy();
	});

	it("splits an unlocked heading when pressing Enter in the middle", () => {
		const editor = createEditor("# Scene\n\nBody");

		editor.commands.setTextSelection(3);
		pressKey(editor, "Enter");

		expect(editor.getMarkdown()).toBe("# Sc\n\n# ene\n\nBody");

		editor.destroy();
	});

	it("turns an empty unlocked heading into a paragraph when pressing Backspace", () => {
		const editor = createEditor("# \n\nBody");

		editor.commands.setTextSelection(1);
		pressKey(editor, "Backspace");

		expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
		expect(editor.getMarkdown()).toBe("\n\nBody");

		editor.destroy();
	});

	it.each(["Enter", "Backspace"])(
		"keeps a locked heading unchanged when pressing %s",
		async (key) => {
			const editor = createEditor("# Scene\n\nBody", [
				createLockedHeadingsExtension({
					count: 1,
					titles: [{ level: 1, sectionId: "section_scene", title: "Scene" }],
				}),
			]);

			await Promise.resolve();
			expect(editor.state.doc.firstChild?.attrs.locked).toBe(true);

			editor.commands.setTextSelection(headingContentEnd(editor));
			pressKey(editor, key);

			expect(editor.getMarkdown()).toBe("# Scene\n\nBody");

			editor.destroy();
		},
	);

	it("does not merge the next paragraph into a locked heading", async () => {
		const editor = createEditor("# Scene\n\nBody", [
			createLockedHeadingsExtension({
				count: 1,
				titles: [{ level: 1, sectionId: "section_scene", title: "Scene" }],
			}),
		]);

		await Promise.resolve();
		expect(editor.state.doc.firstChild?.attrs.locked).toBe(true);

		editor.commands.setTextSelection(firstBodyTextStart(editor));
		pressKey(editor, "Backspace");

		expect(editor.getMarkdown()).toBe("# Scene\n\nBody");

		editor.destroy();
	});
});

const createEditor = (content: string, extraExtensions: Extensions = []) =>
	new Editor({
		extensions: [
			StarterKit.configure({
				heading: false,
			}),
			LockedHeading.configure({ levels: [1, 2, 3, 4] }),
			...extraExtensions,
			Markdown.configure({
				indentation: {
					style: "space",
					size: 2,
				},
			}),
		],
		content,
		contentType: "markdown",
	});

const headingContentEnd = (editor: Editor) => {
	const heading = editor.state.doc.firstChild;
	if (!heading || heading.type.name !== "heading") {
		throw new Error("missing first heading");
	}

	return heading.nodeSize - 1;
};

const firstBodyTextStart = (editor: Editor) => {
	const heading = editor.state.doc.firstChild;
	if (!heading || heading.type.name !== "heading") {
		throw new Error("missing first heading");
	}

	return heading.nodeSize + 1;
};

const pressKey = (editor: Editor, key: string) => {
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
	});

	editor.view.someProp("handleKeyDown", (handleKeyDown) => handleKeyDown(editor.view, event));
};
