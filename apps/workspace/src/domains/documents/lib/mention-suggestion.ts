import { createElement, forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { File, FileCode2, FileImage, FileVideo, Hash } from "lucide-react";
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
import { listDocumentSections } from "@/domains/documents/lib/sections";
import {
	type DocumentCategory,
	type MarkdownDocument,
	useDocumentsStore,
} from "@/domains/documents/stores";

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

export const fallbackMentionCategory: DocumentCategory = "source-material";

const maxMentionItems = 40;
const categoryOrder = new Map<DocumentCategory, number>(
	documentCategoryDescriptors.map((descriptor, index) => [descriptor.key, index]),
);
const fallbackMentionDescriptor = documentCategoryDescriptorMap[fallbackMentionCategory];

export const AgentMentionList = forwardRef<MentionListHandle, MentionListProps>(
	function AgentMentionList({ command, items }, ref) {
		const [selectedIndex, setSelectedIndex] = useState(0);

		useEffect(() => {
			setSelectedIndex(0);
		}, [items]);

		useImperativeHandle(
			ref,
			() => ({
				onKeyDown: ({ event }) => {
					if (items.length === 0) return false;

					if (event.key === "ArrowUp") {
						setSelectedIndex((index) => (index + items.length - 1) % items.length);
						return true;
					}

					if (event.key === "ArrowDown") {
						setSelectedIndex((index) => (index + 1) % items.length);
						return true;
					}

					if (event.key === "Enter") {
						command(items[selectedIndex] ?? items[0]);
						return true;
					}

					return false;
				},
			}),
			[command, items, selectedIndex],
		);

		if (items.length === 0) {
			return createElement("div", { className: "agent-mention-menu-empty" }, "无匹配引用");
		}

		let previousCategory: DocumentCategory | null = null;

		return createElement(
			"div",
			{ className: "agent-mention-menu", role: "listbox" },
			items.map((item, index) => {
				const showGroup = item.category !== previousCategory;
				previousCategory = item.category;
				const descriptor = mentionCategoryDescriptor(item.category);
				const Icon =
					item.kind === "section"
						? Hash
						: item.kind === "asset"
							? assetMentionIcon(item.assetKind)
							: descriptor.icon;

				return createElement(
					"div",
					{ key: item.id },
					showGroup
						? createElement("div", { className: "agent-mention-group" }, descriptor.label)
						: null,
					createElement(
						"button",
						{
							type: "button",
							className: "agent-mention-option",
							"data-category": item.category,
							"data-kind": item.kind,
							"data-selected": index === selectedIndex ? "true" : "false",
							role: "option",
							"aria-selected": index === selectedIndex,
							onMouseEnter: () => setSelectedIndex(index),
							onMouseDown: (event) => {
								event.preventDefault();
								command(item);
							},
						},
						createElement(Icon, { className: "agent-mention-option-icon" }),
						createElement(
							"span",
							{ className: "agent-mention-option-body" },
							createElement("span", { className: "agent-mention-option-title" }, item.title),
							createElement(
								"span",
								{ className: "agent-mention-option-meta" },
								mentionItemMeta(item),
							),
						),
					),
				);
			}),
		);
	},
);

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

				popup = tippy(document.body, {
					appendTo: () => document.body,
					content: component.element,
					getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
					hideOnClick: true,
					interactive: true,
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

export const createMentionItems = (query: string): AgentMentionItem[] => {
	const normalizedQuery = query.trim().toLowerCase();
	const documents = [...useDocumentsStore.getState().documents].sort(compareDocuments);
	const assets = [...useDocumentsStore.getState().assets].sort(compareAssets);
	const items: AgentMentionItem[] = [];

	for (const document of documents) {
		const category = normalizeMentionCategory(document.category);
		const docMatches = matchesMentionQuery(document.title, normalizedQuery);
		const sections = listDocumentSections(document);
		const matchingSections = sections.filter(
			(section) => docMatches || matchesMentionQuery(section.title, normalizedQuery),
		);

		if (docMatches) {
			items.push({
				category,
				documentId: document.id,
				documentTitle: document.title,
				id: document.id,
				kind: "document",
				label: document.title,
				title: document.title,
			});
		}

		for (const section of matchingSections) {
			items.push({
				blockId: section.blockId,
				category,
				documentId: document.id,
				documentTitle: document.title,
				id: `${document.id}:${section.blockId}`,
				kind: "section",
				label: section.title,
				level: section.level,
				title: section.title,
			});
		}

		if (items.length >= maxMentionItems) break;
	}

	for (const asset of assets) {
		if (items.length >= maxMentionItems) break;
		if (!matchesMentionQuery(asset.filename, normalizedQuery)) continue;

		items.push({
			assetId: asset.id,
			assetKind: asset.kind,
			category: fallbackMentionCategory,
			documentId: asset.id,
			documentTitle: asset.filename,
			id: `asset:${asset.id}`,
			kind: "asset",
			label: asset.filename,
			mimeType: asset.mimeType,
			title: asset.filename,
			url: asset.url,
		});
	}

	return items.slice(0, maxMentionItems);
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
