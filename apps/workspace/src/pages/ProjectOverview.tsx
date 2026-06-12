import { Layers, Loader2, Palette, ReceiptText, RotateCcw, Save } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import useSWR from "swr";
import {
	type PromptLayer,
	type PromptPreset,
	listPromptPresets,
	promptPresetsKey,
} from "@/domains/generation/api/prompt-presets";
import {
	billingSummaryKey,
	getBillingSummary,
	type BillingSummaryResponse,
} from "@/domains/billing/api/billing";
import {
	type ProjectLayerDefaults,
	getProjectConfig,
	projectConfigKey,
	updateProjectConfig,
} from "@/domains/projects/api/projects";
import { ProjectWorkspaceShell } from "@/domains/workspace/components/ProjectWorkspaceShell";
import { getRouteProjectId } from "@/domains/workspace/lib/workbench-route";
import { useProjectStore } from "@/domains/projects/stores";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import { useToast } from "@/hooks/useToast";

type SaveStatus = "saved" | "dirty" | "saving" | "error";

// 可作项目默认的层。
const defaultLayers: { layer: PromptLayer; label: string; hint: string }[] = [
	{ layer: "style", label: "风格", hint: "项目视觉与生成风格基准。" },
	{ layer: "extra", label: "其他", hint: "除风格外的可复用补充提示词。" },
];
const NONE_VALUE = "__none__";
// 稳定的空数组引用:避免 SWR 加载中每次渲染 `= []` 产生新引用,触发 useMemo→useEffect→setState 死循环。
const EMPTY_PRESETS: PromptPreset[] = [];

const numberFormatter = new Intl.NumberFormat("zh-CN");
const moneyFormatter = new Intl.NumberFormat("zh-CN", {
	maximumFractionDigits: 6,
	minimumFractionDigits: 0,
});

const saveStatusLabels: Record<SaveStatus, string> = {
	saved: "已保存",
	dirty: "未保存",
	saving: "正在保存",
	error: "保存失败",
};

export const ProjectOverview: React.FC = () => {
	const location = useLocation();
	const projectId = getRouteProjectId(location.search);
	const toast = useToast();
	const activeProjectId = useProjectStore((state) => state.activeProjectId);
	const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);
	const [defaults, setDefaults] = useState<ProjectLayerDefaults>({});
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
	const usageParams = useMemo(
		() => (projectId ? { groupBy: "capability", projectId } : null),
		[projectId],
	);
	const {
		data: config,
		error,
		isLoading,
		mutate,
	} = useSWR(projectId ? projectConfigKey(projectId) : null, () =>
		getProjectConfig(projectId ?? ""),
	);
	const { data: presets = EMPTY_PRESETS, isLoading: isPresetsLoading } = useSWR(
		promptPresetsKey,
		() => listPromptPresets(),
	);
	const {
		data: usageSummary,
		error: usageError,
		isLoading: isUsageLoading,
	} = useSWR(usageParams ? billingSummaryKey(usageParams) : null, () =>
		getBillingSummary(usageParams ?? { groupBy: "capability" }),
	);

	// 配置基线:优先用已存的 layerDefaults;否则从旧 overview.style 反查风格预设做无损迁移预选。
	const configDefaults = useMemo<ProjectLayerDefaults>(() => {
		if (!config) return {};
		const stored = pickDefaultLayers(config.overview.layerDefaults ?? {});
		if (Object.keys(stored).length > 0) return stored;
		const inferredStyle = inferStylePresetId(config.overview.style, presets);
		return inferredStyle ? { style: inferredStyle } : {};
	}, [config, presets]);

	const hasChanges = useMemo(
		() => !sameDefaults(defaults, configDefaults),
		[defaults, configDefaults],
	);

	useEffect(() => {
		if (projectId && activeProjectId !== projectId) setActiveProjectId(projectId);
	}, [activeProjectId, projectId, setActiveProjectId]);

	useEffect(() => {
		setDefaults(configDefaults);
		setSaveStatus("saved");
	}, [configDefaults]);

	const createdAtLabel = useMemo(() => {
		if (!config?.createdAt) return "";
		const date = new Date(config.createdAt);
		if (Number.isNaN(date.getTime())) return config.createdAt;
		return date.toLocaleString();
	}, [config?.createdAt]);

	const setLayerDefault = (layer: PromptLayer, presetId: string) => {
		setDefaults((current) => {
			const next = { ...current };
			if (presetId) next[layer] = presetId;
			else delete next[layer];
			return next;
		});
		setSaveStatus("dirty");
	};

	const resetDefaults = () => {
		setDefaults(configDefaults);
		setSaveStatus("saved");
	};

	const saveDefaults = useCallback(async () => {
		if (!projectId || !config || saveStatus === "saving") return;
		setSaveStatus("saving");
		try {
			const result = await updateProjectConfig(projectId, {
				overview: { layerDefaults: defaults },
			});
			await mutate(result.config, false);
			setSaveStatus("saved");
			toast.success("项目默认已保存");
		} catch (err) {
			const message = err instanceof Error ? err.message : "项目默认保存失败。";
			setSaveStatus("error");
			toast.error(message);
		}
	}, [config, defaults, mutate, projectId, saveStatus, toast]);

	if (!projectId) return <Navigate to="/" replace />;

	return (
		<ProjectWorkspaceShell>
			<div className="flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
				<div className="min-h-0 flex-1 overflow-y-auto bg-ide-editor">
					<main className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 px-4 py-4">
						<header className="flex flex-col gap-3 border-b border-border pb-3 md:flex-row md:items-center md:justify-between">
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
							<Badge variant={saveStatus === "saved" ? "secondary" : "outline"}>
								{saveStatusLabels[saveStatus]}
							</Badge>
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

								<div className="bg-card">
									<div className="flex flex-col gap-3">
										<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
											<div className="flex min-w-0 items-center gap-2">
												<Layers className="size-4 shrink-0 text-muted-foreground" />
												<div className="grid gap-1">
													<Label className="text-sm font-medium">项目默认提示词层</Label>
													<p className="text-xs text-muted-foreground">
														为各层选默认预设；生成时自动套用，可在生成处覆盖。
													</p>
												</div>
											</div>
											<div className="flex shrink-0 items-center gap-2">
												<Button
													type="button"
													variant="outline"
													disabled={!hasChanges || saveStatus === "saving"}
													onClick={resetDefaults}
												>
													<RotateCcw />
													<span>重置</span>
												</Button>
												<Button
													type="button"
													disabled={!hasChanges || saveStatus === "saving"}
													onClick={saveDefaults}
												>
													{saveStatus === "saving" ? (
														<Loader2 className="animate-spin" />
													) : (
														<Save />
													)}
													<span>保存</span>
												</Button>
											</div>
										</div>

										<div className="grid gap-3">
											{defaultLayers.map(({ layer, label, hint }) => {
												const options = presets.filter((preset) => preset.layer === layer);
												const value = defaults[layer] ?? "";
												return (
													<div
														key={layer}
														className="grid gap-2 md:grid-cols-[10rem_minmax(0,1fr)] md:items-center"
													>
														<div className="grid gap-0.5">
															<Label className="text-sm font-medium text-foreground">{label}</Label>
															<span className="text-xs text-muted-foreground">{hint}</span>
														</div>
														<Select
															value={value || NONE_VALUE}
															onValueChange={(next) =>
																setLayerDefault(layer, next === NONE_VALUE ? "" : next)
															}
														>
															<SelectTrigger className="rounded-md text-foreground">
																<SelectValue
																	placeholder={isPresetsLoading ? "加载中…" : "不使用"}
																/>
															</SelectTrigger>
															<SelectContent align="start">
																<SelectItem value={NONE_VALUE}>不使用</SelectItem>
																{options.map((preset) => (
																	<SelectItem key={preset.id} value={preset.id}>
																		{preset.name}
																	</SelectItem>
																))}
															</SelectContent>
														</Select>
													</div>
												);
											})}
										</div>
									</div>
								</div>
							</section>
						) : null}
					</main>
				</div>
			</div>
		</ProjectWorkspaceShell>
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

const inferStylePresetId = (style: string, presets: PromptPreset[]): string => {
	const normalized = style.trim();
	if (!normalized) return "";
	return (
		presets.find((preset) => preset.layer === "style" && preset.prompt.trim() === normalized)?.id ??
		""
	);
};

const sameDefaults = (left: ProjectLayerDefaults, right: ProjectLayerDefaults) => {
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) {
		if (left[key as PromptLayer] !== right[key as PromptLayer]) return false;
	}
	return true;
};

const pickDefaultLayers = (defaults: ProjectLayerDefaults): ProjectLayerDefaults => {
	const picked: ProjectLayerDefaults = {};
	for (const { layer } of defaultLayers) {
		const presetId = defaults[layer];
		if (presetId) picked[layer] = presetId;
	}
	return picked;
};

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
