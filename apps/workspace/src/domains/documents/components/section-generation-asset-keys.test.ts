import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownDocument } from "@/domains/documents/stores";
import type { MarkdownSectionContext } from "./MarkdownHybridEditor";
import { sectionAssetKeysFromDocuments } from "./section-generation-asset-keys";

const makeDocument = (content: string): MarkdownDocument => ({
	category: "storyboard",
	comments: [],
	content,
	id: "doc-1",
	isDirty: false,
	parentId: null,
	sortOrder: 0,
	title: "分镜",
	updatedAt: "2026-06-22T00:00:00.000Z",
	version: 1,
	workbenchDraft: null,
});

const section: MarkdownSectionContext = {
	blockId: "section-character",
	documentId: "doc-1",
	headingLevel: 2,
	headingOccurrence: 1,
	headingText: "林书彤",
	markdown: "## 林书彤\n\n旧内容。",
	plainText: "林书彤\n\n旧内容。",
	prompt: "旧内容。",
};

describe("section-generation-asset-keys", () => {
	afterEach(() => {
		delete window.mediagoDesktop;
		vi.unstubAllEnvs();
	});

	it("reads selected image keys from the latest document section markdown", () => {
		const documents = [
			makeDocument(
				[
					"# 角色",
					"",
					"## 林书彤",
					"",
					"新内容。",
					"![林书彤](<https://example.test/lin.png>)",
				].join("\n"),
			),
		];

		expect(sectionAssetKeysFromDocuments(documents, section, "image")).toEqual([
			"image:https://example.test/lin.png",
		]);
	});

	it("matches a legacy canvas section context after the backend anchors the document section", () => {
		const legacyCanvasSection: MarkdownSectionContext = {
			...section,
			blockId: "section-lin",
		};
		const documents = [
			makeDocument(
				[
					"# 角色",
					"",
					"<!-- section-id: section_lin -->",
					"## 林书彤",
					"",
					"新内容。",
					"![林书彤](</api/v1/media-assets/asset-lin/content>)",
				].join("\n"),
			),
		];

		expect(sectionAssetKeysFromDocuments(documents, legacyCanvasSection, "image")).toEqual([
			"image:/api/v1/media-assets/asset-lin/content",
		]);
	});

	it("normalizes local API image URLs before comparing selected assets", () => {
		vi.stubEnv("DEV", false);
		window.mediagoDesktop = { isElectron: true } as typeof window.mediagoDesktop;
		const documents = [
			makeDocument(
				["# 角色", "", "## 林书彤", "", "![林书彤](</api/media/assets/generated/content>)"].join(
					"\n",
				),
			),
		];

		expect(sectionAssetKeysFromDocuments(documents, section, "image")).toEqual([
			"image:http://127.0.0.1:48273/api/v1/media-assets/generated/content",
		]);
	});

	it("falls back to the provided section markdown when the document is unavailable", () => {
		const fallbackSection = {
			...section,
			markdown: "## 林书彤\n\n![林书彤](<https://example.test/fallback.png>)",
		};

		expect(sectionAssetKeysFromDocuments([], fallbackSection, "image")).toEqual([
			"image:https://example.test/fallback.png",
		]);
	});
});
