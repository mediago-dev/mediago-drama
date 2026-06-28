import { cleanup, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SectionIdAnchor } from "./section-id-anchor";
import {
	SelectedSectionImagePreview,
	updateSelectedSectionImagePreviewAssets,
} from "./selected-section-image-preview";

describe("SelectedSectionImagePreview", () => {
	afterEach(() => {
		cleanup();
		delete window.mediagoDesktop;
		vi.unstubAllEnvs();
	});

	it("renders selected section images without serializing them into markdown", () => {
		const markdown = [
			"<!-- section-id: section_character -->",
			"## 角色",
			"",
			"角色设定正文。",
			"",
			"<!-- section-id: section_scene -->",
			"## 场景",
			"",
			"场景设定正文。",
		].join("\n");
		const editor = new Editor({
			extensions: [StarterKit, SectionIdAnchor, SelectedSectionImagePreview, Markdown],
			content: markdown,
			contentType: "markdown",
		});
		const markdownBeforePreview = editor.getMarkdown();

		updateSelectedSectionImagePreviewAssets(editor, "doc-character", [
			{
				assetIndex: 0,
				id: "selected-character",
				kind: "image",
				resourceId: "section_character",
				sourceDocumentId: "doc-character",
				title: "角色定稿",
				url: "/api/v1/media-assets/character/content",
			},
		]);
		render(<EditorContent editor={editor} />);

		const image = screen.getByRole("img", { name: "角色定稿" });
		expect(image.getAttribute("src")).toBe("/api/v1/media-assets/character/content");
		expect(editor.getMarkdown()).toBe(markdownBeforePreview);
		expect(editor.getMarkdown()).not.toContain("character/content");

		editor.destroy();
	});

	it("renders selected section image URLs against the packaged desktop server", () => {
		vi.stubEnv("DEV", false);
		window.mediagoDesktop = { isElectron: true } as typeof window.mediagoDesktop;
		const editor = new Editor({
			extensions: [StarterKit, SectionIdAnchor, SelectedSectionImagePreview, Markdown],
			content: "<!-- section-id: section_character -->\n## 角色\n\n角色设定正文。",
			contentType: "markdown",
		});

		updateSelectedSectionImagePreviewAssets(editor, "doc-character", [
			{
				assetIndex: 0,
				id: "selected-character",
				kind: "image",
				resourceId: "section_character",
				sourceDocumentId: "doc-character",
				title: "角色定稿",
				url: "/api/v1/media-assets/character/content",
			},
		]);
		render(<EditorContent editor={editor} />);

		expect(screen.getByRole("img", { name: "角色定稿" })).toHaveAttribute(
			"src",
			"http://127.0.0.1:48273/api/v1/media-assets/character/content",
		);

		editor.destroy();
	});

	it("ignores images selected for another document", () => {
		const editor = new Editor({
			extensions: [StarterKit, SectionIdAnchor, SelectedSectionImagePreview, Markdown],
			content: "<!-- section-id: section_character -->\n## 角色\n\n角色设定正文。",
			contentType: "markdown",
		});

		updateSelectedSectionImagePreviewAssets(editor, "doc-character", [
			{
				assetIndex: 0,
				id: "selected-other",
				kind: "image",
				resourceId: "section_character",
				sourceDocumentId: "doc-other",
				title: "其他文档图片",
				url: "/api/v1/media-assets/other/content",
			},
		]);
		render(<EditorContent editor={editor} />);

		expect(screen.queryByRole("img", { name: "其他文档图片" })).toBeNull();
		expect(editor.getMarkdown()).not.toContain("other/content");

		editor.destroy();
	});
});
