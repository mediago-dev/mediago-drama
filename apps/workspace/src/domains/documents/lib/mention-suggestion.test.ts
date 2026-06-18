import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
	AgentMentionList,
	createMentionItems,
	mentionPopupAppendTarget,
} from "@/domains/documents/lib/mention-suggestion";
import { useDocumentsStore } from "@/domains/documents/stores";
import type { MarkdownDocument } from "@/domains/documents/stores";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";

const timestamp = "2026-06-19T00:00:00.000Z";

const makeDocument = (overrides: Partial<MarkdownDocument> = {}): MarkdownDocument => ({
	id: "doc-character",
	title: "太虚角色设定",
	content: "# 太虚角色设定\n",
	category: "character",
	parentId: null,
	sortOrder: 0,
	version: 1,
	updatedAt: timestamp,
	isDirty: false,
	comments: [],
	workbenchDraft: null,
	...overrides,
});

const makeAsset = (overrides: Partial<ProjectAsset> = {}): ProjectAsset => ({
	id: "asset-image",
	projectId: "project-a",
	kind: "image",
	filename: "角色参考图.png",
	mimeType: "image/png",
	sizeBytes: 1,
	url: "/api/v1/projects/project-a/assets/asset-image/content",
	sortOrder: 0,
	createdAt: timestamp,
	updatedAt: timestamp,
	...overrides,
});

describe("mention suggestion items", () => {
	afterEach(() => {
		cleanup();
		useDocumentsStore.setState({
			documents: [],
			assets: [],
		});
	});

	it("adds selected section image previews to matching section items", () => {
		useDocumentsStore.setState({
			documents: [
				makeDocument({
					content: [
						"# 太虚角色设定",
						"",
						"## 系统女声 / 太虚古老意识",
						"",
						"![角色定稿](</api/v1/media-assets/voice/content>)",
						"",
						"## 神秘旧天声音 / 倒悬旧天意识",
						"",
						"![正在生成图片](<data:image/svg+xml;base64,placeholder>)",
					].join("\n"),
				}),
			],
			assets: [],
		});

		const items = createMentionItems("系统女声");
		const sectionItem = items.find((item) => item.kind === "section");

		expect(sectionItem?.title).toBe("系统女声 / 太虚古老意识");
		expect(sectionItem?.previewUrl).toBe("/api/v1/media-assets/voice/content");
	});

	it("adds image asset previews to asset items", () => {
		useDocumentsStore.setState({
			documents: [],
			assets: [makeAsset()],
		});

		const items = createMentionItems("角色参考");
		const assetItem = items.find((item) => item.kind === "asset");

		expect(assetItem?.title).toBe("角色参考图.png");
		expect(assetItem?.previewUrl).toBe("/api/v1/projects/project-a/assets/asset-image/content");
	});

	it("keeps project image assets when document sections exceed the document result cap", () => {
		useDocumentsStore.setState({
			documents: [
				makeDocument({
					content: [
						"# 太虚角色设定",
						...Array.from({ length: 120 }, (_, index) => `## 节点 ${index + 1}`),
					].join("\n\n"),
				}),
			],
			assets: [makeAsset({ filename: "ChatGPT Image 2026年6月.png" })],
		});

		const items = createMentionItems("");
		const assetItem = items.find((item) => item.kind === "asset");

		expect(assetItem?.title).toBe("ChatGPT Image 2026年6月.png");
		expect(assetItem?.previewUrl).toBe("/api/v1/projects/project-a/assets/asset-image/content");
	});

	it("renders parent sources and child nodes as a joined cascader", () => {
		useDocumentsStore.setState({
			documents: [
				makeDocument({
					content: [
						"# 太虚角色设定",
						"",
						"## 系统女声 / 太虚古老意识",
						"",
						"![角色定稿](</api/v1/media-assets/voice/content>)",
					].join("\n"),
				}),
			],
			assets: [],
		});

		const items = createMentionItems("");
		const { container } = render(
			createElement(AgentMentionList, {
				command: () => {},
				items,
			}),
		);

		expect(container.querySelector(".agent-mention-cascader")).toBeTruthy();
		expect(container.querySelectorAll(".agent-mention-source")).toHaveLength(1);
		expect(container.querySelectorAll(".agent-mention-option")).toHaveLength(3);
		expect(container.querySelector(".agent-mention-cascader-primary")?.textContent).toContain(
			"角色",
		);
		expect(container.querySelector(".agent-mention-cascader-secondary")?.textContent).toContain(
			"系统女声 / 太虚古老意识",
		);
		expect(
			container.querySelector('.agent-mention-option[data-has-preview="true"] img'),
		).toBeTruthy();
	});

	it("appends the popup inside a generation dialog root when available", () => {
		const dialogRoot = document.createElement("div");
		dialogRoot.setAttribute("data-agent-mention-popup-root", "");
		const editorElement = document.createElement("div");
		dialogRoot.append(editorElement);
		document.body.append(dialogRoot);

		expect(mentionPopupAppendTarget(editorElement)).toBe(dialogRoot);

		dialogRoot.remove();
		expect(mentionPopupAppendTarget(document.createElement("div"))).toBe(document.body);
	});
});
