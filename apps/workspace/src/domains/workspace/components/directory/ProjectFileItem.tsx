import { useDraggable, useDroppable } from "@dnd-kit/core";
import { FolderOpen, Tags, Trash2 } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import type { WorkspaceProject } from "@/domains/projects/api/projects";
import {
	documentCategoryDescriptorMap,
	documentCategoryDescriptors,
} from "@/domains/documents/lib/categories";
import type { DocumentFolder, MarkdownDocument } from "@/domains/documents/stores";
import { useDocumentsStore } from "@/domains/documents/stores";
import type {
	ProjectAssetDeleteHandler,
	ProjectDocumentDeleteHandler,
} from "@/domains/workspace/components/ProjectDirectory";
import { useToast } from "@/hooks/useToast";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { cn } from "@/shared/lib/utils";
import {
	DirectoryItemMenu,
	type DirectoryItemMenuItem,
	type DirectoryItemMenuPosition,
} from "./DirectoryItemMenu";
import {
	canShowInFileManager,
	describeFileManagerError,
	revealDirectoryFileInFileManager,
} from "./file-manager";
import { assetIcon } from "./helpers";
import type { DirectoryDropData, DirectoryFileEntry, DragPayload } from "./types";
import { fileDropId, itemDragId } from "./types";

export const ProjectFileItem: React.FC<{
	activeAssetId: string;
	activeDocumentId: string;
	canMutate: boolean;
	depth: number;
	documents: MarkdownDocument[];
	entry: DirectoryFileEntry;
	folders: DocumentFolder[];
	locationPathname: string;
	onDeleteAsset: ProjectAssetDeleteHandler;
	onDeleteDocument: ProjectDocumentDeleteHandler;
	onOpenAsset: (project: WorkspaceProject, assetId: string) => void;
	onOpenDocument: (project: WorkspaceProject, documentId: string) => void;
	project: WorkspaceProject;
	showActiveSelection: boolean;
	workspaceDir: string;
}> = ({
	activeAssetId,
	activeDocumentId,
	canMutate,
	depth,
	documents,
	entry,
	folders,
	locationPathname,
	onDeleteAsset,
	onDeleteDocument,
	onOpenAsset,
	onOpenDocument,
	project,
	showActiveSelection,
	workspaceDir,
}) => {
	const [menuPosition, setMenuPosition] = useState<DirectoryItemMenuPosition | null>(null);
	const setDocumentCategory = useDocumentsStore((state) => state.setDocumentCategory);
	const toast = useToast();
	const isAsset = entry.kind === "asset";
	const isAgentProjectRoute = locationPathname === "/agent";
	const isDocumentActive =
		entry.kind === "document" && isAgentProjectRoute && entry.id === activeDocumentId;
	const isAssetActive = entry.kind === "asset" && isAgentProjectRoute && entry.id === activeAssetId;
	const isActive = showActiveSelection && (isDocumentActive || isAssetActive);
	const itemTitle = entry.title || (isAsset ? "未命名文件" : "未命名文档");
	const descriptor =
		documentCategoryDescriptorMap[entry.category] ??
		documentCategoryDescriptorMap["source-material"];
	const EntryIcon = entry.kind === "asset" ? assetIcon(entry.asset.kind) : descriptor.icon;
	const canRevealInFileManager = canShowInFileManager(workspaceDir);
	const canOpenContextMenu = canMutate || canRevealInFileManager;
	const dragPayload: DragPayload = { kind: entry.kind, id: entry.id };
	const {
		attributes: dragAttributes,
		isDragging,
		listeners: dragListeners,
		setNodeRef: setDragNodeRef,
	} = useDraggable({
		id: itemDragId(dragPayload),
		data: { payload: dragPayload },
		disabled: !canMutate,
	});
	const { setNodeRef: setDropNodeRef } = useDroppable({
		id: fileDropId(entry.kind, entry.id),
		data: {
			dropTarget: { folderId: entry.folderId, position: "inside" } satisfies DirectoryDropData,
		},
		disabled: !canMutate,
	});

	const closeMenu = useCallback(() => setMenuPosition(null), []);

	const openMenuAt = useCallback(
		(position: DirectoryItemMenuPosition) => {
			if (!canOpenContextMenu) return;
			setMenuPosition(position);
		},
		[canOpenContextMenu],
	);

	const openMenuFromContext = (event: React.MouseEvent<HTMLDivElement>) => {
		if (!canOpenContextMenu) return;
		event.preventDefault();
		openMenuAt({ x: event.clientX, y: event.clientY });
	};

	const showInFileManager = () => {
		void revealDirectoryFileInFileManager({ documents, entry, folders, workspaceDir }).catch(
			(error: unknown) =>
				toast.error("无法在文件管理器中展示", {
					description: describeFileManagerError(error),
				}),
		);
	};

	const deletedIds = entry.kind === "document" ? [entry.document.id] : [];
	const menuItems = [
		...(canRevealInFileManager
			? [
					{
						icon: FolderOpen,
						label: "在文件管理器中展示",
						onSelect: showInFileManager,
					} satisfies DirectoryItemMenuItem,
				]
			: []),
		...(canMutate && entry.kind === "document"
			? [
					{
						icon: Tags,
						label: "变更类型",
						onSelect: () => undefined,
						children: documentCategoryDescriptors
							.filter((categoryDescriptor) => categoryDescriptor.key !== "source-material")
							.map((categoryDescriptor) => ({
								icon: categoryDescriptor.icon,
								iconStyle: { color: `var(${categoryDescriptor.colorVar})` },
								label: categoryDescriptor.label,
								onSelect: () => setDocumentCategory(entry.id, categoryDescriptor.key),
							})),
					} satisfies DirectoryItemMenuItem,
				]
			: []),
		...(canMutate
			? [
					{
						icon: Trash2,
						label: "删除",
						onSelect: () =>
							void confirmDialog({
								title: isAsset ? "删除素材？" : "删除文档？",
								description: `确定要删除“${itemTitle}”吗？此操作无法撤销。`,
								confirmLabel: "删除",
								onConfirm: () => {
									if (entry.kind === "asset") {
										onDeleteAsset(project, entry.id, entry.asset.filename);
										return;
									}
									onDeleteDocument(project, entry.document, deletedIds);
								},
							}),
						variant: "danger",
					} satisfies DirectoryItemMenuItem,
				]
			: []),
	];

	return (
		<div className="relative">
			<div
				ref={setDropNodeRef}
				className={cn(
					"group/file flex h-7 w-full items-center gap-1.5 rounded-sm pr-1 text-left text-xs transition-colors",
					isActive
						? "bg-ide-list-active text-ide-list-active-foreground"
						: "text-muted-foreground hover:bg-ide-list-hover hover:text-foreground focus-within:bg-ide-list-hover focus-within:text-foreground",
				)}
				style={{ paddingLeft: `${depth * 12 + 14}px` }}
				onContextMenu={openMenuFromContext}
			>
				<button
					ref={setDragNodeRef}
					type="button"
					onClick={() =>
						entry.kind === "asset"
							? onOpenAsset(project, entry.id)
							: onOpenDocument(project, entry.id)
					}
					className={cn(
						"flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left",
						canMutate && "touch-none select-none",
						isDragging && "opacity-40",
					)}
					title={canMutate ? "拖拽移动" : undefined}
					{...dragListeners}
					{...dragAttributes}
				>
					<EntryIcon
						className="size-3.5 shrink-0"
						style={{ color: `var(${descriptor.colorVar})` }}
					/>
					<span className="min-w-0 flex-1 truncate">{itemTitle}</span>
				</button>
				{entry.kind === "document" && entry.document.isDirty ? (
					<span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="未保存更改" />
				) : null}
			</div>
			{menuPosition ? (
				<DirectoryItemMenu
					ariaLabel={`${itemTitle} 操作`}
					items={menuItems}
					onClose={closeMenu}
					position={menuPosition}
				/>
			) : null}
		</div>
	);
};
