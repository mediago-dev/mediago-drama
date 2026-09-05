import {
	Archive,
	ArrowRight,
	Clapperboard,
	Check,
	CheckSquare,
	FolderOpen,
	GripVertical,
	ImageIcon,
	Images,
	Layers3,
	Loader2,
	Pencil,
	Plus,
	RotateCcw,
	ScanSearch,
	Search,
	ShieldCheck,
	Trash2,
	X,
	type LucideIcon,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import useSWR, { useSWRConfig } from "swr";
import {
	archiveProject,
	deleteProject,
	getProjectConfig,
	getProjects,
	normalizeProjectProductionState,
	permanentlyDeleteProject,
	projectProductionStages,
	type ProjectStatusFilter,
	projectsKeyForStatus,
	restoreProject,
	updateProject,
	updateProjectConfig,
	type ProjectConfig,
	type WorkspaceProject,
} from "@/domains/projects/api/projects";
import { openProjectRenameDialog } from "@/domains/projects/components/ProjectRenameDialog";
import { useProjectStore } from "@/domains/projects/stores";
import { uploadProjectAsset } from "@/domains/workspace/api/project-assets";
import { agentProjectPath, agentProjectRouteState } from "@/domains/workspace/lib/workbench-route";
import { requestProjectCreate } from "@/domains/workspace/lib/project-create-request";
import { useToast } from "@/hooks/useToast";
import { type ProductionStageState } from "@/lib/production/production-templates";
import { analytics, AnalyticsEvent } from "@/shared/analytics";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { Button } from "@/shared/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import { apiResourceURL } from "@/shared/lib/api-base";
import { cn } from "@/shared/lib/utils";

type ProjectManagementTab = Exclude<ProjectStatusFilter, "all">;
type ProjectAction = "archive" | "trash" | "restore" | "permanent" | "rename";
type InteractionMode = "browse" | "manage" | "sort";

type MarqueeSelection = {
	currentX: number;
	currentY: number;
	startX: number;
	startY: number;
};

type ProjectCardSummary = {
	blockerCount: number;
	currentOrder: number;
	currentState: ProductionStageState;
	progress: number;
	totalStages: number;
};

const stagePriority: Record<ProductionStageState, number> = {
	BLOCKED: 0,
	NEEDS_FIX: 1,
	REVIEW: 2,
	IN_PROGRESS: 3,
	NOT_STARTED: 4,
	PASS: 5,
};

const projectTabs: Array<{ label: string; status: ProjectManagementTab }> = [
	{ label: "制作中", status: "active" },
	{ label: "归档", status: "archived" },
	{ label: "垃圾箱", status: "trashed" },
];

const tabMeta: Record<
	ProjectManagementTab,
	{
		emptyDescription: string;
		emptyTitle: string;
		icon: LucideIcon;
	}
> = {
	active: {
		emptyDescription: "从左侧新建一个项目，开始第一段制作流程。",
		emptyTitle: "还没有制作项目",
		icon: FolderOpen,
	},
	archived: {
		emptyDescription: "归档后的项目会显示在这里。",
		emptyTitle: "没有归档项目",
		icon: Archive,
	},
	trashed: {
		emptyDescription: "移到垃圾箱的项目可以恢复，也可以永久删除。",
		emptyTitle: "垃圾箱为空",
		icon: Trash2,
	},
};

export const Projects: React.FC = () => {
	const navigate = useNavigate();
	const toast = useToast();
	const { mutate } = useSWRConfig();
	const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);
	const [activeTab, setActiveTab] = useState<ProjectManagementTab>("active");
	const [interactionMode, setInteractionMode] = useState<InteractionMode>("browse");
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
	const [action, setAction] = useState<{ kind: ProjectAction; projectId: string } | null>(null);
	const [bulkPending, setBulkPending] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [orderIds, setOrderIds] = useState<string[]>([]);
	const [sortSnapshot, setSortSnapshot] = useState<string[]>([]);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [marqueeSelection, setMarqueeSelection] = useState<MarqueeSelection | null>(null);
	const projectSurfaceRef = useRef<HTMLDivElement>(null);
	const marqueePointerId = useRef<number | null>(null);
	const marqueeMoved = useRef(false);
	const suppressContextMenuUntil = useRef(0);
	const [projectSummaries, setProjectSummaries] = useState<Record<string, ProjectCardSummary>>({});
	// 项目列表接口可能返回旧的摘要；工作区使用 config 接口中的真实生产状态。
	// 在列表层把两者合并，避免“工作区已经有流程、列表却显示 0%”的错位。
	const [projectConfigById, setProjectConfigById] = useState<Record<string, ProjectConfig>>({});
	const swrKey = projectsKeyForStatus(activeTab);
	const {
		data,
		error,
		isLoading,
		mutate: revalidateProjects,
	} = useSWR(swrKey, () => getProjects(activeTab));

	useEffect(() => {
		let cancelled = false;
		const listedProjects = data?.projects ?? [];
		if (listedProjects.length === 0) {
			setProjectConfigById({});
			return () => {
				cancelled = true;
			};
		}

		void Promise.all(
			listedProjects.map(async (project) => {
				try {
					return [project.id, await getProjectConfig(project.id)] as const;
				} catch {
					// 旧项目或迁移中的项目可能还没有 config；保留列表接口的旧数据。
					return null;
				}
			}),
		).then((entries) => {
			if (cancelled) return;
			const next = Object.fromEntries(
				entries.filter((entry): entry is readonly [string, ProjectConfig] => Boolean(entry)),
			);
			setProjectConfigById((current) => ({ ...current, ...next }));
		});

		return () => {
			cancelled = true;
		};
	}, [data?.projects]);

	useEffect(() => {
		setInteractionMode("browse");
		setSelectedIds(new Set());
		setLastSelectedIndex(null);
		setSearchQuery("");
		setDraggingId(null);
		setOrderIds([]);
	}, [activeTab]);

	const projects = useMemo(() => {
		const syncedProjects = (data?.projects ?? []).map((project) => {
			const config = projectConfigById[project.id];
			if (!config) return project;
			return {
				...project,
				production: config.overview.production ?? project.production,
				coverAssetId: config.overview.coverAssetId ?? project.coverAssetId,
				sortOrder: config.overview.sortOrder ?? project.sortOrder,
				outputDirectory: config.overview.outputDirectory ?? project.outputDirectory,
			};
		});
		const sorted = [...syncedProjects].sort(compareProjectsByPersistedOrder);
		if (orderIds.length === 0) return sorted;
		const rank = new Map(orderIds.map((id, index) => [id, index]));
		return sorted.sort((left, right) => {
			const leftRank = rank.get(left.id);
			const rightRank = rank.get(right.id);
			if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
			if (leftRank !== undefined) return -1;
			if (rightRank !== undefined) return 1;
			return compareProjectsByUpdatedAtDesc(left, right);
		});
	}, [data?.projects, orderIds, projectConfigById]);

	const visibleProjects = useMemo(() => {
		const query = searchQuery.trim().toLocaleLowerCase("zh-CN");
		if (!query) return projects;
		return projects.filter((project) =>
			`${project.name} ${project.description}`.toLocaleLowerCase("zh-CN").includes(query),
		);
	}, [projects, searchQuery]);

	const featuredProject =
		activeTab === "active"
			? [...visibleProjects].sort((left, right) => {
					const leftSummary = projectSummaries[left.id];
					const rightSummary = projectSummaries[right.id];
					const priorityDifference =
						(stagePriority[leftSummary?.currentState ?? "NOT_STARTED"] ?? 4) -
						(stagePriority[rightSummary?.currentState ?? "NOT_STARTED"] ?? 4);
					return priorityDifference || compareProjectsByUpdatedAtDesc(left, right);
				})[0]
			: undefined;
	const remainingProjects = featuredProject
		? visibleProjects.filter((project) => project.id !== featuredProject.id)
		: visibleProjects;
	const meta = tabMeta[activeTab];
	const isBusy = Boolean(action) || bulkPending;
	const showWelcome = activeTab === "active" && !isLoading && !error && projects.length === 0;
	const reportProjectSummary = useCallback((projectId: string, summary: ProjectCardSummary) => {
		setProjectSummaries((current) => {
			const previous = current[projectId];
			if (
				previous &&
				previous.blockerCount === summary.blockerCount &&
				previous.currentOrder === summary.currentOrder &&
				previous.currentState === summary.currentState &&
				previous.progress === summary.progress &&
				previous.totalStages === summary.totalStages
			) {
				return current;
			}
			return { ...current, [projectId]: summary };
		});
	}, []);

	const openProject = (project: WorkspaceProject) => {
		analytics.track(AnalyticsEvent.OpenProject, {
			document_count: project.documentCount,
			project_id: project.id,
			status: project.status,
		});
		setActiveProjectId(project.id);
		// 打开项目就是进入当前生产阶段，不再先落到只展示数据的总览页。
		// 总览仍然保留在项目工作区中，用户需要时可从侧栏进入。
		navigate(
			agentProjectPath(project.id, {
				workspace: "workflow",
				stageId: project.production?.currentStageId ?? "stage-1",
			}),
			{
				state: agentProjectRouteState("overview"),
			},
		);
	};

	const refreshProjectLists = async () => {
		await Promise.all([
			mutate(projectsKeyForStatus("active")),
			mutate(projectsKeyForStatus("archived")),
			mutate(projectsKeyForStatus("trashed")),
		]);
	};

	const leaveInteractionMode = () => {
		setInteractionMode("browse");
		setSelectedIds(new Set());
		setLastSelectedIndex(null);
		setDraggingId(null);
	};

	useEffect(() => {
		if (interactionMode === "browse") return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !isBusy) leaveInteractionMode();
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [interactionMode, isBusy]);

	const enterManageMode = () => {
		setInteractionMode("manage");
		setSelectedIds(new Set());
		setLastSelectedIndex(null);
	};

	const enterSortMode = () => {
		setSortSnapshot(projects.map((project) => project.id));
		setOrderIds(projects.map((project) => project.id));
		setInteractionMode("sort");
	};

	const saveSortMode = async () => {
		setBulkPending(true);
		try {
			await Promise.all(
				orderIds.map((projectId, sortOrder) =>
					updateProjectConfig(projectId, { overview: { sortOrder } }),
				),
			);
			await revalidateProjects();
			setInteractionMode("browse");
			setDraggingId(null);
			toast.success("项目顺序已保存到工作区");
		} catch (error) {
			toast.error("保存项目顺序失败", {
				description: error instanceof Error ? error.message : "请稍后重试。",
			});
		} finally {
			setBulkPending(false);
		}
	};

	const cancelSortMode = () => {
		setOrderIds(sortSnapshot);
		setInteractionMode("browse");
		setDraggingId(null);
	};

	const selectProject = (
		projectId: string,
		index: number,
		options: { additive: boolean; range: boolean },
	) => {
		setSelectedIds((current) => {
			if (options.range && lastSelectedIndex !== null) {
				const start = Math.min(lastSelectedIndex, index);
				const end = Math.max(lastSelectedIndex, index);
				const next = options.additive ? new Set(current) : new Set<string>();
				visibleProjects.slice(start, end + 1).forEach((project) => next.add(project.id));
				return next;
			}
			const next = options.additive ? new Set(current) : new Set(current);
			if (next.has(projectId)) next.delete(projectId);
			else next.add(projectId);
			return next;
		});
		setLastSelectedIndex(index);
	};

	const selectAllVisible = () =>
		setSelectedIds(new Set(visibleProjects.map((project) => project.id)));
	const clearSelection = () => {
		setSelectedIds(new Set());
		setLastSelectedIndex(null);
	};

	const moveProjectBefore = (targetId: string) => {
		if (!draggingId || draggingId === targetId) return;
		setOrderIds((current) => {
			const next = current.filter((id) => id !== draggingId);
			const targetIndex = next.indexOf(targetId);
			next.splice(targetIndex < 0 ? next.length : targetIndex, 0, draggingId);
			return next;
		});
	};

	const runBulk = async (kind: "archive" | "trash" | "restore" | "permanent") => {
		if (selectedIds.size === 0 || isBusy) return false;
		const targets = projects.filter((project) => selectedIds.has(project.id));
		setBulkPending(true);
		// Project trash/restore operations move whole directories. Running several
		// Windows directory moves at once can make sibling removals interfere with
		// each other, so keep bulk actions ordered while still collecting failures.
		const results: PromiseSettledResult<unknown>[] = [];
		for (const project of targets) {
			try {
				if (kind === "archive") await archiveProject(project.id);
				else if (kind === "trash") await retryProjectRemoval(() => deleteProject(project.id));
				else if (kind === "restore") await restoreProject(project.id);
				else await retryProjectRemoval(() => permanentlyDeleteProject(project.id));
				results.push({ status: "fulfilled", value: undefined });
			} catch (reason) {
				results.push({ status: "rejected", reason });
			}
		}
		const failedIds = new Set(
			results.flatMap((result, index) => (result.status === "rejected" ? [targets[index].id] : [])),
		);
		const firstFailure = results.find(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		const succeeded = targets.length - failedIds.size;
		await refreshProjectLists();
		setBulkPending(false);
		if (failedIds.size === 0) {
			leaveInteractionMode();
			toast.success(`已处理 ${succeeded} 个项目`);
			return true;
		}
		setSelectedIds(failedIds);
		toast.error(`${failedIds.size} 个项目处理失败`, {
			description: firstFailure
				? projectManagementErrorMessage(firstFailure.reason, "请稍后重试。")
				: succeeded > 0
					? `另外 ${succeeded} 个项目已处理完成。`
					: "请稍后重试。",
		});
		return false;
	};

	const requestBulkAction = (kind: "archive" | "trash" | "restore" | "permanent") => {
		if (kind === "trash" || kind === "permanent") {
			const isPermanent = kind === "permanent";
			void confirmDialog({
				title: isPermanent
					? `永久删除 ${selectedIds.size} 个项目？`
					: `移动 ${selectedIds.size} 个项目到垃圾箱？`,
				description: isPermanent
					? "永久删除后，本地项目文件和记录都无法恢复。"
					: "项目文件会移入本地垃圾箱，之后仍可恢复。",
				confirmLabel: isPermanent ? "永久删除" : "移到垃圾箱",
				confirmIcon: <Trash2 />,
				onConfirm: () => runBulk(kind),
			});
			return;
		}
		void runBulk(kind);
	};

	const restoreCurrentProject = async (project: WorkspaceProject) => {
		if (isBusy) return;
		setAction({ kind: "restore", projectId: project.id });
		try {
			const restored = await restoreProject(project.id);
			await refreshProjectLists();
			toast.success("项目已恢复", { description: restored.name || project.name });
		} catch (error) {
			toast.error("恢复项目失败", {
				description: projectManagementErrorMessage(error, "恢复项目失败。"),
			});
		} finally {
			setAction(null);
		}
	};

	const archiveCurrentProject = async (project: WorkspaceProject) => {
		if (isBusy) return;
		setAction({ kind: "archive", projectId: project.id });
		try {
			await archiveProject(project.id);
			await refreshProjectLists();
			toast.success("项目已归档", { description: project.name });
		} catch (error) {
			toast.error("归档项目失败", {
				description: projectManagementErrorMessage(error, "归档项目失败。"),
			});
		} finally {
			setAction(null);
		}
	};

	const renameCurrentProject = (project: WorkspaceProject) => {
		if (isBusy) return;
		void (async () => {
			const nextName = await openProjectRenameDialog({ projectName: project.name });
			if (!nextName || nextName === project.name.trim()) return;
			setAction({ kind: "rename", projectId: project.id });
			try {
				const renamed = await updateProject(project.id, { name: nextName });
				await refreshProjectLists();
				toast.success("项目已重命名", { description: renamed.name });
			} catch (error) {
				toast.error("重命名项目失败", {
					description: projectManagementErrorMessage(error, "重命名项目失败。"),
				});
			} finally {
				setAction(null);
			}
		})();
	};

	const deleteCurrentProject = async (project: WorkspaceProject) => {
		if (isBusy) return false;
		setAction({ kind: "trash", projectId: project.id });
		try {
			await deleteProject(project.id);
			await refreshProjectLists();
			toast.success("项目已移到垃圾箱", { description: project.name });
			return true;
		} catch (error) {
			toast.error("移到垃圾箱失败", {
				description: projectManagementErrorMessage(error, "移到垃圾箱失败。"),
			});
			return false;
		} finally {
			setAction(null);
		}
	};

	const permanentlyDeleteCurrentProject = async (project: WorkspaceProject) => {
		if (isBusy) return false;
		setAction({ kind: "permanent", projectId: project.id });
		try {
			await permanentlyDeleteProject(project.id);
			await refreshProjectLists();
			toast.success("项目已永久删除", { description: project.name });
			return true;
		} catch (error) {
			toast.error("永久删除失败", {
				description: projectManagementErrorMessage(error, "永久删除项目失败。"),
			});
			return false;
		} finally {
			setAction(null);
		}
	};

	const confirmDeleteProject = (project: WorkspaceProject) => {
		void confirmDialog({
			title: "移到垃圾箱？",
			description: `确定要将“${project.name}”移到垃圾箱吗？之后仍可恢复。`,
			confirmLabel: "移到垃圾箱",
			confirmIcon: <Trash2 />,
			onConfirm: () => deleteCurrentProject(project),
		});
	};

	const confirmPermanentlyDeleteProject = (project: WorkspaceProject) => {
		void confirmDialog({
			title: "永久删除项目？",
			description: "永久删除后，本地项目文件和记录都会被清除，无法恢复。",
			confirmLabel: "永久删除",
			confirmIcon: <Trash2 />,
			onConfirm: () => permanentlyDeleteCurrentProject(project),
		});
	};

	const updateMarqueeSelection = (selection: MarqueeSelection) => {
		const left = Math.min(selection.startX, selection.currentX);
		const right = Math.max(selection.startX, selection.currentX);
		const top = Math.min(selection.startY, selection.currentY);
		const bottom = Math.max(selection.startY, selection.currentY);
		const next = new Set<string>();
		projectSurfaceRef.current?.querySelectorAll<HTMLElement>("[data-project-card-id]").forEach((card) => {
			const bounds = card.getBoundingClientRect();
			if (bounds.left <= right && bounds.right >= left && bounds.top <= bottom && bounds.bottom >= top) {
				const projectId = card.dataset.projectCardId;
				if (projectId) next.add(projectId);
			}
		});
		setSelectedIds(next);
	};

	const handleMarqueePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 2 || interactionMode === "sort" || isBusy) return;
		marqueePointerId.current = event.pointerId;
		marqueeMoved.current = false;
		event.currentTarget.setPointerCapture(event.pointerId);
		setMarqueeSelection({
			currentX: event.clientX,
			currentY: event.clientY,
			startX: event.clientX,
			startY: event.clientY,
		});
	};

	const handleMarqueePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (marqueePointerId.current !== event.pointerId || !marqueeSelection) return;
		const next = { ...marqueeSelection, currentX: event.clientX, currentY: event.clientY };
		if (
			!marqueeMoved.current &&
			Math.hypot(next.currentX - next.startX, next.currentY - next.startY) >= 5
		) {
			marqueeMoved.current = true;
			setInteractionMode("manage");
		}
		if (marqueeMoved.current) {
			event.preventDefault();
			updateMarqueeSelection(next);
		}
		setMarqueeSelection(next);
	};

	const finishMarqueeSelection = (event: React.PointerEvent<HTMLDivElement>) => {
		if (marqueePointerId.current !== event.pointerId) return;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (marqueeMoved.current) {
			event.preventDefault();
			suppressContextMenuUntil.current = Date.now() + 500;
		}
		marqueePointerId.current = null;
		marqueeMoved.current = false;
		setMarqueeSelection(null);
	};

	const renderProject = (project: WorkspaceProject, index: number, featured: boolean) => (
		<ProjectCard
			key={project.id}
			action={action}
			activeTab={activeTab}
			featured={featured}
			interactionMode={interactionMode}
			isBusy={isBusy}
			project={project}
			selected={selectedIds.has(project.id)}
			onArchive={() => void archiveCurrentProject(project)}
			onDragEnd={() => setDraggingId(null)}
			onDragStart={() => setDraggingId(project.id)}
			onDrop={() => moveProjectBefore(project.id)}
			onOpen={openProject}
			onRename={() => renameCurrentProject(project)}
			onRequestDelete={() => confirmDeleteProject(project)}
			onRequestPermanentDelete={() => confirmPermanentlyDeleteProject(project)}
			onRestore={() => void restoreCurrentProject(project)}
			onSelect={(options) => selectProject(project.id, index, options)}
			onSummary={(summary) => reportProjectSummary(project.id, summary)}
		/>
	);

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
			<header className="min-h-16 shrink-0 bg-card px-7 py-4">
				<div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
					{interactionMode === "browse" ? (
						<>
							<div className="min-w-0">
								<h1 className="text-xl font-semibold text-foreground">
									{activeTab === "active"
										? showWelcome
											? "欢迎"
											: "继续制作"
										: activeTab === "archived"
											? "归档项目"
											: "垃圾箱"}
								</h1>
								<p className="mt-1 text-xs text-muted-foreground">
									{activeTab === "active"
										? showWelcome
											? "建立第一个项目，开始组织故事、资产、镜头与版本。"
											: "按住鼠标右键拖动画框可多选项目；单击右键仍打开项目菜单。"
										: meta.emptyDescription}
								</p>
							</div>
							{activeTab === "active" && !showWelcome ? (
								<span className="shrink-0 text-xs text-muted-foreground">
									{projects.length} 个制作项目
								</span>
							) : null}
						</>
					) : null}
					{interactionMode === "manage" ? (
						<>
							<div>
								<p className="text-sm font-medium text-foreground">管理项目</p>
								<p className="mt-1 text-xs text-muted-foreground">
									点击卡片只会选择 · 已选择 {selectedIds.size} 个 · 按 Esc 退出
								</p>
							</div>
							<div className="flex flex-wrap items-center justify-end gap-2">
								<Button size="sm" variant="ghost" onClick={selectAllVisible} disabled={isBusy}>
									全选当前结果
								</Button>
								<Button size="sm" variant="ghost" onClick={clearSelection} disabled={isBusy}>
									取消选择
								</Button>
								{activeTab === "active" ? (
									<>
										<Button
											size="sm"
											variant="secondary"
											disabled={selectedIds.size === 0 || isBusy}
											onClick={() => requestBulkAction("archive")}
										>
											<Archive />
											归档
										</Button>
										<Button
											size="sm"
											variant="destructive"
											disabled={selectedIds.size === 0 || isBusy}
											onClick={() => requestBulkAction("trash")}
										>
											<Trash2 />
											移到垃圾箱
										</Button>
									</>
								) : (
									<Button
										size="sm"
										variant="secondary"
										disabled={selectedIds.size === 0 || isBusy}
										onClick={() => requestBulkAction("restore")}
									>
										<RotateCcw />
										恢复
									</Button>
								)}
								{activeTab === "trashed" ? (
									<Button
										size="sm"
										variant="destructive"
										disabled={selectedIds.size === 0 || isBusy}
										onClick={() => requestBulkAction("permanent")}
									>
										<Trash2 />
										永久删除
									</Button>
								) : null}
								<Button size="sm" onClick={leaveInteractionMode} disabled={isBusy}>
									{bulkPending ? <Loader2 className="animate-spin" /> : <Check />}
									完成
								</Button>
							</div>
						</>
					) : null}
					{interactionMode === "sort" ? (
						<>
							<div>
								<p className="text-sm font-medium text-foreground">手动排序</p>
								<p className="mt-1 text-xs text-muted-foreground">拖动卡片左上角把手调整顺序。</p>
							</div>
							<div className="flex items-center gap-2">
								<Button size="sm" variant="ghost" onClick={cancelSortMode}>
									取消
								</Button>
								<Button size="sm" onClick={saveSortMode}>
									<Check />
									保存顺序
								</Button>
							</div>
						</>
					) : null}
				</div>
			</header>
			<div className="shrink-0 border-b border-border/70 bg-card px-7 py-1.5">
				<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-5">
						{projectTabs.map((tab) => (
							<button
								key={tab.status}
								type="button"
								disabled={interactionMode !== "browse"}
								onClick={() => setActiveTab(tab.status)}
								className={cn(
									"h-8 border-b text-xs transition-colors disabled:cursor-default",
									activeTab === tab.status
										? "border-foreground font-medium text-foreground"
										: "border-transparent text-muted-foreground hover:text-foreground",
								)}
							>
								{tab.label}
							</button>
						))}
					</div>
					<div
						className={cn(
							"flex flex-wrap items-center gap-2",
							interactionMode !== "browse" && "invisible",
						)}
					>
						{projects.length > 0 ? (
							<>
								<label className="relative">
									<Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
									<input
										type="search"
										value={searchQuery}
										onChange={(event) => setSearchQuery(event.target.value)}
										placeholder="搜索项目"
										className="h-8 w-44 rounded-md border border-input bg-background pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
									/>
								</label>
								<Button
									size="sm"
									variant="secondary"
									onClick={enterSortMode}
									disabled={projects.length < 2}
								>
									<GripVertical />
									排序
								</Button>
								<Button size="sm" variant="secondary" onClick={enterManageMode}>
									<CheckSquare />
									批量管理
								</Button>
							</>
						) : null}
					</div>
				</div>
			</div>

			<div
				ref={projectSurfaceRef}
				className="min-h-0 flex-1 overflow-auto bg-background px-7 py-6"
				onPointerDown={handleMarqueePointerDown}
				onPointerMove={handleMarqueePointerMove}
				onPointerUp={finishMarqueeSelection}
				onPointerCancel={finishMarqueeSelection}
				onContextMenuCapture={(event) => {
					if (Date.now() < suppressContextMenuUntil.current) event.preventDefault();
				}}
			>
				{marqueeSelection && marqueeMoved.current ? (
					<div
						className="pointer-events-none fixed z-50 border border-primary bg-primary/10"
						style={{
							left: Math.min(marqueeSelection.startX, marqueeSelection.currentX),
							top: Math.min(marqueeSelection.startY, marqueeSelection.currentY),
							width: Math.abs(marqueeSelection.currentX - marqueeSelection.startX),
							height: Math.abs(marqueeSelection.currentY - marqueeSelection.startY),
						}}
					/>
				) : null}
				{isLoading && projects.length === 0 ? (
					<ProjectManagementCenterState icon={Loader2} title="正在读取项目" spin />
				) : null}
				{!isLoading && error && projects.length === 0 ? (
					<ProjectManagementCenterState
						icon={FolderOpen}
						title="项目列表加载失败"
						description="本地项目服务暂时不可用。"
						action={
							<Button type="button" variant="secondary" onClick={() => void revalidateProjects()}>
								<RotateCcw />
								重试
							</Button>
						}
					/>
				) : null}
				{showWelcome ? <ProductionWelcome onCreateProject={requestProjectCreate} /> : null}
				{!isLoading && !error && projects.length === 0 && activeTab !== "active" ? (
					<ProjectManagementCenterState
						icon={meta.icon}
						title={meta.emptyTitle}
						description={meta.emptyDescription}
					/>
				) : null}
				{projects.length > 0 && visibleProjects.length === 0 ? (
					<ProjectManagementCenterState
						icon={Search}
						title="没有匹配的项目"
						description="换一个关键词，或清除搜索内容。"
					/>
				) : null}
				{visibleProjects.length > 0 ? (
					<div className="mx-auto w-full max-w-6xl">
						{featuredProject && interactionMode !== "sort" ? (
							<section>
								<div className="mb-2 flex items-center justify-between">
									<h2 className="text-xs font-medium text-foreground">建议先处理</h2>
									<span className="text-[11px] text-muted-foreground">按风险与待办推荐</span>
								</div>
								{renderProject(featuredProject, 0, true)}
							</section>
						) : null}
						{remainingProjects.length > 0 || interactionMode === "sort" ? (
							<section className={cn(featuredProject && interactionMode !== "sort" && "mt-5")}>
								<div className="mb-2 flex items-center justify-between">
									<h2 className="text-xs font-medium text-foreground">
										{featuredProject && interactionMode !== "sort" ? "其他项目" : "全部项目"}
									</h2>
									<span className="text-[11px] text-muted-foreground">
										{visibleProjects.length} 个项目
									</span>
								</div>
								<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
									{(interactionMode === "sort" ? visibleProjects : remainingProjects).map(
										(project, index) =>
											renderProject(
												project,
												interactionMode === "sort"
													? index
													: visibleProjects.findIndex((item) => item.id === project.id),
												false,
											),
									)}
								</div>
							</section>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
};

const ProjectCard: React.FC<{
	action: { kind: ProjectAction; projectId: string } | null;
	activeTab: ProjectManagementTab;
	featured: boolean;
	interactionMode: InteractionMode;
	isBusy: boolean;
	onArchive: () => void;
	onDragEnd: () => void;
	onDragStart: () => void;
	onDrop: () => void;
	onOpen: (project: WorkspaceProject) => void;
	onRename: () => void;
	onRequestDelete: () => void;
	onRequestPermanentDelete: () => void;
	onRestore: () => void;
	onSelect: (options: { additive: boolean; range: boolean }) => void;
	onSummary: (summary: ProjectCardSummary) => void;
	project: WorkspaceProject;
	selected: boolean;
}> = ({
	action,
	activeTab,
	featured,
	interactionMode,
	isBusy,
	onArchive,
	onDragEnd,
	onDragStart,
	onDrop,
	onOpen,
	onRename,
	onRequestDelete,
	onRequestPermanentDelete,
	onRestore,
	onSelect,
	onSummary,
	project,
	selected,
}) => {
	const dragHandleArmed = useRef(false);
	const coverInputRef = useRef<HTMLInputElement>(null);
	const [coverBusy, setCoverBusy] = useState(false);
	const { mutate } = useSWRConfig();
	const toast = useToast();
	const production = normalizeProjectProductionState(project.production);
	const stages = projectProductionStages(production);
	const progress = calculateProductionProgress(stages, production?.overallProgress);
	const currentStage =
		stages.find((stage) => stage.id === production?.currentStageId) ??
		stages.find((stage) => stage.status !== "PASS") ??
		stages.at(-1);
	const currentState = currentStage?.status ?? "NOT_STARTED";
	const storyboardCoverShot = production?.shots?.find(
		(shot) => shot.storyboardImagePath || shot.storyboardAssetId,
	);
	const automaticCoverSource = storyboardCoverShot?.storyboardImagePath
		? storyboardCoverShot.storyboardImagePath
		: storyboardCoverShot?.storyboardAssetId
			? apiResourceURL(
					`/api/v1/projects/${encodeURIComponent(project.id)}/assets/${encodeURIComponent(storyboardCoverShot.storyboardAssetId)}/content`,
				)
			: "";
	const coverSource = project.coverAssetId
		? apiResourceURL(
				`/api/v1/projects/${encodeURIComponent(project.id)}/assets/${encodeURIComponent(project.coverAssetId)}/content`,
			)
		: automaticCoverSource;
	const timestamp = projectLifecycleTimestamp(project, activeTab);
	const canOpen = activeTab === "active" && interactionMode === "browse";
	const hasAction = isBusy || coverBusy;
	const isRestoring = action?.kind === "restore" && action.projectId === project.id;
	const isDeleting = action?.kind === "permanent" && action.projectId === project.id;
	const isRenaming = action?.kind === "rename" && action.projectId === project.id;
	const isArchiving = action?.kind === "archive" && action.projectId === project.id;
	const isTrashing = action?.kind === "trash" && action.projectId === project.id;
	const updateCover = async (file: File) => {
		setCoverBusy(true);
		try {
			const asset = await uploadProjectAsset(project.id, file);
			await updateProjectConfig(project.id, { overview: { coverAssetId: asset.id } });
			await mutate(projectsKeyForStatus("active"));
			toast.success("项目封面已更新", { description: project.name });
		} catch (error) {
			toast.error("设置封面失败", {
				description: error instanceof Error ? error.message : "请稍后重试。",
			});
		} finally {
			setCoverBusy(false);
			if (coverInputRef.current) coverInputRef.current.value = "";
		}
	};
	const removeCover = async () => {
		setCoverBusy(true);
		try {
			await updateProjectConfig(project.id, { overview: { coverAssetId: "" } });
			await mutate(projectsKeyForStatus("active"));
			toast.success("项目封面已移除", { description: project.name });
		} catch (error) {
			toast.error("移除封面失败", {
				description: error instanceof Error ? error.message : "请稍后重试。",
			});
		} finally {
			setCoverBusy(false);
		}
	};

	useEffect(() => {
		onSummary({
			blockerCount: production?.blockers?.length ?? 0,
			currentOrder: currentStage?.order ?? 0,
			currentState,
			progress,
			totalStages: stages.length,
		});
	}, [
		currentStage?.order,
		currentState,
		onSummary,
		production?.blockers?.length,
		progress,
		stages.length,
	]);

	const activateCard = (event: React.MouseEvent<HTMLDivElement>) => {
		if (interactionMode === "manage") {
			onSelect({ additive: event.metaKey || event.ctrlKey, range: event.shiftKey });
			return;
		}
		if (canOpen) onOpen(project);
	};

	const activateCardFromKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		if (interactionMode === "manage") {
			onSelect({ additive: event.metaKey || event.ctrlKey, range: event.shiftKey });
			return;
		}
		if (canOpen) onOpen(project);
	};

	const card = (
		<div
			data-project-card-id={project.id}
			role="button"
			tabIndex={0}
			aria-label={project.name}
			aria-pressed={interactionMode === "manage" ? selected : undefined}
			draggable={interactionMode === "sort"}
			onClick={activateCard}
			onKeyDown={activateCardFromKeyboard}
			onDragStart={(event) => {
				if (interactionMode !== "sort" || !dragHandleArmed.current) {
					event.preventDefault();
					return;
				}
				onDragStart();
			}}
			onDragEnd={() => {
				dragHandleArmed.current = false;
				onDragEnd();
			}}
			onDragOver={(event) => {
				if (interactionMode === "sort") event.preventDefault();
			}}
			onDrop={(event) => {
				if (interactionMode !== "sort") return;
				event.preventDefault();
				onDrop();
			}}
			className={cn(
				"group relative overflow-hidden rounded-xl border border-border/75 bg-card text-card-foreground shadow-sm transition-[border-color,transform,box-shadow]",
				featured ? "grid min-h-52 md:grid-cols-[minmax(260px,46%)_1fr]" : "flex min-h-64 flex-col",
				interactionMode === "browse" &&
					activeTab === "active" &&
					"cursor-pointer hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-lg",
				interactionMode === "manage" && "cursor-pointer",
				interactionMode === "sort" && "cursor-default",
				selected && "border-primary ring-2 ring-primary/15",
			)}
		>
			<div
				className={cn(
					"project-cover-surface relative overflow-hidden bg-muted",
					featured ? "min-h-44 md:min-h-52" : "aspect-[16/7]",
				)}
			>
				{coverSource ? (
					<img src={coverSource} alt="" className="size-full object-cover" />
				) : (
					<div className="flex size-full min-h-32 flex-col items-center justify-center gap-2 text-muted-foreground">
						<ImageIcon className="size-5" />
						<span className="text-[11px]">尚未设置项目封面</span>
					</div>
				)}
				{interactionMode === "manage" ? (
					<span
						className={cn(
							"absolute left-3 top-3 grid size-6 place-items-center rounded border bg-card text-card-foreground",
							selected && "border-primary bg-primary text-primary-foreground",
						)}
					>
						{selected ? <Check className="size-4" /> : null}
					</span>
				) : null}
				{interactionMode === "sort" ? (
					<button
						type="button"
						aria-label={`拖动${project.name}`}
						className="absolute left-3 top-3 grid size-8 cursor-grab place-items-center rounded-md border border-border bg-card text-muted-foreground shadow-sm active:cursor-grabbing"
						onPointerDown={() => {
							dragHandleArmed.current = true;
						}}
					>
						<GripVertical className="size-4" />
					</button>
				) : null}
			</div>

			<div className={cn("flex min-w-0 flex-1 flex-col", featured ? "p-5" : "p-4")}>
				<div className="flex min-w-0 items-start justify-between gap-3">
					<div className="min-w-0">
						<p
							className={cn(
								"truncate font-medium text-foreground",
								featured ? "text-base" : "text-sm",
							)}
						>
							{project.name}
						</p>
						<p className="mt-1 truncate text-[11px] text-muted-foreground">
							{production?.shotCount ?? 0} 个镜头 · 已完成 {production?.completedShotCount ?? 0} 个
						</p>
					</div>
					{interactionMode === "browse" ? (
						<span className="shrink-0 text-[11px] text-muted-foreground">
							{formatProjectTimestamp(project.updatedAt || project.createdAt)}
						</span>
					) : null}
				</div>

				<div>
					<div className="min-w-0">
						<p className="text-[10px] text-muted-foreground">
							{activeTab === "active" ? "当前进度" : (timestamp?.label ?? "项目状态")}
						</p>
						<p
							className={cn(
								"mt-1 truncate text-xs font-medium",
								production?.blockers?.length ? "text-warning-foreground" : "text-foreground",
							)}
						>
							{activeTab === "active"
								? currentStage
									? formatStageTitle(currentStage.order, currentStage.title)
									: "准备开始"
								: timestamp?.value || "等待处理"}
						</p>
					</div>
					{activeTab === "active" && canOpen ? (
						<Button
							type="button"
							size="sm"
							onClick={(event) => {
								event.stopPropagation();
								onOpen(project);
							}}
						>
							继续制作
							<ArrowRight />
						</Button>
					) : null}
					{!featured && activeTab !== "active" && interactionMode === "browse" ? (
						<div className="flex shrink-0 items-center gap-2">
							<Button
								type="button"
								size="sm"
								variant="secondary"
								disabled={hasAction}
								onClick={(event) => {
									event.stopPropagation();
									onRestore();
								}}
							>
								{isRestoring ? <Loader2 className="animate-spin" /> : <RotateCcw />}
								恢复
							</Button>
							{activeTab === "trashed" ? (
								<Button
									type="button"
									size="sm"
									variant="destructive"
									disabled={hasAction}
									onClick={(event) => {
										event.stopPropagation();
										onRequestPermanentDelete();
									}}
								>
									{isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
									永久删除
								</Button>
							) : null}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);

	return (
		<>
			<input
				ref={coverInputRef}
				type="file"
				accept="image/jpeg,image/png,image/webp"
				hidden
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void updateCover(file);
				}}
			/>
			<ContextMenu>
				<ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
				<ContextMenuContent>
					{interactionMode === "browse" && activeTab === "active" ? (
						<>
							<ContextMenuItem disabled={hasAction} onSelect={() => onOpen(project)}>
								<FolderOpen className="size-4" />
								打开
							</ContextMenuItem>
							<ContextMenuItem disabled={hasAction} onSelect={onRename}>
								{isRenaming ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Pencil className="size-4" />
								)}
								{isRenaming ? "正在重命名" : "重命名"}
							</ContextMenuItem>
							<ContextMenuItem disabled={hasAction} onSelect={() => coverInputRef.current?.click()}>
								{coverBusy ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Images className="size-4" />
								)}
								{project.coverAssetId ? "更换封面" : "设置封面"}
							</ContextMenuItem>
							{project.coverAssetId ? (
								<ContextMenuItem disabled={hasAction} onSelect={() => void removeCover()}>
									<X className="size-4" />
									移除封面
								</ContextMenuItem>
							) : null}
							<ContextMenuItem disabled={hasAction} onSelect={onArchive}>
								{isArchiving ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Archive className="size-4" />
								)}
								{isArchiving ? "正在归档" : "归档"}
							</ContextMenuItem>
							<ContextMenuItem
								className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
								disabled={hasAction}
								onSelect={onRequestDelete}
							>
								{isTrashing ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Trash2 className="size-4" />
								)}
								{isTrashing ? "正在移入" : "移到垃圾箱"}
							</ContextMenuItem>
						</>
					) : interactionMode === "browse" ? (
						<ContextMenuItem disabled={hasAction} onSelect={onRestore}>
							{isRestoring ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<RotateCcw className="size-4" />
							)}
							{isRestoring ? "正在恢复" : "恢复"}
						</ContextMenuItem>
					) : null}
					{interactionMode === "browse" && activeTab === "trashed" ? (
						<ContextMenuItem
							className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
							disabled={hasAction}
							onSelect={onRequestPermanentDelete}
						>
							{isDeleting ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Trash2 className="size-4" />
							)}
							{isDeleting ? "正在删除" : "永久删除"}
						</ContextMenuItem>
					) : null}
				</ContextMenuContent>
			</ContextMenu>
		</>
	);
};

const ProductionWelcome: React.FC<{ onCreateProject: () => void }> = ({ onCreateProject }) => (
	<div className="mx-auto w-full max-w-6xl pb-8">
		<section className="grid min-h-[430px] overflow-hidden rounded-md border border-black/25 bg-[#15171a] text-white shadow-sm lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]">
			<div className="flex flex-col justify-between p-8 sm:p-10">
				<div>
					<div className="flex items-center gap-3">
						<img src="/heart-logo.png" alt="心悦制作台" className="size-10 rounded-lg" />
						<div>
							<p className="text-xs font-medium text-white/55">心悦制作台</p>
							<p className="mt-0.5 text-sm text-white/80">本地制作工作台</p>
						</div>
					</div>
					<h2 className="mt-10 max-w-lg text-3xl font-semibold leading-tight tracking-normal sm:text-4xl">
						从创意到成片，保持每一步可见
					</h2>
					<p className="mt-4 max-w-md text-sm leading-6 text-white/65">
						建立项目后，系统会按所选模板生成制作阶段、交付文档和质量检查节点。
					</p>
				</div>
				<div className="mt-10 flex flex-wrap items-center gap-3">
					<Button
						type="button"
						size="lg"
						className="bg-white text-black hover:bg-white/90"
						onClick={onCreateProject}
					>
						<Plus />
						创建第一个项目
					</Button>
					<span className="text-xs text-white/45">项目与素材默认保存在本机</span>
				</div>
			</div>

			<div className="border-t border-white/10 bg-[#202329] p-5 lg:border-l lg:border-t-0 sm:p-7">
				<div className="flex h-full min-h-[360px] flex-col border border-white/10 bg-[#181a1e] p-5">
					<div className="flex items-center justify-between border-b border-white/10 pb-4">
						<div>
							<p className="text-xs text-white/45">示例项目</p>
							<p className="mt-1 text-sm font-medium">品牌短片 · 制作总控</p>
						</div>
						<span className="rounded-sm bg-[#d9ff58] px-2 py-1 text-[10px] font-semibold text-black">
							进行中
						</span>
					</div>

					<div className="mt-5 flex items-baseline justify-between">
						<div>
							<p className="text-[11px] text-white/45">当前阶段</p>
							<p className="mt-1 text-sm font-medium">06 单镜制作</p>
						</div>
						<p className="text-2xl font-semibold">58%</p>
					</div>
					<div className="mt-4 grid grid-cols-10 gap-1" aria-hidden="true">
						{Array.from({ length: 10 }, (_, index) => (
							<span
								key={index}
								className={cn(
									"h-1.5",
									index < 5 ? "bg-[#d9ff58]" : index === 5 ? "bg-[#5c8dff]" : "bg-white/10",
								)}
							/>
						))}
					</div>

					<div className="mt-7 grid flex-1 gap-2 sm:grid-cols-3">
						<WelcomeCapability icon={ScanSearch} label="参考图拆解" meta="视觉 DNA" tone="lime" />
						<WelcomeCapability icon={Images} label="资产与版本" meta="V01 → PASS" tone="blue" />
						<WelcomeCapability
							icon={Clapperboard}
							label="镜头与动态"
							meta="Shot / Motion"
							tone="coral"
						/>
					</div>

					<div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4 text-xs">
						<span className="text-white/45">下一步行动</span>
						<span className="font-medium text-white/85">完成关键帧并提交审核</span>
					</div>
				</div>
			</div>
		</section>

		<section className="grid border-x border-b border-border bg-card sm:grid-cols-3">
			<WelcomeModule
				icon={Layers3}
				title="生产流程"
				description="按项目类型生成 1、5、8 或 10 个制作阶段"
			/>
			<WelcomeModule
				icon={ScanSearch}
				title="参考图迁移"
				description="先拆证据，再迁移动作、构图、灯光与材质"
			/>
			<WelcomeModule
				icon={ShieldCheck}
				title="版本与审核"
				description="保留生成版本、阶段状态、问题与下一步行动"
			/>
		</section>
	</div>
);

const WelcomeCapability: React.FC<{
	icon: LucideIcon;
	label: string;
	meta: string;
	tone: "blue" | "coral" | "lime";
}> = ({ icon: Icon, label, meta, tone }) => (
	<div className="flex min-h-28 flex-col justify-between border border-white/10 bg-white/[0.035] p-3">
		<Icon
			className={cn(
				"size-5",
				tone === "lime" && "text-[#d9ff58]",
				tone === "blue" && "text-[#79a2ff]",
				tone === "coral" && "text-[#ff8b73]",
			)}
		/>
		<div>
			<p className="text-xs font-medium">{label}</p>
			<p className="mt-1 text-[10px] text-white/40">{meta}</p>
		</div>
	</div>
);

const WelcomeModule: React.FC<{ description: string; icon: LucideIcon; title: string }> = ({
	description,
	icon: Icon,
	title,
}) => (
	<div className="flex gap-3 border-b border-border p-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
		<div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-foreground">
			<Icon className="size-4" />
		</div>
		<div>
			<p className="text-sm font-medium text-foreground">{title}</p>
			<p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
		</div>
	</div>
);

const ProjectManagementCenterState: React.FC<{
	action?: React.ReactNode;
	description?: string;
	icon: LucideIcon;
	spin?: boolean;
	title: string;
}> = ({ action, description, icon: Icon, spin = false, title }) => (
	<div className="grid h-full min-h-64 place-items-center p-6 text-center">
		<div>
			<Icon className={cn("mx-auto size-7 text-muted-foreground", spin && "animate-spin")} />
			<p className="mt-3 text-sm font-medium text-foreground">{title}</p>
			{description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
			{action ? <div className="mt-4 flex justify-center">{action}</div> : null}
		</div>
	</div>
);

const calculateProductionProgress = (
	stages: Array<{ status: ProductionStageState; completion?: number }>,
	persistedProgress = 0,
) => {
	if (stages.length === 0) return clampProgress(persistedProgress);
	const hasMeasuredProgress = stages.some(
		(stage) => typeof stage.completion === "number" && stage.completion > 0,
	);
	if (hasMeasuredProgress) {
		const total = stages.reduce((sum, stage) => {
			const completion =
				typeof stage.completion === "number" ? stage.completion : stage.status === "PASS" ? 100 : 0;
			return sum + Math.max(0, Math.min(100, completion));
		}, 0);
		return clampProgress(total / stages.length);
	}
	// The project config is the durable source of truth for progress. A stage can
	// already be in REVIEW/IN_PROGRESS while its measured completion is still
	// unknown; in that case do not silently turn a persisted non-zero progress
	// value into 0% just because no stage has reached PASS yet.
	if (persistedProgress > 0) return clampProgress(persistedProgress);
	const hasStatusProgress = stages.some((stage) => stage.status !== "NOT_STARTED");
	if (!hasStatusProgress) return clampProgress(persistedProgress);
	const completed = stages.filter((stage) => stage.status === "PASS").length;
	return clampProgress((completed / stages.length) * 100);
};

const clampProgress = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const formatStageTitle = (order: number, title: string) =>
	`${String(order).padStart(2, "0")} ${title}`;

const compareProjectsByUpdatedAtDesc = (left: WorkspaceProject, right: WorkspaceProject) => {
	const leftTime = getProjectTimestamp(left.updatedAt || left.createdAt);
	const rightTime = getProjectTimestamp(right.updatedAt || right.createdAt);
	if (rightTime !== leftTime) return rightTime - leftTime;
	return left.id.localeCompare(right.id);
};

const compareProjectsByPersistedOrder = (left: WorkspaceProject, right: WorkspaceProject) => {
	if (left.sortOrder !== undefined && right.sortOrder !== undefined) {
		return left.sortOrder - right.sortOrder || compareProjectsByUpdatedAtDesc(left, right);
	}
	if (left.sortOrder !== undefined) return -1;
	if (right.sortOrder !== undefined) return 1;
	return compareProjectsByUpdatedAtDesc(left, right);
};

const getProjectTimestamp = (timestamp: string) => {
	const time = Date.parse(timestamp);
	return Number.isFinite(time) ? time : 0;
};

const projectLifecycleTimestamp = (project: WorkspaceProject, status: ProjectManagementTab) => {
	if (status === "archived" && project.archivedAt) {
		return { label: "归档时间", value: formatProjectTimestamp(project.archivedAt) };
	}
	if (status === "trashed" && project.trashedAt) {
		return { label: "移入时间", value: formatProjectTimestamp(project.trashedAt) };
	}
	return null;
};

const formatProjectTimestamp = (value: string) => {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat("zh-CN", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
};

const projectManagementErrorMessage = (error: unknown, fallback: string) => {
	if (error && typeof error === "object" && "response" in error) {
		const response = (error as { response?: { data?: unknown } }).response;
		const data = response?.data;
		if (data && typeof data === "object") {
			for (const key of ["message", "error", "detail"] as const) {
				const value = (data as Record<string, unknown>)[key];
				if (typeof value === "string" && value.trim() && value !== "internal error") return value;
			}
		}
	}
	if (error instanceof Error) return error.message;
	if (error && typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return fallback;
};

const projectRemovalStatus = (error: unknown) => {
	if (!error || typeof error !== "object" || !("response" in error)) return undefined;
	return (error as { response?: { status?: number } }).response?.status;
};

const retryProjectRemoval = async (operation: () => Promise<unknown>) => {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			await operation();
			return;
		} catch (error) {
			const status = projectRemovalStatus(error);
			// A previous request may have completed while its response was lost. For a
			// removal action, 404 already represents the requested final state.
			if (status === 404) return;
			lastError = error;
			if (status !== undefined && status < 500) throw error;
			if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
		}
	}
	throw lastError;
};
