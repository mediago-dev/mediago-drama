import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { normalizeSectionId, sectionIdAnchorNodeName } from "@/domains/documents/lib/sections";
import {
	selectedSectionImageAssetSource,
	type SelectedSectionImageAssetLike,
} from "@/domains/documents/lib/selected-section-images";

export type SelectedSectionImagePreviewAsset = SelectedSectionImageAssetLike;

interface SelectedSectionImagePreviewStorage {
	assets: SelectedSectionImagePreviewAsset[];
	documentId: string;
}

interface TopLevelNodeRange {
	from: number;
	index: number;
	node: ProseMirrorNode;
	to: number;
}

const selectedSectionImagePreviewPluginKey = new PluginKey("selectedSectionImagePreview");

export const SelectedSectionImagePreview = Extension.create({
	name: "selectedSectionImagePreview",

	addStorage() {
		return {
			assets: [],
			documentId: "",
		} satisfies SelectedSectionImagePreviewStorage;
	},

	addProseMirrorPlugins() {
		const editor = this.editor;

		return [
			new Plugin({
				key: selectedSectionImagePreviewPluginKey,
				props: {
					decorations(state) {
						const storage = selectedSectionImagePreviewStorage(editor);
						return selectedSectionImagePreviewDecorations(
							state.doc,
							storage.documentId,
							storage.assets,
						);
					},
				},
			}),
		];
	},
});

export const updateSelectedSectionImagePreviewAssets = (
	editor: Editor | null,
	documentId: string,
	assets: readonly SelectedSectionImagePreviewAsset[],
) => {
	if (!editor || editor.isDestroyed) return;

	const storage = selectedSectionImagePreviewStorage(editor);
	storage.documentId = documentId.trim();
	storage.assets = [...assets];
	editor.view.dispatch(editor.state.tr.setMeta(selectedSectionImagePreviewPluginKey, Date.now()));
};

const selectedSectionImagePreviewStorage = (editor: Editor) =>
	(editor.storage as unknown as Record<string, unknown>)
		.selectedSectionImagePreview as SelectedSectionImagePreviewStorage;

const selectedSectionImagePreviewDecorations = (
	doc: ProseMirrorNode,
	documentId: string,
	assets: readonly SelectedSectionImagePreviewAsset[],
) => {
	const normalizedDocumentId = documentId.trim();
	if (!normalizedDocumentId || assets.length === 0) return DecorationSet.empty;

	const assetsBySection = selectedAssetsBySection(normalizedDocumentId, assets);
	if (assetsBySection.size === 0) return DecorationSet.empty;

	const topLevelNodes = topLevelNodeRanges(doc);
	const decorations: Decoration[] = [];

	for (const range of topLevelNodes) {
		if (range.node.type.name !== "heading") continue;

		const sectionId = sectionIdForHeading(topLevelNodes, range.index);
		if (!sectionId) continue;

		const sectionAssets = assetsBySection.get(sectionId);
		if (!sectionAssets?.length) continue;

		const sectionEndIndex = findSectionEndIndex(topLevelNodes, range.index);
		const insertAfterRange = topLevelNodes[sectionEndIndex - 1] ?? range;
		decorations.push(
			Decoration.widget(
				insertAfterRange.to,
				() => createSelectedSectionImagesElement(sectionId, sectionAssets),
				{
					key: selectedSectionWidgetKey(sectionId, sectionAssets),
					side: 1,
				},
			),
		);
	}

	return DecorationSet.create(doc, decorations);
};

const selectedAssetsBySection = (
	documentId: string,
	assets: readonly SelectedSectionImagePreviewAsset[],
) => {
	const groups = new Map<string, SelectedSectionImagePreviewAsset[]>();
	const seenSourcesBySection = new Map<string, Set<string>>();

	for (const asset of assets) {
		if (asset.kind !== "image") continue;

		const sectionId = asset.resourceId?.trim();
		if (!sectionId) continue;

		const sourceDocumentId = asset.sourceDocumentId?.trim();
		if (sourceDocumentId && sourceDocumentId !== documentId) continue;

		const source = selectedSectionImageAssetSource(asset);
		if (!source) continue;

		const seenSources = seenSourcesBySection.get(sectionId) ?? new Set<string>();
		if (seenSources.has(source)) continue;

		seenSources.add(source);
		seenSourcesBySection.set(sectionId, seenSources);
		groups.set(sectionId, [...(groups.get(sectionId) ?? []), asset]);
	}

	return groups;
};

const topLevelNodeRanges = (doc: ProseMirrorNode): TopLevelNodeRange[] => {
	const ranges: TopLevelNodeRange[] = [];
	let from = 0;

	for (let index = 0; index < doc.childCount; index += 1) {
		const node = doc.child(index);
		const to = from + node.nodeSize;
		ranges.push({ from, index, node, to });
		from = to;
	}

	return ranges;
};

const sectionIdForHeading = (ranges: TopLevelNodeRange[], headingIndex: number) => {
	for (let index = headingIndex - 1; index >= 0; index -= 1) {
		const node = ranges[index]?.node;
		if (!node) return "";

		if (node.type.name === sectionIdAnchorNodeName) {
			return normalizeSectionId(node.attrs.sectionId) || "";
		}
		if (node.type.name === "paragraph" && !node.textContent.trim()) continue;
		return "";
	}

	return "";
};

const findSectionEndIndex = (ranges: TopLevelNodeRange[], headingIndex: number) => {
	const headingNode = ranges[headingIndex]?.node;
	const headingLevel = Number(headingNode?.attrs.level ?? 1);

	for (let index = headingIndex + 1; index < ranges.length; index += 1) {
		const node = ranges[index]?.node;
		if (node?.type.name !== "heading") continue;

		const level = Number(node.attrs.level ?? 1);
		if (level <= headingLevel) return index;
	}

	return ranges.length;
};

const createSelectedSectionImagesElement = (
	sectionId: string,
	assets: readonly SelectedSectionImagePreviewAsset[],
) => {
	const container = document.createElement("div");
	container.className = "tiptap-selected-section-images";
	container.contentEditable = "false";
	container.dataset.selectedSectionImages = sectionId;
	container.setAttribute("aria-label", "已选章节图片");

	for (const asset of assets) {
		const source = selectedSectionImageAssetSource(asset);
		if (!source) continue;

		const item = document.createElement("figure");
		item.className = "tiptap-selected-section-image";

		const image = document.createElement("img");
		image.alt = asset.title?.trim() || asset.resourceTitle?.trim() || "章节图片";
		image.decoding = "async";
		image.loading = "lazy";
		image.src = source;
		image.dataset.selectedSectionImage = asset.id;
		item.append(image);
		container.append(item);
	}

	return container;
};

const selectedSectionWidgetKey = (
	sectionId: string,
	assets: readonly SelectedSectionImagePreviewAsset[],
) =>
	[
		"selected-section-images",
		sectionId,
		...assets.map((asset) => `${asset.id}:${selectedSectionImageAssetSource(asset)}`),
	].join(":");
