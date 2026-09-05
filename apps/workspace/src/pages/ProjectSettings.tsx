import { Archive, FolderOpen, Loader2, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import useSWR, { useSWRConfig } from "swr";
import {
	archiveProject,
	deleteProject,
	getProjectConfig,
	getProjects,
	projectsKey,
	projectsKeyForStatus,
	updateProjectConfig,
	type WorkspaceProject,
} from "@/domains/projects/api/projects";
import { workspaceStateKey } from "@/domains/workspace/api/workspace";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import { Button } from "@/shared/components/ui/button";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { useToast } from "@/hooks/useToast";
import { isDesktopRuntime, openProjectDirectory } from "@/domains/projects/lib/project-directory";
import { openNativePath, pickDesktopDirectory } from "@/shared/desktop/actions";
import { useDocumentsStore } from "@/domains/documents/stores";
import { useProjectStore } from "@/domains/projects/stores";
import { getRouteProjectId } from "@/domains/workspace/lib/workbench-route";

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
	const { data: projectConfig, mutate: mutateProjectConfig } = useSWR(
		projectId ? `${projectsKey}/${encodeURIComponent(projectId)}/config` : null,
		() => getProjectConfig(projectId ?? ""),
	);
	const [isArchiving, setIsArchiving] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isOpeningProjectFolder, setIsOpeningProjectFolder] = useState(false);
	const [isSavingOutputDirectory, setIsSavingOutputDirectory] = useState(false);

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

	const chooseOutputDirectory = async () => {
		if (!projectId || isSavingOutputDirectory) return;
		const directory = await pickDesktopDirectory("选择项目生成结果保存目录");
		if (!directory) return;
		setIsSavingOutputDirectory(true);
		try {
			await updateProjectConfig(projectId, { overview: { outputDirectory: directory } });
			await mutateProjectConfig();
			toast.success("输出目录已保存", { description: directory });
		} catch (err) {
			toast.error("保存输出目录失败", {
				description: projectSettingsErrorMessage(err, "请稍后重试。"),
			});
		} finally {
			setIsSavingOutputDirectory(false);
		}
	};

	const clearOutputDirectory = async () => {
		if (!projectId || isSavingOutputDirectory) return;
		setIsSavingOutputDirectory(true);
		try {
			await updateProjectConfig(projectId, { overview: { outputDirectory: null } });
			await mutateProjectConfig();
			toast.success("已恢复默认输出目录");
		} catch (err) {
			toast.error("清除输出目录失败", {
				description: projectSettingsErrorMessage(err, "请稍后重试。"),
			});
		} finally {
			setIsSavingOutputDirectory(false);
		}
	};

	const openOutputDirectory = async () => {
		const directory = projectConfig?.overview.outputDirectory?.trim();
		if (!directory) return;
		try {
			await openNativePath(directory);
		} catch (err) {
			toast.error("打开输出目录失败", {
				description: projectSettingsErrorMessage(err, "请确认目录仍然存在。"),
			});
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
				outputDirectory={projectConfig?.overview.outputDirectory ?? ""}
				isSavingOutputDirectory={isSavingOutputDirectory}
				isOpeningProjectFolder={isOpeningProjectFolder}
				onArchive={() => void archiveCurrentProject()}
				onDelete={confirmDeleteCurrentProject}
				onOpenProjectFolder={openCurrentProjectFolder}
				onChooseOutputDirectory={() => void chooseOutputDirectory()}
				onClearOutputDirectory={() => void clearOutputDirectory()}
				onOpenOutputDirectory={() => void openOutputDirectory()}
			/>
		</div>
	);
};

const ProjectSettingsGeneralPanel: React.FC<{
	isArchiving: boolean;
	isDeleting: boolean;
	isLoading: boolean;
	isOpeningProjectFolder: boolean;
	isSavingOutputDirectory: boolean;
	onArchive: () => void;
	onDelete: () => void;
	onOpenProjectFolder: () => void;
	onChooseOutputDirectory: () => void;
	onClearOutputDirectory: () => void;
	onOpenOutputDirectory: () => void;
	project: WorkspaceProject | null;
	projectDir: string;
	projectName: string;
	outputDirectory: string;
}> = ({
	isArchiving,
	isDeleting,
	isLoading,
	isOpeningProjectFolder,
	isSavingOutputDirectory,
	onArchive,
	onDelete,
	onOpenProjectFolder,
	onChooseOutputDirectory,
	onClearOutputDirectory,
	onOpenOutputDirectory,
	project,
	projectDir,
	projectName,
	outputDirectory,
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
			<div className="divide-y divide-border">
				{isDesktopRuntime() ? (
					<div className={projectSettingsRowClassName}>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium text-foreground">项目文件夹</p>
							<p className="mt-1 truncate text-xs leading-5 text-muted-foreground">
								{projectDir || "项目文件夹正在加载。"}
							</p>
						</div>
						<Button
							type="button"
							variant="secondary"
							onClick={onOpenProjectFolder}
							disabled={isOpeningProjectFolder || !projectDir}
							className="shrink-0 rounded-md"
						>
							{isOpeningProjectFolder ? <Loader2 className="animate-spin" /> : <FolderOpen />}
							<span>打开项目文件夹</span>
						</Button>
					</div>
				) : null}

				{isDesktopRuntime() ? (
					<div className={projectSettingsRowClassName}>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium text-foreground">生成结果保存位置</p>
							<p className="mt-1 truncate text-xs leading-5 text-muted-foreground">
								{outputDirectory || "未指定，将使用项目默认媒体目录。"}
							</p>
							<p className="mt-1 text-xs leading-5 text-muted-foreground">
								图片、视频和导出结果会保留在项目任务记录中，不会因为切换阶段而丢失。
							</p>
						</div>
						<div className="flex shrink-0 flex-wrap gap-2">
							{outputDirectory ? (
								<Button type="button" variant="ghost" onClick={onOpenOutputDirectory}>
									<FolderOpen />
									<span>打开</span>
								</Button>
							) : null}
							<Button
								type="button"
								variant="secondary"
								onClick={onChooseOutputDirectory}
								disabled={isSavingOutputDirectory}
							>
								{isSavingOutputDirectory ? <Loader2 className="animate-spin" /> : <Upload />}
								<span>{outputDirectory ? "更换目录" : "选择目录"}</span>
							</Button>
							{outputDirectory ? (
								<Button
									type="button"
									variant="ghost"
									onClick={onClearOutputDirectory}
									disabled={isSavingOutputDirectory}
								>
									<span>恢复默认</span>
								</Button>
							) : null}
						</div>
					</div>
				) : null}

				<div className={projectSettingsRowClassName}>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-medium text-foreground">归档项目</p>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">
							从默认项目列表隐藏“{project.name}”，项目文件夹仍保留在当前位置。
						</p>
					</div>
					<Button
						type="button"
						variant="secondary"
						onClick={onArchive}
						disabled={isArchiving}
						className="shrink-0 rounded-md"
					>
						{isArchiving ? <Loader2 className="animate-spin" /> : <Archive />}
						<span>归档项目</span>
					</Button>
				</div>

				<div className={projectSettingsRowClassName}>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-medium text-foreground">移到垃圾箱</p>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">
							从默认项目列表隐藏“{project.name}”，并把项目文件夹移动到 .mediago-drama/trash。
						</p>
					</div>
					<Button
						type="button"
						variant="destructive"
						onClick={onDelete}
						disabled={isDeleting}
						className="shrink-0 rounded-md"
					>
						{isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
						<span>移到垃圾箱</span>
					</Button>
				</div>
			</div>
		) : null}
	</SettingsPanelLayout>
);

const projectSettingsRowClassName =
	"flex flex-wrap items-center justify-between gap-3 py-5 first:pt-0 last:pb-0";

const projectSettingsErrorMessage = (err: unknown, fallback: string) => {
	if (err instanceof Error) return err.message;
	if (err && typeof err === "object" && "message" in err) {
		const message = (err as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return fallback;
};
