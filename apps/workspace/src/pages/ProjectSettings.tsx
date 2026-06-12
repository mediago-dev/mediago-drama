import { FolderOpen, Loader2, SlidersHorizontal, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import useSWR, { mutate as mutateSWR } from "swr";
import {
	deleteProject,
	getProjects,
	projectsKey,
	type WorkspaceProject,
} from "@/domains/projects/api/projects";
import { workspaceStateKey } from "@/domains/workspace/api/workspace";
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
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import { Button } from "@/shared/components/ui/button";
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
	const activeProjectId = useProjectStore((state) => state.activeProjectId);
	const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);
	const prepareWorkspaceLoad = useDocumentsStore((state) => state.prepareWorkspaceLoad);
	const documentsProjectId = useDocumentsStore((state) => state.projectId);
	const workspaceDir = useDocumentsStore((state) => state.workspaceDir);
	const { data, isLoading } = useSWR(projectsKey, getProjects);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
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

	const deleteCurrentProject = async () => {
		if (!project || isDeleting) return;

		setIsDeleting(true);
		try {
			await deleteProject(project.id);
			await mutateSWR(projectsKey);
			void mutateSWR(workspaceStateKey(project.id), undefined, { revalidate: false });
			setActiveProjectId(null);
			prepareWorkspaceLoad("请选择一个项目");
			setIsDeleteDialogOpen(false);
			navigate("/", { replace: true });
			toast.success("项目已删除", { description: project.name });
		} catch (err) {
			const message = err instanceof Error ? err.message : "删除项目失败。";
			toast.error("删除项目失败", { description: message });
		} finally {
			setIsDeleting(false);
		}
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
				isDeleting={isDeleting}
				isLoading={isLoading}
				project={project}
				projectDir={projectDir}
				projectName={projectName}
				isOpeningProjectFolder={isOpeningProjectFolder}
				onDelete={() => setIsDeleteDialogOpen(true)}
				onOpenProjectFolder={openCurrentProjectFolder}
			/>

			<AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>删除项目？</AlertDialogTitle>
						<AlertDialogDescription>
							确定要删除“{projectName}”吗？项目会从列表中移除，并清除 MediaGo Drama
							中的文档索引、智能体会话和待处理审批；本地项目文件夹不会被删除。
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isDeleting}>取消</AlertDialogCancel>
						<AlertDialogAction
							disabled={isDeleting || !project}
							onClick={(event) => {
								event.preventDefault();
								void deleteCurrentProject();
							}}
						>
							{isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
							<span>删除项目</span>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
};

const ProjectSettingsGeneralPanel: React.FC<{
	isDeleting: boolean;
	isLoading: boolean;
	isOpeningProjectFolder: boolean;
	onDelete: () => void;
	onOpenProjectFolder: () => void;
	project: WorkspaceProject | null;
	projectDir: string;
	projectName: string;
}> = ({
	isDeleting,
	isLoading,
	isOpeningProjectFolder,
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
						<p className="text-sm font-medium text-foreground">删除项目</p>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">
							从项目列表中移除“{project.name}”，并清除它在 MediaGo Drama 中的索引数据。
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
							<span>删除项目</span>
						</Button>
					</div>
				</div>
			</div>
		) : null}
	</SettingsPanelLayout>
);

const projectSettingsRowClassName =
	"grid gap-3 md:grid-cols-[minmax(var(--settings-label-column-min),var(--settings-label-column-max))_minmax(0,1fr)] md:items-start";
