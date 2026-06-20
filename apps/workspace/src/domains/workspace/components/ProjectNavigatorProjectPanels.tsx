import {
	ChevronLeft,
	FilePlus2,
	Folder,
	FolderPlus,
	FolderTree,
	LayoutDashboard,
	LayoutList,
	Loader2,
	Search,
	SquarePen,
} from "lucide-react";
import type React from "react";
import { useCallback, useRef } from "react";
import type { WorkspaceProject } from "@/domains/projects/api/projects";
import type { DocumentCategory } from "@/domains/documents/stores";
import type { GenerationSuccessNotification } from "@/domains/generation/stores/generation-notifications";
import { Button } from "@/shared/components/ui/button";
import {
	ProjectDirectory,
	type ProjectDocumentDeleteHandler,
} from "@/domains/workspace/components/ProjectDirectory";
import { ProjectDirectoryTree } from "@/domains/workspace/components/ProjectDirectoryTree";
import { SettingsButton } from "@/domains/workspace/components/ProjectNavigatorPanels";
import { GenerationNotificationButton } from "@/domains/workspace/components/GenerationNotificationButton";
import { GlobalToolboxButton } from "@/domains/workspace/components/GlobalToolboxDrawer";
import { AssetLibraryButton } from "@/domains/workspace/components/AssetLibraryButton";
import {
	getRouteAssetId,
	getRouteDocumentId,
	isProjectSettingsRoute,
} from "@/domains/workspace/lib/workbench-route";
import { useDocumentViewStore } from "@/lib/stores/document-view";
import { cn } from "@/shared/lib/utils";

export const ProjectsSidebarPanel: React.FC<{
	error?: unknown;
	isCreating: boolean;
	isLoading: boolean;
	locationPathname: string;
	onCreateProject: () => void;
	onOpenProject: (project: WorkspaceProject) => void;
	onOpenGenerationNotification?: (notification: GenerationSuccessNotification) => void;
	onOpenSearch: (scope: "global" | "project") => void;
	onOpenSettings: () => void;
	projects: WorkspaceProject[];
}> = ({
	error,
	isCreating,
	isLoading,
	locationPathname,
	onCreateProject,
	onOpenGenerationNotification,
	onOpenProject,
	onOpenSearch,
	onOpenSettings,
	projects,
}) => (
	<div className="flex h-full flex-col">
		<Button
			type="button"
			variant="ghost"
			className="h-8 w-full justify-start gap-2 rounded-sm px-2 text-sm font-normal text-ide-sidebar-foreground hover:bg-ide-list-hover hover:text-foreground"
			onClick={onCreateProject}
			disabled={isCreating}
		>
			{isCreating ? <Loader2 className="animate-spin" /> : <SquarePen />}
			<span className="min-w-0 flex-1 truncate text-left">新项目</span>
			<span className="rounded-sm border border-border bg-ide-toolbar px-1.5 py-0.5 text-2xs leading-none text-muted-foreground">
				⌘N
			</span>
		</Button>

		<div className="mt-2">
			<button
				type="button"
				onClick={() => onOpenSearch("global")}
				className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-ide-sidebar-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground"
			>
				<Search className="size-4 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate">全局搜索</span>
				<span className="rounded-sm border border-border bg-ide-toolbar px-1.5 py-0.5 text-2xs leading-none text-muted-foreground">
					⌘K
				</span>
			</button>
		</div>

		<div className="mt-5 flex min-h-0 flex-1 flex-col">
			<div className="mb-2 px-2 text-xs font-medium text-muted-foreground">项目</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{isLoading ? (
					<div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
						<Loader2 className="size-3.5 animate-spin" />
						<span>加载项目</span>
					</div>
				) : error ? (
					<p className="px-2 py-1.5 text-xs text-error-foreground">项目加载失败</p>
				) : projects.length === 0 ? (
					<p className="px-2 py-1.5 text-xs text-muted-foreground">暂无项目</p>
				) : (
					projects.map((project) => (
						<button
							key={project.id}
							type="button"
							onClick={() => onOpenProject(project)}
							className="mb-0.5 flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-ide-sidebar-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground"
						>
							<Folder className="size-4 shrink-0 text-muted-foreground" />
							<span className="min-w-0 flex-1 truncate">{project.name}</span>
						</button>
					))
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

export const ProjectSidebarPanel: React.FC<{
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
	onOpenSearch: (scope: "global" | "project") => void;
	onOpenSettings: () => void;
	showActiveSelection?: boolean;
}> = ({
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
	const setStartCreateRootFolder = useCallback((startCreateRootFolder: (() => void) | null) => {
		startCreateRootFolderRef.current = startCreateRootFolder;
	}, []);

	return (
		<div className="flex h-full flex-col">
			<div className="mt-5 flex min-h-0 flex-1 flex-col">
				<div className="min-h-0 flex-1 overflow-y-auto">
					{displayProject ? (
						<div className="space-y-1">
							<div className="flex items-center justify-between gap-2 px-2 pb-1">
								<button
									type="button"
									className={sidebarToolbarIconButtonClassName}
									onClick={onBack}
									title="返回"
									aria-label="返回"
								>
									<ChevronLeft className="size-3.5" />
								</button>
								<div className="flex min-w-0 items-center justify-end gap-1">
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
									{documentViewMode === "directory" ? (
										<button
											type="button"
											className={sidebarToolbarIconButtonClassName}
											onClick={() => startCreateRootFolderRef.current?.()}
											disabled={!canMutateProjectDirectory}
											title="新建文件夹"
											aria-label="新建文件夹"
										>
											<FolderPlus className="size-3.5" />
										</button>
									) : null}
									<DocumentViewModeSwitcher
										mode={documentViewMode}
										onSelectMode={setDocumentViewMode}
									/>
								</div>
							</div>
							<button
								type="button"
								onClick={() => onOpenOverview(displayProject)}
								className={cn(
									"flex h-7 w-full items-center gap-1.5 rounded-sm px-2 text-left text-xs transition-colors",
									showActiveSelection && isOverviewActive
										? "bg-ide-list-active text-ide-list-active-foreground"
										: "text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
								)}
							>
								<LayoutDashboard className="size-3.5 shrink-0" />
								<span className="min-w-0 flex-1 truncate">项目概览</span>
							</button>
							{documentViewMode === "directory" ? (
								<ProjectDirectoryTree
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
					) : isLoading ? (
						<div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
							<Loader2 className="size-3.5 animate-spin" />
							<span>加载项目</span>
						</div>
					) : error ? (
						<p className="px-2 py-1.5 text-xs text-error-foreground">项目加载失败</p>
					) : (
						<p className="px-2 py-1.5 text-xs text-muted-foreground">项目不存在</p>
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

const SidebarFooterActions: React.FC<{
	onOpenGenerationNotification?: (notification: GenerationSuccessNotification) => void;
	onOpenSettings: () => void;
	settingsActive: boolean;
}> = ({ onOpenGenerationNotification, onOpenSettings, settingsActive }) => (
	<div className="mt-auto pt-2">
		<div className="flex items-center gap-1">
			<div className="min-w-0 flex-1">
				<SettingsButton isActive={settingsActive} onClick={onOpenSettings} />
			</div>
			<AssetLibraryButton />
			<GlobalToolboxButton />
			{onOpenGenerationNotification ? (
				<GenerationNotificationButton onOpenNotification={onOpenGenerationNotification} />
			) : null}
		</div>
	</div>
);

const sidebarToolbarIconButtonClassName =
	"flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

const DocumentViewModeSwitcher: React.FC<{
	mode: "category" | "directory";
	onSelectMode: (mode: "category" | "directory") => void;
}> = ({ mode, onSelectMode }) => (
	<div className="flex h-7 shrink-0 items-center rounded-sm border border-border bg-ide-toolbar p-0.5">
		<button
			type="button"
			className={cn(
				"flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground",
				mode === "category" && "bg-ide-list-active text-ide-list-active-foreground",
			)}
			onClick={() => onSelectMode("category")}
			title="类别视图"
			aria-label="类别视图"
			aria-pressed={mode === "category"}
		>
			<LayoutList className="size-3.5" />
		</button>
		<button
			type="button"
			className={cn(
				"flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground",
				mode === "directory" && "bg-ide-list-active text-ide-list-active-foreground",
			)}
			onClick={() => onSelectMode("directory")}
			title="目录视图"
			aria-label="目录视图"
			aria-pressed={mode === "directory"}
		>
			<FolderTree className="size-3.5" />
		</button>
	</div>
);
