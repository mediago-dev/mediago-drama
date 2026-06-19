import { Archive, FolderOpen, Loader2, SlidersHorizontal, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import useSWR, { useSWRConfig } from "swr";
import {
	archiveProject,
	deleteProject,
	getProjects,
	projectsKey,
	projectsKeyForStatus,
	type WorkspaceProject,
} from "@/domains/projects/api/projects";
import { workspaceStateKey } from "@/domains/workspace/api/workspace";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import { Button } from "@/shared/components/ui/button";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { useToast } from "@/hooks/useToast";
import { isTauriRuntime, openProjectDirectory } from "@/domains/projects/lib/project-directory";
import { settingsInsetRowClassName } from "@/lib/settings-layout";
import { useDocumentsStore } from "@/domains/documents/stores";
import { useProjectStore } from "@/domains/projects/stores";
import { getRouteProjectId } from "@/domains/workspace/lib/workbench-route";
import { cn } from "@/shared/lib/utils";

export const ProjectSettings: React.FC = () => {
	const location = useLocation();
	const projectId = getRouteProjectId(location.search);
	const navigate = useNavigate();
	const toast = useToast();
	const { mutate } = useSWRConfig();
	const activeProjectId = useProjectStore((state) => state.activeProjectId);
	const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);
	const prepareWorkspaceLoad = useDocumentsStore((state) => state.prepareWorkspaceLoad);
	const documentsProjectId = useDocumentsStore((state) => state.projectId);
	const workspaceDir = useDocumentsStore((state) => state.workspaceDir);
	const { data, isLoading } = useSWR(projectsKey, getProjects);
	const [isArchiving, setIsArchiving] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isOpeningProjectFolder, setIsOpeningProjectFolder] = useState(false);

	useEffect(() => {
		if (projectId && activeProjectId !== projectId) setActiveProjectId(projectId);
	}, [activeProjectId, projectId, setActiveProjectId]);

	if (!projectId) return <Navigate to="/" replace />;

	const project = data?.projects.find((item) => item.id === projectId) ?? null;
	const projectName = project?.name || projectId;
	const projectDir =
		project?.projectDir?.trim() || (documentsProjectId === project?.id ? workspaceDir.trim() : "");

	const refreshProjectLists = async () => {
		await Promise.all([
			mutate(projectsKeyForStatus("active")),
			mutate(projectsKeyForStatus("archived")),
			mutate(projectsKeyForStatus("trashed")),
		]);
	};

	const leaveCurrentProject = (message: string) => {
		void mutate(workspaceStateKey(project?.id ?? ""), undefined, { revalidate: false });
		setActiveProjectId(null);
		prepareWorkspaceLoad(message);
		navigate("/", { replace: true });
	};

	const archiveCurrentProject = async () => {
		if (!project || isArchiving) return;

		setIsArchiving(true);
		try {
			await archiveProject(project.id);
			await refreshProjectLists();
			leaveCurrentProject("请选择一个项目");
			toast.success("项目已归档", { description: project.name });
		} catch (err) {
			const message = projectSettingsErrorMessage(err, "归档项目失败。");
			toast.error("归档项目失败", { description: message });
		} finally {
			setIsArchiving(false);
		}
	};

	const deleteCurrentProject = async () => {
		if (!project || isDeleting) return false;

		setIsDeleting(true);
		try {
			await deleteProject(project.id);
			await refreshProjectLists();
			leaveCurrentProject("请选择一个项目");
			toast.success("项目已移到垃圾箱", { description: project.name });
			return true;
		} catch (err) {
			const message = projectSettingsErrorMessage(err, "移到垃圾箱失败。");
			toast.error("移到垃圾箱失败", { description: message });
			return false;
		} finally {
			setIsDeleting(false);
		}
	};

	const confirmDeleteCurrentProject = () => {
		if (!project) return;
		void confirmDialog({
			title: "移到垃圾箱？",
			description: (
				<>
					确定要将“{projectName}”移到垃圾箱吗？项目文件夹会移动到
					.mediago-drama/trash，之后可以在垃圾箱中恢复。
				</>
			),
			confirmLabel: "移到垃圾箱",
			confirmIcon: <Trash2 />,
			onConfirm: deleteCurrentProject,
		});
	};

	const openCurrentProjectFolder = async () => {
		if (!project || isOpeningProjectFolder) return;

		if (!projectDir) {
			toast.info("项目目录加载中", { description: "文档库准备好后再打开项目文件夹。" });
			return;
		}

		setIsOpeningProjectFolder(true);
		try {
			await openProjectDirectory(projectDir);
		} catch (err) {
			const message = err instanceof Error ? err.message : "无法打开项目文件夹。";
			toast.error("打开项目文件夹失败", { description: message });
		} finally {
			setIsOpeningProjectFolder(false);
		}
	};

	return (
		<div className="h-full min-h-0 overflow-hidden bg-ide-editor text-ide-editor-foreground">
			<ProjectSettingsGeneralPanel
				isArchiving={isArchiving}
				isDeleting={isDeleting}
				isLoading={isLoading}
				project={project}
				projectDir={projectDir}
				projectName={projectName}
				isOpeningProjectFolder={isOpeningProjectFolder}
				onArchive={() => void archiveCurrentProject()}
				onDelete={confirmDeleteCurrentProject}
				onOpenProjectFolder={openCurrentProjectFolder}
			/>
		</div>
	);
};

const ProjectSettingsGeneralPanel: React.FC<{
	isArchiving: boolean;
	isDeleting: boolean;
	isLoading: boolean;
	isOpeningProjectFolder: boolean;
	onArchive: () => void;
	onDelete: () => void;
	onOpenProjectFolder: () => void;
	project: WorkspaceProject | null;
	projectDir: string;
	projectName: string;
}> = ({
	isArchiving,
	isDeleting,
	isLoading,
	isOpeningProjectFolder,
	onArchive,
	onDelete,
	onOpenProjectFolder,
	project,
	projectDir,
	projectName,
}) => (
	<SettingsPanelLayout
		title="基础设置"
		description={<>管理“{projectName}”的项目设置。</>}
		icon={<SlidersHorizontal className="size-4" />}
	>
		{isLoading && !project ? (
			<div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" />
				<span>加载项目设置</span>
			</div>
		) : null}

		{!isLoading && !project ? (
			<p className="py-2 text-sm text-muted-foreground">项目不存在或已被删除。</p>
		) : null}

		{project ? (
			<div className="space-y-3">
				{isTauriRuntime() ? (
					<div className={cn(settingsInsetRowClassName, projectSettingsRowClassName)}>
						<div className="min-w-0">
							<p className="text-sm font-medium text-foreground">项目文件夹</p>
							<p className="mt-1 truncate text-xs leading-5 text-muted-foreground">
								{projectDir || "项目文件夹正在加载。"}
							</p>
						</div>
						<div className="flex min-w-0 justify-start md:justify-end">
							<Button
								type="button"
								variant="secondary"
								onClick={onOpenProjectFolder}
								disabled={isOpeningProjectFolder || !projectDir}
								className="rounded-md"
							>
								{isOpeningProjectFolder ? <Loader2 className="animate-spin" /> : <FolderOpen />}
								<span>打开项目文件夹</span>
							</Button>
						</div>
					</div>
				) : null}

				<div className={cn(settingsInsetRowClassName, projectSettingsRowClassName)}>
					<div className="min-w-0">
						<p className="text-sm font-medium text-foreground">归档项目</p>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">
							从默认项目列表隐藏“{project.name}”，项目文件夹仍保留在当前位置。
						</p>
					</div>
					<div className="flex min-w-0 justify-start md:justify-end">
						<Button
							type="button"
							variant="secondary"
							onClick={onArchive}
							disabled={isArchiving}
							className="rounded-md"
						>
							{isArchiving ? <Loader2 className="animate-spin" /> : <Archive />}
							<span>归档项目</span>
						</Button>
					</div>
				</div>

				<div className={cn(settingsInsetRowClassName, projectSettingsRowClassName)}>
					<div className="min-w-0">
						<p className="text-sm font-medium text-foreground">移到垃圾箱</p>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">
							从默认项目列表隐藏“{project.name}”，并把项目文件夹移动到 .mediago-drama/trash。
						</p>
					</div>
					<div className="flex min-w-0 justify-start md:justify-end">
						<Button
							type="button"
							variant="destructive"
							onClick={onDelete}
							disabled={isDeleting}
							className="rounded-md"
						>
							{isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
							<span>移到垃圾箱</span>
						</Button>
					</div>
				</div>
			</div>
		) : null}
	</SettingsPanelLayout>
);

const projectSettingsRowClassName =
	"grid gap-3 md:grid-cols-[minmax(var(--settings-label-column-min),var(--settings-label-column-max))_minmax(0,1fr)] md:items-start";

const projectSettingsErrorMessage = (err: unknown, fallback: string) => {
	if (err instanceof Error) return err.message;
	if (err && typeof err === "object" && "message" in err) {
		const message = (err as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return fallback;
};
