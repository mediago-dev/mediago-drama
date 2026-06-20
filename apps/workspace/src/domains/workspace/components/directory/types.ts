import type { LucideIcon } from "lucide-react";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import type {
	DocumentCategory,
	DocumentFolder,
	FolderMovePosition,
	MarkdownDocument,
} from "@/domains/documents/stores";

export type DirectoryFileEntry =
	| {
			kind: "document";
			id: string;
			title: string;
			folderId: string | null;
			sortOrder: number;
			updatedAt: string;
			category: DocumentCategory;
			document: MarkdownDocument;
	  }
	| {
			kind: "asset";
			id: string;
			title: string;
			folderId: string | null;
			sortOrder: number;
			updatedAt: string;
			category: "reference";
			asset: ProjectAsset;
	  };

export interface DirectoryFolderNode {
	folder: DocumentFolder;
	folders: DirectoryFolderNode[];
	files: DirectoryFileEntry[];
}

export interface DirectoryTree {
	folders: DirectoryFolderNode[];
	files: DirectoryFileEntry[];
}

export interface DragPayload {
	kind: "document" | "asset" | "folder";
	id: string;
}

export interface DirectoryDropTarget {
	folderId: string | null;
	position: FolderMovePosition;
}

export interface DirectoryDropData {
	folderId: string | null;
	position: FolderMovePosition;
}

export interface DirectoryDragPreviewData {
	colorVar?: string;
	detail?: string;
	icon: LucideIcon;
	kind: DragPayload["kind"];
	title: string;
}

export const rootDropId = "directory-root";
export const rootTailDropId = "directory-root:tail";

export const itemDragId = (payload: DragPayload) => `directory-item:${payload.kind}:${payload.id}`;

export const fileDropId = (kind: DirectoryFileEntry["kind"], id: string) =>
	`directory-file:${kind}:${id}`;

export const folderDropId = (folderId: string, position: FolderMovePosition) =>
	`directory-folder:${folderId}:${position}`;
