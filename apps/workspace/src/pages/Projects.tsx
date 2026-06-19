import { Archive, FolderOpen, Loader2, RotateCcw, Trash2, type LucideIcon } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import useSWR, { useSWRConfig } from "swr";
import {
	getProjects,
	permanentlyDeleteProject,
	type ProjectStatusFilter,
	projectsKeyForStatus,
	restoreProject,
	type WorkspaceProject,
} from "@/domains/projects/api/projects";
import { useProjectStore } from "@/domains/projects/stores";
import { agentProjectPath, agentProjectRouteState } from "@/domains/workspace/lib/workbench-route";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/shared/lib/utils";

type ProjectManagementTab = Exclude<ProjectStatusFilter, "all">;
type ProjectAction = "restore" | "permanent";

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
	const { data, error, isLoading } = useSWR(swrKey, () => getProjects(activeTab));
	const projects = useMemo(
		() => [...(data?.projects ?? [])].sort(compareProjectsByUpdatedAtDesc),
		[data?.projects],
	);
	const meta = tabMeta[activeTab];

	const openProject = (project: WorkspaceProject) => {
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
				{isLoading ? (
					<ProjectManagementCenterState icon={Loader2} title="加载项目列表" spin />
				) : null}

				{!isLoading && error ? (
					<ProjectManagementCenterState
						icon={FolderOpen}
						title="项目列表加载失败"
						description="请确认本地服务已启动。"
					/>
				) : null}

				{!isLoading && !error && projects.length === 0 ? (
					<ProjectManagementCenterState
						icon={meta.icon}
						title={meta.emptyTitle}
						description={meta.emptyDescription}
					/>
				) : null}

				{!isLoading && !error && projects.length > 0 ? (
					<div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
						{projects.map((project) => (
							<ProjectManagementRow
								key={project.id}
								action={action}
								activeTab={activeTab}
								project={project}
								statusLabel={meta.statusLabel}
								onOpen={openProject}
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
	onOpen: (project: WorkspaceProject) => void;
	onRequestPermanentDelete: () => void;
	onRestore: () => void;
	project: WorkspaceProject;
	statusLabel: string;
}> = ({ action, activeTab, onOpen, onRequestPermanentDelete, onRestore, project, statusLabel }) => {
	const isRestoring = action?.kind === "restore" && action.projectId === project.id;
	const isDeleting = action?.kind === "permanent" && action.projectId === project.id;
	const Icon = tabMeta[activeTab].icon;
	const path = project.originalProjectDir || project.projectDir || project.relativeDir || "";
	const timestamp = projectLifecycleTimestamp(project, activeTab);

	return (
		<div className="grid gap-3 rounded-sm border border-border/70 bg-ide-panel px-3 py-3 text-ide-panel-foreground md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
			<div className="flex min-w-0 gap-3">
				<div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar text-muted-foreground">
					<Icon className="size-4" />
				</div>
				<div className="min-w-0">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<p className="truncate text-sm font-medium text-foreground">{project.name}</p>
						<Badge variant="secondary">{statusLabel}</Badge>
						{project.documentCount > 0 ? (
							<span className="text-xs text-muted-foreground">{project.documentCount} 个文档</span>
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
					<Button type="button" variant="secondary" onClick={() => onOpen(project)}>
						<FolderOpen />
						<span>打开</span>
					</Button>
				) : null}

				{activeTab === "archived" || activeTab === "trashed" ? (
					<Button type="button" variant="secondary" onClick={onRestore} disabled={Boolean(action)}>
						{isRestoring ? <Loader2 className="animate-spin" /> : <RotateCcw />}
						<span>恢复</span>
					</Button>
				) : null}

				{activeTab === "trashed" ? (
					<Button
						type="button"
						variant="destructive"
						onClick={onRequestPermanentDelete}
						disabled={Boolean(action)}
					>
						{isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
						<span>永久删除</span>
					</Button>
				) : null}
			</div>
		</div>
	);
};

const ProjectManagementCenterState: React.FC<{
	description?: string;
	icon: LucideIcon;
	spin?: boolean;
	title: string;
}> = ({ description, icon: Icon, spin = false, title }) => (
	<div className="grid h-full min-h-64 place-items-center p-6 text-center">
		<div>
			<Icon className={cn("mx-auto size-8 text-muted-foreground", spin && "animate-spin")} />
			<p className="mt-3 text-sm font-medium text-foreground">{title}</p>
			{description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
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
