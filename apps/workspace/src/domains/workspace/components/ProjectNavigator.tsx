import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderKanban, Image, Settings, Trash2, Video } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import useSWR, { mutate as mutateSWR } from "swr";
import {
	archiveProject,
	collectReusableProductionMemory,
	createProject,
	deleteProject,
	getProjects,
	projectsKey,
	projectsKeyForStatus,
	updateProjectConfig,
	updateProject,
	type WorkspaceProject,
} from "@/domains/projects/api/projects";
import { openProjectRenameDialog } from "@/domains/projects/components/ProjectRenameDialog";
import {
	type GenerationSuccessNotification,
	useGenerationNotificationStore,
} from "@/domains/generation/stores/generation-notifications";
import { MediaGenerationDialogHost } from "@/domains/generation/components/MediaGenerationDialogHost";
import { AssetLibraryButton } from "@/domains/workspace/components/AssetLibraryButton";
import { GlobalToolboxButton } from "@/domains/workspace/components/GlobalToolboxDrawer";
import { GenerationNotificationButton } from "@/domains/workspace/components/GenerationNotificationButton";
import { GenerationNotificationSync } from "@/domains/generation/components/GenerationNotificationSync";
import { markGenerationNotificationRead } from "@/domains/generation/api/generation";
import { deleteProjectAsset, uploadProjectAsset } from "@/domains/workspace/api/project-assets";
import {
	createWorkspaceDocument,
	getWorkspaceDocuments,
	workspaceDocumentsKey,
} from "@/domains/workspace/api/workspace";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/shared/lib/utils";
import {
	type DocumentCategory,
	type MarkdownDocument,
	useDocumentsStore,
} from "@/domains/documents/stores";
import { useProjectStore } from "@/domains/projects/stores";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
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
	getRouteProjectWorkspace,
	isProjectSettingsRoute,
	settingsPath,
	studioTabPath,
	type ProjectWorkspaceView,
} from "@/domains/workspace/lib/workbench-route";
import { projectCreateRequestEvent } from "@/domains/workspace/lib/project-create-request";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";
import { projectSettingsGeneralTab, useSettingsNavigationStore } from "@/lib/stores/settings";
import { useWorkModeStore } from "@/lib/stores/work-mode";
import { openAgentProjectCreateDialog } from "./AgentProjectCreateDialog";
import type { AgentProjectCreateChoice } from "./AgentProjectCreateDialog";
import {
	buildProductionTemplateDocuments,
	productionTemplateById,
	productionTemplateSnapshot,
	productionStageStates,
} from "@/lib/production/production-templates";
import { openNewDocumentDialog, type NewDocumentDialogChoice } from "./NewDocumentDialog";
import { openNewReferenceDocumentDialog } from "./NewReferenceDocumentDialog";
import { SettingsSidebarPanel, StudioSessionsScreen } from "./ProjectNavigatorPanels";
import { ProjectSidebarPanel, ProjectsSidebarPanel } from "./ProjectNavigatorProjectPanels";
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
	const documentsProjectId = useDocumentsStore((state) => state.projectId);
	const prepareWorkspaceLoad = useDocumentsStore((state) => state.prepareWorkspaceLoad);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const activeAssetId = useDocumentsStore((state) => state.activeAssetId);
	const selectDocument = useDocumentsStore((state) => state.selectDocument);
	const selectAsset = useDocumentsStore((state) => state.selectAsset);
	const activeSettingsTab = useSettingsNavigationStore((state) => state.activeTab);
	const setActiveSettingsTab = useSettingsNavigationStore((state) => state.setActiveTab);
	const requestOpenGenerationNotification = useGenerationNotificationStore(
		(state) => state.requestOpenNotification,
	);
	const agentLayoutTab = useAgentLayoutStore((state) => state.tab);
	const setAgentLayoutTab = useAgentLayoutStore((state) => state.setTab);
	const workMode = useWorkModeStore((state) => state.mode);
	const setWorkMode = useWorkModeStore((state) => state.setMode);
	const [isCreating, setIsCreating] = useState(false);
	const [projectAction, setProjectAction] = useState<{
		kind: "archive" | "trash" | "rename";
		projectId: string;
	} | null>(null);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [searchScope, setSearchScope] = useState<"global" | "project">("global");
	const [displayProjectId, setDisplayProjectId] = useState(activeProjectId);
	const previousProjectSettingsIdRef = useRef<string | null>(null);

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
	const activeProjectWorkspace = getRouteProjectWorkspace(location.search);
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

	const refreshProjectLists = useCallback(async () => {
		await Promise.all([
			mutate(),
			mutateSWR(projectsKeyForStatus("archived")),
			mutateSWR(projectsKeyForStatus("trashed")),
		]);
	}, [mutate]);

	const leaveProjectIfHidden = useCallback(
		(projectId: string) => {
			const routeProjectId = getRouteProjectId(location.search);
			const shouldLeave =
				activeProjectId === projectId ||
				displayProjectId === projectId ||
				routeProjectId === projectId;
			if (!shouldLeave) return;

			setActiveProjectId(null);
			setDisplayProjectId(null);
			prepareWorkspaceLoad("请选择一个项目");
			navigate("/", { replace: true });
		},
		[
			activeProjectId,
			displayProjectId,
			location.search,
			navigate,
			prepareWorkspaceLoad,
			setActiveProjectId,
		],
	);

	const showDocumentPane = useCallback(() => {
		setAgentLayoutTab("document");
	}, [setAgentLayoutTab]);

	const openProject = useCallback(
		(project: WorkspaceProject) => {
			showDocumentPane();
			setActiveProjectId(project.id);
			// “继续制作”必须进入真实工作台，而不是先落到统计总览。
			navigate(
				agentProjectPath(project.id, {
					workspace: "workflow",
					stageId: project.production?.currentStageId,
				}),
				{
					state: agentProjectRouteState("overview"),
				},
			);
		},
		[navigate, setActiveProjectId, showDocumentPane],
	);

	const archiveSidebarProject = useCallback(
		async (project: WorkspaceProject) => {
			if (projectAction) return;

			setProjectAction({ kind: "archive", projectId: project.id });
			try {
				await archiveProject(project.id);
				await refreshProjectLists();
				leaveProjectIfHidden(project.id);
				toast.success("项目已归档", { description: project.name });
			} catch (err) {
				const message = err instanceof Error ? err.message : "归档项目失败。";
				toast.error("归档项目失败", { description: message });
			} finally {
				setProjectAction(null);
			}
		},
		[leaveProjectIfHidden, projectAction, refreshProjectLists, toast],
	);

	const renameSidebarProject = useCallback(
		(project: WorkspaceProject) => {
			if (projectAction) return;
			void (async () => {
				const nextName = await openProjectRenameDialog({ projectName: project.name });
				if (!nextName || nextName === project.name.trim()) return;

				setProjectAction({ kind: "rename", projectId: project.id });
				try {
					const renamed = await updateProject(project.id, { name: nextName });
					await refreshProjectLists();
					toast.success("项目已重命名", { description: renamed.name });
				} catch (err) {
					const message = err instanceof Error ? err.message : "重命名项目失败。";
					toast.error("重命名项目失败", { description: message });
				} finally {
					setProjectAction(null);
				}
			})();
		},
		[projectAction, refreshProjectLists, toast],
	);

	const trashSidebarProject = useCallback(
		async (project: WorkspaceProject) => {
			if (projectAction) return false;

			setProjectAction({ kind: "trash", projectId: project.id });
			try {
				await deleteProject(project.id);
				await refreshProjectLists();
				leaveProjectIfHidden(project.id);
				toast.success("项目已移到垃圾箱", { description: project.name });
				return true;
			} catch (err) {
				const message = err instanceof Error ? err.message : "移到垃圾箱失败。";
				toast.error("移到垃圾箱失败", { description: message });
				return false;
			} finally {
				setProjectAction(null);
			}
		},
		[leaveProjectIfHidden, projectAction, refreshProjectLists, toast],
	);

	const requestTrashSidebarProject = useCallback(
		(project: WorkspaceProject) => {
			void confirmDialog({
				title: "移到垃圾箱？",
				description: (
					<>
						确定要将“{project.name}”移到垃圾箱吗？项目文件夹会移动到
						.mediago-drama/trash，之后可以在垃圾箱中恢复。
					</>
				),
				confirmLabel: "移到垃圾箱",
				confirmIcon: <Trash2 />,
				onConfirm: () => trashSidebarProject(project),
			});
		},
		[trashSidebarProject],
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
			requestOpenGenerationNotification(notification.id);
			void markGenerationNotificationRead(notification.id);
		},
		[requestOpenGenerationNotification],
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

	const openProjectWorkspace = useCallback(
		(project: WorkspaceProject, workspace: ProjectWorkspaceView) => {
			showDocumentPane();
			setActiveProjectId(project.id);
			navigate(agentProjectPath(project.id, { workspace }), {
				state: agentProjectRouteState("overview"),
			});
		},
		[navigate, setActiveProjectId, showDocumentPane],
	);

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
				location.pathname === "/projects" &&
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

	const openGlobalSettings = useCallback(() => {
		setActiveSettingsTab("appearance");
		navigate("/settings");
	}, [navigate, setActiveSettingsTab]);

	const openProjectCenter = useCallback(() => {
		setWorkMode("agent");
		if (displayProject) {
			setActiveProjectId(displayProject.id);
			navigate(
				agentProjectPath(displayProject.id, {
					workspace: "workflow",
					stageId: displayProject.production?.currentStageId,
				}),
				{ state: agentProjectRouteState("overview") },
			);
			return;
		}
		setActiveProjectId(null);
		navigate("/");
	}, [displayProject, navigate, setActiveProjectId, setWorkMode]);

	const openGenerationKind = useCallback((kind: "image" | "video") => {
		setWorkMode("studio");
		navigate(studioTabPath(kind));
	}, [navigate, setWorkMode]);

	const openProjectSettings = useCallback(() => {
		setActiveSettingsTab(projectSettingsGeneralTab);
		navigate(projectSettingsPath);
	}, [navigate, projectSettingsPath, setActiveSettingsTab]);

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

	const requestNewDocument = useCallback(
		async (category?: DocumentCategory) => {
			const choice =
				category === "reference"
					? await openNewReferenceDocumentDialog()
					: await openNewDocumentDialog({
							initialCategory: category ?? null,
							showReferenceHandoff: true,
						});
			if (!choice) return;

			const finalChoice =
				choice.kind === "reference" ? await openNewReferenceDocumentDialog() : choice;
			if (!finalChoice) return;
			createDocumentFromTemplate(finalChoice);
		},
		[createDocumentFromTemplate],
	);

	const createProjectFromName = useCallback(
		async (choice: AgentProjectCreateChoice) => {
			if (isCreating) return;
			const projectName = choice.name.trim() || "未命名项目";
			const template = productionTemplateById(choice.templateId);

			setIsCreating(true);
			try {
				const reusableMemory = await collectReusableProductionMemory(data?.projects ?? []);
				const project = await createProject({ name: projectName });
				const documents = buildProductionTemplateDocuments(template, projectName);
				for (const document of documents) {
					await createWorkspaceDocument(
						{
							id: document.id,
							title: document.title,
							content: document.content,
							category: document.category,
							parentId: null,
							sortOrder: document.sortOrder,
						},
						project.id,
					);
				}
				const snapshot = productionTemplateSnapshot(template);
				await updateProjectConfig(project.id, {
					overview: {
						production: {
							template: snapshot,
							stageStates: productionStageStates(template),
							currentStageId: template.id === "custom" ? undefined : template.stages[0]?.id,
							overallProgress: 0,
							coreAssetCount: 0,
							shotCount: 0,
							completedShotCount: 0,
							reviewShotCount: 0,
							version: "V01",
							updatedAt: new Date().toISOString(),
							blockers: [],
							nextAction: `完成“${template.stages[0]?.title ?? "项目总控"}”并提交审核。`,
							sharedContext: Object.values(reusableMemory).some((items) => items.length > 0)
								? {
										...reusableMemory,
										updatedAt: new Date().toISOString(),
									}
								: undefined,
						},
					},
				});
				// 先锁定新项目并进入第一个可执行阶段。列表刷新不能阻塞或重置
				// 刚刚建立的工作区路由，否则用户会被送回项目中心。
				showDocumentPane();
				setActiveProjectId(project.id);
				navigate(agentProjectPath(project.id, { workspace: "workflow", stageId: "stage-1" }), {
					state: agentProjectRouteState("overview"),
				});
				void Promise.all([mutate(), mutateSWR(projectsKey)]);
				toast.success("心悦制作台项目已创建", {
					description: `${project.name} · ${template.label}`,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : "创建项目失败。";
				toast.error("创建项目失败", { description: message });
			} finally {
				setIsCreating(false);
			}
		},
		[data?.projects, isCreating, mutate, navigate, setActiveProjectId, showDocumentPane, toast],
	);

	const openAgentCreateDialog = useCallback(() => {
		void (async () => {
			const choice = await openAgentProjectCreateDialog();
			if (!choice) return;
			await createProjectFromName(choice);
		})();
	}, [createProjectFromName]);

	useEffect(() => {
		const handleCreateRequest = () => openAgentCreateDialog();
		window.addEventListener(projectCreateRequestEvent, handleCreateRequest);
		return () => window.removeEventListener(projectCreateRequestEvent, handleCreateRequest);
	}, [openAgentCreateDialog]);

	useEffect(() => {
		if (activeProjectId) setDisplayProjectId(activeProjectId);
	}, [activeProjectId]);

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

	useEffect(() => {
		const projectSettingsId = isProjectSettingsMode ? getRouteProjectId(location.search) : null;
		if (projectSettingsId && previousProjectSettingsIdRef.current !== projectSettingsId) {
			setActiveSettingsTab(projectSettingsGeneralTab);
		}
		previousProjectSettingsIdRef.current = projectSettingsId;
	}, [isProjectSettingsMode, location.search, setActiveSettingsTab]);

	return (
		<>
			<GenerationNotificationSync />
			<MediaGenerationDialogHost />
			<div className="flex h-full min-h-0 overflow-hidden text-ide-sidebar-foreground">
				<nav className="brand-activity-rail flex w-16 shrink-0 flex-col items-center px-1.5 pb-3 pt-2 text-white">
					<button
						type="button"
						aria-label="返回主界面"
						title="返回主界面"
						onClick={openProjectCenter}
						className="mb-5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
					>
						<img src="/heart-logo.png" alt="心悦制作台" className="size-10 rounded-xl" />
					</button>
					<PrimaryRailButton
						active={activeWorkMode === "agent" && !isProjectSettingsMode}
						icon={FolderKanban}
						label="项目"
						onClick={openProjectCenter}
					/>
					<PrimaryRailButton
						active={activeWorkMode === "studio" && activeStudioTab === "image"}
						icon={Image}
						label="图片生成"
						onClick={() => openGenerationKind("image")}
					/>
					<PrimaryRailButton
						active={activeWorkMode === "studio" && activeStudioTab === "video"}
						icon={Video}
						label="视频生成"
						onClick={() => openGenerationKind("video")}
					/>
					<div className="rail-utility mt-auto flex flex-col items-center gap-1">
						<AssetLibraryButton />
						<GlobalToolboxButton />
						<GenerationNotificationButton onOpenNotification={openGenerationNotification} />
						<PrimaryRailButton
							active={activeScreen === "settings"}
							icon={Settings}
							label="设置"
							onClick={openGlobalSettings}
						/>
					</div>
				</nav>
				<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden px-3 pb-3 pt-4">
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
										projectAction={projectAction}
										onArchiveProject={(project) => void archiveSidebarProject(project)}
										onCreateProject={openAgentCreateDialog}
										onRequestDeleteProject={requestTrashSidebarProject}
										onRenameProject={renameSidebarProject}
										onOpenGenerationNotification={openGenerationNotification}
										onOpenProject={openProject}
										onOpenSearch={openSearch}
										onOpenSettings={openGlobalSettings}
										onRetry={() => void mutate()}
									/>
								),
							},
							{
								id: "project",
								level: sidebarScreenLevel("project", { isProjectSettings: false }),
								node: (
									<ProjectSidebarPanel
										activeProjectWorkspace={activeProjectWorkspace}
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
										onOpenNewDocument={requestNewDocument}
										onOpenOverview={openOverview}
										onOpenProjectWorkspace={openProjectWorkspace}
										onOpenSearch={openSearch}
										onOpenSettings={openProjectSettings}
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
											isProjectMode && activeProjectId
												? openProjectSettings()
												: openGlobalSettings()
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
		</>
	);
};

const PrimaryRailButton: React.FC<{
	active: boolean;
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	onClick: () => void;
}> = ({ active, icon: Icon, label, onClick }) => (
	<button
		type="button"
		className={cn(
			"mb-2 flex w-14 flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-xs transition-colors",
			active
				? "bg-white/20 font-medium text-white shadow-sm"
				: "text-white/70 hover:bg-white/12 hover:text-white",
		)}
		onClick={onClick}
	>
		<Icon className="size-5" />
		<span>{label}</span>
	</button>
);

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
