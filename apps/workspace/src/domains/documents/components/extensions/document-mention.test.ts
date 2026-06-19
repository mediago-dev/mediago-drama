import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { DocumentMention } from "./document-mention";

describe("DocumentMention", () => {
	it("parses agent-written mention markdown before the regular link tokenizer", () => {
		const editor = new Editor({
			extensions: [
				StarterKit.configure({
					link: {
						autolink: true,
						defaultProtocol: "https",
						enableClickSelection: true,
						linkOnPaste: true,
						openOnClick: false,
					},
				}),
				DocumentMention,
				Markdown.configure({
					indentation: {
						style: "space",
						size: 2,
					},
				}),
			],
			content:
				"**引用资源**：场景 @[下城雨夜出租屋](mention://scene-doc/section_scene?kind=section&category=scene)。",
			contentType: "markdown",
		});

		const mention = findNode(editor.getJSON(), "documentMention");
		expect(mention?.attrs).toMatchObject({
			blockId: "section_scene",
			category: "scene",
			documentId: "scene-doc",
			kind: "section",
			title: "下城雨夜出租屋",
		});
		expect(editor.getHTML()).toContain("agent-reference-mention");
		expect(editor.getHTML()).not.toContain('href="mention://');
		expect(editor.getMarkdown()).toContain(
			"@[下城雨夜出租屋](mention://scene-doc/section_scene?kind=section&category=scene)",
		);

		editor.destroy();
	});
});

const findNode = (
	node: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] },
	type: string,
): { attrs?: Record<string, unknown> } | null => {
	if (node.type === type) return node;

	for (const child of node.content ?? []) {
		const found = findNode(
			child as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] },
			type,
		);
		if (found) return found;
	}

	return null;
};
