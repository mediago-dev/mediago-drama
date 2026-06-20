import { ArrowLeft, Loader2 } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import useSWR from "swr";
import {
	getSelectedGenerationAssets,
	selectedGenerationAssetsQueryKey,
} from "@/domains/generation/api/generation";
import {
	SelectedGenerationAssetsEmpty,
	SelectedGenerationAssetsGrid,
} from "@/domains/generation/components/SelectedGenerationAssetsGrid";
import { selectedGenerationResourceDescriptorMap } from "@/domains/generation/lib/selected-resources";
import { ProjectWorkspaceShell } from "@/domains/workspace/components/ProjectWorkspaceShell";
import {
	agentProjectPath,
	agentProjectRouteState,
	getRouteProjectId,
	getRouteResourceType,
} from "@/domains/workspace/lib/workbench-route";
import { Button } from "@/shared/components/ui/button";

export const ProjectSelectedResources: React.FC = () => {
	const location = useLocation();
	const navigate = useNavigate();
	const projectId = getRouteProjectId(location.search);
	const resourceType = getRouteResourceType(location.search);
	const descriptor = resourceType ? selectedGenerationResourceDescriptorMap[resourceType] : null;
	const { data, error, isLoading } = useSWR(
		projectId ? selectedGenerationAssetsQueryKey(projectId) : null,
		() => getSelectedGenerationAssets(projectId ?? ""),
	);
	const assets = useMemo(
		() => (data?.assets ?? []).filter((asset) => asset.resourceType === resourceType),
		[data?.assets, resourceType],
	);

	if (!projectId) return <Navigate to="/" replace />;
	if (!resourceType || !descriptor) {
		return <Navigate to={agentProjectPath(projectId)} replace />;
	}

	const Icon = descriptor.icon;
	const backToOverview = () => {
		navigate(agentProjectPath(projectId), { state: agentProjectRouteState("overview") });
	};

	return (
		<ProjectWorkspaceShell>
			<div className="flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
				<div className="min-h-0 flex-1 overflow-y-auto bg-ide-editor">
					<main className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-4 px-4 py-4">
						<header className="flex flex-col gap-3 border-b border-border pb-3 md:flex-row md:items-center md:justify-between">
							<div className="flex min-w-0 items-center gap-2">
								<Icon className="size-5 shrink-0 text-muted-foreground" />
								<div className="min-w-0">
									<p className="truncate text-sm font-medium text-foreground">
										{descriptor.label} · 已选资源
									</p>
									<p className="truncate text-xs text-muted-foreground">
										展示项目中已选入该资源类型的图片。
									</p>
								</div>
							</div>
							<Button type="button" variant="outline" size="sm" onClick={backToOverview}>
								<ArrowLeft />
								<span>返回概览</span>
							</Button>
						</header>

						{isLoading ? (
							<div className="grid min-h-56 place-items-center border border-border bg-card">
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<Loader2 className="size-4 animate-spin" />
									<span>正在加载已选图片</span>
								</div>
							</div>
						) : null}

						{error ? (
							<div className="border border-error-border bg-error-surface p-4 text-sm text-error-foreground">
								已选图片加载失败。
							</div>
						) : null}

						{!isLoading && !error && assets.length === 0 ? <SelectedGenerationAssetsEmpty /> : null}

						{assets.length > 0 ? <SelectedGenerationAssetsGrid assets={assets} /> : null}
					</main>
				</div>
			</div>
		</ProjectWorkspaceShell>
	);
};
