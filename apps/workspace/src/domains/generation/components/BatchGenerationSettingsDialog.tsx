import {
	Check,
	ChevronDown,
	ChevronRight,
	Images,
	Library,
	Loader2,
	MessageSquarePlus,
	SlidersHorizontal,
	Sparkles,
	type LucideIcon,
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
import type { MediaAsset } from "@/domains/workspace/api/media";
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
import { ReferencePreviewStrip } from "./ReferencePreviewStrip";
import { ReferenceSelectionDialog, type ReferenceKindFilter } from "./ReferenceSelectionDialog";
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
	maxReferenceUrlsForRoute,
	paramLabel,
	preferredRoute,
	routeProviderLabel,
	type StoredGenerationModelSelection,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { Badge } from "@/shared/components/ui/badge";
import { DialogDismissButton } from "@/shared/components/ui/dialog-dismiss";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";
import {
	type CascadedPickerPoint,
	pointerEventPoint,
	shouldKeepCascadedPickerSourceActive,
} from "./cascadedPickerSafeTriangle";

export interface BatchGenerationSettings {
	family: GenerationFamily;
	params: Record<string, unknown>;
	promptOptimization?: GenerationPromptOptimizationRequest;
	promptSupplement?: BatchGenerationPromptSupplement;
	referenceAssetIds?: string[];
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
	const [referenceDialogOpen, setReferenceDialogOpen] = useState(false);
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
	const supportsBatchReferenceImages =
		kind === "image" && hasAvailableRoute && ws.selectedRoute.supportsReferenceUrls;
	const imageReferenceAssets = useMemo(
		() => ws.mediaAssets.filter((asset) => asset.kind === "image"),
		[ws.mediaAssets],
	);
	const imageReferenceKinds = useMemo(() => new Set<MediaAsset["kind"]>(["image"]), []);
	const imageReferenceKindFilters = useMemo<ReferenceKindFilter[]>(() => ["image"], []);
	const selectedBatchReferenceAssetIds = supportsBatchReferenceImages
		? ws.selectedReferenceAssetIds
		: [];
	const selectedBatchReferenceAssets = supportsBatchReferenceImages
		? ws.selectedReferenceAssets
		: [];
	const maxBatchReferenceUrls = supportsBatchReferenceImages
		? maxReferenceUrlsForRoute(ws.selectedRoute)
		: undefined;
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
		const referenceAssetIds =
			kind === "image" && ws.selectedRoute.supportsReferenceUrls
				? selectedBatchReferenceAssetIds
				: [];
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
			...(referenceAssetIds.length > 0 ? { referenceAssetIds } : {}),
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
							{supportsBatchReferenceImages ? (
								<div className="grid gap-2 pt-1">
									<LabeledInlineControl label="参考图">
										<button
											type="button"
											title="选择参考图"
											className="flex h-[var(--generation-control-height)] items-center gap-1.5 rounded-[var(--generation-control-radius)] border-0 bg-muted px-[var(--generation-control-padding-x)] text-2xs font-semibold text-foreground transition-colors hover:bg-ide-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
											onClick={() => setReferenceDialogOpen(true)}
										>
											<Images className="size-4 shrink-0 text-muted-foreground" />
											<span>
												{selectedBatchReferenceAssetIds.length > 0
													? `已选 ${selectedBatchReferenceAssetIds.length} 张`
													: "选择"}
											</span>
										</button>
									</LabeledInlineControl>
									{selectedBatchReferenceAssets.length > 0 ? (
										<ReferencePreviewStrip
											tone="card"
											enableImagePreview
											references={selectedBatchReferenceAssets}
											simple
											onRemove={ws.toggleReferenceAsset}
										/>
									) : null}
								</div>
							) : null}
							{secondaryRouteParams.length > 0 ? (
								<SecondaryParamSettings
									className="border-t border-border/70 pt-2"
									params={secondaryRouteParams}
									values={ws.selectedParams}
									onChange={ws.updateParam}
								/>
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
						<DialogDismissButton
							type="button"
							variant="outline"
							size="sm"
							className="h-8 rounded-sm"
							onClick={() => onOpenChange(false)}
						>
							取消
						</DialogDismissButton>
						<DialogDismissButton
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
						</DialogDismissButton>
					</div>
				</footer>
			</div>
			<ReferenceSelectionDialog
				acceptedFileTypes="image/*"
				disabled={!supportsBatchReferenceImages}
				entries={[]}
				inputId="batch-generation-reference-upload"
				isUploading={ws.isUploadingAsset}
				maxReferences={maxBatchReferenceUrls}
				mediaAssets={imageReferenceAssets}
				open={referenceDialogOpen}
				referenceCount={supportsBatchReferenceImages ? ws.referenceCount : 0}
				references={selectedBatchReferenceAssets}
				requiresReference={false}
				selectableKinds={imageReferenceKinds}
				selectedAssetIds={ws.selectedReferenceAssetIds}
				title="选择参考图"
				visibleKindFilters={imageReferenceKindFilters}
				onOpenChange={setReferenceDialogOpen}
				onRefreshAssets={() => {
					void ws.mutateMediaAssets();
				}}
				onRemoveReference={ws.toggleReferenceAsset}
				onToggleReference={ws.toggleReferenceAsset}
				onUpload={ws.uploadReferenceAsset}
			/>
		</GenerationModalShell>
	);
};

const PromptPackSelect: React.FC<{
	ariaLabel: string;
	disabled: boolean;
	items: PromptInsertItem[];
	onValueChange: (value: string) => void;
	selectedItem: PromptInsertItem | null;
}> = ({ ariaLabel, disabled, items, onValueChange, selectedItem }) => {
	const [open, setOpen] = useState(false);
	const groups = useMemo(() => groupPromptPackSelectItems(items), [items]);
	const selectedGroup = useMemo(
		() => groups.find((group) => group.items.some((item) => item.id === selectedItem?.id)) ?? null,
		[groups, selectedItem?.id],
	);
	const [activeGroupId, setActiveGroupId] = useState(selectedGroup?.id ?? groups[0]?.id ?? "");
	const [suppressedGroupHoverId, setSuppressedGroupHoverId] = useState<string | null>(null);
	const groupButtonRefs = useRef(new Map<string, HTMLButtonElement>());
	const itemPanelRef = useRef<HTMLElement | null>(null);
	const safeTriangleOriginRef = useRef<{
		groupId: string;
		point: CascadedPickerPoint;
	} | null>(null);
	const groupActivationIntentTimerRef = useRef<number | null>(null);
	const activeGroup =
		groups.find((group) => group.id === activeGroupId) ?? selectedGroup ?? groups[0] ?? null;

	useEffect(() => {
		return () => {
			const timer = groupActivationIntentTimerRef.current;
			if (timer !== null) {
				window.clearTimeout(timer);
				groupActivationIntentTimerRef.current = null;
			}
		};
	}, []);

	useEffect(() => {
		if (disabled && open) setOpen(false);
	}, [disabled, open]);

	useEffect(() => {
		if (!open) return;
		setActiveGroupId(selectedGroup?.id ?? groups[0]?.id ?? "");
	}, [groups, open, selectedGroup?.id]);

	useEffect(() => {
		if (!groups.length) {
			if (activeGroupId) setActiveGroupId("");
			return;
		}
		if (groups.some((group) => group.id === activeGroupId)) return;
		setActiveGroupId(selectedGroup?.id ?? groups[0]?.id ?? "");
	}, [activeGroupId, groups, selectedGroup?.id]);

	const selectItem = (item: PromptInsertItem) => {
		onValueChange(item.id);
		setOpen(false);
	};
	const popoverOpen = open && !disabled;

	const clearGroupActivationIntent = () => {
		const timer = groupActivationIntentTimerRef.current;
		if (timer !== null) {
			window.clearTimeout(timer);
			groupActivationIntentTimerRef.current = null;
		}
	};

	const clearSafeTriangle = () => {
		clearGroupActivationIntent();
		safeTriangleOriginRef.current = null;
		setSuppressedGroupHoverId(null);
	};

	const rememberActiveGroupPointer = (groupId: string, point: CascadedPickerPoint) => {
		clearGroupActivationIntent();
		safeTriangleOriginRef.current = { groupId, point };
		setSuppressedGroupHoverId(null);
	};

	const activateGroup = (groupId: string) => {
		setActiveGroupId(groupId);
		clearSafeTriangle();
	};

	const activateGroupFromPointer = (groupId: string, point: CascadedPickerPoint) => {
		setActiveGroupId(groupId);
		rememberActiveGroupPointer(groupId, point);
	};

	const scheduleGroupActivationIntent = (groupId: string, point: CascadedPickerPoint) => {
		setSuppressedGroupHoverId((currentId) => (currentId === groupId ? currentId : groupId));
		clearGroupActivationIntent();
		groupActivationIntentTimerRef.current = window.setTimeout(() => {
			groupActivationIntentTimerRef.current = null;
			activateGroupFromPointer(groupId, point);
		}, PROMPT_PACK_PICKER_SAFE_TRIANGLE_HOVER_INTENT_MS);
	};

	const shouldPreserveActiveGroup = (point: CascadedPickerPoint) => {
		const currentActiveGroupId = activeGroup?.id ?? "";
		const activeButton = currentActiveGroupId
			? groupButtonRefs.current.get(currentActiveGroupId)
			: null;
		const origin =
			safeTriangleOriginRef.current?.groupId === currentActiveGroupId
				? safeTriangleOriginRef.current.point
				: null;

		return shouldKeepCascadedPickerSourceActive({
			activeRect: activeButton?.getBoundingClientRect(),
			origin,
			point,
			submenuRect: itemPanelRef.current?.getBoundingClientRect(),
		});
	};

	const handleGroupPointerEnter = (
		groupId: string,
		event: React.PointerEvent<HTMLButtonElement>,
	) => {
		const point = pointerEventPoint(event);
		if (groupId === activeGroup?.id) {
			rememberActiveGroupPointer(groupId, point);
			return;
		}

		if (shouldPreserveActiveGroup(point)) {
			scheduleGroupActivationIntent(groupId, point);
			return;
		}

		activateGroupFromPointer(groupId, point);
	};

	const handleGroupPointerMove = (
		groupId: string,
		event: React.PointerEvent<HTMLButtonElement>,
	) => {
		const point = pointerEventPoint(event);
		if (groupId === activeGroup?.id) {
			rememberActiveGroupPointer(groupId, point);
			return;
		}

		if (shouldPreserveActiveGroup(point)) {
			scheduleGroupActivationIntent(groupId, point);
			return;
		}

		activateGroupFromPointer(groupId, point);
	};

	return (
		<Popover open={popoverOpen} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={ariaLabel}
					aria-expanded={popoverOpen}
					aria-haspopup="dialog"
					disabled={disabled}
					className={cn(
						"flex h-8 min-w-52 max-w-80 items-center justify-between gap-2 rounded-sm bg-muted px-2 text-xs font-semibold text-foreground transition-colors hover:bg-ide-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
						popoverOpen && "bg-ide-list-active text-ide-list-active-foreground",
					)}
				>
					<span className="min-w-0 flex-1 truncate text-left">
						{selectedItem?.name ?? "无可用提示词包"}
					</span>
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="bottom"
				align="start"
				aria-label={`${ariaLabel}选择`}
				className="grid h-[var(--batch-prompt-pack-picker-menu-height)] max-h-[var(--generation-popover-max-block)] w-fit max-w-[var(--generation-popover-max-inline)] grid-cols-[fit-content(var(--generation-model-popover-version-column-max-width))_minmax(14rem,max-content)] overflow-hidden rounded-[var(--generation-popover-radius)] border-border bg-popover p-0 text-popover-foreground shadow-xl"
				style={promptPackSelectMenuStyle}
				onPointerLeave={clearSafeTriangle}
			>
				<section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-[var(--generation-popover-padding)]">
					<p className="mb-1.5 px-1 text-2xs font-semibold text-muted-foreground">分类</p>
					<div className="grid min-h-0 auto-rows-min gap-1 overflow-y-auto overscroll-contain pr-1">
						{groups.map((group) => {
							const Icon = group.icon;
							const selected = group.id === activeGroup?.id;
							const suppressHover = group.id === suppressedGroupHoverId;

							return (
								<button
									key={group.id}
									type="button"
									ref={(node) => {
										if (node) {
											groupButtonRefs.current.set(group.id, node);
										} else {
											groupButtonRefs.current.delete(group.id);
										}
									}}
									aria-label={`${group.label} ${group.items.length} 项`}
									className={cn(
										"flex h-[var(--generation-model-popover-option-height)] min-w-0 items-center gap-1.5 rounded-[var(--generation-control-radius)] px-[var(--generation-control-padding-x)] text-left text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										selected
											? "bg-ide-list-active text-ide-list-active-foreground"
											: suppressHover
												? "text-foreground"
												: "text-foreground hover:bg-muted",
									)}
									onPointerEnter={(event) => handleGroupPointerEnter(group.id, event)}
									onPointerMove={(event) => handleGroupPointerMove(group.id, event)}
									onFocus={() => activateGroup(group.id)}
									onClick={() => activateGroup(group.id)}
								>
									<Icon className="size-3.5 shrink-0 text-primary" />
									<span className="min-w-0 flex-1 truncate">{group.label}</span>
									<span className="shrink-0 text-muted-foreground/70">{group.items.length}</span>
									<ChevronRight
										className={cn(
											"size-4 shrink-0",
											selected ? "text-primary" : "text-muted-foreground",
										)}
									/>
								</button>
							);
						})}
					</div>
				</section>
				<section
					ref={itemPanelRef}
					className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-muted/40 p-[var(--generation-popover-padding)]"
					onPointerEnter={clearSafeTriangle}
				>
					<p className="mb-1.5 px-1 text-2xs font-semibold text-muted-foreground">提示词包</p>
					<div
						aria-label="提示词包列表"
						className="grid min-h-0 auto-rows-min gap-1 overflow-y-auto overscroll-contain pr-1"
						role="listbox"
					>
						{activeGroup?.items.map((item) => {
							const selected = item.id === selectedItem?.id;

							return (
								<button
									key={item.id}
									type="button"
									role="option"
									aria-label={item.name}
									aria-selected={selected}
									className={cn(
										"flex h-[var(--generation-model-popover-option-height)] min-w-0 items-center gap-1.5 rounded-[var(--generation-control-radius)] px-[var(--generation-control-padding-x)] text-left text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										selected
											? "bg-ide-list-active text-ide-list-active-foreground"
											: "text-foreground hover:bg-card",
									)}
									onClick={() => selectItem(item)}
								>
									<Library className="size-3.5 shrink-0 text-primary" />
									<span className="min-w-0 flex-1 truncate">{item.name}</span>
									{selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
								</button>
							);
						}) ?? null}
					</div>
				</section>
			</PopoverContent>
		</Popover>
	);
};

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

interface PromptPackSelectGroup {
	icon: LucideIcon;
	id: string;
	items: PromptInsertItem[];
	label: string;
}

const PROMPT_PACK_PICKER_MAX_VISIBLE_ROWS = 5;
const PROMPT_PACK_PICKER_SAFE_TRIANGLE_HOVER_INTENT_MS = 180;

const promptPackSelectMenuHeight = () => {
	const gapCount = Math.max(PROMPT_PACK_PICKER_MAX_VISIBLE_ROWS - 1, 0);
	return `calc(var(--generation-popover-padding) * 2 + 1.25rem + ${PROMPT_PACK_PICKER_MAX_VISIBLE_ROWS} * var(--generation-control-height-lg) + ${gapCount} * 0.25rem)`;
};

const promptPackSelectMenuStyle = {
	"--batch-prompt-pack-picker-menu-height": promptPackSelectMenuHeight(),
} as React.CSSProperties;

const groupPromptPackSelectItems = (items: PromptInsertItem[]): PromptPackSelectGroup[] => {
	const groups: PromptPackSelectGroup[] = [];
	const groupsById = new Map<string, PromptPackSelectGroup>();

	for (const item of items) {
		const label = item.categoryLabel || "提示词";
		let group = groupsById.get(label);
		if (!group) {
			group = {
				icon: promptPackSelectGroupIcon(item),
				id: label,
				items: [],
				label,
			};
			groupsById.set(label, group);
			groups.push(group);
		}
		group.items.push(item);
	}

	return groups;
};

const promptPackSelectGroupIcon = (item: PromptInsertItem): LucideIcon =>
	item.categoryLabel === "风格" ? Sparkles : Library;

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
