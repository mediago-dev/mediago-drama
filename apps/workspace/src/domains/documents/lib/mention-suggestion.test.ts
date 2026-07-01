import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AgentMentionList,
	createMentionItems,
	mentionPopupAppendTarget,
	shouldKeepAgentMentionGroupActive,
} from "@/domains/documents/lib/mention-suggestion";
import type { SelectedGenerationAsset } from "@/domains/generation/api/generation";
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

const makeSelectedGenerationAsset = (
	overrides: Partial<SelectedGenerationAsset> = {},
): SelectedGenerationAsset => ({
	assetIndex: 0,
	id: "selected-character-image",
	kind: "image",
	resourceType: "character",
	url: "/api/v1/media-assets/selected-character/content",
	...overrides,
});

describe("mention suggestion items", () => {
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
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

		expect(items[0]).toEqual(
			expect.objectContaining({
				kind: "document",
				title: "太虚角色设定",
			}),
		);
		expect(sectionItem?.title).toBe("系统女声 / 太虚古老意识");
		expect(sectionItem?.previewUrl).toBe("/api/v1/media-assets/voice/content");
	});

	it("uses selected generation images as section previews when markdown has no image", () => {
		useDocumentsStore.setState({
			documents: [
				makeDocument({
					content: [
						"# 角色",
						"",
						"<!-- section-id: section_chenyuan -->",
						"## 陈远",
						"",
						"陈远，21岁男大学生。",
					].join("\n"),
					title: "角色",
				}),
			],
			assets: [],
		});

		const items = createMentionItems("陈远", {
			selectedGenerationAssets: [
				makeSelectedGenerationAsset({
					resourceId: "section_chenyuan",
					resourceTitle: "陈远",
					sourceDocumentId: "doc-character",
				}),
			],
		});
		const sectionItem = items.find((item) => item.kind === "section");

		expect(sectionItem?.title).toBe("陈远");
		expect(sectionItem?.previewUrl).toBe("/api/v1/media-assets/selected-character/content");
	});

	it("keeps the document itself before section mention items", () => {
		useDocumentsStore.setState({
			documents: [
				makeDocument({
					content: [
						"# 角色册 第一章",
						"",
						"## 陈远",
						"",
						"陈远，21岁男大学生。",
						"",
						"## 林书彤",
						"",
						"林书彤，21岁女大学生。",
					].join("\n"),
					title: "角色册 第一章",
				}),
			],
			assets: [],
		});

		const items = createMentionItems("角色册");

		expect(items.map((item) => `${item.kind}:${item.title}`)).toEqual([
			"document:角色册 第一章",
			"section:陈远",
			"section:林书彤",
		]);
		expect(items.every((item) => item.kind !== "section" || item.blockId)).toBe(true);
	});

	it("keeps reference documents selectable as whole documents even when they have headings", () => {
		useDocumentsStore.setState({
			documents: [
				makeDocument({
					category: "reference",
					content: [
						"# 原始素材",
						"",
						"未加工素材正文。",
						"",
						"## 第一幕",
						"",
						"第一幕素材正文。",
					].join("\n"),
					id: "doc-reference",
					title: "原始素材",
				}),
			],
			assets: [],
		});

		const items = createMentionItems("原始素材");

		expect(items.map((item) => `${item.kind}:${item.title}`)).toEqual([
			"document:原始素材",
			"section:第一幕",
		]);
		expect(items[0]).toEqual(
			expect.objectContaining({
				category: "reference",
				documentId: "doc-reference",
				kind: "document",
				title: "原始素材",
			}),
		);
	});

	it("keeps a document mention item for documents without headings", () => {
		useDocumentsStore.setState({
			documents: [
				makeDocument({
					content: "纯文本设定，没有标题层级。",
					title: "散文设定",
				}),
			],
			assets: [],
		});

		const items = createMentionItems("散文");

		expect(items).toEqual([
			expect.objectContaining({
				documentId: "doc-character",
				kind: "document",
				title: "散文设定",
			}),
		]);
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
		expect(container.querySelectorAll(".agent-mention-option")).toHaveLength(2);
		expect(container.querySelector(".agent-mention-cascader-primary")?.textContent).toContain(
			"角色",
		);
		expect(container.querySelector(".agent-mention-cascader-secondary")?.textContent).toContain(
			"太虚角色设定",
		);
		expect(container.querySelector(".agent-mention-cascader-secondary")?.textContent).toContain(
			"系统女声 / 太虚古老意识",
		);
		expect(
			container.querySelector('.agent-mention-option:first-of-type[data-kind="document"]'),
		).toBeTruthy();
		expect(
			container.querySelector('.agent-mention-option[data-has-preview="true"] img'),
		).toBeTruthy();
	});

	it("keeps the active source while the pointer crosses the safe triangle", () => {
		useDocumentsStore.setState({
			documents: [
				makeDocument({
					content: "# 角色设定\n\n## 陈远",
					title: "角色设定",
				}),
				makeDocument({
					category: "scene",
					content: "# 场景设定\n\n## 教室",
					id: "doc-scene",
					title: "场景设定",
				}),
			],
			assets: [],
		});

		const { container } = render(
			createElement(AgentMentionList, {
				command: () => {},
				items: createMentionItems(""),
			}),
		);
		const characterSource = sourceByText(container, "角色设定");
		const sceneSource = sourceByText(container, "场景设定");
		const secondaryPane = container.querySelector(".agent-mention-cascader-secondary-pane");
		expect(characterSource).toBeTruthy();
		expect(sceneSource).toBeTruthy();
		expect(secondaryPane).toBeTruthy();
		vi.spyOn(characterSource as Element, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 124, left: 20, right: 220, top: 80 }),
		);
		vi.spyOn(secondaryPane as Element, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 360, left: 240, right: 520, top: 40 }),
		);

		fireEvent.pointerOver(characterSource as Element, { clientX: 150, clientY: 96 });
		fireEvent.pointerMove(characterSource as Element, { clientX: 160, clientY: 112 });
		fireEvent.pointerOver(sceneSource as Element, { clientX: 172, clientY: 136 });

		expect(sceneSource?.getAttribute("data-selected")).toBe("false");
		expect(secondaryPane?.textContent).toContain("陈远");
		expect(secondaryPane?.textContent).not.toContain("教室");
	});

	it("switches source when the pointer dwells on a crossed source", () => {
		vi.useFakeTimers();
		useDocumentsStore.setState({
			documents: [
				makeDocument({
					content: "# 角色设定\n\n## 陈远",
					title: "角色设定",
				}),
				makeDocument({
					category: "scene",
					content: "# 场景设定\n\n## 教室",
					id: "doc-scene",
					title: "场景设定",
				}),
			],
			assets: [],
		});

		const { container } = render(
			createElement(AgentMentionList, {
				command: () => {},
				items: createMentionItems(""),
			}),
		);
		const characterSource = sourceByText(container, "角色设定");
		const sceneSource = sourceByText(container, "场景设定");
		const secondaryPane = container.querySelector(".agent-mention-cascader-secondary-pane");
		expect(characterSource).toBeTruthy();
		expect(sceneSource).toBeTruthy();
		expect(secondaryPane).toBeTruthy();
		vi.spyOn(characterSource as Element, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 124, left: 20, right: 220, top: 80 }),
		);
		vi.spyOn(secondaryPane as Element, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 360, left: 240, right: 520, top: 40 }),
		);

		fireEvent.pointerOver(characterSource as Element, { clientX: 150, clientY: 96 });
		fireEvent.pointerMove(characterSource as Element, { clientX: 160, clientY: 112 });
		fireEvent.pointerOver(sceneSource as Element, { clientX: 172, clientY: 136 });

		expect(sceneSource?.getAttribute("data-selected")).toBe("false");

		act(() => {
			vi.advanceTimersByTime(200);
		});

		expect(sceneSource?.getAttribute("data-selected")).toBe("true");
		expect(secondaryPane?.textContent).toContain("教室");
		expect(secondaryPane?.textContent).not.toContain("陈远");
	});

	it("renders a document-scoped create action in the active child pane", () => {
		useDocumentsStore.setState({
			documents: [
				makeDocument({
					content: "# 太虚角色设定\n\n## 系统女声",
					title: "太虚角色设定",
				}),
			],
			assets: [],
		});

		const onCreateSection = vi.fn();
		const { container } = render(
			createElement(AgentMentionList, {
				command: () => {},
				items: createMentionItems(""),
				onCreateSection,
			}),
		);

		const createButton = container.querySelector(".agent-mention-create");
		expect(createButton?.textContent).toContain("新增角色");

		fireEvent.mouseDown(createButton as Element);

		expect(onCreateSection).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "character",
				documentId: "doc-character",
				label: "太虚角色设定",
			}),
		);
	});

	it("creates from the typed query when Enter is pressed without matches", () => {
		const onCreateSectionFromQuery = vi.fn();
		const ref = createRef<{
			onKeyDown: (props: { event: KeyboardEvent }) => boolean;
		}>();
		const { container } = render(
			createElement(AgentMentionList, {
				command: () => {},
				items: [],
				onCreateSectionFromQuery,
				query: " 你是 ",
				ref,
			}),
		);

		expect(container.textContent).toContain("无匹配引用，按 Enter 新增「你是」");

		const handled = ref.current?.onKeyDown({
			event: new KeyboardEvent("keydown", { key: "Enter" }),
		});

		expect(handled).toBe(true);
		expect(onCreateSectionFromQuery).toHaveBeenCalledWith("你是");
	});

	it("keeps unmatched Enter unhandled when the query is blank", () => {
		const onCreateSectionFromQuery = vi.fn();
		const ref = createRef<{
			onKeyDown: (props: { event: KeyboardEvent }) => boolean;
		}>();
		render(
			createElement(AgentMentionList, {
				command: () => {},
				items: [],
				onCreateSectionFromQuery,
				query: " ",
				ref,
			}),
		);

		const handled = ref.current?.onKeyDown({
			event: new KeyboardEvent("keydown", { key: "Enter" }),
		});

		expect(handled).toBe(false);
		expect(onCreateSectionFromQuery).not.toHaveBeenCalled();
	});

	it("updates the create action label when a different document group is active", () => {
		useDocumentsStore.setState({
			documents: [
				makeDocument({
					content: "# 太虚角色设定\n\n## 系统女声",
					title: "太虚角色设定",
				}),
				makeDocument({
					category: "scene",
					content: "# 场景设定\n\n## 雨夜小巷",
					id: "doc-scene",
					title: "场景设定",
				}),
			],
			assets: [],
		});

		const { container } = render(
			createElement(AgentMentionList, {
				command: () => {},
				items: createMentionItems(""),
				onCreateSection: vi.fn(),
			}),
		);
		const sceneSource = Array.from(container.querySelectorAll(".agent-mention-source")).find(
			(element) => element.textContent?.includes("场景设定"),
		);

		fireEvent.mouseEnter(sceneSource as Element);

		expect(container.querySelector(".agent-mention-create")?.textContent).toContain("新增场景");
	});

	it("does not render a create action for project assets", () => {
		useDocumentsStore.setState({
			documents: [],
			assets: [makeAsset()],
		});

		const { container } = render(
			createElement(AgentMentionList, {
				command: () => {},
				items: createMentionItems(""),
			}),
		);

		expect(container.querySelector(".agent-mention-create")).toBeNull();
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

describe("shouldKeepAgentMentionGroupActive", () => {
	it("keeps the group active for diagonal movement through the safe triangle", () => {
		expect(
			shouldKeepAgentMentionGroupActive({
				activeRect: { bottom: 124, left: 20, right: 220, top: 80 },
				origin: { x: 160, y: 112 },
				point: { x: 172, y: 136 },
				submenuRect: { bottom: 360, left: 240, right: 520, top: 40 },
			}),
		).toBe(true);
	});

	it("does not keep the group active for vertical movement inside the source column", () => {
		expect(
			shouldKeepAgentMentionGroupActive({
				activeRect: { bottom: 124, left: 20, right: 220, top: 80 },
				origin: { x: 188, y: 112 },
				point: { x: 188, y: 136 },
				submenuRect: { bottom: 360, left: 240, right: 520, top: 40 },
			}),
		).toBe(false);
	});
});

const sourceByText = (container: HTMLElement, text: string) =>
	Array.from(container.querySelectorAll(".agent-mention-source")).find((element) =>
		element.textContent?.includes(text),
	);

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
	toJSON: () => ({}),
	top,
	width: right - left,
	x: left,
	y: top,
});
