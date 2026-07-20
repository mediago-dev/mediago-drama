import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	GenerationFamily,
	GenerationModelsResponse,
	GenerationRoute,
	GenerationVersion,
} from "@/domains/generation/api/generation";
import {
	batchGenerationStoredSettingsFromValue,
	type GenerationSettingsKind,
	type GenerationSettingsValue,
	generationSettingsValueForSubmit,
	normalizeGenerationSettingsValue,
	resolveGenerationSettingsValue,
} from "@/domains/generation/components/generationSettingsValue";
import { resolveGenerationRouteParamControls } from "@/domains/generation/components/generationRouteParamControls";
import type { PromptInsertItem } from "@/domains/generation/components/PromptSlashCommand";
import { useGenerationCountControl } from "@/domains/generation/components/useGenerationCountControl";
import {
	isConfiguredRoute,
	maxReferenceUrlsForRoute,
	preferredRoute,
} from "@/domains/generation/hooks/generationCatalog";
import {
	promptOptimizeModelOptions as listPromptOptimizeModelOptions,
	type PromptOptimizeModelOption,
} from "@/domains/generation/hooks/usePromptOptimize";
import { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import { useCodexTextAvailability } from "@/domains/generation/hooks/useCodexTextAvailability";
import {
	batchGenerationPromptSupplementEnabled,
	useBatchGenerationSettingsPreferenceStore,
} from "@/domains/generation/stores/batch-generation-settings";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { uploadMediaAsset } from "@/domains/workspace/api/media";

export interface UseGenerationSettingsFormOptions {
	defaultValue?: unknown;
	kind: GenerationSettingsKind;
	onValueChange?: (value: GenerationSettingsValue) => void;
	persist?: boolean;
	projectId?: string;
	uploadIdPrefix?: string;
}

export interface GenerationSettingsFormController {
	catalog: GenerationModelsResponse;
	codexAvailable: boolean;
	error: string | null;
	generationCountControl: ReturnType<typeof useGenerationCountControl>["generationCountControl"];
	hasAvailableRoute: boolean;
	hasConfiguredRoutesForKind: boolean;
	hasLiveCatalog: boolean;
	imageReferenceAssets: MediaAsset[];
	isBusy: boolean;
	isReady: boolean;
	isUploadingReference: boolean;
	isValid: boolean;
	maxReferenceImages?: number;
	mutateMediaAssets: () => void | Promise<unknown>;
	promptInsertItems: PromptInsertItem[];
	promptOptimizationModelOptions: PromptOptimizeModelOption[];
	promptSupplementEnabled: boolean;
	referenceDialogOpen: boolean;
	referenceInputId: string;
	routeParamControls: ReturnType<typeof resolveGenerationRouteParamControls>;
	selectedFamily: GenerationFamily;
	selectedPromptOptimizationItem: PromptInsertItem | null;
	selectedPromptOptimizationModel: PromptOptimizeModelOption | null;
	selectedPromptSupplementItems: PromptInsertItem[];
	selectedReferenceAssets: MediaAsset[];
	selectedRoute: GenerationRoute;
	selectedVersion: GenerationVersion;
	supportsReferenceImages: boolean;
	value: GenerationSettingsValue;
	visibleFamilies: GenerationFamily[];
	visibleFamilyRoutes: GenerationRoute[];
	visibleVersions: GenerationVersion[];
	setPromptOptimizationEnabled: (enabled: boolean) => void;
	setPromptOptimizationItemId: (id: string | null) => void;
	setPromptOptimizationRouteId: (id: string) => void;
	setPromptSupplementEnabled: (enabled: boolean) => void;
	setReferenceDialogOpen: (open: boolean) => void;
	togglePromptSupplementItem: (id: string) => void;
	toggleReferenceAsset: (asset: MediaAsset) => void;
	updateFamily: (familyId: string) => void;
	updateModelRoute: (versionId: string, routeId: string) => void;
	updateParam: (name: string, value: unknown) => void;
	uploadReferenceAsset: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}

export const useGenerationSettingsForm = ({
	defaultValue,
	kind,
	onValueChange,
	persist = true,
	projectId,
	uploadIdPrefix = "generation-settings",
}: UseGenerationSettingsFormOptions): GenerationSettingsFormController => {
	const codexAvailable = useCodexTextAvailability();
	const storedSettings = useBatchGenerationSettingsPreferenceStore(
		(state) => state.settingsByKind[kind] ?? null,
	);
	const setStoredSettings = useBatchGenerationSettingsPreferenceStore((state) => state.setSettings);
	const workspace = useGenerationWorkspace({
		initialKind: kind,
		initialPrompt: "",
		modelPreferenceScopeId: projectId,
		persistModelSelection: false,
		projectId,
		projectStyleOnly: true,
		uploadIdPrefix,
		useRawPrompt: true,
	});
	const promptItemsLoaded = workspace.hasLoadedPromptInsertItems;
	const promptItemsForNormalization = promptItemsLoaded
		? workspace.promptReferenceItems
		: undefined;
	const [value, setValue] = useState<GenerationSettingsValue>(() =>
		emptyGenerationSettingsValue(kind),
	);
	const valueRef = useRef(value);
	const onValueChangeRef = useRef(onValueChange);
	const initializedKeyRef = useRef("");
	const [initializedKey, setInitializedKey] = useState("");
	const routeParamsRef = useRef<Record<string, Record<string, unknown>>>({});
	const [promptSupplementEnabled, setPromptSupplementEnabledState] = useState(false);
	const promptSupplementEnabledRef = useRef(false);
	const [promptSupplementDraftItemIds, setPromptSupplementDraftItemIds] = useState<string[]>([]);
	const promptSupplementDraftItemIdsRef = useRef<string[]>([]);
	const [promptOptimizationDraftItemId, setPromptOptimizationDraftItemId] = useState<string | null>(
		null,
	);
	const promptOptimizationDraftItemIdRef = useRef<string | null>(null);
	const promptOptimizationDraftItemClearedRef = useRef(false);
	const [promptOptimizationDraftRouteId, setPromptOptimizationDraftRouteId] = useState("");
	const promptOptimizationDraftRouteIdRef = useRef("");
	const promptOptimizationDraftRouteClearedRef = useRef(false);
	const [referenceDialogOpen, setReferenceDialogOpen] = useState(false);
	const [isUploadingReference, setIsUploadingReference] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const defaultValueKey = stableValueKey(defaultValue);
	const initializationKey = `${kind}:${defaultValueKey}`;

	useEffect(() => {
		onValueChangeRef.current = onValueChange;
	}, [onValueChange]);

	const commitValue = useCallback((next: GenerationSettingsValue, notify = true) => {
		const changed = !sameGenerationSettingsValue(valueRef.current, next);
		if (next.routeId) routeParamsRef.current[next.routeId] = { ...next.params };
		valueRef.current = next;
		setValue((current) => (sameGenerationSettingsValue(current, next) ? current : next));
		if (notify && changed) onValueChangeRef.current?.(next);
	}, []);

	useEffect(() => {
		if (
			!workspace.hasLiveCatalog ||
			!workspace.hasSettledGenerationPreferences ||
			!workspace.hasSettledPromptInsertItems
		) {
			return;
		}
		const optimizationOptions = listPromptOptimizeModelOptions(workspace.catalog);
		const preferredOptimizationRoute = preferredRoute(
			optimizationOptions.map((option) => option.route),
		);
		const preferredOptimizationModel =
			optimizationOptions.find((option) => option.route.id === preferredOptimizationRoute?.id) ??
			optimizationOptions[0] ??
			null;

		if (initializedKeyRef.current !== initializationKey) {
			let next = resolveGenerationSettingsValue({
				catalog: workspace.catalog,
				contextValue: defaultValue,
				generationPreference: workspace.generationPreferences,
				kind,
				promptItems: promptItemsForNormalization,
				storedSettings,
			});
			const contextRouteId = recordString(defaultValue, "routeId");
			const usesContextValue = Boolean(contextRouteId && contextRouteId === next.routeId);
			const supplementEnabled = usesContextValue
				? recordArray(defaultValue, "promptSupplements").length > 0
				: batchGenerationPromptSupplementEnabled(storedSettings);
			const supplementDraftItemIds = normalizePromptSupplementDraftItemIds(
				usesContextValue
					? promptSupplementDraftItemIdsFromValue(defaultValue)
					: (storedSettings?.promptSupplementItemIds ?? []),
				workspace.promptReferenceItems,
				promptItemsLoaded,
			);
			const optimizationDraftItemId = resolvePromptOptimizationDraftItemId(
				usesContextValue
					? recordNestedString(defaultValue, "promptOptimization", "referenceId")
					: (storedSettings?.promptOptimizeItemId ?? ""),
				workspace.promptReferenceItems,
				promptItemsLoaded,
			);
			const optimizationDraftRouteId = resolvePromptOptimizationDraftRouteId(
				usesContextValue
					? recordNestedString(defaultValue, "promptOptimization", "routeId")
					: (storedSettings?.promptOptimizeRouteId ?? ""),
				optimizationOptions,
				preferredOptimizationModel,
			);
			const optimizationEnabled = usesContextValue
				? recordNestedBoolean(defaultValue, "promptOptimization", "enabled")
				: storedSettings?.usePromptOptimization === true;
			const optimizationDraftItem = workspace.promptReferenceItems.find(
				(item) => item.id === optimizationDraftItemId,
			);
			const optimizationDraftModel = optimizationOptions.find(
				(option) => option.id === optimizationDraftRouteId,
			);

			promptSupplementEnabledRef.current = supplementEnabled;
			setPromptSupplementEnabledState(supplementEnabled);
			promptSupplementDraftItemIdsRef.current = supplementDraftItemIds;
			setPromptSupplementDraftItemIds(supplementDraftItemIds);
			promptOptimizationDraftItemIdRef.current = optimizationDraftItemId;
			promptOptimizationDraftItemClearedRef.current = false;
			setPromptOptimizationDraftItemId(optimizationDraftItemId);
			promptOptimizationDraftRouteIdRef.current = optimizationDraftRouteId;
			promptOptimizationDraftRouteClearedRef.current = false;
			setPromptOptimizationDraftRouteId(optimizationDraftRouteId);
			next = {
				...next,
				promptOptimization: optimizationEnabled
					? promptOptimizationValue(optimizationDraftItem, optimizationDraftModel, codexAvailable)
					: { enabled: false },
				promptSupplements: supplementEnabled
					? promptSupplementValues(supplementDraftItemIds, workspace.promptReferenceItems)
					: [],
			};
			initializedKeyRef.current = initializationKey;
			setInitializedKey(initializationKey);
			commitValue(next);
			return;
		}

		const current = valueRef.current;
		const supplementDraftItemIds = normalizePromptSupplementDraftItemIds(
			promptSupplementDraftItemIdsRef.current,
			workspace.promptReferenceItems,
			promptItemsLoaded,
		);
		const optimizationDraftItemId = promptOptimizationDraftItemClearedRef.current
			? null
			: resolvePromptOptimizationDraftItemId(
					promptOptimizationDraftItemIdRef.current ?? "",
					workspace.promptReferenceItems,
					promptItemsLoaded,
				);
		const optimizationDraftRouteId = promptOptimizationDraftRouteClearedRef.current
			? ""
			: resolvePromptOptimizationDraftRouteId(
					promptOptimizationDraftRouteIdRef.current,
					optimizationOptions,
					preferredOptimizationModel,
				);
		if (!sameStringList(promptSupplementDraftItemIdsRef.current, supplementDraftItemIds)) {
			promptSupplementDraftItemIdsRef.current = supplementDraftItemIds;
			setPromptSupplementDraftItemIds(supplementDraftItemIds);
		}
		if (promptOptimizationDraftItemIdRef.current !== optimizationDraftItemId) {
			promptOptimizationDraftItemIdRef.current = optimizationDraftItemId;
			setPromptOptimizationDraftItemId(optimizationDraftItemId);
		}
		if (promptOptimizationDraftRouteIdRef.current !== optimizationDraftRouteId) {
			promptOptimizationDraftRouteIdRef.current = optimizationDraftRouteId;
			setPromptOptimizationDraftRouteId(optimizationDraftRouteId);
		}
		const optimizationDraftItem = workspace.promptReferenceItems.find(
			(item) => item.id === optimizationDraftItemId,
		);
		const optimizationDraftModel = optimizationOptions.find(
			(option) => option.id === optimizationDraftRouteId,
		);
		const normalized = normalizeGenerationSettingsValue(
			workspace.catalog,
			kind,
			current,
			promptItemsForNormalization,
		);
		const next: GenerationSettingsValue = {
			...normalized,
			promptOptimization: current.promptOptimization.enabled
				? promptOptimizationValue(optimizationDraftItem, optimizationDraftModel, codexAvailable)
				: { enabled: false },
			promptSupplements: promptSupplementEnabledRef.current
				? promptSupplementValues(supplementDraftItemIds, workspace.promptReferenceItems)
				: [],
		};
		commitValue(next);
	}, [
		commitValue,
		codexAvailable,
		defaultValue,
		initializationKey,
		kind,
		promptItemsLoaded,
		promptItemsForNormalization,
		storedSettings,
		workspace.catalog,
		workspace.generationPreferences,
		workspace.hasLiveCatalog,
		workspace.hasSettledGenerationPreferences,
		workspace.hasSettledPromptInsertItems,
		workspace.promptReferenceItems,
	]);

	const selectedRoute = useMemo(
		() =>
			workspace.catalog.routes.find((route) => route.id === value.routeId) ??
			workspace.selectedRoute,
		[value.routeId, workspace.catalog.routes, workspace.selectedRoute],
	);
	const selectedFamily = useMemo(
		() =>
			workspace.catalog.families.find((family) => family.id === selectedRoute.familyId) ??
			workspace.selectedFamily,
		[selectedRoute.familyId, workspace.catalog.families, workspace.selectedFamily],
	);
	const selectedVersion = useMemo(
		() =>
			workspace.catalog.versions.find((version) => version.id === selectedRoute.versionId) ??
			workspace.selectedVersion,
		[selectedRoute.versionId, workspace.catalog.versions, workspace.selectedVersion],
	);
	const hasAvailableRoute =
		workspace.hasLiveCatalog &&
		Boolean(value.routeId) &&
		selectedRoute.id === value.routeId &&
		selectedRoute.kind === kind &&
		isConfiguredRoute(selectedRoute);
	const hasConfiguredRoutesForKind =
		workspace.hasLiveCatalog &&
		workspace.catalog.routes.some((route) => route.kind === kind && isConfiguredRoute(route));

	useEffect(() => {
		if (
			!persist ||
			initializedKey !== initializationKey ||
			!workspace.hasSettledGenerationPreferences ||
			!workspace.hasSettledPromptInsertItems ||
			!hasAvailableRoute
		) {
			return;
		}
		setStoredSettings(kind, {
			...batchGenerationStoredSettingsFromValue(workspace.catalog, value),
			promptOptimizeItemId: promptOptimizationDraftItemId ?? undefined,
			promptOptimizeRouteId: promptOptimizationDraftRouteId || undefined,
			promptSupplementItemIds:
				promptSupplementDraftItemIds.length > 0 ? promptSupplementDraftItemIds : undefined,
			usePromptOptimization: value.promptOptimization.enabled,
			usePromptSupplement: promptSupplementEnabled,
		});
	}, [
		hasAvailableRoute,
		initializationKey,
		initializedKey,
		kind,
		persist,
		promptOptimizationDraftItemId,
		promptOptimizationDraftRouteId,
		promptSupplementDraftItemIds,
		promptSupplementEnabled,
		setStoredSettings,
		value,
		workspace.catalog,
		workspace.hasSettledGenerationPreferences,
		workspace.hasSettledPromptInsertItems,
	]);
	const visibleFamilies = useMemo(
		() =>
			workspace.catalog.families.filter(
				(family) =>
					family.kind === kind &&
					workspace.catalog.routes.some(
						(route) => route.familyId === family.id && isConfiguredRoute(route),
					),
			),
		[kind, workspace.catalog.families, workspace.catalog.routes],
	);
	const visibleFamilyRoutes = useMemo(
		() =>
			workspace.catalog.routes.filter(
				(route) => route.familyId === selectedFamily.id && isConfiguredRoute(route),
			),
		[selectedFamily.id, workspace.catalog.routes],
	);
	const visibleVersions = useMemo(
		() =>
			workspace.catalog.versions.filter(
				(version) =>
					version.familyId === selectedFamily.id &&
					visibleFamilyRoutes.some((route) => route.versionId === version.id),
			),
		[selectedFamily.id, visibleFamilyRoutes, workspace.catalog.versions],
	);
	const routeParamControls = useMemo(
		() =>
			resolveGenerationRouteParamControls(selectedRoute, value.params, {
				referenceCount: value.referenceAssetIds.length,
			}),
		[selectedRoute, value.params, value.referenceAssetIds.length],
	);

	const updateParam = useCallback(
		(name: string, paramValue: unknown) => {
			const next = normalizeGenerationSettingsValue(
				workspace.catalog,
				kind,
				{
					...valueRef.current,
					params: { ...valueRef.current.params, [name]: paramValue },
				},
				promptItemsForNormalization,
			);
			commitValue(next);
		},
		[commitValue, kind, promptItemsForNormalization, workspace.catalog],
	);
	const { generationCountControl } = useGenerationCountControl({
		hasConfiguredRoutesForKind,
		onParamChange: updateParam,
		params: routeParamControls.countGroupParams,
		selectedParams: value.params,
	});

	const updateModelRoute = useCallback(
		(versionId: string, routeId: string) => {
			const route = workspace.catalog.routes.find(
				(item) =>
					item.id === routeId &&
					item.versionId === versionId &&
					item.kind === kind &&
					isConfiguredRoute(item),
			);
			if (!route) return;
			const next = normalizeGenerationSettingsValue(
				workspace.catalog,
				kind,
				{
					...valueRef.current,
					params: routeParamsRef.current[route.id] ?? {},
					routeId: route.id,
				},
				promptItemsForNormalization,
			);
			commitValue(next);
		},
		[commitValue, kind, promptItemsForNormalization, workspace.catalog],
	);
	const updateFamily = useCallback(
		(familyId: string) => {
			const route = preferredRoute(
				workspace.catalog.routes.filter(
					(item) => item.familyId === familyId && item.kind === kind && isConfiguredRoute(item),
				),
			);
			if (route) updateModelRoute(route.versionId, route.id);
		},
		[kind, updateModelRoute, workspace.catalog.routes],
	);

	const promptOptimizationModelOptions = useMemo(
		() => (workspace.hasLiveCatalog ? listPromptOptimizeModelOptions(workspace.catalog) : []),
		[workspace.catalog, workspace.hasLiveCatalog],
	);
	const preferredPromptOptimizationModel = useMemo(() => {
		const route = preferredRoute(promptOptimizationModelOptions.map((option) => option.route));
		return (
			promptOptimizationModelOptions.find((option) => option.route.id === route?.id) ??
			promptOptimizationModelOptions[0] ??
			null
		);
	}, [promptOptimizationModelOptions]);
	const selectedPromptOptimizationModel =
		promptOptimizationModelOptions.find((option) => option.id === promptOptimizationDraftRouteId) ??
		null;
	const selectedPromptOptimizationItem =
		workspace.promptReferenceItems.find((item) => item.id === promptOptimizationDraftItemId) ??
		null;
	const selectedPromptSupplementItems = useMemo(
		() =>
			promptSupplementDraftItemIds
				.map((id) => workspace.promptReferenceItems.find((item) => item.id === id))
				.filter((item): item is PromptInsertItem => Boolean(item)),
		[promptSupplementDraftItemIds, workspace.promptReferenceItems],
	);

	const setPromptSupplementEnabled = useCallback(
		(enabled: boolean) => {
			promptSupplementEnabledRef.current = enabled;
			setPromptSupplementEnabledState(enabled);
			commitValue({
				...valueRef.current,
				promptSupplements: enabled
					? promptSupplementValues(
							promptSupplementDraftItemIdsRef.current,
							workspace.promptReferenceItems,
						)
					: [],
			});
		},
		[commitValue, workspace.promptReferenceItems],
	);
	const togglePromptSupplementItem = useCallback(
		(id: string) => {
			const item = workspace.promptReferenceItems.find((candidate) => candidate.id === id);
			if (!item) return;
			const selected = promptSupplementDraftItemIdsRef.current.includes(item.id);
			const nextDraftItemIds = selected
				? promptSupplementDraftItemIdsRef.current.filter((itemId) => itemId !== item.id)
				: [...promptSupplementDraftItemIdsRef.current, item.id];
			promptSupplementDraftItemIdsRef.current = nextDraftItemIds;
			setPromptSupplementDraftItemIds(nextDraftItemIds);
			promptSupplementEnabledRef.current = true;
			setPromptSupplementEnabledState(true);
			commitValue({
				...valueRef.current,
				promptSupplements: promptSupplementValues(nextDraftItemIds, workspace.promptReferenceItems),
			});
		},
		[commitValue, workspace.promptReferenceItems],
	);

	const setPromptOptimizationEnabled = useCallback(
		(enabled: boolean) => {
			if (!enabled) {
				commitValue({ ...valueRef.current, promptOptimization: { enabled: false } });
				return;
			}
			const itemId = promptOptimizationDraftItemClearedRef.current
				? null
				: resolvePromptOptimizationDraftItemId(
						promptOptimizationDraftItemIdRef.current ?? "",
						workspace.promptReferenceItems,
						promptItemsLoaded,
					);
			const routeId = promptOptimizationDraftRouteClearedRef.current
				? ""
				: resolvePromptOptimizationDraftRouteId(
						promptOptimizationDraftRouteIdRef.current,
						promptOptimizationModelOptions,
						preferredPromptOptimizationModel,
					);
			promptOptimizationDraftItemIdRef.current = itemId;
			setPromptOptimizationDraftItemId(itemId);
			promptOptimizationDraftRouteIdRef.current = routeId;
			setPromptOptimizationDraftRouteId(routeId);
			const item = workspace.promptReferenceItems.find((candidate) => candidate.id === itemId);
			const model = promptOptimizationModelOptions.find((option) => option.id === routeId);
			commitValue({
				...valueRef.current,
				promptOptimization: promptOptimizationValue(item, model, codexAvailable),
			});
		},
		[
			commitValue,
			codexAvailable,
			promptItemsLoaded,
			preferredPromptOptimizationModel,
			promptOptimizationModelOptions,
			workspace.promptReferenceItems,
		],
	);
	const setPromptOptimizationItemId = useCallback(
		(id: string | null) => {
			promptOptimizationDraftItemIdRef.current = id;
			promptOptimizationDraftItemClearedRef.current = id === null;
			setPromptOptimizationDraftItemId(id);
			if (!valueRef.current.promptOptimization.enabled) return;
			const item = id
				? (workspace.promptReferenceItems.find((candidate) => candidate.id === id) ?? null)
				: null;
			const model =
				promptOptimizationModelOptions.find(
					(option) => option.id === promptOptimizationDraftRouteIdRef.current,
				) ?? null;
			commitValue({
				...valueRef.current,
				promptOptimization: promptOptimizationValue(item, model, codexAvailable),
			});
		},
		[commitValue, codexAvailable, promptOptimizationModelOptions, workspace.promptReferenceItems],
	);
	const setPromptOptimizationRouteId = useCallback(
		(id: string) => {
			promptOptimizationDraftRouteIdRef.current = id;
			promptOptimizationDraftRouteClearedRef.current = !id.trim();
			setPromptOptimizationDraftRouteId(id);
			if (!valueRef.current.promptOptimization.enabled) return;
			const item =
				workspace.promptReferenceItems.find(
					(candidate) => candidate.id === promptOptimizationDraftItemIdRef.current,
				) ?? null;
			const model = promptOptimizationModelOptions.find((option) => option.id === id) ?? null;
			commitValue({
				...valueRef.current,
				promptOptimization: promptOptimizationValue(item, model, codexAvailable),
			});
		},
		[commitValue, codexAvailable, promptOptimizationModelOptions, workspace.promptReferenceItems],
	);

	const supportsReferenceImages =
		kind === "image" && hasAvailableRoute && selectedRoute.supportsReferenceUrls;
	const imageReferenceAssets = useMemo(
		() => workspace.mediaAssets.filter((asset) => asset.kind === "image"),
		[workspace.mediaAssets],
	);
	const selectedReferenceAssets = useMemo(
		() => imageReferenceAssets.filter((asset) => value.referenceAssetIds.includes(asset.id)),
		[imageReferenceAssets, value.referenceAssetIds],
	);
	const maxReferenceImages = supportsReferenceImages
		? maxReferenceUrlsForRoute(selectedRoute)
		: undefined;
	const toggleReferenceAsset = useCallback(
		(asset: MediaAsset) => {
			if (!supportsReferenceImages || asset.kind !== "image") return;
			const current = valueRef.current;
			const selected = current.referenceAssetIds.includes(asset.id);
			if (
				!selected &&
				maxReferenceImages &&
				current.referenceAssetIds.length >= maxReferenceImages
			) {
				setError(`当前模型最多支持 ${maxReferenceImages} 个参考素材。`);
				return;
			}
			setError(null);
			const next = normalizeGenerationSettingsValue(
				workspace.catalog,
				kind,
				{
					...current,
					referenceAssetIds: selected
						? current.referenceAssetIds.filter((id) => id !== asset.id)
						: [...current.referenceAssetIds, asset.id],
				},
				promptItemsForNormalization,
			);
			commitValue(next);
		},
		[
			commitValue,
			kind,
			maxReferenceImages,
			promptItemsForNormalization,
			supportsReferenceImages,
			workspace.catalog,
		],
	);
	const uploadReferenceAsset = useCallback(
		async (event: React.ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0];
			event.target.value = "";
			if (!file || !supportsReferenceImages) return;
			setIsUploadingReference(true);
			setError(null);
			try {
				const asset = await uploadMediaAsset(file, projectId);
				await workspace.mutateMediaAssets();
				if (asset.kind === "image") toggleReferenceAsset(asset);
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : "素材上传失败。");
			} finally {
				setIsUploadingReference(false);
			}
		},
		[projectId, supportsReferenceImages, toggleReferenceAsset, workspace.mutateMediaAssets],
	);

	const isReady =
		workspace.hasLiveCatalog &&
		workspace.hasSettledGenerationPreferences &&
		workspace.hasSettledPromptInsertItems &&
		initializedKey === initializationKey;
	const submitValue = isReady
		? generationSettingsValueForSubmit(workspace.catalog, value, promptItemsForNormalization)
		: null;
	const isBusy = !isReady || isUploadingReference;
	const isValid =
		isReady &&
		hasAvailableRoute &&
		Boolean(submitValue) &&
		Boolean(submitValue && sameGenerationSettingsValue(value, submitValue)) &&
		(!promptSupplementEnabled || Boolean(submitValue?.promptSupplements.length));

	return {
		catalog: workspace.catalog,
		codexAvailable,
		error,
		generationCountControl,
		hasAvailableRoute,
		hasConfiguredRoutesForKind,
		hasLiveCatalog: workspace.hasLiveCatalog,
		imageReferenceAssets,
		isBusy,
		isReady,
		isUploadingReference,
		isValid,
		maxReferenceImages,
		mutateMediaAssets: workspace.mutateMediaAssets,
		promptInsertItems: workspace.promptReferenceItems,
		promptOptimizationModelOptions,
		promptSupplementEnabled,
		referenceDialogOpen,
		referenceInputId: `${uploadIdPrefix}-reference-upload`,
		routeParamControls,
		selectedFamily,
		selectedPromptOptimizationItem,
		selectedPromptOptimizationModel,
		selectedPromptSupplementItems,
		selectedReferenceAssets,
		selectedRoute,
		selectedVersion,
		supportsReferenceImages,
		value,
		visibleFamilies,
		visibleFamilyRoutes,
		visibleVersions,
		setPromptOptimizationEnabled,
		setPromptOptimizationItemId,
		setPromptOptimizationRouteId,
		setPromptSupplementEnabled,
		setReferenceDialogOpen,
		togglePromptSupplementItem,
		toggleReferenceAsset,
		updateFamily,
		updateModelRoute,
		updateParam,
		uploadReferenceAsset,
	};
};

const emptyGenerationSettingsValue = (kind: GenerationSettingsKind): GenerationSettingsValue => ({
	kind,
	label: "",
	params: {},
	promptOptimization: { enabled: false },
	promptSupplements: [],
	referenceAssetIds: [],
	routeId: "",
});

const promptOptimizationValue = (
	item: PromptInsertItem | null | undefined,
	model: PromptOptimizeModelOption | null | undefined,
	codexAvailable: boolean,
) => ({
	enabled: true,
	...(!model && codexAvailable ? { executor: "codex" as const } : {}),
	...(model ? { label: model.route.label.trim() || model.route.id, routeId: model.route.id } : {}),
	...(item
		? {
				referenceId: item.id,
				referenceName: item.name.trim(),
				referencePrompt: item.prompt.trim(),
			}
		: {}),
});

const normalizePromptSupplementDraftItemIds = (
	itemIds: readonly string[],
	promptItems: readonly PromptInsertItem[],
	promptItemsReady: boolean,
) => {
	const normalizedItemIds = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];
	if (!promptItemsReady) return normalizedItemIds;
	const availableItemIds = new Set(promptItems.map((item) => item.id));
	return normalizedItemIds.filter((id) => availableItemIds.has(id));
};

const resolvePromptOptimizationDraftItemId = (
	itemId: string,
	promptItems: readonly PromptInsertItem[],
	promptItemsReady: boolean,
) => {
	const normalizedItemId = itemId.trim();
	if (!promptItemsReady) return normalizedItemId || null;
	if (normalizedItemId && promptItems.some((item) => item.id === normalizedItemId)) {
		return normalizedItemId;
	}
	return promptItems[0]?.id ?? null;
};

const resolvePromptOptimizationDraftRouteId = (
	routeId: string,
	modelOptions: readonly PromptOptimizeModelOption[],
	preferredModel: PromptOptimizeModelOption | null,
) => {
	const normalizedRouteId = routeId.trim();
	if (normalizedRouteId && modelOptions.some((option) => option.id === normalizedRouteId)) {
		return normalizedRouteId;
	}
	return preferredModel?.id ?? modelOptions[0]?.id ?? "";
};

const promptSupplementValues = (
	itemIds: readonly string[],
	promptItems: readonly PromptInsertItem[],
) => {
	const promptItemsById = new Map(promptItems.map((item) => [item.id, item]));
	return itemIds.flatMap((id) => {
		const item = promptItemsById.get(id);
		const referencePrompt = item?.prompt.trim() ?? "";
		if (!item) return [];
		return [
			{
				referenceId: item.id,
				referenceName: item.name.trim(),
				referencePrompt,
			},
		];
	});
};

const promptSupplementDraftItemIdsFromValue = (value: unknown) =>
	recordArray(value, "promptSupplements")
		.map((item) => recordString(item, "referenceId"))
		.filter(Boolean);

const sameStringList = (left: readonly string[], right: readonly string[]) =>
	left.length === right.length && left.every((item, index) => item === right[index]);

const stableValueKey = (value: unknown) => {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
};

const sameGenerationSettingsValue = (
	left: GenerationSettingsValue,
	right: GenerationSettingsValue,
) => stableValueKey(left) === stableValueKey(right);

const recordValue = (value: unknown): Record<string, unknown> | null =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

const recordString = (value: unknown, key: string) => {
	const candidate = recordValue(value)?.[key];
	return typeof candidate === "string" ? candidate.trim() : "";
};

const recordArray = (value: unknown, key: string) => {
	const candidate = recordValue(value)?.[key];
	return Array.isArray(candidate) ? candidate : [];
};

const recordNestedString = (value: unknown, parentKey: string, key: string) =>
	recordString(recordValue(value)?.[parentKey], key);

const recordNestedBoolean = (value: unknown, parentKey: string, key: string) =>
	recordValue(recordValue(value)?.[parentKey])?.[key] === true;
