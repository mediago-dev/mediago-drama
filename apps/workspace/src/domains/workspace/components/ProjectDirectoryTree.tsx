import { DndContext, DragOverlay } from "@dnd-kit/core";
import { FolderPlus, Loader2 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import type { WorkspaceProject } from "@/domains/projects/api/projects";
import { getWorkspaceDocuments, workspaceDocumentsKey } from "@/domains/workspace/api/workspace";
import { isOverviewDocumentId } from "@/lib/overview/overview-template";
import { useDocumentsStore } from "@/domains/documents/stores";
import type {
	ProjectAssetDeleteHandler,
	ProjectDocumentDeleteHandler,
} from "@/domains/workspace/components/ProjectDirectory";
import { useDirectoryTreeStore } from "@/lib/stores/directory-tree";
import { Button } from "@/shared/components/ui/button";
import { DirectoryDragPreview, DirectoryRootDropZone } from "./directory/DropZones";
import { FolderNameEditor } from "./directory/FolderNameEditor";
import { ProjectFileItem } from "./directory/ProjectFileItem";
import { ProjectFolderItem } from "./directory/ProjectFolderItem";
import {
	buildDirectoryTree,
	directoryCollisionDetection,
	previewForPayload,
} from "./directory/helpers";
import { useDirectoryDragDrop } from "./directory/useDirectoryDragDrop";

const EMPTY_COLLAPSED_FOLDERS: Record<string, boolean> = {};

export const ProjectDirectoryTree: React.FC<{
	locationPathname: string;
	onDeleteAsset: ProjectAssetDeleteHandler;
	onDeleteDocument: ProjectDocumentDeleteHandler;
	onOpenAsset: (project: WorkspaceProject, assetId: string) => void;
	onOpenDocument: (project: WorkspaceProject, documentId: string) => void;
	onRootCreateRequestReady?: (startCreateRootFolder: (() => void) | null) => void;
	project: WorkspaceProject;
	routeAssetId?: string | null;
	routeDocumentId?: string | null;
	showActiveSelection?: boolean;
	showRootCreateButton?: boolean;
}> = ({
	locationPathname,
	onDeleteAsset,
	onDeleteDocument,
	onOpenAsset,
	onOpenDocument,
	onRootCreateRequestReady,
	project,
	routeAssetId,
	routeDocumentId,
	showActiveSelection = true,
	showRootCreateButton = true,
}) => {
	const storeDocuments = useDocumentsStore((state) => state.documents);
	const storeFolders = useDocumentsStore((state) => state.folders);
	const storeAssets = useDocumentsStore((state) => state.assets);
	const storeWorkspaceDir = useDocumentsStore((state) => state.workspaceDir);
	const documentsProjectId = useDocumentsStore((state) => state.projectId);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const activeAssetId = useDocumentsStore((state) => state.activeAssetId);
	const createFolder = useDocumentsStore((state) => state.createFolder);
	const renameFolder = useDocumentsStore((state) => state.renameFolder);
	const deleteFolder = useDocumentsStore((state) => state.deleteFolder);
	const moveFolder = useDocumentsStore((state) => state.moveFolder);
	const moveItemToFolder = useDocumentsStore((state) => state.moveItemToFolder);
	const collapsedFolders = useDirectoryTreeStore(
		(state) => state.collapsedByProject[project.id] ?? EMPTY_COLLAPSED_FOLDERS,
	);
	const toggleStoredFolder = useDirectoryTreeStore((state) => state.toggleFolder);
	const setFolderCollapsed = useDirectoryTreeStore((state) => state.setFolderCollapsed);
	const expandStoredFolder = useDirectoryTreeStore((state) => state.expandFolder);
	const [creatingFolderParentId, setCreatingFolderParentId] = useState<string | null | undefined>();
	const isStoreProject = documentsProjectId === project.id;
	const {
		data: remoteDocuments,
		error,
		isLoading,
	} = useSWR(isStoreProject ? null : workspaceDocumentsKey(project.id), () =>
		getWorkspaceDocuments(project.id),
	);
	const remoteProjectId = remoteDocuments?.projectId?.trim() || "";
	const remoteDocumentsForProject =
		remoteDocuments && remoteProjectId === project.id ? remoteDocuments : null;
	const sourceDocuments = isStoreProject
		? storeDocuments
		: (remoteDocumentsForProject?.documents ?? []);
	const sourceFolders = isStoreProject ? storeFolders : (remoteDocumentsForProject?.folders ?? []);
	const sourceAssets = isStoreProject ? storeAssets : (remoteDocumentsForProject?.assets ?? []);
	const workspaceDir = isStoreProject
		? storeWorkspaceDir
		: (remoteDocumentsForProject?.workspaceDir ?? "");
	const canMutate = isStoreProject;
	const displayedActiveDocumentId = routeDocumentId ?? (routeAssetId ? "" : activeDocumentId);
	const displayedActiveAssetId = routeAssetId ?? (routeDocumentId ? "" : activeAssetId);
	const autoExpandFolder = useCallback(
		(folderId: string) => {
			expandStoredFolder(project.id, folderId);
		},
		[expandStoredFolder, project.id],
	);
	const {
		activePayload,
		clearDragState,
		dropTarget,
		handleDragEnd,
		handleDragOver,
		handleDragStart,
		sensors,
	} = useDirectoryDragDrop({
		canMutate,
		folders: sourceFolders,
		moveFolder,
		moveItemToFolder,
		onAutoExpandFolder: autoExpandFolder,
	});
	const projectDocuments = useMemo(
		() => sourceDocuments.filter((document) => !isOverviewDocumentId(document.id)),
		[sourceDocuments],
	);
	const directoryTree = useMemo(
		() => buildDirectoryTree(sourceFolders, projectDocuments, sourceAssets),
		[projectDocuments, sourceAssets, sourceFolders],
	);
	const activePreview = useMemo(
		() =>
			activePayload
				? previewForPayload(activePayload, sourceFolders, projectDocuments, sourceAssets)
				: null,
		[activePayload, projectDocuments, sourceAssets, sourceFolders],
	);
	const isCreatingFolder = creatingFolderParentId !== undefined;
	const hasDirectoryItems =
		directoryTree.folders.length > 0 ||
		directoryTree.files.length > 0 ||
		sourceFolders.length > 0 ||
		isCreatingFolder;
	const dragOverlay = (
		<DragOverlay dropAnimation={null}>
			{activePreview ? <DirectoryDragPreview preview={activePreview} /> : null}
		</DragOverlay>
	);

	const startCreateFolder = useCallback(
		(parentId: string | null = null) => {
			setCreatingFolderParentId(parentId);
			if (parentId) {
				setFolderCollapsed(project.id, parentId, false);
			}
		},
		[project.id, setFolderCollapsed],
	);

	const commitCreateFolder = (name: string, parentId: string | null) => {
		setCreatingFolderParentId(undefined);
		const trimmedName = name.trim();
		if (!trimmedName) return;
		createFolder(trimmedName, parentId);
	};

	const cancelCreateFolder = () => {
		setCreatingFolderParentId(undefined);
	};

	const createFolderFromDraft = (name: string, parentId: string | null) => {
		commitCreateFolder(name, parentId);
	};

	const renameFolderFromDraft = (folderId: string, name: string) => {
		const trimmedName = name.trim();
		if (!trimmedName) return;
		renameFolder(folderId, trimmedName);
	};

	const createFolderAtRoot = useCallback(() => {
		startCreateFolder(null);
	}, [startCreateFolder]);

	useEffect(() => {
		onRootCreateRequestReady?.(createFolderAtRoot);
		return () => onRootCreateRequestReady?.(null);
	}, [createFolderAtRoot, onRootCreateRequestReady]);

	const createFolderUnder = (parentId: string | null) => {
		startCreateFolder(parentId);
	};

	const toggleFolder = useCallback(
		(folderId: string) => {
			toggleStoredFolder(project.id, folderId);
		},
		[project.id, toggleStoredFolder],
	);

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={directoryCollisionDetection}
			onDragStart={handleDragStart}
			onDragOver={handleDragOver}
			onDragEnd={handleDragEnd}
			onDragCancel={clearDragState}
		>
			<DirectoryRootDropZone isActive={Boolean(activePayload && dropTarget?.folderId === null)}>
				{showRootCreateButton ? (
					<div className="px-2">
						<Button
							type="button"
							variant="ghost"
							className="h-7 w-full justify-start gap-1.5 rounded-sm px-2 text-xs text-muted-foreground hover:bg-ide-list-hover hover:text-foreground"
							onClick={createFolderAtRoot}
							disabled={!canMutate}
							title="新建文件夹"
							aria-label="新建文件夹"
						>
							<FolderPlus className="size-3.5" />
							<span className="min-w-0 flex-1 truncate text-left">新建文件夹</span>
						</Button>
					</div>
				) : null}
				{isLoading ? (
					<div className="flex h-6 items-center gap-1.5 px-2 text-xs text-muted-foreground">
						<Loader2 className="size-3.5 animate-spin" />
						<span>加载目录</span>
					</div>
				) : null}
				{error ? <p className="px-2 py-1 text-xs text-error-foreground">目录加载失败</p> : null}
				{hasDirectoryItems ? (
					<div className="space-y-0.5">
						{creatingFolderParentId === null ? (
							<FolderNameEditor
								defaultValue=""
								depth={0}
								onCancel={cancelCreateFolder}
								onCommit={(name) => createFolderFromDraft(name, null)}
								placeholder="新文件夹"
								showDisclosureSpacer
							/>
						) : null}
						{directoryTree.folders.map((node) => (
							<ProjectFolderItem
								key={node.folder.id}
								node={node}
								project={project}
								depth={0}
								activeDocumentId={displayedActiveDocumentId}
								activeAssetId={displayedActiveAssetId}
								canMutate={canMutate}
								collapsedFolders={collapsedFolders}
								creatingFolderParentId={creatingFolderParentId}
								documents={sourceDocuments}
								dropTarget={dropTarget}
								folders={sourceFolders}
								locationPathname={locationPathname}
								onCancelCreateFolder={cancelCreateFolder}
								onCommitCreateFolder={createFolderFromDraft}
								onCreateFolder={createFolderUnder}
								onDeleteAsset={onDeleteAsset}
								onDeleteDocument={onDeleteDocument}
								onDeleteFolder={deleteFolder}
								onOpenAsset={onOpenAsset}
								onOpenDocument={onOpenDocument}
								onRenameFolder={renameFolderFromDraft}
								showActiveSelection={showActiveSelection}
								onToggleFolder={toggleFolder}
								workspaceDir={workspaceDir}
							/>
						))}
						{directoryTree.files.map((file) => (
							<ProjectFileItem
								key={`${file.kind}:${file.id}`}
								entry={file}
								project={project}
								depth={0}
								activeDocumentId={displayedActiveDocumentId}
								activeAssetId={displayedActiveAssetId}
								canMutate={canMutate}
								documents={sourceDocuments}
								folders={sourceFolders}
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
				) : (
					<p className="px-2 py-1 text-xs text-muted-foreground">暂无目录内容</p>
				)}
			</DirectoryRootDropZone>
			{typeof document === "undefined" ? dragOverlay : createPortal(dragOverlay, document.body)}
		</DndContext>
	);
};
