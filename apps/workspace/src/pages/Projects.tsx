import {
	Archive,
	FolderOpen,
	Loader2,
	Pencil,
	RotateCcw,
	Trash2,
	type LucideIcon,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import useSWR, { useSWRConfig } from "swr";
import {
	archiveProject,
	deleteProject,
	getProjects,
	permanentlyDeleteProject,
	type ProjectStatusFilter,
	projectsKeyForStatus,
	restoreProject,
	updateProject,
	type WorkspaceProject,
} from "@/domains/projects/api/projects";
import { openProjectRenameDialog } from "@/domains/projects/components/ProjectRenameDialog";
import { useProjectStore } from "@/domains/projects/stores";
import { agentProjectPath, agentProjectRouteState } from "@/domains/workspace/lib/workbench-route";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import { useToast } from "@/hooks/useToast";
import { analytics, AnalyticsEvent } from "@/shared/analytics";
import { cn } from "@/shared/lib/utils";

type ProjectManagementTab = Exclude<ProjectStatusFilter, "all">;
type ProjectAction = "archive" | "trash" | "restore" | "permanent" | "rename";

const projectTabs: Array<{ label: string; status: ProjectManagementTab }> = [
	{ label: "项目", status: "active" },
	{ label: "归档", status: "archived" },
	{ label: "垃圾箱", status: "trashed" },
];

const tabMeta: Record<
	ProjectManagementTab,
	{
		description: string;
		emptyDescription: string;
		emptyTitle: string;
		icon: LucideIcon;
		statusLabel: string;
	}
> = {
	active: {
		description: "当前项目",
		emptyDescription: "暂无项目。",
		emptyTitle: "还没有项目",
		icon: FolderOpen,
		statusLabel: "项目",
	},
	archived: {
		description: "已归档项目",
		emptyDescription: "暂无归档项目。",
		emptyTitle: "没有归档项目",
		icon: Archive,
		statusLabel: "归档",
	},
	trashed: {
		description: "垃圾箱项目",
		emptyDescription: "暂无垃圾箱项目。",
		emptyTitle: "垃圾箱为空",
		icon: Trash2,
		statusLabel: "垃圾箱",
	},
};

export const Projects: React.FC = () => {
	const navigate = useNavigate();
	const toast = useToast();
	const { mutate } = useSWRConfig();
	const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);
	const [activeTab, setActiveTab] = useState<ProjectManagementTab>("active");
	const [action, setAction] = useState<{ kind: ProjectAction; projectId: string } | null>(null);
	const swrKey = projectsKeyForStatus(activeTab);
	const {
		data,
		error,
		isLoading,
		mutate: revalidateProjects,
	} = useSWR(swrKey, () => getProjects(activeTab));
	const projects = useMemo(
		() => [...(data?.projects ?? [])].sort(compareProjectsByUpdatedAtDesc),
		[data?.projects],
	);
	const meta = tabMeta[activeTab];

	const openProject = (project: WorkspaceProject) => {
		analytics.track(AnalyticsEvent.OpenProject, {
			document_count: project.documentCount,
			project_id: project.id,
			status: project.status,
		});
		setActiveProjectId(project.id);
		navigate(agentProjectPath(project.id), {
			state: agentProjectRouteState("agent"),
		});
	};

	const refreshProjectLists = async () => {
		await Promise.all([
			mutate(projectsKeyForStatus("active")),
			mutate(projectsKeyForStatus("archived")),
			mutate(projectsKeyForStatus("trashed")),
		]);
	};

	const restoreCurrentProject = async (project: WorkspaceProject) => {
		if (action) return;

		setAction({ kind: "restore", projectId: project.id });
		try {
			const restored = await restoreProject(project.id);
			await refreshProjectLists();
			toast.success("项目已恢复", { description: restored.name || project.name });
		} catch (err) {
			toast.error("恢复项目失败", {
				description: projectManagementErrorMessage(err, "恢复项目失败。"),
			});
		} finally {
			setAction(null);
		}
	};

	const archiveCurrentProject = async (project: WorkspaceProject) => {
		if (action) return;

		setAction({ kind: "archive", projectId: project.id });
		try {
			await archiveProject(project.id);
			await refreshProjectLists();
			toast.success("项目已归档", { description: project.name });
		} catch (err) {
			toast.error("归档项目失败", {
				description: projectManagementErrorMessage(err, "归档项目失败。"),
			});
		} finally {
			setAction(null);
		}
	};

	const renameCurrentProject = (project: WorkspaceProject) => {
		if (action) return;
		void (async () => {
			const nextName = await openProjectRenameDialog({ projectName: project.name });
			if (!nextName || nextName === project.name.trim()) return;

			setAction({ kind: "rename", projectId: project.id });
			try {
				const renamed = await updateProject(project.id, { name: nextName });
				await refreshProjectLists();
				toast.success("项目已重命名", { description: renamed.name });
			} catch (err) {
				toast.error("重命名项目失败", {
					description: projectManagementErrorMessage(err, "重命名项目失败。"),
				});
			} finally {
				setAction(null);
			}
		})();
	};

	const deleteCurrentProject = async (project: WorkspaceProject) => {
		if (action) return false;

		setAction({ kind: "trash", projectId: project.id });
		try {
			await deleteProject(project.id);
			await refreshProjectLists();
			toast.success("项目已移到垃圾箱", { description: project.name });
			return true;
		} catch (err) {
			toast.error("移到垃圾箱失败", {
				description: projectManagementErrorMessage(err, "移到垃圾箱失败。"),
			});
			return false;
		} finally {
			setAction(null);
		}
	};

	const confirmDeleteProject = (project: WorkspaceProject) => {
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
			onConfirm: () => deleteCurrentProject(project),
		});
	};

	const permanentlyDeleteCurrentProject = async (project: WorkspaceProject) => {
		if (action) return false;

		setAction({ kind: "permanent", projectId: project.id });
		try {
			await permanentlyDeleteProject(project.id);
			await refreshProjectLists();
			toast.success("项目已永久删除", { description: project.name });
			return true;
		} catch (err) {
			toast.error("永久删除失败", {
				description: projectManagementErrorMessage(err, "永久删除项目失败。"),
			});
			return false;
		} finally {
			setAction(null);
		}
	};

	const confirmPermanentlyDeleteProject = (project: WorkspaceProject) => {
		void confirmDialog({
			title: "永久删除项目？",
			description:
				"永久删除后，垃圾箱中的项目文件夹和 MediaGo Drama 中的项目记录都会被清除，无法恢复。",
			confirmLabel: "永久删除",
			confirmIcon: <Trash2 />,
			onConfirm: () => permanentlyDeleteCurrentProject(project),
		});
	};

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
			<div className="border-b border-border/70 px-5 py-4">
				<div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
					<div className="min-w-0">
						<h1 className="text-base font-semibold text-foreground">项目管理</h1>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">{meta.description}</p>
					</div>
					<div className="inline-grid grid-cols-3 rounded-sm border border-border bg-ide-toolbar p-0.5">
						{projectTabs.map((tab) => (
							<button
								key={tab.status}
								type="button"
								onClick={() => setActiveTab(tab.status)}
								className={cn(
									"h-7 min-w-16 rounded-sm px-3 text-xs font-medium transition-colors",
									activeTab === tab.status
										? "bg-ide-editor text-foreground shadow-sm"
										: "text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
								)}
							>
								{tab.label}
							</button>
						))}
					</div>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-auto px-5 py-4">
				{isLoading && projects.length === 0 ? (
					<ProjectManagementCenterState icon={Loader2} title="加载项目列表" spin />
				) : null}

				{!isLoading && error && projects.length === 0 ? (
					<ProjectManagementCenterState
						icon={FolderOpen}
						title="项目列表加载失败"
						description="请确认本地服务已启动。"
						action={
							<Button type="button" variant="secondary" onClick={() => void revalidateProjects()}>
								<RotateCcw />
								<span>重试</span>
							</Button>
						}
					/>
				) : null}

				{!isLoading && !error && projects.length === 0 ? (
					<ProjectManagementCenterState
						icon={meta.icon}
						title={meta.emptyTitle}
						description={meta.emptyDescription}
					/>
				) : null}

				{projects.length > 0 ? (
					<div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
						{projects.map((project) => (
							<ProjectManagementRow
								key={project.id}
								action={action}
								activeTab={activeTab}
								project={project}
								statusLabel={meta.statusLabel}
								onArchive={() => void archiveCurrentProject(project)}
								onRequestDelete={() => confirmDeleteProject(project)}
								onOpen={openProject}
								onRename={() => renameCurrentProject(project)}
								onRestore={() => void restoreCurrentProject(project)}
								onRequestPermanentDelete={() => confirmPermanentlyDeleteProject(project)}
							/>
						))}
					</div>
				) : null}
			</div>
		</div>
	);
};

const ProjectManagementRow: React.FC<{
	action: { kind: ProjectAction; projectId: string } | null;
	activeTab: ProjectManagementTab;
	onArchive: () => void;
	onOpen: (project: WorkspaceProject) => void;
	onRename: () => void;
	onRequestDelete: () => void;
	onRequestPermanentDelete: () => void;
	onRestore: () => void;
	project: WorkspaceProject;
	statusLabel: string;
}> = ({
	action,
	activeTab,
	onArchive,
	onOpen,
	onRename,
	onRequestDelete,
	onRequestPermanentDelete,
	onRestore,
	project,
	statusLabel,
}) => {
	const isArchiving = action?.kind === "archive" && action.projectId === project.id;
	const isTrashing = action?.kind === "trash" && action.projectId === project.id;
	const isRestoring = action?.kind === "restore" && action.projectId === project.id;
	const isDeleting = action?.kind === "permanent" && action.projectId === project.id;
	const isRenaming = action?.kind === "rename" && action.projectId === project.id;
	const Icon = tabMeta[activeTab].icon;
	const path = project.originalProjectDir || project.projectDir || project.relativeDir || "";
	const timestamp = projectLifecycleTimestamp(project, activeTab);
	const hasAction = Boolean(action);
	const canOpenProject = activeTab === "active";
	const openFromRow = () => {
		if (!canOpenProject) return;
		onOpen(project);
	};
	const openFromKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (!canOpenProject || (event.key !== "Enter" && event.key !== " ")) return;
		event.preventDefault();
		onOpen(project);
	};
	const openFromButton = (event: React.MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		onOpen(project);
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					role={canOpenProject ? "button" : undefined}
					tabIndex={canOpenProject ? 0 : undefined}
					className={cn(
						"grid gap-3 rounded-sm border border-border/70 bg-ide-panel px-3 py-3 text-ide-panel-foreground md:grid-cols-[minmax(0,1fr)_auto] md:items-center",
						canOpenProject &&
							"cursor-pointer transition-colors hover:bg-ide-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
					)}
					onClick={openFromRow}
					onKeyDown={openFromKeyboard}
				>
					<div className="flex min-w-0 gap-3">
						<div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar text-muted-foreground">
							<Icon className="size-4" />
						</div>
						<div className="min-w-0">
							<div className="flex min-w-0 flex-wrap items-center gap-2">
								<p className="truncate text-sm font-medium text-foreground">{project.name}</p>
								<Badge variant="secondary">{statusLabel}</Badge>
								{project.documentCount > 0 ? (
									<span className="text-xs text-muted-foreground">
										{project.documentCount} 个文档
									</span>
								) : null}
							</div>
							{path ? <p className="mt-1 truncate text-xs text-muted-foreground">{path}</p> : null}
							{timestamp ? (
								<p className="mt-1 text-xs text-muted-foreground">
									{timestamp.label}：{timestamp.value}
								</p>
							) : null}
						</div>
					</div>
					<div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
						{activeTab === "active" ? (
							<Button type="button" variant="secondary" onClick={openFromButton}>
								<FolderOpen />
								<span>打开</span>
							</Button>
						) : null}

						{activeTab === "archived" || activeTab === "trashed" ? (
							<Button type="button" variant="secondary" onClick={onRestore} disabled={hasAction}>
								{isRestoring ? <Loader2 className="animate-spin" /> : <RotateCcw />}
								<span>恢复</span>
							</Button>
						) : null}

						{activeTab === "trashed" ? (
							<Button
								type="button"
								variant="destructive"
								onClick={onRequestPermanentDelete}
								disabled={hasAction}
							>
								{isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
								<span>永久删除</span>
							</Button>
						) : null}
					</div>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				{activeTab === "active" ? (
					<>
						<ContextMenuItem disabled={hasAction} onSelect={() => onOpen(project)}>
							<FolderOpen className="size-4" />
							<span>打开</span>
						</ContextMenuItem>
						<ContextMenuItem disabled={hasAction} onSelect={onRename}>
							{isRenaming ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Pencil className="size-4" />
							)}
							<span>{isRenaming ? "正在重命名" : "重命名"}</span>
						</ContextMenuItem>
						<ContextMenuItem disabled={hasAction} onSelect={onArchive}>
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
							onSelect={onRequestDelete}
						>
							{isTrashing ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Trash2 className="size-4" />
							)}
							<span>{isTrashing ? "正在移入" : "移到垃圾箱"}</span>
						</ContextMenuItem>
					</>
				) : null}

				{activeTab === "archived" || activeTab === "trashed" ? (
					<ContextMenuItem disabled={hasAction} onSelect={onRestore}>
						{isRestoring ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<RotateCcw className="size-4" />
						)}
						<span>{isRestoring ? "正在恢复" : "恢复"}</span>
					</ContextMenuItem>
				) : null}

				{activeTab === "trashed" ? (
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
						<span>{isDeleting ? "正在删除" : "永久删除"}</span>
					</ContextMenuItem>
				) : null}
			</ContextMenuContent>
		</ContextMenu>
	);
};

const ProjectManagementCenterState: React.FC<{
	action?: React.ReactNode;
	description?: string;
	icon: LucideIcon;
	spin?: boolean;
	title: string;
}> = ({ action, description, icon: Icon, spin = false, title }) => (
	<div className="grid h-full min-h-64 place-items-center p-6 text-center">
		<div>
			<Icon className={cn("mx-auto size-8 text-muted-foreground", spin && "animate-spin")} />
			<p className="mt-3 text-sm font-medium text-foreground">{title}</p>
			{description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
			{action ? <div className="mt-4 flex justify-center">{action}</div> : null}
		</div>
	</div>
);

const compareProjectsByUpdatedAtDesc = (left: WorkspaceProject, right: WorkspaceProject) => {
	const leftTime = getProjectTimestamp(left.updatedAt || left.createdAt);
	const rightTime = getProjectTimestamp(right.updatedAt || right.createdAt);

	if (rightTime !== leftTime) return rightTime - leftTime;

	return left.id.localeCompare(right.id);
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

const projectManagementErrorMessage = (err: unknown, fallback: string) => {
	if (err instanceof Error) return err.message;
	if (err && typeof err === "object" && "message" in err) {
		const message = (err as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return fallback;
};
