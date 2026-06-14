import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useSWR, { mutate as mutateSWR } from "swr";
import {
	createProject,
	getProjects,
	projectsKey,
	type WorkspaceProject,
} from "@/domains/projects/api/projects";
import {
	type GenerationSuccessNotification,
	useGenerationNotificationStore,
} from "@/domains/generation/stores/generation-notifications";
import { GenerationNotificationSync } from "@/domains/generation/components/GenerationNotificationSync";
import { markGenerationNotificationRead } from "@/domains/generation/api/generation";
import { deleteProjectAsset, uploadProjectAsset } from "@/domains/workspace/api/project-assets";
import { getWorkspaceDocuments, workspaceDocumentsKey } from "@/domains/workspace/api/workspace";
import { useToast } from "@/hooks/useToast";
import {
	type DocumentCategory,
	type MarkdownDocument,
	useDocumentsStore,
} from "@/domains/documents/stores";
import { useProjectStore } from "@/domains/projects/stores";
import {
	resolveSidebarScreen,
	studioTabFromPath,
	workModeForScreen,
} from "@/domains/workspace/lib/sidebar-navigation";
import {
	sidebarScreenLevel,
	usesProjectSettingsSidebar,
} from "@/domains/workspace/lib/app-route-descriptor";
import {
	agentProjectPath,
	agentProjectRouteState,
	getRouteAssetId,
	getRouteDocumentId,
	getRouteProjectId,
	isProjectSettingsRoute,
	settingsPath,
	studioTabPath,
} from "@/domains/workspace/lib/workbench-route";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";
import { useSettingsNavigationStore } from "@/lib/stores/settings";
import { useWorkModeStore } from "@/lib/stores/work-mode";
import { NewDocumentDialog, type NewDocumentDialogChoice } from "./NewDocumentDialog";
import { NewSourceMaterialDialog } from "./NewSourceMaterialDialog";
import { SettingsSidebarPanel, StudioSessionsScreen } from "./ProjectNavigatorPanels";
import {
	AgentProjectCreateDialog,
	ProjectSidebarPanel,
	ProjectsSidebarPanel,
} from "./ProjectNavigatorProjectPanels";
import type { StudioTab } from "./ProjectNavigatorTypes";
import { ProjectDocumentSearchDialog } from "./ProjectDocumentSearchDialog";
import { SidebarScreenStack } from "./SidebarScreenStack";

interface ProjectNavigatorProps {
	activeProjectId: string | null;
}

export const ProjectNavigator: React.FC<ProjectNavigatorProps> = ({ activeProjectId }) => {
	const navigate = useNavigate();
	const location = useLocation();
	const toast = useToast();
	const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);
	const { data, error, isLoading, mutate } = useSWR(projectsKey, getProjects);
	const createDocument = useDocumentsStore((state) => state.createDocument);
	const deleteDocument = useDocumentsStore((state) => state.deleteDocument);
	const documents = useDocumentsStore((state) => state.documents);
	const documentsProjectId = useDocumentsStore((state) => state.projectId);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const activeAssetId = useDocumentsStore((state) => state.activeAssetId);
	const selectDocument = useDocumentsStore((state) => state.selectDocument);
	const selectAsset = useDocumentsStore((state) => state.selectAsset);
	const activeSettingsTab = useSettingsNavigationStore((state) => state.activeTab);
	const setActiveSettingsTab = useSettingsNavigationStore((state) => state.setActiveTab);
	const requestOpenGenerationNotification = useGenerationNotificationStore(
		(state) => state.requestOpenNotification,
	);
	const pendingGenerationOpenRequest = useGenerationNotificationStore(
		(state) => state.pendingOpenRequest,
	);
	const agentLayoutTab = useAgentLayoutStore((state) => state.tab);
	const setAgentLayoutTab = useAgentLayoutStore((state) => state.setTab);
	const workMode = useWorkModeStore((state) => state.mode);
	const setWorkMode = useWorkModeStore((state) => state.setMode);
	const [isCreating, setIsCreating] = useState(false);
	const [isAgentCreateOpen, setIsAgentCreateOpen] = useState(false);
	const [newAgentProjectName, setNewAgentProjectName] = useState("");
	const [isNewDocumentOpen, setIsNewDocumentOpen] = useState(false);
	const [isSourceMaterialOpen, setIsSourceMaterialOpen] = useState(false);
	const [newDocumentInitialCategory, setNewDocumentInitialCategory] =
		useState<DocumentCategory | null>(null);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [searchScope, setSearchScope] = useState<"global" | "project">("global");
	const [displayProjectId, setDisplayProjectId] = useState(activeProjectId);

	const projects = useMemo(
		() => [...(data?.projects ?? [])].sort(compareProjectsByCreatedAtDesc),
		[data?.projects],
	);
	const visibleProjects = projects;
	const isProjectMode = Boolean(activeProjectId);
	const visibleProjectId = activeProjectId ?? displayProjectId;
	const displayProject = visibleProjects.find((project) => project.id === visibleProjectId) ?? null;
	const searchProjects =
		searchScope === "project" ? (displayProject ? [displayProject] : []) : visibleProjects;
	const projectSettingsPath = settingsPath(visibleProjectId);
	const activeScreen = resolveSidebarScreen(location.pathname, location.search, {
		projectId: activeProjectId,
		workMode,
	});
	const isProjectSettingsMode = isProjectSettingsRoute(location.pathname, location.search);
	const routeWorkMode = workModeForScreen(activeScreen);
	const activeWorkMode = routeWorkMode ?? workMode;
	const studioSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
	const activeStudioTab = studioTabFromPath(location.pathname);
	const activeStudioConversationId = studioSearchParams.get("conversation") ?? "";
	const routeDocumentId = getRouteDocumentId(location.search);
	const routeAssetId = getRouteAssetId(location.search);
	const isOverviewActive = !routeDocumentId && !routeAssetId;
	const showProjectSidebarActiveSelection = agentLayoutTab === "document";
	const settingsScreenIsProjectSettings = usesProjectSettingsSidebar(
		activeScreen,
		isProjectSettingsMode,
	);
	const settingsScreenLevel = sidebarScreenLevel("settings", {
		isProjectSettings: settingsScreenIsProjectSettings,
	});

	const openSearch = useCallback((scope: "global" | "project") => {
		setSearchScope(scope);
		setIsSearchOpen(true);
	}, []);

	const showDocumentPane = useCallback(() => {
		setAgentLayoutTab("document");
	}, [setAgentLayoutTab]);

	const openProject = useCallback(
		(project: WorkspaceProject) => {
			showDocumentPane();
			setActiveProjectId(project.id);
			navigate(agentProjectPath(project.id), {
				state: agentProjectRouteState("overview"),
			});
		},
		[navigate, setActiveProjectId, showDocumentPane],
	);

	const openDocument = useCallback(
		(project: WorkspaceProject, documentId: string) => {
			showDocumentPane();
			setActiveProjectId(project.id);
			selectDocument(documentId);
			navigate(agentProjectPath(project.id, { documentId }), {
				state: agentProjectRouteState("document"),
			});
		},
		[navigate, selectDocument, setActiveProjectId, showDocumentPane],
	);

	const openAsset = useCallback(
		(project: WorkspaceProject, assetId: string) => {
			showDocumentPane();
			setActiveProjectId(project.id);
			selectAsset(assetId);
			navigate(agentProjectPath(project.id, { assetId }), {
				state: agentProjectRouteState("document"),
			});
		},
		[navigate, selectAsset, setActiveProjectId, showDocumentPane],
	);

	const openGenerationNotification = useCallback(
		(notification: GenerationSuccessNotification) => {
			const openedNotification = requestOpenGenerationNotification(notification.id);
			const target = openedNotification?.target ?? notification.target;
			void markGenerationNotificationRead(notification.id);

			showDocumentPane();
			setActiveProjectId(target.projectId);
			selectDocument(target.documentId);
			navigate(agentProjectPath(target.projectId, { documentId: target.documentId }), {
				state: agentProjectRouteState("document"),
			});
		},
		[
			navigate,
			requestOpenGenerationNotification,
			selectDocument,
			setActiveProjectId,
			showDocumentPane,
		],
	);

	const openOverview = useCallback(
		(project: WorkspaceProject) => {
			showDocumentPane();
			setActiveProjectId(project.id);
			navigate(agentProjectPath(project.id), {
				state: agentProjectRouteState("overview"),
			});
		},
		[navigate, setActiveProjectId, showDocumentPane],
	);

	const openNewDocumentDialog = useCallback((category?: DocumentCategory) => {
		if (category === "source-material") {
			setIsSourceMaterialOpen(true);
			return;
		}
		setNewDocumentInitialCategory(category ?? null);
		setIsNewDocumentOpen(true);
	}, []);

	const deleteProjectDocument = useCallback(
		(project: WorkspaceProject, document: MarkdownDocument, deletedIds: string[]) => {
			if (documentsProjectId !== project.id) {
				toast.info("文档库加载中", { description: "稍等片刻再删除文档。" });
				return;
			}

			const deletedIdSet = new Set(deletedIds);
			deleteDocument(document.id);
			void mutateSWR(projectsKey);

			if (
				location.pathname === "/agent" &&
				getRouteProjectId(location.search) === project.id &&
				deletedIdSet.has(activeDocumentId)
			) {
				navigate(agentProjectPath(project.id), {
					state: agentProjectRouteState("overview"),
				});
			}

			const documentTitle = document.title || "未命名文档";
			toast.success("文档已删除", {
				description:
					deletedIds.length > 1
						? `已删除“${documentTitle}”及 ${deletedIds.length - 1} 篇子文档。`
						: `已删除“${documentTitle}”。`,
			});
		},
		[
			activeDocumentId,
			deleteDocument,
			documentsProjectId,
			location.pathname,
			location.search,
			navigate,
			toast,
		],
	);

	const deleteProjectAssetRecord = useCallback(
		async (project: WorkspaceProject, assetId: string, filename: string) => {
			if (documentsProjectId !== project.id) {
				toast.info("素材库加载中", { description: "稍等片刻再删除素材。" });
				return;
			}

			try {
				await deleteProjectAsset(project.id, assetId);
				const state = await getWorkspaceDocuments(project.id);
				useDocumentsStore.getState().hydrateWorkspaceDocuments(state);
				await mutateSWR(workspaceDocumentsKey(project.id));
				if (activeAssetId === assetId) {
					navigate(agentProjectPath(project.id), {
						state: agentProjectRouteState("overview"),
					});
				}
				toast.success("素材已删除", { description: filename || "未命名文件" });
			} catch (err) {
				const message = err instanceof Error ? err.message : "删除素材失败。";
				toast.error("删除素材失败", { description: message });
			}
		},
		[activeAssetId, documentsProjectId, navigate, toast],
	);

	const returnToProjects = useCallback(() => {
		setActiveProjectId(null);
		navigate("/");
	}, [navigate, setActiveProjectId]);

	const returnFromSettings = useCallback(() => {
		if (window.history.length > 1) {
			navigate(-1);
		} else if (isProjectSettingsMode && visibleProjectId) {
			navigate(agentProjectPath(visibleProjectId), {
				state: agentProjectRouteState("overview"),
			});
		} else if (activeWorkMode === "studio") {
			navigate("/");
		} else {
			navigate("/");
		}
	}, [activeWorkMode, isProjectSettingsMode, navigate, visibleProjectId]);

	const selectStudioConversation = useCallback(
		(kind: StudioTab, conversationId: string) => {
			setWorkMode("studio");
			navigate(studioTabPath(kind, { conversationId }));
		},
		[navigate, setWorkMode],
	);

	const createDocumentFromTemplate = useCallback(
		(choice: NewDocumentDialogChoice) => {
			if (!displayProject) return;
			if (documentsProjectId !== displayProject.id) {
				toast.info("文档库加载中", { description: "稍等片刻再操作素材库。" });
				return;
			}

			if (choice.kind === "upload") {
				void (async () => {
					try {
						const asset = await uploadProjectAsset(displayProject.id, choice.file);
						const state = await getWorkspaceDocuments(displayProject.id);
						useDocumentsStore.getState().hydrateWorkspaceDocuments(state);
						await mutateSWR(workspaceDocumentsKey(displayProject.id));
						setIsNewDocumentOpen(false);
						setIsSourceMaterialOpen(false);
						showDocumentPane();
						setActiveProjectId(displayProject.id);
						selectAsset(asset.id);
						navigate(agentProjectPath(displayProject.id, { assetId: asset.id }), {
							state: agentProjectRouteState("document"),
						});
						toast.success("素材已上传", { description: asset.filename || choice.file.name });
					} catch (err) {
						const message = err instanceof Error ? err.message : "上传文件失败。";
						toast.error("上传失败", { description: message });
					}
				})();
				return;
			}

			const document = createDocument({
				category: choice.category,
			});
			if (!document) {
				toast.error("创建失败", { description: "无法创建该类型的文档。" });
				return;
			}

			setIsNewDocumentOpen(false);
			setIsSourceMaterialOpen(false);
			showDocumentPane();
			setActiveProjectId(displayProject.id);
			selectDocument(document.id);
			navigate(agentProjectPath(displayProject.id, { documentId: document.id }), {
				state: agentProjectRouteState("document"),
			});
			toast.success("文档已创建", { description: document.title || "未命名文档" });
		},
		[
			createDocument,
			displayProject,
			documentsProjectId,
			navigate,
			selectAsset,
			selectDocument,
			setActiveProjectId,
			showDocumentPane,
			toast,
		],
	);

	const openAgentCreateDialog = useCallback(() => {
		setIsAgentCreateOpen(true);
	}, []);

	const createProjectFromName = useCallback(async () => {
		if (isCreating) return;

		const name = newAgentProjectName.trim() || "未命名项目";

		setIsCreating(true);
		try {
			const project = await createProject({ name });
			await mutate();
			await mutateSWR(projectsKey);
			setIsAgentCreateOpen(false);
			setNewAgentProjectName("");
			showDocumentPane();
			setActiveProjectId(project.id);
			navigate(agentProjectPath(project.id), {
				state: agentProjectRouteState("overview"),
			});
			toast.success("项目已创建", { description: project.name });
		} catch (err) {
			const message = err instanceof Error ? err.message : "创建项目失败。";
			toast.error("创建项目失败", { description: message });
		} finally {
			setIsCreating(false);
		}
	}, [
		isCreating,
		mutate,
		navigate,
		newAgentProjectName,
		setActiveProjectId,
		showDocumentPane,
		toast,
	]);

	useEffect(() => {
		if (activeProjectId) setDisplayProjectId(activeProjectId);
	}, [activeProjectId]);

	useEffect(() => {
		const target = pendingGenerationOpenRequest?.target;
		if (!target) return;
		if (documentsProjectId !== target.projectId) return;
		if (activeDocumentId === target.documentId) return;
		if (!documents.some((document) => document.id === target.documentId)) return;

		selectDocument(target.documentId);
	}, [
		activeDocumentId,
		documents,
		documentsProjectId,
		pendingGenerationOpenRequest,
		selectDocument,
	]);

	useEffect(() => {
		if (!routeWorkMode || routeWorkMode === workMode) return;
		setWorkMode(routeWorkMode);
	}, [routeWorkMode, setWorkMode, workMode]);

	useEffect(() => {
		const createOnShortcut = (event: KeyboardEvent) => {
			if (!event.metaKey && !event.ctrlKey) return;
			const key = event.key.toLowerCase();
			if (key === "n") {
				event.preventDefault();
				openAgentCreateDialog();
			} else if (key === "k") {
				event.preventDefault();
				openSearch(isProjectMode ? "project" : "global");
			}
		};

		window.addEventListener("keydown", createOnShortcut);
		return () => window.removeEventListener("keydown", createOnShortcut);
	}, [isProjectMode, openAgentCreateDialog, openSearch]);

	return (
		<>
			<GenerationNotificationSync />
			<div className="flex h-full min-h-0 flex-col overflow-hidden text-ide-sidebar-foreground">
				<div className="relative min-h-0 flex-1 overflow-hidden">
					<SidebarScreenStack
						activeId={activeScreen}
						screens={[
							{
								id: "projects",
								level: sidebarScreenLevel("projects", { isProjectSettings: false }),
								node: (
									<ProjectsSidebarPanel
										error={error}
										isCreating={isCreating}
										isLoading={isLoading}
										locationPathname={location.pathname}
										projects={visibleProjects}
										onCreateProject={openAgentCreateDialog}
										onOpenGenerationNotification={openGenerationNotification}
										onOpenProject={openProject}
										onOpenSearch={openSearch}
										onOpenSettings={() => navigate("/settings")}
									/>
								),
							},
							{
								id: "project",
								level: sidebarScreenLevel("project", { isProjectSettings: false }),
								node: (
									<ProjectSidebarPanel
										displayProject={displayProject}
										documentsProjectId={documentsProjectId}
										error={error}
										isLoading={isLoading}
										locationPathname={location.pathname}
										isOverviewActive={isOverviewActive}
										locationSearch={location.search}
										showActiveSelection={showProjectSidebarActiveSelection}
										onBack={returnToProjects}
										onDeleteDocument={deleteProjectDocument}
										onDeleteAsset={deleteProjectAssetRecord}
										onOpenDocument={openDocument}
										onOpenGenerationNotification={openGenerationNotification}
										onOpenAsset={openAsset}
										onCreateDocumentInCategory={(category) =>
											createDocumentFromTemplate({ kind: "document", category })
										}
										onOpenNewDocument={openNewDocumentDialog}
										onOpenOverview={openOverview}
										onOpenSearch={openSearch}
										onOpenSettings={() => navigate(projectSettingsPath)}
									/>
								),
							},
							{
								id: "studio-types",
								level: sidebarScreenLevel("studio-types", { isProjectSettings: false }),
								node: (
									<StudioSessionsScreen
										activeConversationId={activeStudioConversationId}
										activeTab={activeStudioTab}
										onOpenSettings={() =>
											navigate(isProjectMode && activeProjectId ? projectSettingsPath : "/settings")
										}
										onOpenGenerationNotification={openGenerationNotification}
										onSelectConversation={selectStudioConversation}
									/>
								),
							},
							{
								id: "studio-conversations",
								level: sidebarScreenLevel("studio-conversations", {
									isProjectSettings: false,
								}),
								node: null,
							},
							{
								id: "settings",
								level: settingsScreenLevel,
								node: (
									<SettingsSidebarPanel
										activeTab={activeSettingsTab}
										isProjectSettings={settingsScreenIsProjectSettings}
										projectName={displayProject?.name ?? visibleProjectId ?? "项目设置"}
										onBack={returnFromSettings}
										onOpenGenerationNotification={openGenerationNotification}
										onSelectTab={setActiveSettingsTab}
									/>
								),
							},
						]}
					/>
				</div>
			</div>
			<ProjectDocumentSearchDialog
				open={isSearchOpen}
				onOpenChange={setIsSearchOpen}
				projects={searchProjects}
				onOpenDocument={openDocument}
				scopeLabel={searchScope === "project" ? "当前项目" : "所有项目"}
			/>
			<NewDocumentDialog
				open={isNewDocumentOpen}
				initialCategory={newDocumentInitialCategory}
				onOpenChange={setIsNewDocumentOpen}
				onCreate={createDocumentFromTemplate}
			/>
			<NewSourceMaterialDialog
				open={isSourceMaterialOpen}
				onOpenChange={setIsSourceMaterialOpen}
				onCreate={createDocumentFromTemplate}
			/>
			<AgentProjectCreateDialog
				open={isAgentCreateOpen}
				isCreating={isCreating}
				projectName={newAgentProjectName}
				onOpenChange={setIsAgentCreateOpen}
				onProjectNameChange={setNewAgentProjectName}
				onCreate={() => void createProjectFromName()}
			/>
		</>
	);
};

const compareProjectsByCreatedAtDesc = (left: WorkspaceProject, right: WorkspaceProject) => {
	const leftTime = getProjectCreatedAtTime(left);
	const rightTime = getProjectCreatedAtTime(right);

	if (rightTime !== leftTime) return rightTime - leftTime;

	return left.id.localeCompare(right.id);
};

const getProjectCreatedAtTime = (project: WorkspaceProject) => {
	const timestamp = Date.parse(project.createdAt);
	return Number.isFinite(timestamp) ? timestamp : 0;
};
