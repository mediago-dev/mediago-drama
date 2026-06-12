import {
	ChevronDown,
	ChevronRight,
	FileText,
	FolderKanban,
	GripVertical,
	LayoutDashboard,
	Plus,
	Search,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { useProjectName } from "@/domains/projects/hooks/useProjectName";
import {
	type DocumentCategory,
	type DocumentMovePosition,
	type MarkdownDocument,
	useDocumentsStore,
} from "@/domains/documents/stores";
import {
	documentCategoryDescriptors,
	documentCategoryIconMap,
	documentsForCategory,
	type DocumentCategoryDescriptor,
} from "@/domains/documents/lib/categories";
import { isOverviewDocumentId } from "@/lib/overview/overview-template";
import {
	agentProjectPath,
	agentProjectRouteState,
	getRouteProjectId,
	isAgentProjectViewState,
} from "@/domains/workspace/lib/workbench-route";
import { cn } from "@/shared/lib/utils";

interface DocumentSidebarProps {
	forceVisible?: boolean;
	onNavigate?: () => void;
	width: number;
}

export const DocumentSidebar: React.FC<DocumentSidebarProps> = ({
	forceVisible = false,
	onNavigate,
	width,
}) => {
	const location = useLocation();
	const projectId = getRouteProjectId(location.search);
	const navigate = useNavigate();
	const [draggedDocumentId, setDraggedDocumentId] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<DocumentDropTarget | null>(null);
	const [collapsedCategories, setCollapsedCategories] = useState<
		Partial<Record<DocumentCategory, boolean>>
	>({});
	const allDocuments = useDocumentsStore((state) => state.documents);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const searchQuery = useDocumentsStore((state) => state.searchQuery);
	const activeProjectName = useProjectName(projectId);
	const createDocument = useDocumentsStore((state) => state.createDocument);
	const deleteDocument = useDocumentsStore((state) => state.deleteDocument);
	const moveDocument = useDocumentsStore((state) => state.moveDocument);
	const selectDocument = useDocumentsStore((state) => state.selectDocument);
	const setSearchQuery = useDocumentsStore((state) => state.setSearchQuery);

	const documents = allDocuments.filter((document) => !isOverviewDocumentId(document.id));
	const normalizedQuery = searchQuery.trim().toLowerCase();
	const visibleDocuments = normalizedQuery
		? documents.filter((document) => document.title.toLowerCase().includes(normalizedQuery))
		: documents;
	const isDragEnabled = normalizedQuery === "";
	const isOverviewActive = isAgentProjectViewState(location.state, "overview");
	const visibleActiveDocumentId = isOverviewActive ? "" : activeDocumentId;

	const openOverview = () => {
		if (!projectId) return;
		navigate(agentProjectPath(projectId), {
			state: agentProjectRouteState("overview"),
		});
		onNavigate?.();
	};

	const openDocument = (documentId: string) => {
		selectDocument(documentId);
		if (projectId && isOverviewActive) {
			navigate(agentProjectPath(projectId), {
				state: agentProjectRouteState("document"),
			});
		}
		onNavigate?.();
	};

	const handleCreateInCategory = (category: DocumentCategory, parentId: string | null = null) => {
		createDocument({ category, parentId });
		if (projectId && isOverviewActive) {
			navigate(agentProjectPath(projectId), {
				state: agentProjectRouteState("document"),
			});
		}
	};

	const toggleCategory = (category: DocumentCategory) => {
		setCollapsedCategories((current) => ({
			...current,
			[category]: !current[category],
		}));
	};

	const beginDrag = (documentId: string, event: React.DragEvent<HTMLDivElement>) => {
		if (!isDragEnabled) return;

		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", documentId);
		setDraggedDocumentId(documentId);
	};

	const updateDropTarget = (
		targetDocumentId: string,
		position: DocumentMovePosition,
		event: React.DragEvent<HTMLDivElement>,
	) => {
		if (!isDragEnabled || !draggedDocumentId) return;

		event.preventDefault();
		event.stopPropagation();
		event.dataTransfer.dropEffect = "move";
		if (!canDropDocument(documents, draggedDocumentId, targetDocumentId)) {
			setDropTarget(null);
			return;
		}
		setDropTarget({ documentId: targetDocumentId, position });
	};

	const clearDropTarget = (targetDocumentId: string, event: React.DragEvent<HTMLDivElement>) => {
		if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
		setDropTarget((target) => (target?.documentId === targetDocumentId ? null : target));
	};

	const finishDrop = (
		targetDocumentId: string,
		position: DocumentMovePosition,
		event: React.DragEvent<HTMLDivElement>,
	) => {
		event.preventDefault();
		event.stopPropagation();
		const sourceDocumentId =
			draggedDocumentId || event.dataTransfer.getData("text/plain").trim() || "";
		setDraggedDocumentId(null);
		setDropTarget(null);
		if (!sourceDocumentId || !canDropDocument(documents, sourceDocumentId, targetDocumentId))
			return;
		moveDocument(sourceDocumentId, targetDocumentId, position);
	};

	const endDrag = () => {
		setDraggedDocumentId(null);
		setDropTarget(null);
	};

	return (
		<aside
			className={cn(
				"h-full min-h-0 shrink-0 flex-col bg-ide-sidebar text-ide-sidebar-foreground",
				forceVisible ? "flex" : "hidden md:flex",
			)}
			style={{ width }}
		>
			<header className="border-b border-border px-2 py-2">
				<div className="flex items-start justify-between gap-2">
					<div className="flex min-w-0 gap-2">
						<div className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar text-muted-foreground">
							<FolderKanban className="size-4" />
						</div>
						<div className="min-w-0">
							<h1 className="truncate text-sm font-semibold text-foreground">
								{activeProjectName || "当前项目"}
							</h1>
						</div>
					</div>
				</div>
			</header>

			<div className="border-b border-border p-2">
				<div className="relative">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						placeholder="搜索"
						className="h-8 rounded-sm pl-8 text-xs shadow-none"
					/>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-1">
				<button
					type="button"
					onClick={openOverview}
					className={cn(
						"mb-1 flex w-full items-center gap-1.5 rounded-sm border border-transparent px-1.5 py-1 text-left text-xs transition-colors",
						isOverviewActive
							? "bg-ide-list-active text-ide-list-active-foreground"
							: "text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
					)}
				>
					<span className="w-3 shrink-0" />
					<LayoutDashboard className="size-3.5 shrink-0" />
					<span className="min-w-0 flex-1 truncate">概览</span>
				</button>
				{documentCategoryDescriptors.map((descriptor) => {
					const categoryDocuments = documentsForCategory(documents, descriptor.key);
					const visibleCategoryDocuments = documentsForCategory(visibleDocuments, descriptor.key);
					const nodes = buildDocumentTree(visibleCategoryDocuments);
					const isCollapsed = Boolean(collapsedCategories[descriptor.key]);

					return (
						<DocumentCategoryGroup
							key={descriptor.key}
							descriptor={descriptor}
							nodes={nodes}
							activeDocumentId={visibleActiveDocumentId}
							categoryCount={categoryDocuments.length}
							collapsed={isCollapsed}
							dragEnabled={isDragEnabled}
							draggedDocumentId={draggedDocumentId}
							dropTarget={dropTarget}
							onCreate={() => handleCreateInCategory(descriptor.key)}
							onCreateChild={(parentId) => handleCreateInCategory(descriptor.key, parentId)}
							onDelete={deleteDocument}
							onDragEnd={endDrag}
							onDragLeave={clearDropTarget}
							onDragOver={updateDropTarget}
							onDragStart={beginDrag}
							onDrop={finishDrop}
							onSelect={openDocument}
							onToggle={() => toggleCategory(descriptor.key)}
						/>
					);
				})}

				{normalizedQuery && visibleDocuments.length === 0 ? (
					<p className="px-2 py-3 text-xs text-muted-foreground">没有找到文档。</p>
				) : null}
			</div>
		</aside>
	);
};

interface DocumentTreeNode {
	document: MarkdownDocument;
	children: DocumentTreeNode[];
}

interface DocumentDropTarget {
	documentId: string;
	position: DocumentMovePosition;
}

interface DocumentCategoryGroupProps {
	descriptor: DocumentCategoryDescriptor;
	nodes: DocumentTreeNode[];
	activeDocumentId: string;
	categoryCount: number;
	collapsed: boolean;
	dragEnabled: boolean;
	draggedDocumentId: string | null;
	dropTarget: DocumentDropTarget | null;
	onCreate: () => void;
	onCreateChild: (parentId: string) => void;
	onDelete: (id: string) => void;
	onDragEnd: () => void;
	onDragLeave: (documentId: string, event: React.DragEvent<HTMLDivElement>) => void;
	onDragOver: (
		documentId: string,
		position: DocumentMovePosition,
		event: React.DragEvent<HTMLDivElement>,
	) => void;
	onDragStart: (documentId: string, event: React.DragEvent<HTMLDivElement>) => void;
	onDrop: (
		documentId: string,
		position: DocumentMovePosition,
		event: React.DragEvent<HTMLDivElement>,
	) => void;
	onSelect: (id: string) => void;
	onToggle: () => void;
}

const DocumentCategoryGroup: React.FC<DocumentCategoryGroupProps> = ({
	descriptor,
	nodes,
	activeDocumentId,
	categoryCount,
	collapsed,
	dragEnabled,
	draggedDocumentId,
	dropTarget,
	onCreate,
	onCreateChild,
	onDelete,
	onDragEnd,
	onDragLeave,
	onDragOver,
	onDragStart,
	onDrop,
	onSelect,
	onToggle,
}) => {
	const CategoryIcon = descriptor.icon;
	const ToggleIcon = collapsed ? ChevronRight : ChevronDown;

	return (
		<section className="mt-1">
			<div className="group flex items-center gap-1 rounded-sm px-1 py-0.5">
				<button
					type="button"
					onClick={onToggle}
					className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-1 text-left text-xs transition-colors hover:bg-ide-list-hover hover:text-foreground"
					aria-expanded={!collapsed}
				>
					<ToggleIcon className="size-3 shrink-0 text-muted-foreground" />
					<CategoryIcon
						className="size-3.5 shrink-0"
						style={{ color: `var(${descriptor.colorVar})` }}
					/>
					<span className="min-w-0 flex-1 truncate font-semibold text-foreground">
						{descriptor.label}
					</span>
					<span className="rounded-sm bg-ide-toolbar px-1.5 py-0.5 text-2xs leading-none text-muted-foreground">
						{categoryCount}
					</span>
				</button>
				<Button
					size="icon"
					variant="ghost"
					className="size-6 opacity-100 md:opacity-0 md:group-hover:opacity-100"
					onClick={onCreate}
					aria-label={`新建${descriptor.label}`}
				>
					<Plus className="size-3.5" />
				</Button>
			</div>
			{collapsed ? null : (
				<div>
					{nodes.length > 0 ? (
						nodes.map((node) => (
							<DocumentTreeItem
								key={node.document.id}
								node={node}
								depth={0}
								activeDocumentId={activeDocumentId}
								dragEnabled={dragEnabled}
								draggedDocumentId={draggedDocumentId}
								dropTarget={dropTarget}
								onCreateChild={onCreateChild}
								onDelete={onDelete}
								onDragEnd={onDragEnd}
								onDragLeave={onDragLeave}
								onDragOver={onDragOver}
								onDragStart={onDragStart}
								onDrop={onDrop}
								onSelect={onSelect}
							/>
						))
					) : (
						<p className="px-7 py-1.5 text-xs italic text-muted-foreground">暂无文档</p>
					)}
				</div>
			)}
		</section>
	);
};

interface DocumentTreeItemProps {
	node: DocumentTreeNode;
	depth: number;
	activeDocumentId: string;
	dragEnabled: boolean;
	draggedDocumentId: string | null;
	dropTarget: DocumentDropTarget | null;
	onCreateChild: (parentId: string) => void;
	onDelete: (id: string) => void;
	onDragEnd: () => void;
	onDragLeave: (documentId: string, event: React.DragEvent<HTMLDivElement>) => void;
	onDragOver: (
		documentId: string,
		position: DocumentMovePosition,
		event: React.DragEvent<HTMLDivElement>,
	) => void;
	onDragStart: (documentId: string, event: React.DragEvent<HTMLDivElement>) => void;
	onDrop: (
		documentId: string,
		position: DocumentMovePosition,
		event: React.DragEvent<HTMLDivElement>,
	) => void;
	onSelect: (id: string) => void;
}

const DocumentTreeItem: React.FC<DocumentTreeItemProps> = ({
	node,
	depth,
	activeDocumentId,
	dragEnabled,
	draggedDocumentId,
	dropTarget,
	onCreateChild,
	onDelete,
	onDragEnd,
	onDragLeave,
	onDragOver,
	onDragStart,
	onDrop,
	onSelect,
}) => {
	const { document, children } = node;
	const isActive = document.id === activeDocumentId;
	const activeDropPosition = dropTarget?.documentId === document.id ? dropTarget.position : null;
	const isDragging = draggedDocumentId === document.id;
	const documentTitle = document.title || "未命名";
	const DocumentIcon = documentIconForCategory(document.category);

	return (
		<div>
			<div
				draggable={dragEnabled}
				onDragEnd={onDragEnd}
				onDragLeave={(event) => onDragLeave(document.id, event)}
				onDragOver={(event) => onDragOver(document.id, resolveDropPosition(), event)}
				onDragStart={(event) => onDragStart(document.id, event)}
				onDrop={(event) => onDrop(document.id, resolveDropPosition(), event)}
				className={cn(
					"group flex items-center gap-1 rounded-sm border border-transparent px-1.5 py-1 transition-colors",
					dragEnabled && "cursor-grab active:cursor-grabbing",
					isDragging && "opacity-50",
					activeDropPosition === "before" && "border-t-primary",
					activeDropPosition === "after" && "border-b-primary",
					activeDropPosition === "inside" && "border-primary bg-ide-list-hover",
					isActive
						? "bg-ide-list-active text-ide-list-active-foreground"
						: "text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
				)}
				style={{ paddingLeft: `${depth * 14 + 18}px` }}
			>
				<button
					type="button"
					onClick={() => onSelect(document.id)}
					className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
				>
					{dragEnabled ? (
						<GripVertical className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
					) : null}
					<DocumentIcon className="size-3.5 shrink-0" />
					<span className="min-w-0 flex-1 truncate text-xs">{document.title || "未命名"}</span>
					{document.isDirty ? (
						<span className="size-1.5 rounded-full bg-primary" aria-label="未保存更改" />
					) : null}
				</button>
				<Button
					size="icon"
					variant="ghost"
					className="size-6 opacity-0 group-hover:opacity-100"
					onClick={() => onCreateChild(document.id)}
					aria-label={`在 ${document.title || "未命名"} 下新建子文档`}
				>
					<Plus className="size-3.5" />
				</Button>
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button
							size="icon"
							variant="ghost"
							className="size-6 opacity-0 group-hover:opacity-100"
							aria-label={`删除 ${documentTitle}`}
						>
							<Trash2 className="size-3.5" />
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>删除文档？</AlertDialogTitle>
							<AlertDialogDescription>
								确定要删除“{documentTitle}”吗？
								{children.length > 0
									? " 该文档及其子文档会一起删除，此操作无法撤销。"
									: " 此操作无法撤销。"}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>取消</AlertDialogCancel>
							<AlertDialogAction onClick={() => onDelete(document.id)}>删除</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
			{children.map((child) => (
				<DocumentTreeItem
					key={child.document.id}
					node={child}
					depth={depth + 1}
					activeDocumentId={activeDocumentId}
					dragEnabled={dragEnabled}
					draggedDocumentId={draggedDocumentId}
					dropTarget={dropTarget}
					onCreateChild={onCreateChild}
					onDelete={onDelete}
					onDragEnd={onDragEnd}
					onDragLeave={onDragLeave}
					onDragOver={onDragOver}
					onDragStart={onDragStart}
					onDrop={onDrop}
					onSelect={onSelect}
				/>
			))}
		</div>
	);
};

const documentIconForCategory = (category: MarkdownDocument["category"]) =>
	category ? (documentCategoryIconMap[category] ?? FileText) : FileText;

const buildDocumentTree = (documents: MarkdownDocument[]) => {
	const nodes = new Map<string, DocumentTreeNode>();
	for (const document of documents) {
		nodes.set(document.id, { document, children: [] });
	}

	const roots: DocumentTreeNode[] = [];
	for (const node of nodes.values()) {
		const parent = node.document.parentId ? nodes.get(node.document.parentId) : undefined;
		if (parent && parent.document.id !== node.document.id) {
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}

	const sortNodes = (items: DocumentTreeNode[]) => {
		items.sort(
			(first, second) =>
				first.document.title.localeCompare(second.document.title, "zh-CN") ||
				first.document.id.localeCompare(second.document.id, "zh-CN"),
		);
		for (const item of items) sortNodes(item.children);
		return items;
	};

	return sortNodes(roots);
};

const resolveDropPosition = (): DocumentMovePosition => {
	return "inside";
};

const canDropDocument = (
	documents: MarkdownDocument[],
	sourceDocumentId: string,
	targetDocumentId: string,
) => {
	if (sourceDocumentId === targetDocumentId) return false;
	return !collectDocumentDescendantIds(documents, sourceDocumentId).has(targetDocumentId);
};

const collectDocumentDescendantIds = (documents: MarkdownDocument[], documentId: string) => {
	const collected = new Set<string>();
	const visit = (id: string) => {
		if (collected.has(id)) return;
		collected.add(id);
		for (const child of documents.filter((document) => document.parentId === id)) {
			visit(child.id);
		}
	};
	visit(documentId);
	return collected;
};
