import { Images, Loader2, Palette, ReceiptText } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import useSWR from "swr";
import {
	type SelectedGenerationAsset,
	getSelectedGenerationAssets,
	selectedGenerationAssetsQueryKey,
} from "@/domains/generation/api/generation";
import {
	SelectedGenerationAssetsEmpty,
	SelectedGenerationAssetsGrid,
} from "@/domains/generation/components/SelectedGenerationAssetsGrid";
import { GenerationModalShell } from "@/domains/documents/components/GenerationModalShell";
import {
	selectedGenerationResourceDescriptorMap,
	selectedGenerationResourceDescriptors,
} from "@/domains/generation/lib/selected-resources";
import {
	billingSummaryKey,
	getBillingSummary,
	type BillingSummaryResponse,
} from "@/domains/billing/api/billing";
import { getProjectConfig, projectConfigKey } from "@/domains/projects/api/projects";
import { ProjectWorkspaceShell } from "@/domains/workspace/components/ProjectWorkspaceShell";
import { getRouteProjectId, type AgentResourceType } from "@/domains/workspace/lib/workbench-route";
import { useProjectStore } from "@/domains/projects/stores";
import { Badge } from "@/shared/components/ui/badge";

const numberFormatter = new Intl.NumberFormat("zh-CN");
const moneyFormatter = new Intl.NumberFormat("zh-CN", {
	maximumFractionDigits: 6,
	minimumFractionDigits: 0,
});

export const ProjectOverview: React.FC = () => {
	const location = useLocation();
	const projectId = getRouteProjectId(location.search);
	const activeProjectId = useProjectStore((state) => state.activeProjectId);
	const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);
	const [selectedResourceDialogType, setSelectedResourceDialogType] =
		useState<AgentResourceType | null>(null);
	const usageParams = useMemo(
		() => (projectId ? { groupBy: "capability", projectId } : null),
		[projectId],
	);
	const {
		data: config,
		error,
		isLoading,
	} = useSWR(projectId ? projectConfigKey(projectId) : null, () =>
		getProjectConfig(projectId ?? ""),
	);
	const {
		data: usageSummary,
		error: usageError,
		isLoading: isUsageLoading,
	} = useSWR(usageParams ? billingSummaryKey(usageParams) : null, () =>
		getBillingSummary(usageParams ?? { groupBy: "capability" }),
	);
	const {
		data: selectedResources,
		error: selectedResourcesError,
		isLoading: isSelectedResourcesLoading,
	} = useSWR(projectId ? selectedGenerationAssetsQueryKey(projectId) : null, () =>
		getSelectedGenerationAssets(projectId ?? ""),
	);

	useEffect(() => {
		if (projectId && activeProjectId !== projectId) setActiveProjectId(projectId);
	}, [activeProjectId, projectId, setActiveProjectId]);

	useEffect(() => {
		setSelectedResourceDialogType(null);
	}, [projectId]);

	const createdAtLabel = useMemo(() => {
		if (!config?.createdAt) return "";
		const date = new Date(config.createdAt);
		if (Number.isNaN(date.getTime())) return config.createdAt;
		return date.toLocaleString();
	}, [config?.createdAt]);

	const openSelectedResourceType = useCallback((resourceType: AgentResourceType) => {
		setSelectedResourceDialogType(resourceType);
	}, []);

	if (!projectId) return <Navigate to="/" replace />;

	return (
		<ProjectWorkspaceShell>
			<div className="flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
				<div className="min-h-0 flex-1 overflow-y-auto bg-ide-editor">
					<main className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 px-4 py-4">
						<header className="flex flex-col gap-3 border-b border-border pb-3 md:flex-row md:items-center">
							<div className="flex min-w-0 items-center gap-2">
								<Palette className="size-5 shrink-0 text-muted-foreground" />
								<div className="min-w-0">
									<p className="truncate text-sm font-medium text-foreground">
										{config?.name || projectId}
									</p>
									{createdAtLabel ? (
										<p className="truncate text-xs text-muted-foreground">
											创建于 {createdAtLabel}
										</p>
									) : null}
								</div>
							</div>
						</header>

						{isLoading ? (
							<div className="grid min-h-56 place-items-center border border-border bg-card">
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<Loader2 className="size-4 animate-spin" />
									<span>正在加载项目概览</span>
								</div>
							</div>
						) : null}

						{error ? (
							<div className="border border-error-border bg-error-surface p-4 text-sm text-error-foreground">
								项目概览加载失败。
							</div>
						) : null}

						{config && !isLoading ? (
							<section className="grid gap-4">
								<ProjectUsageSummary
									data={usageSummary}
									error={usageError}
									isLoading={isUsageLoading}
								/>
								<SelectedGenerationResourcesSummary
									assets={selectedResources?.assets ?? []}
									error={selectedResourcesError}
									isLoading={isSelectedResourcesLoading}
									onOpen={openSelectedResourceType}
								/>
								<SelectedGenerationResourcesDialog
									assets={selectedResources?.assets ?? []}
									error={selectedResourcesError}
									isLoading={isSelectedResourcesLoading}
									open={Boolean(selectedResourceDialogType)}
									resourceType={selectedResourceDialogType}
									onOpenChange={(open) => {
										if (!open) setSelectedResourceDialogType(null);
									}}
								/>
							</section>
						) : null}
					</main>
				</div>
			</div>
		</ProjectWorkspaceShell>
	);
};

const SelectedGenerationResourcesDialog: React.FC<{
	assets: SelectedGenerationAsset[];
	error?: unknown;
	isLoading: boolean;
	open: boolean;
	resourceType: AgentResourceType | null;
	onOpenChange: (open: boolean) => void;
}> = ({ assets, error, isLoading, open, resourceType, onOpenChange }) => {
	const descriptor = resourceType ? selectedGenerationResourceDescriptorMap[resourceType] : null;
	const filteredAssets = useMemo(
		() => (resourceType ? assets.filter((asset) => asset.resourceType === resourceType) : []),
		[assets, resourceType],
	);

	if (!descriptor) return null;

	const Icon = descriptor.icon;
	const titleId = `selected-generation-resources-${descriptor.key}-title`;

	return (
		<GenerationModalShell
			open={open}
			title={
				<span className="flex min-w-0 items-center gap-2">
					<Icon className="size-4 shrink-0 text-muted-foreground" />
					<span className="truncate">{descriptor.label} · 已选资源</span>
				</span>
			}
			titleAside={
				<Badge variant="secondary" className="shrink-0">
					已选 {filteredAssets.length} 张
				</Badge>
			}
			titleId={titleId}
			contentClassName="h-[min(86vh,760px)]"
			onOpenChange={onOpenChange}
		>
			<div className="flex h-full min-h-0 flex-col bg-ide-editor">
				{isLoading ? (
					<div className="grid min-h-56 flex-1 place-items-center">
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							<span>正在加载已选图片</span>
						</div>
					</div>
				) : null}

				{!isLoading && error ? (
					<div className="m-4 border border-error-border bg-error-surface p-4 text-sm text-error-foreground">
						已选图片加载失败。
					</div>
				) : null}

				{!isLoading && !error && filteredAssets.length === 0 ? (
					<div className="p-4">
						<SelectedGenerationAssetsEmpty />
					</div>
				) : null}

				{!isLoading && !error && filteredAssets.length > 0 ? (
					<div className="min-h-0 flex-1 overflow-y-auto p-4">
						<SelectedGenerationAssetsGrid
							assets={filteredAssets}
							className="lg:grid-cols-3 xl:grid-cols-3"
						/>
					</div>
				) : null}
			</div>
		</GenerationModalShell>
	);
};

const SelectedGenerationResourcesSummary: React.FC<{
	assets: SelectedGenerationAsset[];
	error?: unknown;
	isLoading: boolean;
	onOpen: (resourceType: AgentResourceType) => void;
}> = ({ assets, error, isLoading, onOpen }) => {
	const counts = useMemo(() => {
		const next: Record<AgentResourceType, number> = {
			character: 0,
			scene: 0,
			storyboard: 0,
			prop: 0,
		};
		for (const asset of assets) next[asset.resourceType] += 1;
		return next;
	}, [assets]);

	return (
		<section className="bg-card">
			<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
				<div className="flex min-w-0 items-center gap-2">
					<Images className="size-4 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<h2 className="text-sm font-semibold text-foreground">已选生成资源</h2>
						<p className="text-xs text-muted-foreground">生成列表中用户选中的图片资源。</p>
					</div>
				</div>
				{isLoading ? (
					<span className="flex items-center gap-1 text-xs text-muted-foreground">
						<Loader2 className="size-3 animate-spin" />
						加载中
					</span>
				) : null}
			</div>
			{error ? (
				<div className="mt-3 border border-error-border bg-error-surface px-3 py-2 text-xs text-error-foreground">
					已选资源加载失败。
				</div>
			) : null}
			<div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
				{selectedGenerationResourceDescriptors.map(({ key, label, icon: Icon }) => (
					<button
						key={key}
						type="button"
						className="group flex min-h-24 min-w-0 flex-col items-start justify-between rounded-sm border border-border bg-ide-editor px-3 py-3 text-left transition-colors hover:border-input hover:bg-ide-list-hover"
						onClick={() => onOpen(key)}
					>
						<span className="flex w-full min-w-0 items-center justify-between gap-2">
							<span className="flex min-w-0 items-center gap-2">
								<Icon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
								<span className="truncate text-sm font-medium text-foreground">{label}</span>
							</span>
						</span>
						<span className="text-xs text-muted-foreground">已选 {counts[key]} 张</span>
					</button>
				))}
			</div>
		</section>
	);
};

const ProjectUsageSummary: React.FC<{
	data?: BillingSummaryResponse;
	error?: unknown;
	isLoading: boolean;
}> = ({ data, error, isLoading }) => {
	const currencies = data?.currencies ?? [];
	const rows = data?.rows.slice(0, 4) ?? [];

	return (
		<section className="bg-card">
			<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
				<div className="flex min-w-0 items-center gap-2">
					<ReceiptText className="size-4 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<h2 className="text-sm font-semibold text-foreground">项目消耗</h2>
						<p className="text-xs text-muted-foreground">当前项目累计用量与估算花费。</p>
					</div>
				</div>
				{isLoading ? (
					<span className="flex items-center gap-1 text-xs text-muted-foreground">
						<Loader2 className="size-3 animate-spin" />
						加载中
					</span>
				) : null}
			</div>
			{error ? (
				<div className="mt-3 border border-error-border bg-error-surface px-3 py-2 text-xs text-error-foreground">
					项目消耗加载失败。
				</div>
			) : null}
			<div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
				<UsageMetric label="累计花费" value={formatCostTotals(data?.totals.costs, currencies)} />
				<UsageMetric label="总 Token" value={formatNumber(data?.totals.totalTokens ?? 0)} />
				<UsageMetric label="调用次数" value={formatNumber(data?.totals.calls ?? 0)} />
				<UsageMetric
					label="输入 / 输出"
					value={`${formatNumber(data?.totals.inputTokens ?? 0)} / ${formatNumber(data?.totals.outputTokens ?? 0)}`}
				/>
			</div>
			{rows.length > 0 ? (
				<div className="mt-3 overflow-hidden rounded-sm border border-border">
					{rows.map((row) => (
						<div
							key={row.key}
							className="grid gap-2 border-t border-border bg-ide-editor px-3 py-2 text-xs first:border-t-0 md:grid-cols-[minmax(0,1fr)_auto_auto]"
						>
							<div className="min-w-0">
								<p className="truncate font-medium text-foreground">{row.label || row.key}</p>
								<p className="truncate text-muted-foreground">{row.key}</p>
							</div>
							<span className="text-muted-foreground">{formatNumber(row.totalTokens)} Token</span>
							<span className="text-foreground">{formatCosts(row.costs, currencies)}</span>
						</div>
					))}
				</div>
			) : null}
		</section>
	);
};

const UsageMetric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
	<div className="border border-border bg-ide-editor px-3 py-2">
		<p className="text-xs text-muted-foreground">{label}</p>
		<p className="mt-1 truncate text-base font-semibold text-foreground">{value}</p>
	</div>
);

const formatNumber = (value: number | undefined) => numberFormatter.format(value ?? 0);

const formatMoney = (value: number, currency: string) =>
	`${currency} ${moneyFormatter.format(value)}`;

const formatCosts = (costs: Record<string, number>, currencies: string[]) => {
	const visible = currencies.length > 0 ? currencies : Object.keys(costs).sort();
	if (visible.length === 0) return "-";
	return visible.map((currency) => formatMoney(costs[currency] ?? 0, currency)).join(" / ");
};

const formatCostTotals = (costs: Record<string, number> | undefined, currencies: string[]) =>
	formatCosts(costs ?? {}, currencies);
