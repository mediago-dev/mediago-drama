import {
	Check,
	Loader2,
	MessageSquarePlus,
	SlidersHorizontal,
	Sparkles,
	Wand2,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
	GenerationFamily,
	GenerationPromptOptimizationRequest,
	GenerationRoute,
	GenerationVersion,
} from "@/domains/generation/api/generation";
import { GenerationModalShell } from "@/domains/documents/components/GenerationModalShell";
import { GenerationBrandMark, generationFamilyBrand } from "./GenerationBrandMark";
import { GenerationModelRoutePicker } from "./GenerationModelRoutePicker";
import { displayGenerationLabelWithoutAlias } from "./generationDisplayLabels";
import { ImageGenerationSpecControl } from "./ImageGenerationSpecControl";
import { filterImageGenerationSpecParams, resolveImageGenerationSpec } from "./imageGenerationSpec";
import {
	GenerationCountControl,
	PrimaryParamControl,
	SecondaryParamSettings,
} from "./MediaGenerationDialogs";
import { resolveParamGroups } from "./mediaGenerationHelpers";
import type { PromptInsertItem } from "./PromptSlashCommand";
import { useGenerationCountControl } from "./useGenerationCountControl";
import { promptOptimizeModelOptions as listPromptOptimizeModelOptions } from "@/domains/generation/hooks/usePromptOptimize";
import { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import {
	type BatchGenerationDialogKind,
	type BatchGenerationStoredSettings,
	batchGenerationPromptOptimizationEnabled,
	batchGenerationPromptSupplementEnabled,
	useBatchGenerationSettingsPreferenceStore,
} from "@/domains/generation/stores/batch-generation-settings";
import {
	kindLabel,
	paramLabel,
	preferredRoute,
	routeProviderLabel,
	type StoredGenerationModelSelection,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/shared/components/ui/select";

export interface BatchGenerationSettings {
	family: GenerationFamily;
	params: Record<string, unknown>;
	promptOptimization?: GenerationPromptOptimizationRequest;
	promptSupplement?: BatchGenerationPromptSupplement;
	route: GenerationRoute;
	version: GenerationVersion;
}

export interface BatchGenerationPromptSupplement {
	referenceName: string;
	referencePrompt: string;
}

export const batchGenerationParamsForConfirm = (
	route: Pick<GenerationRoute, "params">,
	selectedParams: Record<string, unknown>,
	generationCountParamName?: string,
	generationCountValue = 1,
) => {
	const params: Record<string, unknown> = {};
	const routeParamNames = new Set(route.params.map((param) => param.name));

	for (const param of route.params) {
		const value = selectedParams[param.name];
		if (value !== undefined) params[param.name] = value;
	}

	if (generationCountParamName && routeParamNames.has(generationCountParamName)) {
		params[generationCountParamName] = generationCountValue;
	}

	return params;
};

export const batchGenerationPromptOptimizationForConfirm = (
	item: Pick<PromptInsertItem, "name" | "prompt"> | null | undefined,
	model: { route: Pick<GenerationRoute, "id" | "model"> } | null | undefined,
): GenerationPromptOptimizationRequest | undefined => {
	if (!item || !model?.route) return undefined;
	const referencePrompt = item.prompt.trim();
	if (!referencePrompt) return undefined;

	return {
		model: model.route.model,
		referenceName: item.name,
		referencePrompt,
		routeId: model.route.id,
	};
};

export const batchGenerationPromptSupplementForConfirm = (
	item: Pick<PromptInsertItem, "name" | "prompt"> | null | undefined,
): BatchGenerationPromptSupplement | undefined => {
	if (!item) return undefined;
	const referencePrompt = item.prompt.trim();
	if (!referencePrompt) return undefined;

	return {
		referenceName: item.name,
		referencePrompt,
	};
};

export const batchGenerationConfirmButtonLabel = (optimizePrompt: boolean) =>
	optimizePrompt ? "优化并生成" : "生成";

export const BatchGenerationSettingsDialog: React.FC<{
	kind: BatchGenerationDialogKind;
	onConfirm: (settings: BatchGenerationSettings) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	projectId?: string;
	selectedCount: number;
}> = ({ kind, onConfirm, onOpenChange, open, projectId, selectedCount }) => {
	const setStoredSettings = useBatchGenerationSettingsPreferenceStore((state) => state.setSettings);
	const [settingsToRestore, setSettingsToRestore] = useState<BatchGenerationStoredSettings | null>(
		() => useBatchGenerationSettingsPreferenceStore.getState().settingsByKind[kind] ?? null,
	);
	const restoredStoredSettingsRef = useRef(false);
	const previousOpenRef = useRef(false);
	const [selectedPromptOptimizeItemId, setSelectedPromptOptimizeItemId] = useState<string | null>(
		settingsToRestore?.promptOptimizeItemId ?? null,
	);
	const [selectedPromptOptimizeRouteId, setSelectedPromptOptimizeRouteId] = useState(
		settingsToRestore?.promptOptimizeRouteId ?? "",
	);
	const [selectedPromptSupplementItemId, setSelectedPromptSupplementItemId] = useState<
		string | null
	>(settingsToRestore?.promptSupplementItemId ?? null);
	const [usePromptOptimization, setUsePromptOptimization] = useState(() =>
		batchGenerationPromptOptimizationEnabled(settingsToRestore),
	);
	const [usePromptSupplement, setUsePromptSupplement] = useState(() =>
		batchGenerationPromptSupplementEnabled(settingsToRestore),
	);
	// Seed the workspace from the snapshot captured when the dialog opened, not the
	// live store. Reading the live store here would feed back into itself: the effect
	// below persists edits via setStoredSettings, which would change this value, re-seed
	// the model selection, rewrite the params, and loop forever (crashes on ratio changes
	// like 9:16 → 3:4 that also auto-correct the resolution).
	const settingsForInitialModelSelection = settingsToRestore;
	const initialModelSelection = useMemo(
		() => batchGenerationModelSelectionFromSettings(kind, settingsForInitialModelSelection),
		[kind, settingsForInitialModelSelection],
	);
	const initialModelSelectionKey = useMemo(
		() => batchGenerationStoredSettingsKey(kind, settingsForInitialModelSelection),
		[kind, settingsForInitialModelSelection],
	);
	const ws = useGenerationWorkspace({
		initialKind: kind,
		initialModelSelection,
		initialModelSelectionKey,
		initialPrompt: "",
		modelPreferenceScopeId: projectId,
		persistModelSelection: false,
		projectId,
		projectStyleOnly: true,
		uploadIdPrefix: "batch-generation-settings",
		useRawPrompt: true,
	});

	useEffect(() => {
		if (!open) {
			previousOpenRef.current = false;
			return;
		}
		if (previousOpenRef.current) return;
		previousOpenRef.current = true;

		const latestSettings =
			useBatchGenerationSettingsPreferenceStore.getState().settingsByKind[kind] ?? null;
		setSettingsToRestore(latestSettings);
		setSelectedPromptOptimizeItemId(latestSettings?.promptOptimizeItemId ?? null);
		setSelectedPromptOptimizeRouteId(latestSettings?.promptOptimizeRouteId ?? "");
		setSelectedPromptSupplementItemId(latestSettings?.promptSupplementItemId ?? null);
		setUsePromptOptimization(batchGenerationPromptOptimizationEnabled(latestSettings));
		setUsePromptSupplement(batchGenerationPromptSupplementEnabled(latestSettings));
		restoredStoredSettingsRef.current = false;
	}, [kind, open]);

	useEffect(() => {
		if (restoredStoredSettingsRef.current || !ws.hasLiveCatalog) return;
		if (!settingsToRestore) {
			restoredStoredSettingsRef.current = true;
			return;
		}

		const storedRouteId = settingsToRestore.routeId?.trim();
		if (!storedRouteId || !ws.hasConfiguredRoutesForKind) {
			restoredStoredSettingsRef.current = true;
			return;
		}

		const storedRoute = ws.catalog.routes.find(
			(route) =>
				route.id === storedRouteId &&
				route.kind === kind &&
				route.configured &&
				route.status === "available",
		);
		if (!storedRoute) {
			restoredStoredSettingsRef.current = true;
			return;
		}

		if (ws.selectedFamily.id !== storedRoute.familyId) {
			ws.updateFamily(storedRoute.familyId);
			return;
		}

		if (ws.selectedVersion.id !== storedRoute.versionId || ws.selectedRoute.id !== storedRoute.id) {
			ws.updateModelRoute(storedRoute.versionId, storedRoute.id);
			return;
		}

		const routeParamNames = new Set(storedRoute.params.map((param) => param.name));
		for (const [name, value] of Object.entries(settingsToRestore.params ?? {})) {
			if (routeParamNames.has(name)) ws.updateParam(name, value);
		}
		restoredStoredSettingsRef.current = true;
	}, [
		kind,
		settingsToRestore,
		ws.catalog.routes,
		ws.hasConfiguredRoutesForKind,
		ws.hasLiveCatalog,
		ws.selectedFamily.id,
		ws.selectedRoute.id,
		ws.selectedVersion.id,
		ws.updateFamily,
		ws.updateModelRoute,
		ws.updateParam,
	]);

	const routeParamGroups = useMemo(() => resolveParamGroups(ws.selectedRoute), [ws.selectedRoute]);
	const sizeGroupParams = useMemo(
		() => routeParamGroups.find((group) => group.id === "size")?.params ?? [],
		[routeParamGroups],
	);
	const countGroupParams = useMemo(
		() => routeParamGroups.find((group) => group.id === "count")?.params ?? [],
		[routeParamGroups],
	);
	const otherParamGroup = useMemo(
		() => routeParamGroups.find((group) => group.id === "other") ?? null,
		[routeParamGroups],
	);
	const imageSpec = useMemo(
		() =>
			resolveImageGenerationSpec(sizeGroupParams, ws.selectedParams, ws.selectedRoute.paramCombos),
		[sizeGroupParams, ws.selectedParams, ws.selectedRoute.paramCombos],
	);
	const imageSpecControlledParamNames = useMemo(
		() => new Set(imageSpec?.controlledParamNames ?? []),
		[imageSpec],
	);
	const { generationCountControl } = useGenerationCountControl({
		hasConfiguredRoutesForKind: ws.hasConfiguredRoutesForKind,
		onParamChange: ws.updateParam,
		params: countGroupParams,
		selectedParams: ws.selectedParams,
	});
	const generationCountParamName = useMemo(
		() => countGroupParams.find((param) => param.name === "n" && param.type === "number")?.name,
		[countGroupParams],
	);
	const primaryParamGroups = useMemo(
		() =>
			routeParamGroups.filter(
				(group) =>
					group.id !== "size" &&
					group.id !== "count" &&
					group.id !== "other" &&
					group.params.length === 1 &&
					group.params[0]?.type === "select",
			),
		[routeParamGroups],
	);
	const renderedPrimaryParamNames = useMemo(() => {
		const names = new Set(imageSpecControlledParamNames);
		if (generationCountParamName) names.add(generationCountParamName);
		for (const group of primaryParamGroups) {
			const param = group.params[0];
			if (param) names.add(param.name);
		}
		return names;
	}, [generationCountParamName, imageSpecControlledParamNames, primaryParamGroups]);
	const secondaryRouteParams = useMemo(
		() =>
			filterImageGenerationSpecParams(
				[
					...(otherParamGroup?.params ?? []),
					...routeParamGroups.flatMap((group) =>
						group.id === "other"
							? []
							: group.params.filter((param) => !renderedPrimaryParamNames.has(param.name)),
					),
				],
				imageSpec,
			),
		[imageSpec, otherParamGroup, renderedPrimaryParamNames, routeParamGroups],
	);
	const primaryParamControls = useMemo(
		() =>
			primaryParamGroups.map((group) => {
				const param = group.params[0];
				if (!param) return null;

				return (
					<PrimaryParamControl
						key={`${group.id}:${param.name}`}
						label={group.label}
						param={param}
						value={ws.selectedParams[param.name]}
						onChange={(value) => ws.updateParam(param.name, value)}
					/>
				);
			}),
		[primaryParamGroups, ws.selectedParams, ws.updateParam],
	);
	const promptOptimizeModelOptions = useMemo(
		() => listPromptOptimizeModelOptions(ws.catalog),
		[ws.catalog],
	);
	const preferredPromptOptimizeModel = useMemo(() => {
		const route = preferredRoute(promptOptimizeModelOptions.map((option) => option.route));
		if (!route) return promptOptimizeModelOptions[0] ?? null;
		return (
			promptOptimizeModelOptions.find((option) => option.route.id === route.id) ??
			promptOptimizeModelOptions[0] ??
			null
		);
	}, [promptOptimizeModelOptions]);
	useEffect(() => {
		if (promptOptimizeModelOptions.length === 0) {
			if (ws.hasLiveCatalog && selectedPromptOptimizeRouteId) setSelectedPromptOptimizeRouteId("");
			return;
		}
		if (promptOptimizeModelOptions.some((option) => option.id === selectedPromptOptimizeRouteId)) {
			return;
		}
		setSelectedPromptOptimizeRouteId(
			preferredPromptOptimizeModel?.id ?? promptOptimizeModelOptions[0]?.id ?? "",
		);
	}, [
		preferredPromptOptimizeModel?.id,
		promptOptimizeModelOptions,
		selectedPromptOptimizeRouteId,
		ws.hasLiveCatalog,
	]);
	const selectedPromptOptimizeModel =
		promptOptimizeModelOptions.find((option) => option.id === selectedPromptOptimizeRouteId) ??
		preferredPromptOptimizeModel ??
		promptOptimizeModelOptions[0] ??
		null;
	const selectedPromptOptimizeItem =
		ws.promptInsertItems.find((item) => item.id === selectedPromptOptimizeItemId) ?? null;
	const selectedPromptSupplementItem =
		ws.promptInsertItems.find((item) => item.id === selectedPromptSupplementItemId) ?? null;
	useEffect(() => {
		if (!selectedPromptOptimizeItemId || ws.promptInsertItems.length === 0) return;
		if (ws.promptInsertItems.some((item) => item.id === selectedPromptOptimizeItemId)) return;
		setSelectedPromptOptimizeItemId(null);
	}, [selectedPromptOptimizeItemId, ws.promptInsertItems]);
	useEffect(() => {
		if (selectedPromptOptimizeItemId || !ws.promptInsertItems[0]) return;
		setSelectedPromptOptimizeItemId(ws.promptInsertItems[0].id);
	}, [selectedPromptOptimizeItemId, ws.promptInsertItems]);
	useEffect(() => {
		if (!selectedPromptSupplementItemId || ws.promptInsertItems.length === 0) return;
		if (ws.promptInsertItems.some((item) => item.id === selectedPromptSupplementItemId)) return;
		setSelectedPromptSupplementItemId(null);
	}, [selectedPromptSupplementItemId, ws.promptInsertItems]);
	useEffect(() => {
		if (selectedPromptSupplementItemId || !ws.promptInsertItems[0]) return;
		setSelectedPromptSupplementItemId(ws.promptInsertItems[0].id);
	}, [selectedPromptSupplementItemId, ws.promptInsertItems]);
	const promptSupplement = useMemo(
		() => batchGenerationPromptSupplementForConfirm(selectedPromptSupplementItem),
		[selectedPromptSupplementItem],
	);
	const promptOptimizationReady = Boolean(
		selectedPromptOptimizeItem && selectedPromptOptimizeModel?.route,
	);
	const promptSupplementReady = Boolean(promptSupplement);
	const hasAvailableRoute =
		ws.hasLiveCatalog &&
		ws.hasConfiguredRoutesForKind &&
		ws.selectedRoute.kind === kind &&
		ws.selectedRoute.status === "available" &&
		ws.selectedRoute.configured;
	const confirmDisabled = selectedCount === 0 || !hasAvailableRoute;
	const primaryConfirmDisabled =
		confirmDisabled ||
		(usePromptOptimization && !promptOptimizationReady) ||
		(usePromptSupplement && !promptSupplementReady);
	const primaryConfirmLabel = batchGenerationConfirmButtonLabel(usePromptOptimization);
	const selectedSettingsDraft = useMemo<BatchGenerationStoredSettings>(
		() => ({
			familyId: ws.selectedFamily.id,
			params: batchGenerationParamsForConfirm(
				ws.selectedRoute,
				ws.selectedParams,
				generationCountParamName,
				generationCountControl?.value ?? 1,
			),
			promptOptimizeItemId: selectedPromptOptimizeItem?.id,
			promptOptimizeRouteId: selectedPromptOptimizeModel?.id,
			promptSupplementItemId: selectedPromptSupplementItem?.id,
			routeId: ws.selectedRoute.id,
			usePromptOptimization,
			usePromptSupplement,
			versionId: ws.selectedVersion.id,
		}),
		[
			generationCountControl?.value,
			generationCountParamName,
			selectedPromptOptimizeItem?.id,
			selectedPromptOptimizeModel?.id,
			selectedPromptSupplementItem?.id,
			usePromptOptimization,
			usePromptSupplement,
			ws.selectedFamily.id,
			ws.selectedParams,
			ws.selectedRoute,
			ws.selectedVersion.id,
		],
	);
	useEffect(() => {
		if (!open || !restoredStoredSettingsRef.current || !hasAvailableRoute) return;
		setStoredSettings(kind, selectedSettingsDraft);
	}, [hasAvailableRoute, kind, open, selectedSettingsDraft, setStoredSettings]);
	const modelSummary = hasAvailableRoute
		? `${displayGenerationLabelWithoutAlias(ws.selectedFamily.label)} / ${displayGenerationLabelWithoutAlias(ws.selectedVersion.label)} / ${routeProviderLabel(ws.selectedRoute)}`
		: `暂无可用${kindLabel(kind)}生成供应商`;
	const selectedFamilyLabel = displayGenerationLabelWithoutAlias(ws.selectedFamily.label);
	const selectedFamilyBrand = generationFamilyBrand(ws.selectedFamily);
	const title = `批量生成${kind === "image" ? "图片" : "视频"}设置`;

	const confirm = (optimizePrompt = false) => {
		if (
			confirmDisabled ||
			(optimizePrompt && !promptOptimizationReady) ||
			(usePromptSupplement && !promptSupplement)
		) {
			return;
		}
		const promptOptimization = optimizePrompt
			? batchGenerationPromptOptimizationForConfirm(
					selectedPromptOptimizeItem,
					selectedPromptOptimizeModel,
				)
			: undefined;
		const selectedPromptSupplement = usePromptSupplement ? promptSupplement : undefined;
		const params = batchGenerationParamsForConfirm(
			ws.selectedRoute,
			ws.selectedParams,
			generationCountParamName,
			generationCountControl?.value ?? 1,
		);
		setStoredSettings(kind, {
			...selectedSettingsDraft,
			params,
			usePromptOptimization: optimizePrompt,
			usePromptSupplement,
		});
		onConfirm({
			family: ws.selectedFamily,
			params,
			promptOptimization,
			promptSupplement: selectedPromptSupplement,
			route: ws.selectedRoute,
			version: ws.selectedVersion,
		});
	};

	return (
		<GenerationModalShell
			open={open}
			title={title}
			titleAside={
				<Badge variant="secondary" className="shrink-0">
					已选 {selectedCount} 项
				</Badge>
			}
			titleId={`batch-generation-settings-${kind}-title`}
			contentClassName="h-[min(88vh,620px)] max-w-3xl"
			contentLayerClassName="max-w-3xl"
			onOpenChange={onOpenChange}
		>
			<div className="flex h-full min-h-0 flex-col bg-card">
				<div className="min-h-0 flex-1 overflow-y-auto p-4">
					<div className="grid gap-4">
						<section className="grid gap-3 rounded-sm border border-border bg-ide-editor p-3">
							<div className="flex min-w-0 items-center justify-between gap-3">
								<div className="min-w-0">
									<h3 className="text-sm font-semibold text-foreground">模型</h3>
									<p className="truncate text-xs text-muted-foreground">{modelSummary}</p>
								</div>
								{ws.hasLiveCatalog ? null : (
									<span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
										<Loader2 className="size-3.5 animate-spin" />
										加载中
									</span>
								)}
							</div>

							{ws.hasConfiguredRoutesForKind ? (
								<div className="grid gap-2 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
									<Select value={ws.selectedFamily.id} onValueChange={ws.updateFamily}>
										<SelectTrigger
											aria-label="模型名称"
											className="h-9 rounded-sm border-input bg-muted px-2 text-xs font-semibold shadow-none"
										>
											<GenerationBrandMark
												brand={selectedFamilyBrand}
												className="size-4 text-[0.5rem]"
											/>
											<span className="min-w-0 truncate">{selectedFamilyLabel}</span>
										</SelectTrigger>
										<SelectContent align="start">
											{ws.visibleFamilies.map((family) => (
												<SelectItem
													key={family.id}
													value={family.id}
													textValue={displayGenerationLabelWithoutAlias(family.label)}
												>
													<span className="flex min-w-0 items-center gap-2">
														<GenerationBrandMark
															brand={generationFamilyBrand(family)}
															className="size-4 text-[0.5rem]"
														/>
														<span className="min-w-0 truncate">
															{displayGenerationLabelWithoutAlias(family.label)}
														</span>
													</span>
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<GenerationModelRoutePicker
										className="h-9 max-w-none rounded-sm text-xs"
										routes={ws.visibleFamilyRoutes}
										selectedRoute={ws.selectedRoute}
										selectedVersion={ws.selectedVersion}
										versions={ws.visibleVersions}
										onSelect={ws.updateModelRoute}
									/>
								</div>
							) : (
								<div className="rounded-sm border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-foreground">
									请先在模型设置里配置可用的{kindLabel(kind)}生成供应商。
								</div>
							)}
						</section>

						<section className="grid gap-3 rounded-sm border border-border bg-ide-editor p-3">
							<div className="flex min-w-0 items-center gap-2">
								<SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
								<h3 className="text-sm font-semibold text-foreground">参数</h3>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								{generationCountControl ? (
									<LabeledInlineControl label="每项生成数量">
										<GenerationCountControl {...generationCountControl} />
									</LabeledInlineControl>
								) : (
									<LabeledInlineControl label="每项生成数量">
										<Badge variant="outline" className="h-8 rounded-sm bg-muted px-2">
											每项 1 个
										</Badge>
									</LabeledInlineControl>
								)}
								{imageSpec ? (
									<LabeledInlineControl label={kind === "video" ? "视频大小" : "图片大小"}>
										<ImageGenerationSpecControl
											label={kind === "video" ? "视频大小" : "图片大小"}
											showSizePreview={kind === "image"}
											spec={imageSpec}
											onChange={ws.updateParam}
										/>
									</LabeledInlineControl>
								) : null}
								{primaryParamControls}
							</div>
							{secondaryRouteParams.length > 0 ? (
								<div className="rounded-sm border border-border bg-card p-2">
									<SecondaryParamSettings
										params={secondaryRouteParams}
										values={ws.selectedParams}
										onChange={ws.updateParam}
									/>
								</div>
							) : null}
							{!imageSpec &&
							primaryParamControls.length === 0 &&
							secondaryRouteParams.length === 0 ? (
								<p className="text-xs text-muted-foreground">当前模型没有额外可配置参数。</p>
							) : null}
						</section>

						<section className="grid gap-3 rounded-sm border border-border bg-ide-editor p-3">
							<div className="flex min-w-0 items-center justify-between gap-3">
								<div className="flex min-w-0 items-center gap-2">
									<MessageSquarePlus className="size-4 shrink-0 text-primary" />
									<h3 className="text-sm font-semibold text-foreground">补充提示词</h3>
								</div>
								<label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-sm border border-border bg-card px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-ide-list-hover">
									<input
										type="checkbox"
										checked={usePromptSupplement}
										className="size-4 rounded-sm border-border accent-primary"
										onChange={(event) => setUsePromptSupplement(event.target.checked)}
									/>
									<span>生成时追加</span>
								</label>
							</div>

							<div className="flex flex-wrap items-center gap-2">
								<LabeledInlineControl label="提示词包">
									<PromptPackSelect
										ariaLabel="补充提示词包"
										disabled={!usePromptSupplement || ws.promptInsertItems.length === 0}
										items={ws.promptInsertItems}
										selectedItem={selectedPromptSupplementItem}
										onValueChange={setSelectedPromptSupplementItemId}
									/>
								</LabeledInlineControl>
							</div>
							{usePromptSupplement && !promptSupplementReady ? (
								<p className="text-xs text-muted-foreground">
									需要可用的提示词包后才能追加并生成。
								</p>
							) : null}
						</section>

						<section className="grid gap-3 rounded-sm border border-border bg-ide-editor p-3">
							<div className="flex min-w-0 items-center justify-between gap-3">
								<div className="flex min-w-0 items-center gap-2">
									<Wand2 className="size-4 shrink-0 text-primary" />
									<h3 className="text-sm font-semibold text-foreground">优化提示词</h3>
								</div>
								<label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-sm border border-border bg-card px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-ide-list-hover">
									<input
										type="checkbox"
										checked={usePromptOptimization}
										className="size-4 rounded-sm border-border accent-primary"
										onChange={(event) => setUsePromptOptimization(event.target.checked)}
									/>
									<span>优化并生成时使用</span>
								</label>
							</div>

							<div className="flex flex-wrap items-center gap-2">
								<LabeledInlineControl label="提示词包">
									<PromptPackSelect
										ariaLabel="优化提示词包"
										disabled={!usePromptOptimization || ws.promptInsertItems.length === 0}
										items={ws.promptInsertItems}
										selectedItem={selectedPromptOptimizeItem}
										onValueChange={setSelectedPromptOptimizeItemId}
									/>
								</LabeledInlineControl>
								<LabeledInlineControl label="优化模型">
									<Select
										value={selectedPromptOptimizeModel?.id}
										disabled={!usePromptOptimization || promptOptimizeModelOptions.length === 0}
										onValueChange={setSelectedPromptOptimizeRouteId}
									>
										<SelectTrigger
											aria-label="优化模型"
											className="h-8 min-w-44 max-w-72 rounded-sm border-input bg-muted px-2 text-xs font-semibold shadow-none"
										>
											{selectedPromptOptimizeModel ? (
												<>
													<GenerationBrandMark
														brand={generationFamilyBrand(selectedPromptOptimizeModel.family)}
														className="size-4 text-[0.5rem]"
													/>
													<span className="min-w-0 truncate">
														{selectedPromptOptimizeModel.label}
													</span>
												</>
											) : (
												<span className="min-w-0 truncate">无可用文本模型</span>
											)}
										</SelectTrigger>
										<SelectContent align="start">
											{promptOptimizeModelOptions.map((option) => (
												<SelectItem key={option.id} value={option.id} textValue={option.label}>
													<span className="flex min-w-0 items-center gap-2">
														<GenerationBrandMark
															brand={generationFamilyBrand(option.family)}
															className="size-4 text-[0.5rem]"
														/>
														<span className="min-w-0 truncate">{option.label}</span>
													</span>
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</LabeledInlineControl>
							</div>
							{usePromptOptimization && !promptOptimizationReady ? (
								<p className="text-xs text-muted-foreground">
									需要可用的提示词包和文本模型后才能优化并生成。
								</p>
							) : null}
						</section>
					</div>
				</div>

				<footer className="flex shrink-0 flex-col gap-2 border-t border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-xs text-muted-foreground">
						将按顺序对 {selectedCount} 项各提交一次生成任务。
					</p>
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-8 rounded-sm"
							onClick={() => onOpenChange(false)}
						>
							取消
						</Button>
						<Button
							type="button"
							size="sm"
							className="h-8 rounded-sm"
							disabled={primaryConfirmDisabled}
							onClick={() => confirm(usePromptOptimization)}
						>
							{usePromptOptimization ? (
								<Sparkles className="size-4" />
							) : (
								<Check className="size-4" />
							)}
							{primaryConfirmLabel}
						</Button>
					</div>
				</footer>
			</div>
		</GenerationModalShell>
	);
};

const PromptPackSelect: React.FC<{
	ariaLabel: string;
	disabled: boolean;
	items: PromptInsertItem[];
	onValueChange: (value: string) => void;
	selectedItem: PromptInsertItem | null;
}> = ({ ariaLabel, disabled, items, onValueChange, selectedItem }) => (
	<Select value={selectedItem?.id ?? ""} disabled={disabled} onValueChange={onValueChange}>
		<SelectTrigger
			aria-label={ariaLabel}
			className="h-8 min-w-52 max-w-80 rounded-sm border-input bg-muted px-2 text-xs font-semibold shadow-none"
		>
			<span className="min-w-0 truncate">{selectedItem?.name ?? "无可用提示词包"}</span>
		</SelectTrigger>
		<SelectContent align="start" className="max-h-80">
			{items.map((item) => (
				<SelectItem key={item.id} value={item.id} textValue={item.name}>
					<span className="flex min-w-0 flex-col">
						<span className="min-w-0 truncate text-xs font-semibold">{item.name}</span>
						<span className="min-w-0 truncate text-2xs text-muted-foreground">
							{promptOptimizeItemMeta(item)}
						</span>
					</span>
				</SelectItem>
			))}
		</SelectContent>
	</Select>
);

const LabeledInlineControl: React.FC<{
	children: React.ReactNode;
	label: string;
}> = ({ children, label }) => (
	<div className="flex min-w-0 items-center gap-2 py-1.5">
		<span className="shrink-0 pl-1 text-2xs font-semibold text-muted-foreground">
			{paramLabel(label)}
		</span>
		<div className="min-w-0">{children}</div>
	</div>
);

const promptOptimizeItemMeta = (item: PromptInsertItem) =>
	[item.categoryLabel, item.sourceLabel].filter(Boolean).join(" / ");

const batchGenerationModelSelectionFromSettings = (
	kind: BatchGenerationDialogKind,
	settings: BatchGenerationStoredSettings | null,
): StoredGenerationModelSelection | undefined => {
	if (!settings) return undefined;

	const familyId = settings.familyId?.trim();
	const versionId = settings.versionId?.trim();
	const routeId = settings.routeId?.trim();
	if (!familyId && !versionId && !routeId) return undefined;

	return {
		familyIds: familyId ? { [kind]: familyId } : {},
		routeIds: versionId && routeId ? { [versionId]: routeId } : {},
		routeParams: routeId ? { [routeId]: { ...settings.params } } : {},
		versionIds: familyId && versionId ? { [familyId]: versionId } : {},
	};
};

const batchGenerationStoredSettingsKey = (
	kind: BatchGenerationDialogKind,
	settings: BatchGenerationStoredSettings | null,
) =>
	JSON.stringify({
		familyId: settings?.familyId ?? "",
		kind,
		params: settings?.params ?? {},
		routeId: settings?.routeId ?? "",
		versionId: settings?.versionId ?? "",
	});
