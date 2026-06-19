import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
	ChevronDown,
	ChevronRight,
	Folder,
	FolderOpen,
	FolderPlus,
	Pencil,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import type { WorkspaceProject } from "@/domains/projects/api/projects";
import type { DocumentFolder, MarkdownDocument } from "@/domains/documents/stores";
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
import { FolderDropZones } from "./DropZones";
import {
	canShowInFileManager,
	describeFileManagerError,
	revealDirectoryFolderInFileManager,
} from "./file-manager";
import { FolderNameEditor } from "./FolderNameEditor";
import { ProjectFileItem } from "./ProjectFileItem";
import type {
	DirectoryDropData,
	DirectoryDropTarget,
	DirectoryFolderNode,
	DragPayload,
} from "./types";
import { folderDropId, itemDragId } from "./types";

export const ProjectFolderItem: React.FC<{
	activeAssetId: string;
	activeDocumentId: string;
	canMutate: boolean;
	collapsedFolders: Record<string, boolean>;
	creatingFolderParentId: string | null | undefined;
	depth: number;
	documents: MarkdownDocument[];
	dropTarget: DirectoryDropTarget | null;
	folders: DocumentFolder[];
	locationPathname: string;
	node: DirectoryFolderNode;
	onCancelCreateFolder: () => void;
	onCommitCreateFolder: (name: string, parentId: string | null) => void;
	onCreateFolder: (parentId: string | null) => void;
	onDeleteAsset: ProjectAssetDeleteHandler;
	onDeleteDocument: ProjectDocumentDeleteHandler;
	onDeleteFolder: (folderId: string) => void;
	onOpenAsset: (project: WorkspaceProject, assetId: string) => void;
	onOpenDocument: (project: WorkspaceProject, documentId: string) => void;
	onRenameFolder: (folderId: string, name: string) => void;
	onToggleFolder: (folderId: string) => void;
	project: WorkspaceProject;
	showActiveSelection: boolean;
	workspaceDir: string;
}> = ({
	activeAssetId,
	activeDocumentId,
	canMutate,
	collapsedFolders,
	creatingFolderParentId,
	depth,
	documents,
	dropTarget,
	folders: allFolders,
	locationPathname,
	node,
	onCancelCreateFolder,
	onCommitCreateFolder,
	onCreateFolder,
	onDeleteAsset,
	onDeleteDocument,
	onDeleteFolder,
	onOpenAsset,
	onOpenDocument,
	onRenameFolder,
	onToggleFolder,
	project,
	showActiveSelection,
	workspaceDir,
}) => {
	const { folder, folders: childFolders, files } = node;
	const [menuPosition, setMenuPosition] = useState<DirectoryItemMenuPosition | null>(null);
	const [isRenaming, setIsRenaming] = useState(false);
	const toast = useToast();
	const isCollapsed = Boolean(collapsedFolders[folder.id]);
	const ToggleIcon = isCollapsed ? ChevronRight : ChevronDown;
	const FolderIcon = isCollapsed ? Folder : FolderOpen;
	const activeDropPosition = dropTarget?.folderId === folder.id ? dropTarget.position : null;
	const canRevealInFileManager = canShowInFileManager(workspaceDir);
	const canOpenContextMenu = canMutate || canRevealInFileManager;
	const dragPayload: DragPayload = { kind: "folder", id: folder.id };
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
	const { setNodeRef: setInsideDropNodeRef } = useDroppable({
		id: folderDropId(folder.id, "inside"),
		data: {
			dropTarget: { folderId: folder.id, position: "inside" } satisfies DirectoryDropData,
		},
		disabled: !canMutate,
	});

	const closeMenu = useCallback(() => setMenuPosition(null), []);

	const startRename = () => {
		setIsRenaming(true);
	};

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

	const commitRename = (name: string) => {
		setIsRenaming(false);
		const trimmedName = name.trim();
		if (!trimmedName || trimmedName === folder.name) return;
		onRenameFolder(folder.id, trimmedName);
	};

	const showInFileManager = () => {
		void revealDirectoryFolderInFileManager({ folder, folders: allFolders, workspaceDir }).catch(
			(error: unknown) =>
				toast.error("无法在文件管理器中展示", {
					description: describeFileManagerError(error),
				}),
		);
	};

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
		...(canMutate
			? [
					{
						icon: FolderPlus,
						label: "新建子文件夹",
						onSelect: () => onCreateFolder(folder.id),
					} satisfies DirectoryItemMenuItem,
					{
						icon: Pencil,
						label: "重命名",
						onSelect: startRename,
					} satisfies DirectoryItemMenuItem,
					{
						icon: Trash2,
						label: "删除",
						onSelect: () =>
							void confirmDialog({
								title: "删除文件夹？",
								description: `确定要删除“${folder.name}”吗？其中的文件和子文件夹会上移到上一级。`,
								confirmLabel: "删除",
								onConfirm: () => onDeleteFolder(folder.id),
							}),
						variant: "danger",
					} satisfies DirectoryItemMenuItem,
				]
			: []),
	];

	return (
		<div className="relative">
			{isRenaming ? (
				<FolderNameEditor
					defaultValue={folder.name || "未命名文件夹"}
					depth={depth}
					onCancel={() => setIsRenaming(false)}
					onCommit={commitRename}
					showDisclosureSpacer
				/>
			) : (
				<div
					ref={setInsideDropNodeRef}
					className={cn(
						"group/folder relative flex h-7 w-full items-center gap-1.5 rounded-sm border border-transparent pr-1 text-left text-xs text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground focus-within:bg-ide-list-hover focus-within:text-foreground",
						activeDropPosition === "inside" && "border-primary bg-ide-list-hover",
					)}
					style={{ paddingLeft: `${depth * 12 + 8}px` }}
					onContextMenu={openMenuFromContext}
				>
					{activeDropPosition === "before" ? (
						<span
							className="pointer-events-none absolute top-0 h-px bg-primary"
							style={{ left: `${depth * 12 + 8}px`, right: 0 }}
						/>
					) : null}
					{activeDropPosition === "after" ? (
						<span
							className="pointer-events-none absolute bottom-0 h-px bg-primary"
							style={{ left: `${depth * 12 + 8}px`, right: 0 }}
						/>
					) : null}
					{canMutate ? <FolderDropZones folderId={folder.id} /> : null}
					<button
						ref={setDragNodeRef}
						type="button"
						onClick={() => onToggleFolder(folder.id)}
						className={cn(
							"flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left",
							canMutate && "touch-none select-none",
							isDragging && "opacity-40",
						)}
						title={canMutate ? "拖拽移动文件夹" : undefined}
						aria-label={isCollapsed ? "展开文件夹" : "折叠文件夹"}
						{...dragListeners}
						{...dragAttributes}
					>
						<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
							<ToggleIcon className="size-3" />
						</span>
						<FolderIcon className="size-3.5 shrink-0" />
						<span className="min-w-0 flex-1 truncate">{folder.name || "未命名文件夹"}</span>
					</button>
				</div>
			)}
			{menuPosition ? (
				<DirectoryItemMenu
					ariaLabel={`${folder.name} 操作`}
					items={menuItems}
					onClose={closeMenu}
					position={menuPosition}
				/>
			) : null}
			{isCollapsed ? null : (
				<div>
					{creatingFolderParentId === folder.id ? (
						<FolderNameEditor
							defaultValue=""
							depth={depth + 1}
							onCancel={onCancelCreateFolder}
							onCommit={(name) => onCommitCreateFolder(name, folder.id)}
							placeholder="新文件夹"
							showDisclosureSpacer
						/>
					) : null}
					{childFolders.map((child) => (
						<ProjectFolderItem
							key={child.folder.id}
							node={child}
							project={project}
							depth={depth + 1}
							activeDocumentId={activeDocumentId}
							activeAssetId={activeAssetId}
							canMutate={canMutate}
							collapsedFolders={collapsedFolders}
							creatingFolderParentId={creatingFolderParentId}
							documents={documents}
							dropTarget={dropTarget}
							folders={allFolders}
							locationPathname={locationPathname}
							onCancelCreateFolder={onCancelCreateFolder}
							onCommitCreateFolder={onCommitCreateFolder}
							onCreateFolder={onCreateFolder}
							onDeleteAsset={onDeleteAsset}
							onDeleteDocument={onDeleteDocument}
							onDeleteFolder={onDeleteFolder}
							onOpenAsset={onOpenAsset}
							onOpenDocument={onOpenDocument}
							onRenameFolder={onRenameFolder}
							showActiveSelection={showActiveSelection}
							onToggleFolder={onToggleFolder}
							workspaceDir={workspaceDir}
						/>
					))}
					{files.map((file) => (
						<ProjectFileItem
							key={`${file.kind}:${file.id}`}
							entry={file}
							project={project}
							depth={depth + 1}
							activeDocumentId={activeDocumentId}
							activeAssetId={activeAssetId}
							canMutate={canMutate}
							documents={documents}
							folders={allFolders}
							locationPathname={locationPathname}
							onDeleteAsset={onDeleteAsset}
							onDeleteDocument={onDeleteDocument}
							onOpenAsset={onOpenAsset}
							onOpenDocument={onOpenDocument}
							showActiveSelection={showActiveSelection}
							workspaceDir={workspaceDir}
						/>
					))}
				</div>
			)}
		</div>
	);
};
