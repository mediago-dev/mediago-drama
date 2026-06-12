import { pointerWithin, rectIntersection, type CollisionDetection } from "@dnd-kit/core";
import { File, FileAudio, FileImage, FileText, FileVideo, Folder } from "lucide-react";
import { documentCategoryDescriptorMap } from "@/domains/documents/lib/categories";
import type {
	DocumentFolder,
	FolderMovePosition,
	MarkdownDocument,
} from "@/domains/documents/stores";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import type {
	DirectoryDragPreviewData,
	DirectoryDropData,
	DirectoryDropTarget,
	DirectoryFileEntry,
	DirectoryFolderNode,
	DirectoryTree,
	DragPayload,
} from "./types";
import { rootDropId } from "./types";

export const buildDirectoryTree = (
	folders: DocumentFolder[],
	documents: MarkdownDocument[],
	assets: ProjectAsset[],
): DirectoryTree => {
	const folderNodes = new Map<string, DirectoryFolderNode>();
	for (const folder of folders) {
		folderNodes.set(folder.id, { folder, folders: [], files: [] });
	}

	const tree: DirectoryTree = { folders: [], files: [] };
	for (const node of folderNodes.values()) {
		const parent = node.folder.parentId ? folderNodes.get(node.folder.parentId) : undefined;
		if (parent && parent.folder.id !== node.folder.id) {
			parent.folders.push(node);
		} else {
			tree.folders.push(node);
		}
	}

	const files = [...documents.map(documentEntry), ...assets.map(assetEntry)].sort(
		compareDirectoryFiles,
	);
	for (const file of files) {
		const folderNode = file.folderId ? folderNodes.get(file.folderId) : undefined;
		if (folderNode) {
			folderNode.files.push(file);
		} else {
			tree.files.push(file);
		}
	}

	const sortFolders = (nodes: DirectoryFolderNode[]) => {
		nodes.sort(compareDirectoryFolders);
		for (const node of nodes) {
			sortFolders(node.folders);
			node.files.sort(compareDirectoryFiles);
		}
	};
	sortFolders(tree.folders);
	tree.files.sort(compareDirectoryFiles);
	return tree;
};

const documentEntry = (document: MarkdownDocument): DirectoryFileEntry => ({
	kind: "document",
	id: document.id,
	title: document.title,
	folderId: document.folderId ?? null,
	sortOrder: document.sortOrder,
	updatedAt: document.updatedAt,
	category: document.category ?? "source-material",
	document,
});

const assetEntry = (asset: ProjectAsset): DirectoryFileEntry => ({
	kind: "asset",
	id: asset.id,
	title: asset.filename,
	folderId: asset.folderId ?? null,
	sortOrder: asset.sortOrder,
	updatedAt: asset.updatedAt,
	category: "source-material",
	asset,
});

const compareDirectoryFolders = (first: DirectoryFolderNode, second: DirectoryFolderNode) =>
	first.folder.sortOrder - second.folder.sortOrder ||
	first.folder.name.localeCompare(second.folder.name, "zh-CN");

const compareDirectoryFiles = (first: DirectoryFileEntry, second: DirectoryFileEntry) =>
	first.title.localeCompare(second.title, "zh-CN") ||
	first.kind.localeCompare(second.kind, "zh-CN") ||
	first.id.localeCompare(second.id, "zh-CN");

export const assetIcon = (kind: ProjectAsset["kind"]) => {
	switch (kind) {
		case "image":
			return FileImage;
		case "video":
			return FileVideo;
		case "audio":
			return FileAudio;
		case "text":
			return FileText;
		default:
			return File;
	}
};

export const directoryCollisionDetection: CollisionDetection = (args) => {
	const pointerCollisions = pointerWithin(args);
	const nestedPointerCollisions = pointerCollisions.filter(({ id }) => id !== rootDropId);
	if (nestedPointerCollisions.length > 0) {
		return prioritizeDirectoryCollisions(nestedPointerCollisions);
	}

	const rectangleCollisions = rectIntersection(args);
	const nestedRectangleCollisions = rectangleCollisions.filter(({ id }) => id !== rootDropId);
	if (nestedRectangleCollisions.length > 0) {
		return prioritizeDirectoryCollisions(nestedRectangleCollisions);
	}

	return pointerCollisions.length > 0 ? pointerCollisions : rectangleCollisions;
};

const prioritizeDirectoryCollisions = <T extends { id: unknown }>(collisions: T[]) => {
	const edgeCollisions = collisions.filter(({ id }) =>
		typeof id === "string" ? id.endsWith(":before") || id.endsWith(":after") : false,
	);
	return edgeCollisions.length > 0 ? edgeCollisions : collisions;
};

export const resolveDndDropTarget = (
	payload: DragPayload,
	dropData: DirectoryDropData | undefined,
	folders: DocumentFolder[],
): DirectoryDropTarget | null => {
	if (!dropData) return null;
	const target: DirectoryDropTarget = {
		folderId: dropData.folderId,
		position: payload.kind === "folder" ? dropData.position : "inside",
	};

	return canDropPayload(payload, target.folderId, target.position, folders) ? target : null;
};

export const previewForPayload = (
	payload: DragPayload,
	folders: DocumentFolder[],
	documents: MarkdownDocument[],
	assets: ProjectAsset[],
): DirectoryDragPreviewData | null => {
	if (payload.kind === "folder") {
		const folder = folders.find((item) => item.id === payload.id);
		if (!folder) return null;
		const childCount =
			folders.filter((item) => item.parentId === folder.id).length +
			documents.filter((item) => item.folderId === folder.id).length +
			assets.filter((item) => item.folderId === folder.id).length;
		return {
			detail: String(childCount),
			icon: Folder,
			kind: payload.kind,
			title: folder.name || "未命名文件夹",
		};
	}

	if (payload.kind === "asset") {
		const asset = assets.find((item) => item.id === payload.id);
		if (!asset) return null;
		const descriptor = documentCategoryDescriptorMap["source-material"];
		return {
			colorVar: descriptor.colorVar,
			icon: assetIcon(asset.kind),
			kind: payload.kind,
			title: asset.filename || "未命名文件",
		};
	}

	const document = documents.find((item) => item.id === payload.id);
	if (!document) return null;
	const descriptor =
		documentCategoryDescriptorMap[document.category ?? "source-material"] ??
		documentCategoryDescriptorMap["source-material"];
	return {
		colorVar: descriptor.colorVar,
		icon: descriptor.icon,
		kind: payload.kind,
		title: document.title || "未命名文档",
	};
};

const canDropPayload = (
	payload: DragPayload,
	targetFolderId: string | null,
	position: FolderMovePosition,
	folders: DocumentFolder[],
) => {
	if (payload.kind !== "folder") return position === "inside";
	if (!targetFolderId) return true;
	if (payload.id === targetFolderId) return false;

	const descendants = collectDirectoryFolderDescendantIds(folders, payload.id);
	return !descendants.has(targetFolderId);
};

const collectDirectoryFolderDescendantIds = (folders: DocumentFolder[], folderId: string) => {
	const collected = new Set<string>();
	const visit = (id: string) => {
		for (const folder of folders) {
			if (folder.parentId !== id || collected.has(folder.id)) continue;
			collected.add(folder.id);
			visit(folder.id);
		}
	};
	visit(folderId);
	return collected;
};
