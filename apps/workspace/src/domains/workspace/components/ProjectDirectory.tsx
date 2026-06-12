import {
	ChevronDown,
	ChevronRight,
	File,
	FileAudio,
	FileCode2,
	FilePlus2,
	FileImage,
	FileVideo,
	FolderOpen,
	Loader2,
	Tags,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import type { WorkspaceProject } from "@/domains/projects/api/projects";
import { getWorkspaceDocuments, workspaceDocumentsKey } from "@/domains/workspace/api/workspace";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import {
	type DocumentCategoryDescriptor,
	documentCategoryDescriptorMap,
	documentCategoryDescriptors,
	documentsForCategory,
} from "@/domains/documents/lib/categories";
import { isOverviewDocumentId } from "@/lib/overview/overview-template";
import {
	type DocumentCategory,
	type DocumentFolder,
	type MarkdownDocument,
	useDocumentsStore,
} from "@/domains/documents/stores";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/shared/lib/utils";
import {
	DirectoryItemMenu,
	type DirectoryItemMenuItem,
	type DirectoryItemMenuPosition,
} from "./directory/DirectoryItemMenu";
import {
	canShowInFileManager,
	describeFileManagerError,
	revealDirectoryFileInFileManager,
} from "./directory/file-manager";

export type ProjectDocumentDeleteHandler = (
	project: WorkspaceProject,
	document: MarkdownDocument,
	deletedIds: string[],
) => void;

export type ProjectAssetDeleteHandler = (
	project: WorkspaceProject,
	assetId: string,
	filename: string,
) => void;

type DirectoryEntry =
	| {
			kind: "document";
			id: string;
			title: string;
			parentId: string | null;
			sortOrder: number;
			updatedAt: string;
			document: MarkdownDocument;
	  }
	| {
			kind: "asset";
			id: string;
			title: string;
			parentId: string | null;
			sortOrder: number;
			updatedAt: string;
			asset: ProjectAsset;
	  };

interface DirectoryTreeNode {
	entry: DirectoryEntry;
	children: DirectoryTreeNode[];
}

export const ProjectDirectory: React.FC<{
	locationPathname: string;
	onDeleteAsset: ProjectAssetDeleteHandler;
	onDeleteDocument: ProjectDocumentDeleteHandler;
	onCreateDocumentInCategory: (category: DocumentCategory) => void;
	onOpenAsset: (project: WorkspaceProject, assetId: string) => void;
	onOpenDocument: (project: WorkspaceProject, documentId: string) => void;
	onOpenNewDocument: (category?: DocumentCategory) => void;
	project: WorkspaceProject;
	showActiveSelection?: boolean;
}> = ({
	locationPathname,
	onCreateDocumentInCategory,
	onDeleteAsset,
	onDeleteDocument,
	onOpenAsset,
	onOpenDocument,
	onOpenNewDocument,
	project,
	showActiveSelection = true,
}) => {
	const storeDocuments = useDocumentsStore((state) => state.documents);
	const storeFolders = useDocumentsStore((state) => state.folders);
	const storeAssets = useDocumentsStore((state) => state.assets);
	const storeWorkspaceDir = useDocumentsStore((state) => state.workspaceDir);
	const documentsProjectId = useDocumentsStore((state) => state.projectId);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const activeAssetId = useDocumentsStore((state) => state.activeAssetId);
	const [collapsedCategories, setCollapsedCategories] = useState<
		Partial<Record<DocumentCategory, boolean>>
	>({});
	const isStoreProject = documentsProjectId === project.id;
	const {
		data: remoteDocuments,
		error,
		isLoading,
	} = useSWR(isStoreProject ? null : workspaceDocumentsKey(project.id), () =>
		getWorkspaceDocuments(project.id),
	);
	const sourceDocuments = isStoreProject ? storeDocuments : (remoteDocuments?.documents ?? []);
	const sourceFolders = isStoreProject ? storeFolders : (remoteDocuments?.folders ?? []);
	const sourceAssets = isStoreProject ? storeAssets : (remoteDocuments?.assets ?? []);
	const workspaceDir = isStoreProject ? storeWorkspaceDir : (remoteDocuments?.workspaceDir ?? "");
	const projectDocuments = useMemo(
		() =>
			sourceDocuments
				.filter((document) => !isOverviewDocumentId(document.id))
				.sort(
					(first, second) =>
						first.title.localeCompare(second.title, "zh-CN") ||
						first.id.localeCompare(second.id, "zh-CN"),
				),
		[sourceDocuments],
	);
	const projectAssets = useMemo(
		() =>
			[...sourceAssets].sort(
				(first, second) =>
					first.sortOrder - second.sortOrder ||
					first.filename.localeCompare(second.filename, "zh-CN"),
			),
		[sourceAssets],
	);
	const directoryGroups = useMemo(
		() =>
			documentCategoryDescriptors.map((descriptor) => {
				const categoryDocuments = documentsForCategory(projectDocuments, descriptor.key);
				const entries =
					descriptor.key === "source-material"
						? [...categoryDocuments.map(documentEntry), ...projectAssets.map(assetEntry)]
						: categoryDocuments.map(documentEntry);
				return {
					descriptor,
					nodes: buildEntryTree(entries),
				};
			}),
		[projectAssets, projectDocuments],
	);

	return (
		<div className="space-y-1">
			{isLoading ? (
				<div className="flex h-6 items-center gap-1.5 px-2 text-xs text-muted-foreground">
					<Loader2 className="size-3.5 animate-spin" />
					<span>加载目录</span>
				</div>
			) : null}
			{error ? <p className="px-2 py-1 text-xs text-error-foreground">目录加载失败</p> : null}
			{directoryGroups.map(({ descriptor, nodes }) => {
				const isCollapsed = Boolean(collapsedCategories[descriptor.key]);
				return (
					<section key={descriptor.key} className="space-y-0.5">
						<ProjectCategoryHeader
							descriptor={descriptor}
							isCollapsed={isCollapsed}
							canMutate={isStoreProject}
							onCreateDocumentInCategory={onCreateDocumentInCategory}
							onOpenNewDocument={onOpenNewDocument}
							onToggle={() =>
								setCollapsedCategories((current) => ({
									...current,
									[descriptor.key]: !current[descriptor.key],
								}))
							}
						/>
						{isCollapsed
							? null
							: nodes.map((node) => (
									<ProjectDocumentItem
										key={`${node.entry.kind}:${node.entry.id}`}
										node={node}
										project={project}
										depth={0}
										activeDocumentId={activeDocumentId}
										activeAssetId={activeAssetId}
										canMutate={isStoreProject}
										documents={sourceDocuments}
										folders={sourceFolders}
										locationPathname={locationPathname}
										onDeleteAsset={onDeleteAsset}
										onDelete={onDeleteDocument}
										onOpenAsset={onOpenAsset}
										onOpen={onOpenDocument}
										showActiveSelection={showActiveSelection}
										workspaceDir={workspaceDir}
									/>
								))}
					</section>
				);
			})}
		</div>
	);
};

const ProjectCategoryHeader: React.FC<{
	canMutate: boolean;
	descriptor: DocumentCategoryDescriptor;
	isCollapsed: boolean;
	onCreateDocumentInCategory: (category: DocumentCategory) => void;
	onOpenNewDocument: (category?: DocumentCategory) => void;
	onToggle: () => void;
}> = ({
	canMutate,
	descriptor,
	isCollapsed,
	onCreateDocumentInCategory,
	onOpenNewDocument,
	onToggle,
}) => {
	const [menuPosition, setMenuPosition] = useState<DirectoryItemMenuPosition | null>(null);
	const ToggleIcon = isCollapsed ? ChevronRight : ChevronDown;
	const CategoryIcon = descriptor.icon;
	const closeMenu = useCallback(() => setMenuPosition(null), []);
	const openMenuFromContext = (event: React.MouseEvent<HTMLButtonElement>) => {
		if (!canMutate) return;
		event.preventDefault();
		setMenuPosition({ x: event.clientX, y: event.clientY });
	};
	const createItemLabel =
		descriptor.key === "source-material" ? "新建素材" : `新建${descriptor.label}`;
	const menuItems: DirectoryItemMenuItem[] = [
		{
			icon: FilePlus2,
			label: createItemLabel,
			onSelect: () => {
				if (descriptor.key === "source-material") {
					onOpenNewDocument("source-material");
					return;
				}
				onCreateDocumentInCategory(descriptor.key);
			},
		},
	];

	return (
		<>
			<button
				type="button"
				onClick={onToggle}
				onContextMenu={openMenuFromContext}
				className="flex h-6 w-full items-center gap-1.5 rounded-sm px-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-ide-list-hover"
				aria-expanded={!isCollapsed}
			>
				<ToggleIcon className="size-3 shrink-0 text-muted-foreground" />
				<CategoryIcon
					className="size-3.5 shrink-0"
					style={{ color: `var(${descriptor.colorVar})` }}
				/>
				<span className="min-w-0 flex-1 truncate">{descriptor.label}</span>
			</button>
			{menuPosition ? (
				<DirectoryItemMenu
					ariaLabel={`${descriptor.label} 操作`}
					items={menuItems}
					onClose={closeMenu}
					position={menuPosition}
				/>
			) : null}
		</>
	);
};

const ProjectDocumentItem: React.FC<{
	activeAssetId: string;
	activeDocumentId: string;
	canMutate: boolean;
	depth: number;
	documents: MarkdownDocument[];
	folders: DocumentFolder[];
	locationPathname: string;
	node: DirectoryTreeNode;
	onDeleteAsset: ProjectAssetDeleteHandler;
	onDelete: ProjectDocumentDeleteHandler;
	onOpenAsset: (project: WorkspaceProject, assetId: string) => void;
	onOpen: (project: WorkspaceProject, documentId: string) => void;
	project: WorkspaceProject;
	showActiveSelection: boolean;
	workspaceDir: string;
}> = ({
	activeAssetId,
	activeDocumentId,
	canMutate,
	depth,
	documents,
	folders,
	locationPathname,
	node,
	onDeleteAsset,
	onDelete,
	onOpenAsset,
	onOpen,
	project,
	showActiveSelection,
	workspaceDir,
}) => {
	const { entry, children } = node;
	const [menuPosition, setMenuPosition] = useState<DirectoryItemMenuPosition | null>(null);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const setDocumentCategory = useDocumentsStore((state) => state.setDocumentCategory);
	const toast = useToast();
	const isAsset = entry.kind === "asset";
	const isAgentProjectRoute = locationPathname === "/agent";
	const isDocumentActive =
		entry.kind === "document" && isAgentProjectRoute && entry.id === activeDocumentId;
	const isAssetActive = entry.kind === "asset" && isAgentProjectRoute && entry.id === activeAssetId;
	const isActive = showActiveSelection && (isDocumentActive || isAssetActive);
	const itemTitle = entry.title || (isAsset ? "未命名文件" : "未命名文档");
	const deletedIds = useMemo(() => collectDocumentTreeNodeIds(node), [node]);
	const childDocumentCount = deletedIds.length - 1;
	const entryDescriptor =
		documentCategoryDescriptorMap[
			entry.kind === "document" ? (entry.document.category ?? "source-material") : "source-material"
		] ?? documentCategoryDescriptorMap["source-material"];
	const EntryIcon = entry.kind === "asset" ? assetIcon(entry.asset.kind) : entryDescriptor.icon;
	const canRevealInFileManager = canShowInFileManager(workspaceDir);
	const canOpenContextMenu = canMutate || canRevealInFileManager;

	const closeMenu = useCallback(() => setMenuPosition(null), []);

	const openMenuFromContext = (event: React.MouseEvent<HTMLDivElement>) => {
		if (!canOpenContextMenu) return;
		event.preventDefault();
		setMenuPosition({ x: event.clientX, y: event.clientY });
	};

	const openDeleteDialog = () => {
		closeMenu();
		setIsDeleteDialogOpen(true);
	};
	const showInFileManager = () => {
		void revealDirectoryFileInFileManager({ documents, entry, folders, workspaceDir }).catch(
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
		...(canMutate && entry.kind === "document"
			? [
					{
						icon: Tags,
						label: "变更类型",
						onSelect: () => undefined,
						children: documentCategoryDescriptors
							.filter((descriptor) => descriptor.key !== "source-material")
							.map((descriptor) => ({
								icon: descriptor.icon,
								iconStyle: { color: `var(${descriptor.colorVar})` },
								label: descriptor.label,
								onSelect: () => setDocumentCategory(entry.id, descriptor.key),
							})),
					} satisfies DirectoryItemMenuItem,
				]
			: []),
		...(canMutate
			? [
					{
						icon: Trash2,
						label: "删除",
						onSelect: openDeleteDialog,
						variant: "danger",
					} satisfies DirectoryItemMenuItem,
				]
			: []),
	];

	return (
		<div className="relative">
			<div
				className={cn(
					"group/document flex h-7 w-full items-center gap-1.5 rounded-sm pr-1 text-left text-xs transition-colors",
					isActive
						? "bg-ide-list-active text-ide-list-active-foreground"
						: "text-muted-foreground hover:bg-ide-list-hover hover:text-foreground focus-within:bg-ide-list-hover focus-within:text-foreground",
				)}
				style={{ paddingLeft: `${depth * 12 + 24}px` }}
				onContextMenu={openMenuFromContext}
			>
				<button
					type="button"
					onClick={() =>
						entry.kind === "asset" ? onOpenAsset(project, entry.id) : onOpen(project, entry.id)
					}
					className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
				>
					<EntryIcon
						className="size-3.5 shrink-0"
						style={entryDescriptor ? { color: `var(${entryDescriptor.colorVar})` } : undefined}
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
			<AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{isAsset ? "删除素材？" : "删除文档？"}</AlertDialogTitle>
						<AlertDialogDescription>
							确定要删除“{itemTitle}”吗？
							{!isAsset && childDocumentCount > 0
								? ` 该文档包含 ${childDocumentCount} 篇子文档，会一并删除，此操作无法撤销。`
								: " 此操作无法撤销。"}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>取消</AlertDialogCancel>
						<AlertDialogAction
							onClick={() =>
								entry.kind === "asset"
									? onDeleteAsset(project, entry.id, entry.asset.filename)
									: onDelete(project, entry.document, deletedIds)
							}
						>
							删除
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			{children.map((child) => (
				<ProjectDocumentItem
					key={`${child.entry.kind}:${child.entry.id}`}
					node={child}
					project={project}
					depth={depth + 1}
					activeDocumentId={activeDocumentId}
					activeAssetId={activeAssetId}
					canMutate={canMutate}
					documents={documents}
					folders={folders}
					locationPathname={locationPathname}
					onDeleteAsset={onDeleteAsset}
					onDelete={onDelete}
					onOpenAsset={onOpenAsset}
					onOpen={onOpen}
					showActiveSelection={showActiveSelection}
					workspaceDir={workspaceDir}
				/>
			))}
		</div>
	);
};

const buildEntryTree = (entries: DirectoryEntry[]) => {
	const nodes = new Map<string, DirectoryTreeNode>();
	for (const entry of entries) {
		nodes.set(entry.id, { entry, children: [] });
	}

	const roots: DirectoryTreeNode[] = [];
	for (const node of nodes.values()) {
		const parent = node.entry.parentId ? nodes.get(node.entry.parentId) : undefined;
		if (parent && parent.entry.id !== node.entry.id) {
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}

	const sortNodes = (items: DirectoryTreeNode[]) => {
		items.sort(
			(first, second) =>
				first.entry.title.localeCompare(second.entry.title, "zh-CN") ||
				first.entry.kind.localeCompare(second.entry.kind, "zh-CN") ||
				first.entry.id.localeCompare(second.entry.id, "zh-CN"),
		);
		for (const item of items) sortNodes(item.children);
		return items;
	};

	return sortNodes(roots);
};

const documentEntry = (document: MarkdownDocument): DirectoryEntry => ({
	kind: "document",
	id: document.id,
	title: document.title,
	parentId: document.parentId,
	sortOrder: document.sortOrder,
	updatedAt: document.updatedAt,
	document,
});

const assetEntry = (asset: ProjectAsset): DirectoryEntry => ({
	kind: "asset",
	id: asset.id,
	title: asset.filename,
	parentId: asset.parentId ?? null,
	sortOrder: asset.sortOrder,
	updatedAt: asset.updatedAt,
	asset,
});

const collectDocumentTreeNodeIds = (node: DirectoryTreeNode): string[] => [
	...(node.entry.kind === "document" ? [node.entry.document.id] : []),
	...node.children.flatMap(collectDocumentTreeNodeIds),
];

const assetIcon = (kind: ProjectAsset["kind"]) => {
	switch (kind) {
		case "image":
			return FileImage;
		case "video":
			return FileVideo;
		case "audio":
			return FileAudio;
		case "text":
			return FileCode2;
		default:
			return File;
	}
};
