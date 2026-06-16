import { FolderOpen, Loader2 } from "lucide-react";
import type React from "react";
import useSWR from "swr";
import { getProjects, projectsKey } from "@/domains/projects/api/projects";

export const Projects: React.FC = () => {
	const { data, error, isLoading } = useSWR(projectsKey, getProjects);
	const projects = data?.projects ?? [];

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
			</div>
		</div>
	);
};
