import {
	Archive,
	Clapperboard,
	ChevronLeft,
	FilePlus2,
	Folder,
	FolderTree,
	Images,
	LayoutDashboard,
	LayoutList,
	Loader2,
	Pencil,
	RotateCcw,
	Search,
	SquarePen,
	Trash2,
	WandSparkles,
	Workflow,
} from "lucide-react";
import type React from "react";
import { useCallback, useRef } from "react";
import type { WorkspaceProject } from "@/domains/projects/api/projects";
import type { DocumentCategory } from "@/domains/documents/stores";
import type { GenerationSuccessNotification } from "@/domains/generation/stores/generation-notifications";
import { Button } from "@/shared/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import {
	ProjectDirectory,
	type ProjectDocumentDeleteHandler,
} from "@/domains/workspace/components/ProjectDirectory";
import { ProjectDirectoryTree } from "@/domains/workspace/components/ProjectDirectoryTree";
import {
	getRouteAssetId,
	getRouteDocumentId,
	isProjectSettingsRoute,
	type ProjectWorkspaceView,
} from "@/domains/workspace/lib/workbench-route";
import { useDocumentViewStore } from "@/lib/stores/document-view";
import { cn } from "@/shared/lib/utils";

export const ProjectsSidebarPanel: React.FC<{
	error?: unknown;
	isCreating: boolean;
	isLoading: boolean;
	locationPathname: string;
	onCreateProject: () => void;
	onArchiveProject: (project: WorkspaceProject) => void;
	onRequestDeleteProject: (project: WorkspaceProject) => void;
	onRenameProject: (project: WorkspaceProject) => void;
	onOpenProject: (project: WorkspaceProject) => void;
	onOpenGenerationNotification?: (notification: GenerationSuccessNotification) => void;
	onOpenSearch: (scope: "global" | "project") => void;
	onOpenSettings: () => void;
	onRetry?: () => void;
	projectAction?: { kind: "archive" | "trash" | "rename"; projectId: string } | null;
	projects: WorkspaceProject[];
}> = ({
	error,
	isCreating,
	isLoading,
	locationPathname,
	onArchiveProject,
	onCreateProject,
	onRequestDeleteProject,
	onRenameProject,
	onOpenGenerationNotification,
	onOpenProject,
	onOpenSearch,
	onOpenSettings,
	onRetry,
	projectAction = null,
	projects,
}) => (
	<div className="flex h-full flex-col">
		<div className="mb-4 px-2">
			<h2 className="text-base font-semibold text-foreground">项目</h2>
			<p className="mt-1 text-xs text-muted-foreground">本地制作工作区</p>
		</div>
		<Button
			type="button"
			variant="ghost"
			className="h-10 w-full justify-start gap-2 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			onClick={onCreateProject}
			disabled={isCreating}
		>
			{isCreating ? <Loader2 className="animate-spin" /> : <SquarePen />}
			<span className="min-w-0 flex-1 truncate text-left">新项目</span>
			<span className="rounded-sm border border-border bg-ide-toolbar px-1.5 py-0.5 text-2xs leading-none text-muted-foreground">
				⌘N
			</span>
		</Button>

		<div className="mt-3">
			<button
				type="button"
				onClick={() => onOpenSearch("global")}
				className="flex h-9 w-full items-center gap-2 rounded-xl border border-border bg-card px-3 text-left text-sm text-ide-sidebar-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground"
			>
				<Search className="size-4 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate">全局搜索</span>
				<span className="rounded-sm border border-border bg-ide-toolbar px-1.5 py-0.5 text-2xs leading-none text-muted-foreground">
					⌘K
				</span>
			</button>
		</div>

		<div className="mt-5 flex min-h-0 flex-1 flex-col">
			<div className="mb-2 px-2 text-xs font-medium text-muted-foreground">最近项目</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{projects.length > 0 ? (
					projects.map((project) => (
						<ProjectsSidebarProjectItem
							key={project.id}
							project={project}
							projectAction={projectAction}
							onArchiveProject={onArchiveProject}
							onOpenProject={onOpenProject}
							onRequestDeleteProject={onRequestDeleteProject}
							onRenameProject={onRenameProject}
						/>
					))
				) : isLoading ? (
					<div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
						<Loader2 className="size-3.5 animate-spin" />
						<span>加载项目</span>
					</div>
				) : error ? (
					<div className="flex flex-col items-start gap-1 px-2 py-1.5">
						<p className="text-xs text-error-foreground">项目加载失败</p>
						{onRetry ? (
							<Button
								type="button"
								variant="ghost"
								className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
								onClick={onRetry}
							>
								<RotateCcw className="size-3.5" />
								<span>重试</span>
							</Button>
						) : null}
					</div>
				) : (
					<p className="px-2 py-1.5 text-xs text-muted-foreground">暂无项目</p>
				)}
			</div>
		</div>

		<SidebarFooterActions
			settingsActive={locationPathname.startsWith("/settings")}
			onOpenGenerationNotification={onOpenGenerationNotification}
			onOpenSettings={onOpenSettings}
		/>
	</div>
);

const ProjectsSidebarProjectItem: React.FC<{
	onArchiveProject: (project: WorkspaceProject) => void;
	onOpenProject: (project: WorkspaceProject) => void;
	onRequestDeleteProject: (project: WorkspaceProject) => void;
	onRenameProject: (project: WorkspaceProject) => void;
	project: WorkspaceProject;
	projectAction: { kind: "archive" | "trash" | "rename"; projectId: string } | null;
}> = ({
	onArchiveProject,
	onOpenProject,
	onRenameProject,
	onRequestDeleteProject,
	project,
	projectAction,
}) => {
	const isArchiving = projectAction?.kind === "archive" && projectAction.projectId === project.id;
	const isTrashing = projectAction?.kind === "trash" && projectAction.projectId === project.id;
	const isRenaming = projectAction?.kind === "rename" && projectAction.projectId === project.id;
	const hasAction = Boolean(projectAction);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<button
					type="button"
					onClick={() => onOpenProject(project)}
					className="mb-1 flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-sm text-ide-sidebar-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground"
				>
					<Folder className="size-4 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate">{project.name}</span>
				</button>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem disabled={hasAction} onSelect={() => onOpenProject(project)}>
					<Folder className="size-4" />
					<span>打开</span>
				</ContextMenuItem>
				<ContextMenuItem disabled={hasAction} onSelect={() => onRenameProject(project)}>
					{isRenaming ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
					<span>{isRenaming ? "正在重命名" : "重命名"}</span>
				</ContextMenuItem>
				<ContextMenuItem disabled={hasAction} onSelect={() => onArchiveProject(project)}>
					{isArchiving ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<Archive className="size-4" />
					)}
					<span>{isArchiving ? "正在归档" : "归档"}</span>
				</ContextMenuItem>
				<ContextMenuItem
					className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
					disabled={hasAction}
					onSelect={() => onRequestDeleteProject(project)}
				>
					{isTrashing ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
					<span>{isTrashing ? "正在移入" : "移到垃圾箱"}</span>
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
};

export const ProjectSidebarPanel: React.FC<{
	activeProjectWorkspace: ProjectWorkspaceView;
	displayProject: WorkspaceProject | null;
	documentsProjectId: string | null;
	error?: unknown;
	isOverviewActive: boolean;
	isLoading: boolean;
	locationPathname: string;
	locationSearch: string;
	onCreateDocumentInCategory: (category: DocumentCategory) => void;
	onBack: () => void;
	onDeleteAsset: (project: WorkspaceProject, assetId: string, filename: string) => void;
	onDeleteDocument: ProjectDocumentDeleteHandler;
	onOpenAsset: (project: WorkspaceProject, assetId: string) => void;
	onOpenDocument: (project: WorkspaceProject, documentId: string) => void;
	onOpenGenerationNotification?: (notification: GenerationSuccessNotification) => void;
	onOpenNewDocument: (category?: DocumentCategory) => void;
	onOpenOverview: (project: WorkspaceProject) => void;
	onOpenProjectWorkspace: (project: WorkspaceProject, workspace: ProjectWorkspaceView) => void;
	onOpenSearch: (scope: "global" | "project") => void;
	onOpenSettings: () => void;
	showActiveSelection?: boolean;
}> = ({
	activeProjectWorkspace,
	displayProject,
	documentsProjectId,
	error,
	isOverviewActive,
	isLoading,
	locationPathname,
	locationSearch,
	onCreateDocumentInCategory,
	onBack,
	onDeleteAsset,
	onDeleteDocument,
	onOpenAsset,
	onOpenDocument,
	onOpenGenerationNotification,
	onOpenNewDocument,
	onOpenOverview,
	onOpenProjectWorkspace,
	onOpenSearch,
	onOpenSettings,
	showActiveSelection = true,
}) => {
	const documentViewMode = useDocumentViewStore((state) => state.mode);
	const setDocumentViewMode = useDocumentViewStore((state) => state.setMode);
	const startCreateRootFolderRef = useRef<(() => void) | null>(null);
	const routeDocumentId = getRouteDocumentId(locationSearch);
	const routeAssetId = getRouteAssetId(locationSearch);
	const canMutateProjectDirectory = Boolean(
		displayProject && documentsProjectId === displayProject.id,
	);
	const directoryItemSelectionEnabled = showActiveSelection && !isOverviewActive;
	const workspaceEntries: Array<{
		icon: React.ElementType;
		label: string;
		view: ProjectWorkspaceView;
	}> = [
		{ icon: LayoutDashboard, label: "项目总览", view: "dashboard" },
		{ icon: Workflow, label: "开始制作", view: "workflow" },
	];
	const productionToolEntries: Array<{
		icon: React.ElementType;
		label: string;
		view: ProjectWorkspaceView;
	}> = [
		{ icon: WandSparkles, label: "参考图迁移", view: "reference" },
		{ icon: Images, label: "资产库", view: "assets" },
		{ icon: Clapperboard, label: "镜头与动态", view: "shots" },
	];
	const setStartCreateRootFolder = useCallback((startCreateRootFolder: (() => void) | null) => {
		startCreateRootFolderRef.current = startCreateRootFolder;
	}, []);

	return (
		<div className="flex h-full flex-col">
			<div className="flex min-h-0 flex-1 flex-col">
				<div className="min-h-0 flex-1 overflow-y-auto">
					{displayProject ? (
						<div className="space-y-1">
							<div className="mb-3 px-2">
								<p className="text-xs text-muted-foreground">当前项目</p>
								<h2 className="mt-1 truncate text-base font-semibold text-foreground">
									{displayProject.name}
								</h2>
							</div>
							<div className="flex items-center gap-1.5 px-2 pb-2">
								<button
									type="button"
									className={sidebarToolbarIconButtonClassName}
									onClick={onBack}
									title="返回"
									aria-label="返回"
								>
									<ChevronLeft className="size-3.5" />
								</button>
								<div className="flex min-w-0 items-center gap-1">
									<button
										type="button"
										className={sidebarToolbarIconButtonClassName}
										onClick={() => onOpenSearch("project")}
										disabled={!displayProject}
										title="搜索当前项目"
										aria-label="搜索当前项目"
									>
										<Search className="size-3.5" />
									</button>
									<button
										type="button"
										className={sidebarToolbarIconButtonClassName}
										onClick={() => onOpenNewDocument()}
										disabled={!canMutateProjectDirectory}
										title="新建文档"
										aria-label="新建文档"
									>
										<FilePlus2 className="size-3.5" />
									</button>
									<DocumentViewModeSwitcher
										mode={documentViewMode}
										onSelectMode={setDocumentViewMode}
									/>
								</div>
							</div>
							<SidebarNavigationGroup label="工作区">
								{workspaceEntries.map((entry) => (
									<ProjectWorkspaceNavigationButton
										key={entry.view}
										active={
											showActiveSelection &&
											isOverviewActive &&
											activeProjectWorkspace === entry.view
										}
										icon={entry.icon}
										label={entry.label}
										onClick={() =>
											entry.view === "dashboard"
												? onOpenOverview(displayProject)
												: onOpenProjectWorkspace(displayProject, entry.view)
										}
									/>
								))}
							</SidebarNavigationGroup>
							<div id="project-production-stage-slot" className="mt-3" />
							<SidebarNavigationGroup label="制作工具">
								{productionToolEntries.map((entry) => (
									<ProjectWorkspaceNavigationButton
										key={entry.view}
										active={
											showActiveSelection &&
											isOverviewActive &&
											activeProjectWorkspace === entry.view
										}
										icon={entry.icon}
										label={entry.label}
										onClick={() => onOpenProjectWorkspace(displayProject, entry.view)}
									/>
								))}
							</SidebarNavigationGroup>
							<details className="group mt-4" open={Boolean(routeDocumentId || routeAssetId)}>
								<summary className="flex h-8 cursor-pointer list-none items-center gap-2 px-3 text-xs font-medium text-muted-foreground hover:text-foreground">
									<FolderTree className="size-3.5" />
									<span className="min-w-0 flex-1">阶段文件与资料</span>
									<span className="text-2xs group-open:hidden">展开</span>
									<span className="hidden text-2xs group-open:inline">收起</span>
								</summary>
								<p className="px-3 pb-2 text-[11px] leading-4 text-muted-foreground">
									这是存档区：放阶段文档、参考资料和本地文件。日常制作请从上面的“工作区”和“制作工具”进入。
								</p>
								<div className="mt-1 border-l border-border/80 pl-2">
									{documentViewMode === "directory" ? (
										<ProjectDirectoryTree
											key={displayProject.id}
											project={displayProject}
											locationPathname={locationPathname}
											routeAssetId={routeAssetId}
											routeDocumentId={routeDocumentId}
											onOpenAsset={onOpenAsset}
											onOpenDocument={onOpenDocument}
											onDeleteAsset={onDeleteAsset}
											onDeleteDocument={onDeleteDocument}
											onRootCreateRequestReady={setStartCreateRootFolder}
											showActiveSelection={directoryItemSelectionEnabled}
											showRootCreateButton={false}
										/>
									) : (
										<ProjectDirectory
											key={displayProject.id}
											project={displayProject}
											locationPathname={locationPathname}
											routeAssetId={routeAssetId}
											routeDocumentId={routeDocumentId}
											onCreateDocumentInCategory={onCreateDocumentInCategory}
											onOpenAsset={onOpenAsset}
											onOpenDocument={onOpenDocument}
											onDeleteAsset={onDeleteAsset}
											onDeleteDocument={onDeleteDocument}
											onOpenNewDocument={onOpenNewDocument}
											showActiveSelection={directoryItemSelectionEnabled}
										/>
									)}
								</div>
							</details>
						</div>
					) : isLoading ? (
						<div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
							<Loader2 className="size-3.5 animate-spin" />
							<span>加载项目</span>
						</div>
					) : error ? (
						<p className="px-2 py-1.5 text-xs text-error-foreground">项目加载失败</p>
					) : (
						<div className="px-2 py-1">
							<button
								type="button"
								className="flex h-7 w-full items-center gap-1.5 rounded-sm px-2 text-left text-xs text-ide-sidebar-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								onClick={onBack}
							>
								<ChevronLeft className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate">返回项目列表</span>
							</button>
							<p className="mt-1 px-2 py-1 text-xs text-muted-foreground">项目不存在</p>
						</div>
					)}
				</div>
			</div>

			<SidebarFooterActions
				settingsActive={isProjectSettingsRoute(locationPathname, locationSearch)}
				onOpenGenerationNotification={onOpenGenerationNotification}
				onOpenSettings={onOpenSettings}
			/>
		</div>
	);
};

const SidebarNavigationGroup: React.FC<{
	children: React.ReactNode;
	label: string;
}> = ({ children, label }) => (
	<div className="mt-4">
		<p className="mb-1 px-3 text-2xs font-medium uppercase text-muted-foreground">{label}</p>
		<div className="grid gap-0.5">{children}</div>
	</div>
);

const ProjectWorkspaceNavigationButton: React.FC<{
	active: boolean;
	icon: React.ElementType;
	label: string;
	onClick: () => void;
}> = ({ active, icon: Icon, label, onClick }) => (
	<button
		type="button"
		onClick={onClick}
		className={cn(
			"flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors",
			active
				? "bg-ide-list-active font-medium text-ide-list-active-foreground"
				: "text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
		)}
	>
		<Icon className="size-4 shrink-0" />
		<span className="min-w-0 flex-1 truncate">{label}</span>
	</button>
);

const SidebarFooterActions: React.FC<{
	onOpenGenerationNotification?: (notification: GenerationSuccessNotification) => void;
	onOpenSettings: () => void;
	settingsActive: boolean;
}> = () => null;

const sidebarToolbarIconButtonClassName =
	"flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

const DocumentViewModeSwitcher: React.FC<{
	mode: "category" | "directory";
	onSelectMode: (mode: "category" | "directory") => void;
}> = ({ mode, onSelectMode }) => {
	const nextMode = mode === "category" ? "directory" : "category";
	const label = nextMode === "directory" ? "切换到目录视图" : "切换到类别视图";
	return (
		<button
			type="button"
			className={sidebarToolbarIconButtonClassName}
			onClick={() => onSelectMode(nextMode)}
			title={label}
			aria-label={label}
		>
			{mode === "category" ? (
				<LayoutList className="size-3.5" />
			) : (
				<FolderTree className="size-3.5" />
			)}
		</button>
	);
};
