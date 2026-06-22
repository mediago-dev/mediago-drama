import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { type MarkdownDocument, useDocumentsStore } from "@/domains/documents/stores";
import { DocumentMention } from "./document-mention";

describe("DocumentMention", () => {
	afterEach(() => {
		useDocumentsStore.setState({ documents: [], assets: [] });
	});

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
		expect(editor.getHTML()).toContain('data-category="scene"');
		expect(editor.getHTML()).toContain('data-kind="section"');
		expect(editor.getHTML()).toContain('data-document-id="scene-doc"');
		expect(editor.getHTML()).not.toContain('href="mention://');
		expect(editor.getMarkdown()).toContain("@[下城雨夜出租屋](mention://scene-doc/section_scene)");

		editor.destroy();
	});

	it("infers mention category from the referenced document when the stable href omits params", () => {
		useDocumentsStore.setState({
			documents: [
				makeDocument({
					category: "scene",
					id: "scene-doc",
					title: "湖大正校门口",
				}),
			],
		});

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
			content: "场景 @[湖大正校门口](mention://scene-doc/section_gate)。",
			contentType: "markdown",
		});

		const mention = findNode(editor.getJSON(), "documentMention");
		expect(mention?.attrs).toMatchObject({
			blockId: "section_gate",
			documentId: "scene-doc",
			kind: "section",
			title: "湖大正校门口",
		});
		expect(editor.getHTML()).toContain('data-category="scene"');
		expect(editor.getMarkdown()).toContain("@[湖大正校门口](mention://scene-doc/section_gate)");

		editor.destroy();
	});
});

const makeDocument = (overrides: Partial<MarkdownDocument> & Pick<MarkdownDocument, "id">) => ({
	category: "screenplay" as const,
	comments: [],
	content: "",
	isDirty: false,
	parentId: null,
	sortOrder: 0,
	title: overrides.id,
	updatedAt: "2026-06-18T00:00:00.000Z",
	version: 1,
	workbenchDraft: null,
	...overrides,
	id: overrides.id,
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
