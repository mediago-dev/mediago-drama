import {
	createElement,
	forwardRef,
	useEffect,
	useImperativeHandle,
	useMemo,
	useState,
} from "react";
import {
	ChevronRight,
	File,
	FileCode2,
	FileImage,
	FileVideo,
	Hash,
	type LucideIcon,
} from "lucide-react";
import { ReactRenderer } from "@tiptap/react";
import type {
	SuggestionKeyDownProps,
	SuggestionOptions,
	SuggestionProps,
} from "@tiptap/suggestion";
import tippy, { type Instance, type Props as TippyProps } from "tippy.js";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { AgentReference } from "@/domains/agent/api/agent";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import {
	documentCategoryDescriptorMap,
	documentCategoryDescriptors,
} from "@/domains/documents/lib/categories";
import {
	createSectionBlockId,
	findMarkdownSectionEndLine,
	listDocumentSections,
	normalizeHeadingText,
	sectionIdBeforeHeadingLine,
} from "@/domains/documents/lib/sections";
import {
	type DocumentCategory,
	legacySourceMaterialDocumentCategory,
	type MarkdownDocument,
	referenceDocumentCategory,
	useDocumentsStore,
} from "@/domains/documents/stores";
import { apiResourceURL } from "@/shared/lib/api-base";

export interface AgentMentionItem {
	assetId?: string;
	assetKind?: ProjectAsset["kind"];
	blockId?: string;
	category: DocumentCategory;
	documentId: string;
	documentTitle: string;
	id: string;
	mimeType?: string;
	kind: AgentReference["kind"];
	label: string;
	level?: number;
	previewUrl?: string;
	title: string;
	url?: string;
}

interface MentionListHandle {
	onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

interface MentionListProps {
	command: (item: AgentMentionItem) => void;
	items: AgentMentionItem[];
}

interface AgentMentionGroup {
	category: DocumentCategory;
	icon: LucideIcon;
	id: string;
	items: AgentMentionItem[];
	label: string;
	meta: string;
}

export const fallbackMentionCategory: DocumentCategory = "reference";

const maxMentionItems = 100;
const maxDocumentMentionItems = 72;
const maxAssetMentionItems = 28;
const categoryOrder = new Map<DocumentCategory, number>(
	documentCategoryDescriptors.map((descriptor, index) => [descriptor.key, index]),
);
const fallbackMentionDescriptor = documentCategoryDescriptorMap[fallbackMentionCategory];

export const AgentMentionList = forwardRef<MentionListHandle, MentionListProps>(
	function AgentMentionList({ command, items }, ref) {
		const groups = useMemo(() => createMentionGroups(items), [items]);
		const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);
		const [selectedItemIndex, setSelectedItemIndex] = useState(0);
		const activeGroup = groups[selectedGroupIndex] ?? groups[0];
		const activeItems = activeGroup?.items ?? [];

		useEffect(() => {
			setSelectedGroupIndex(0);
			setSelectedItemIndex(0);
		}, [items]);

		useImperativeHandle(
			ref,
			() => ({
				onKeyDown: ({ event }) => {
					if (groups.length === 0 || activeItems.length === 0) return false;

					if (event.key === "ArrowUp") {
						setSelectedItemIndex((index) => (index + activeItems.length - 1) % activeItems.length);
						return true;
					}

					if (event.key === "ArrowDown") {
						setSelectedItemIndex((index) => (index + 1) % activeItems.length);
						return true;
					}

					if (event.key === "ArrowLeft") {
						setSelectedGroupIndex((index) => {
							const nextIndex = (index + groups.length - 1) % groups.length;
							return nextIndex;
						});
						setSelectedItemIndex(0);
						return true;
					}

					if (event.key === "ArrowRight") {
						setSelectedGroupIndex((index) => (index + 1) % groups.length);
						setSelectedItemIndex(0);
						return true;
					}

					if (event.key === "Enter") {
						command(activeItems[selectedItemIndex] ?? activeItems[0]);
						return true;
					}

					return false;
				},
			}),
			[activeItems, command, groups.length, selectedItemIndex],
		);

		if (items.length === 0) {
			return createElement("div", { className: "agent-mention-menu-empty" }, "无匹配引用");
		}

		let previousSourceCategory: DocumentCategory | null = null;

		return createElement(
			"div",
			{ className: "agent-mention-cascader" },
			createElement(
				"div",
				{ className: "agent-mention-menu agent-mention-cascader-primary" },
				createElement("div", { className: "agent-mention-pane-label" }, "文档"),
				groups.map((group, index) => {
					const showCategory = group.category !== previousSourceCategory;
					previousSourceCategory = group.category;

					return createElement(
						"div",
						{ key: group.id },
						showCategory
							? createElement(
									"div",
									{ className: "agent-mention-source-group" },
									mentionCategoryDescriptor(group.category).label,
								)
							: null,
						createElement(
							"button",
							{
								type: "button",
								className: "agent-mention-source",
								"data-category": group.category,
								"data-selected": index === selectedGroupIndex ? "true" : "false",
								onMouseEnter: () => {
									setSelectedGroupIndex(index);
									setSelectedItemIndex(0);
								},
								onMouseDown: (event) => {
									event.preventDefault();
								},
							},
							createElement(group.icon, { className: "agent-mention-source-icon" }),
							createElement(
								"span",
								{ className: "agent-mention-source-body" },
								createElement("span", { className: "agent-mention-source-title" }, group.label),
								createElement("span", { className: "agent-mention-source-meta" }, group.meta),
							),
							createElement(ChevronRight, { className: "agent-mention-source-chevron" }),
						),
					);
				}),
			),
			createElement(
				"div",
				{ className: "agent-mention-menu agent-mention-cascader-secondary", role: "listbox" },
				createElement("div", { className: "agent-mention-pane-label" }, "文档与节点"),
				activeItems.map((item, index) =>
					renderMentionOption(item, index, selectedItemIndex, {
						command,
						setSelectedItemIndex,
					}),
				),
			),
		);
	},
);

const renderMentionOption = (
	item: AgentMentionItem,
	index: number,
	selectedItemIndex: number,
	actions: {
		command: (item: AgentMentionItem) => void;
		setSelectedItemIndex: (index: number) => void;
	},
) => {
	const descriptor = mentionCategoryDescriptor(item.category);
	const Icon =
		item.kind === "document"
			? File
			: item.kind === "section"
				? Hash
				: item.kind === "asset"
					? assetMentionIcon(item.assetKind)
					: descriptor.icon;
	const selected = index === selectedItemIndex;
	const previewUrl = item.kind === "document" ? undefined : item.previewUrl;

	return createElement(
		"button",
		{
			key: item.id,
			type: "button",
			className: "agent-mention-option",
			"data-category": item.category,
			"data-has-preview": previewUrl ? "true" : "false",
			"data-kind": item.kind,
			"data-selected": selected ? "true" : "false",
			role: "option",
			"aria-selected": selected,
			onMouseEnter: () => actions.setSelectedItemIndex(index),
			onMouseDown: (event) => {
				event.preventDefault();
				actions.command(item);
			},
		},
		createElement(Icon, { className: "agent-mention-option-icon" }),
		createElement(
			"span",
			{ className: "agent-mention-option-body" },
			createElement("span", { className: "agent-mention-option-title" }, item.title),
			createElement("span", { className: "agent-mention-option-meta" }, mentionItemMeta(item)),
		),
		previewUrl
			? createElement("img", {
					alt: "",
					className: "agent-mention-option-preview",
					src: apiResourceURL(previewUrl),
				})
			: null,
	);
};

const createMentionGroups = (items: AgentMentionItem[]): AgentMentionGroup[] => {
	const groups: AgentMentionGroup[] = [];
	const groupById = new Map<string, AgentMentionGroup>();

	for (const item of items) {
		const id = item.kind === "asset" ? "asset:project-assets" : `document:${item.documentId}`;
		let group = groupById.get(id);

		if (!group) {
			const descriptor = mentionCategoryDescriptor(item.category);
			group = {
				category: item.category,
				icon: item.kind === "asset" ? FileImage : descriptor.icon,
				id,
				items: [],
				label: item.kind === "asset" ? "项目素材" : item.documentTitle,
				meta: item.kind === "asset" ? "素材" : descriptor.label,
			};
			groupById.set(id, group);
			groups.push(group);
		}

		group.items.push(item);
	}

	return groups;
};

export function createMentionSuggestion(): Omit<
	SuggestionOptions<AgentMentionItem, AgentMentionItem>,
	"editor"
> {
	let component: ReactRenderer<MentionListHandle, MentionListProps> | null = null;
	let popup: Instance<TippyProps> | null = null;

	const listProps = (props: SuggestionProps<AgentMentionItem, AgentMentionItem>) => ({
		command: props.command,
		items: props.items,
	});

	return {
		allowSpaces: true,
		allowedPrefixes: null,
		char: "@",
		items: ({ query }) => createMentionItems(query),
		render: () => ({
			onStart: (props) => {
				component = new ReactRenderer(AgentMentionList, {
					editor: props.editor,
					props: listProps(props),
				});

				const appendTarget = mentionPopupAppendTarget(props.editor.view.dom);

				popup = tippy(document.body, {
					appendTo: () => appendTarget,
					content: component.element,
					getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
					hideOnClick: true,
					interactive: true,
					maxWidth: "none",
					placement: "bottom-start",
					showOnCreate: true,
					trigger: "manual",
					zIndex: 60,
				});
			},
			onUpdate: (props) => {
				component?.updateProps(listProps(props));
				popup?.setProps({
					getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
				});
			},
			onKeyDown: (props) => {
				if (props.event.key === "Escape") {
					popup?.hide();
					return true;
				}

				return component?.ref?.onKeyDown(props) ?? false;
			},
			onExit: () => {
				popup?.destroy();
				component?.destroy();
				popup = null;
				component = null;
			},
		}),
	};
}

export const mentionPopupAppendTarget = (editorElement: Element | null): HTMLElement => {
	const ownerDocument = editorElement?.ownerDocument ?? document;
	const popupRoot = editorElement?.closest<HTMLElement>(
		"[data-agent-mention-popup-root], [role='dialog']",
	);

	return popupRoot ?? ownerDocument.body;
};

export const createMentionItems = (query: string): AgentMentionItem[] => {
	const normalizedQuery = query.trim().toLowerCase();
	const documents = [...useDocumentsStore.getState().documents].sort(compareDocuments);
	const assets = [...useDocumentsStore.getState().assets].sort(compareAssets);
	const documentItems: AgentMentionItem[] = [];
	const assetItems: AgentMentionItem[] = [];

	for (const document of documents) {
		if (documentItems.length >= maxDocumentMentionItems) break;

		const category = normalizeMentionCategory(document.category);
		const docMatches = matchesMentionQuery(document.title, normalizedQuery);
		const sections = mentionSectionsForDocument(document);
		const sectionPreviewUrls = sectionPreviewUrlMap(document);
		const matchingSections = sections.filter(
			(section) => docMatches || matchesMentionQuery(section.title, normalizedQuery),
		);

		if (docMatches || matchingSections.length > 0) {
			documentItems.push(documentMentionItem(document, category));
		}

		for (const section of matchingSections) {
			if (documentItems.length >= maxDocumentMentionItems) break;

			documentItems.push({
				blockId: section.blockId,
				category,
				documentId: document.id,
				documentTitle: document.title,
				id: `${document.id}:${section.blockId}`,
				kind: "section",
				label: section.title,
				level: section.level,
				previewUrl: sectionPreviewUrls.get(section.blockId),
				title: section.title,
			});
		}
	}

	for (const asset of assets) {
		if (assetItems.length >= maxAssetMentionItems) break;
		if (!matchesMentionQuery(asset.filename, normalizedQuery)) continue;

		assetItems.push({
			assetId: asset.id,
			assetKind: asset.kind,
			category: fallbackMentionCategory,
			documentId: asset.id,
			documentTitle: asset.filename,
			id: `asset:${asset.id}`,
			kind: "asset",
			label: asset.filename,
			mimeType: asset.mimeType,
			previewUrl: asset.kind === "image" ? asset.url : undefined,
			title: asset.filename,
			url: asset.url,
		});
	}

	return [...documentItems, ...assetItems].slice(0, maxMentionItems);
};

const documentMentionItem = (
	document: MarkdownDocument,
	category: DocumentCategory,
): AgentMentionItem => ({
	category,
	documentId: document.id,
	documentTitle: document.title,
	id: document.id,
	kind: "document",
	label: document.title,
	title: document.title,
});

const mentionSectionsForDocument = (document: MarkdownDocument) => {
	const sections = listDocumentSections(document);
	if (sections.length <= 1) return sections;

	const [firstSection, ...restSections] = sections;
	if (
		firstSection?.level === 1 &&
		normalizeHeadingText(firstSection.title) === normalizeHeadingText(document.title)
	) {
		return restSections;
	}

	return sections;
};

export const compareDocuments = (a: MarkdownDocument, b: MarkdownDocument) => {
	const categoryDiff =
		(categoryOrder.get(normalizeMentionCategory(a.category)) ?? 0) -
		(categoryOrder.get(normalizeMentionCategory(b.category)) ?? 0);
	if (categoryDiff !== 0) return categoryDiff;

	return a.title.localeCompare(b.title, "zh-Hans-CN") || a.id.localeCompare(b.id, "zh-Hans-CN");
};

export const mentionItemMeta = (item: AgentMentionItem) => {
	if (item.kind === "asset") return `素材 · ${assetKindLabel(item.assetKind)}`;
	if (item.kind === "document") return mentionCategoryDescriptor(item.category).label;

	return `${item.documentTitle} · H${item.level ?? 1}`;
};

export const referenceFromMentionNode = (node: ProseMirrorNode): AgentReference | null => {
	const kind =
		node.attrs.kind === "section" ? "section" : node.attrs.kind === "asset" ? "asset" : "document";
	const documentId = stringAttribute(node.attrs.documentId);
	const title = stringAttribute(node.attrs.title) || stringAttribute(node.attrs.label);
	if (!documentId || !title) return null;

	if (kind === "asset") {
		const assetId = stringAttribute(node.attrs.assetId) || documentId;
		return {
			kind,
			documentId: assetId,
			assetId,
			assetKind: stringAttribute(node.attrs.assetKind),
			mimeType: stringAttribute(node.attrs.mimeType),
			title,
			category: fallbackMentionCategory,
			url: stringAttribute(node.attrs.url),
		};
	}

	const blockId = kind === "section" ? stringAttribute(node.attrs.blockId) : undefined;
	const category = documentCategory(node.attrs.category);

	return {
		kind,
		documentId,
		...(blockId ? { blockId } : {}),
		title,
		...(category ? { category } : {}),
	};
};

export const documentCategory = (value: unknown): DocumentCategory | undefined => {
	if (typeof value !== "string") return undefined;
	if (value === legacySourceMaterialDocumentCategory) return referenceDocumentCategory;
	return documentCategoryDescriptors.some((descriptor) => descriptor.key === value)
		? (value as DocumentCategory)
		: undefined;
};

export const mentionDisplayText = (value: unknown) => `@${String(value ?? "").trim()}`;

export const renderDataAttribute = (name: string, value: unknown) => {
	const text = stringAttribute(value);
	return text ? { [name]: text } : {};
};

export const stringAttribute = (value: unknown) => (typeof value === "string" ? value : "");

const sectionPreviewUrlMap = (document: MarkdownDocument) => {
	const previews = new Map<string, string>();
	const lines = document.content.split(/\r?\n/);
	const occurrenceByHeading = new Map<string, number>();
	const seenSectionIds = new Set<string>();

	for (let index = 0; index < lines.length; index += 1) {
		const match = /^(#{1,3})\s+(.+)$/.exec(lines[index]);
		if (!match) continue;

		const level = match[1].length;
		const title = normalizeHeadingText(match[2]);
		if (!title) continue;

		const key = `${level}|${title}`;
		const occurrence = (occurrenceByHeading.get(key) ?? 0) + 1;
		occurrenceByHeading.set(key, occurrence);

		const sectionId = sectionIdBeforeHeadingLine(lines, index);
		const blockId =
			sectionId && !seenSectionIds.has(sectionId)
				? sectionId
				: createSectionBlockId(document.id, level, occurrence, title);
		if (sectionId && !seenSectionIds.has(sectionId)) {
			seenSectionIds.add(sectionId);
		}

		const sectionEnd = findMarkdownSectionEndLine(lines, index, level);
		const previewUrl = firstImageSourceFromMarkdown(lines.slice(index + 1, sectionEnd).join("\n"));
		if (previewUrl) previews.set(blockId, previewUrl);
	}

	return previews;
};

const firstImageSourceFromMarkdown = (markdown: string) => {
	for (const line of markdown.split(/\r?\n/)) {
		const image = markdownImageFromLine(line.trim());
		if (!image || isPlaceholderImage(image)) continue;

		return image.source;
	}

	return undefined;
};

const markdownImageFromLine = (line: string) => {
	const match = /^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)$/.exec(line);
	if (!match) return null;

	return {
		alt: match[1] ?? "",
		source: match[2] ?? match[3] ?? "",
	};
};

const isPlaceholderImage = (image: { alt: string; source: string }) =>
	["mediago-drama-section-image-pending:", "media-cli-section-image-pending:"].some((prefix) =>
		image.alt.startsWith(prefix),
	) ||
	Boolean(image.source.startsWith("mediago-drama-section-image-pending:")) ||
	Boolean(image.source.startsWith("media-cli-section-image-pending:")) ||
	(image.alt === "正在生成图片" && image.source.startsWith("data:image/svg+xml;base64,"));

const normalizeMentionCategory = (category: MarkdownDocument["category"]): DocumentCategory =>
	documentCategory(category) ?? fallbackMentionCategory;

const mentionCategoryDescriptor = (category: DocumentCategory) =>
	documentCategoryDescriptorMap[category] ?? fallbackMentionDescriptor;

const matchesMentionQuery = (value: string, normalizedQuery: string) =>
	normalizedQuery === "" || value.toLowerCase().includes(normalizedQuery);

const compareAssets = (a: ProjectAsset, b: ProjectAsset) => {
	const sortDiff = a.sortOrder - b.sortOrder;
	if (sortDiff !== 0) return sortDiff;
	return a.filename.localeCompare(b.filename, "zh-Hans-CN");
};

const assetMentionIcon = (kind?: ProjectAsset["kind"]) => {
	switch (kind) {
		case "image":
			return FileImage;
		case "video":
			return FileVideo;
		case "text":
			return FileCode2;
		default:
			return File;
	}
};

const assetKindLabel = (kind?: ProjectAsset["kind"]) => {
	switch (kind) {
		case "image":
			return "图片";
		case "video":
			return "视频";
		case "audio":
			return "音频";
		case "text":
			return "文本";
		default:
			return "文件";
	}
};
