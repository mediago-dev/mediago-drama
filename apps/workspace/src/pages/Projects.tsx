import { FolderOpen, Loader2, SquarePen } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import useSWR, { mutate as mutateSWR } from "swr";
import { createProject, getProjects, projectsKey } from "@/domains/projects/api/projects";
import { Button } from "@/shared/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { pickProjectDirectory } from "@/domains/projects/lib/project-directory";
import { useProjectStore } from "@/domains/projects/stores";
import { agentProjectPath, agentProjectRouteState } from "@/domains/workspace/lib/workbench-route";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";

export const Projects: React.FC = () => {
	const navigate = useNavigate();
	const toast = useToast();
	const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);
	const setAgentLayoutTab = useAgentLayoutStore((state) => state.setTab);
	const { data, error, isLoading, mutate } = useSWR(projectsKey, getProjects);
	const [isCreating, setIsCreating] = useState(false);
	const projects = data?.projects ?? [];

	const createProjectFromDirectory = async () => {
		if (isCreating) return;

		const projectDir = await pickProjectDirectory();
		if (!projectDir) return;

		setIsCreating(true);
		try {
			const project = await createProject({ projectDir });
			await mutate();
			await mutateSWR(projectsKey);
			setAgentLayoutTab("agent");
			setActiveProjectId(project.id);
			navigate(agentProjectPath(project.id), {
				replace: true,
				state: agentProjectRouteState("agent"),
			});
			toast.success("项目已创建", { description: project.name });
		} catch (err) {
			const message = err instanceof Error ? err.message : "创建项目失败。";
			toast.error("创建项目失败", { description: message });
		} finally {
			setIsCreating(false);
		}
	};

	if (isLoading) {
		return (
			<div className="grid h-full min-h-0 place-items-center bg-ide-editor text-muted-foreground">
				<div className="flex items-center gap-2 text-sm">
					<Loader2 className="size-4 animate-spin" />
					<span>加载项目列表</span>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="grid h-full min-h-0 place-items-center bg-ide-editor p-6 text-center">
				<div>
					<FolderOpen className="mx-auto size-8 text-muted-foreground" />
					<p className="mt-3 text-sm font-medium text-foreground">项目列表加载失败</p>
					<p className="mt-1 text-xs text-muted-foreground">请确认本地服务已启动。</p>
				</div>
			</div>
		);
	}

	if (projects.length > 0) {
		return (
			<div className="grid h-full min-h-0 place-items-center bg-ide-editor p-6 text-center">
				<div>
					<FolderOpen className="mx-auto size-8 text-muted-foreground" />
					<p className="mt-3 text-sm font-medium text-foreground">从左侧选择一个项目开始工作</p>
					<p className="mt-1 text-xs text-muted-foreground">
						打开项目后可查看概览、搜索文档或启动智能体。
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="grid h-full min-h-0 place-items-center bg-ide-editor p-6 text-center">
			<div>
				<FolderOpen className="mx-auto size-8 text-muted-foreground" />
				<p className="mt-3 text-sm font-medium text-foreground">还没有项目</p>
				<p className="mt-1 text-xs text-muted-foreground">选择一个本地文件夹作为项目工作目录。</p>
				<Button
					type="button"
					size="sm"
					className="mt-4"
					onClick={createProjectFromDirectory}
					disabled={isCreating}
				>
					{isCreating ? <Loader2 className="animate-spin" /> : <SquarePen />}
					<span>新项目</span>
				</Button>
			</div>
		</div>
	);
};
