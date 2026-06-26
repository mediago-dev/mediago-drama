import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyedMutator } from "swr";
import type {
	GenerationKind,
	GenerationModelsResponse,
	GenerationPreference,
} from "@/domains/generation/api/generation";
import { updateGenerationPreferences } from "@/domains/generation/api/generation";
import type { StylePreset } from "@/domains/generation/api/prompt-presets";
import {
	catalogOrFallback,
	defaultFamilyIds,
	fallbackCatalog,
	generationPreferenceDebounceMs,
	generationPreferenceFromStoredValues,
	generationPreferencePayload,
	generationPreferenceSignature,
	hasStoredGenerationPreference,
	isConfiguredRoute,
	isEmptyGenerationPreference,
	normalizeGenerationPreference,
	preferredRoute,
	readGenerationModelSelection,
	readGenerationStylePresetId,
	routeParamValues,
	type StoredGenerationModelSelection,
	writeGenerationModelSelection,
	writeGenerationStylePresetId,
} from "./useGenerationWorkspace.helpers";

interface UseGenerationModelSelectionOptions {
	generationPreferences?: GenerationPreference;
	initialKind?: GenerationKind;
	modelCatalog?: GenerationModelsResponse;
	mutatePreferences: KeyedMutator<GenerationPreference>;
	persistSelection?: boolean;
	preferenceScopeId: string;
	stylePresets: StylePreset[];
}

export const useGenerationModelSelection = ({
	generationPreferences,
	initialKind,
	modelCatalog,
	mutatePreferences,
	persistSelection = true,
	preferenceScopeId,
	stylePresets,
}: UseGenerationModelSelectionOptions) => {
	const [kind, setKind] = useState<GenerationKind>(initialKind ?? "image");
	const [selectedFamilyIds, setSelectedFamilyIds] = useState<Record<GenerationKind, string>>(
		() => ({
			...defaultFamilyIds,
			...readGenerationModelSelection().familyIds,
		}),
	);
	const [selectedVersionIds, setSelectedVersionIds] = useState<Record<string, string>>(
		() => readGenerationModelSelection().versionIds,
	);
	const [selectedRouteIds, setSelectedRouteIds] = useState<Record<string, string>>(
		() => readGenerationModelSelection().routeIds,
	);
	const [routeParams, setRouteParams] = useState<Record<string, Record<string, unknown>>>(
		() => readGenerationModelSelection().routeParams,
	);
	const [stylePresetId, setStylePresetId] = useState(readGenerationStylePresetId);
	const preferenceSyncRef = useRef({ initialized: false, scopeId: "" });
	const pendingPreferenceSignatureRef = useRef("");
	const persistedPreferenceSignatureRef = useRef("");

	const catalog = useMemo(() => catalogOrFallback(modelCatalog), [modelCatalog]);
	const hasLiveCatalog = Boolean(
		modelCatalog?.families?.length && modelCatalog.versions?.length && modelCatalog.routes?.length,
	);
	const configuredRoutes = useMemo(
		() => (hasLiveCatalog ? catalog.routes.filter(isConfiguredRoute) : []),
		[catalog.routes, hasLiveCatalog],
	);
	const configuredRoutesForKind = useMemo(
		() => configuredRoutes.filter((routeItem) => routeItem.kind === kind),
		[configuredRoutes, kind],
	);
	const visibleFamilies = useMemo(
		() =>
			catalog.families.filter(
				(family) =>
					family.kind === kind &&
					configuredRoutesForKind.some((routeItem) => routeItem.familyId === family.id),
			),
		[catalog.families, configuredRoutesForKind, kind],
	);

	useEffect(() => {
		if (visibleFamilies.length === 0) return;

		setSelectedFamilyIds((current) => {
			const currentID = current[kind];
			if (visibleFamilies.some((family) => family.id === currentID)) return current;

			return {
				...current,
				[kind]: visibleFamilies[0].id,
			};
		});
	}, [kind, visibleFamilies]);

	const selectedFamily =
		visibleFamilies.find((family) => family.id === selectedFamilyIds[kind]) ??
		visibleFamilies[0] ??
		fallbackCatalog.families[0];
	const visibleVersions = useMemo(
		() =>
			catalog.versions.filter(
				(versionItem) =>
					versionItem.familyId === selectedFamily.id &&
					configuredRoutes.some((routeItem) => routeItem.versionId === versionItem.id),
			),
		[catalog.versions, configuredRoutes, selectedFamily.id],
	);
	const visibleFamilyRoutes = useMemo(
		() => configuredRoutes.filter((routeItem) => routeItem.familyId === selectedFamily.id),
		[configuredRoutes, selectedFamily.id],
	);

	useEffect(() => {
		if (visibleVersions.length === 0) return;

		setSelectedVersionIds((current) => {
			const currentID = current[selectedFamily.id];
			if (visibleVersions.some((versionItem) => versionItem.id === currentID)) return current;

			return {
				...current,
				[selectedFamily.id]: visibleVersions[0].id,
			};
		});
	}, [selectedFamily.id, visibleVersions]);

	const selectedVersion =
		visibleVersions.find(
			(versionItem) => versionItem.id === selectedVersionIds[selectedFamily.id],
		) ??
		visibleVersions[0] ??
		fallbackCatalog.versions[0];
	const visibleRoutes = useMemo(
		() => configuredRoutes.filter((routeItem) => routeItem.versionId === selectedVersion.id),
		[configuredRoutes, selectedVersion.id],
	);

	useEffect(() => {
		if (visibleRoutes.length === 0) return;

		setSelectedRouteIds((current) => {
			const currentID = current[selectedVersion.id];
			if (visibleRoutes.some((routeItem) => routeItem.id === currentID)) return current;

			return {
				...current,
				[selectedVersion.id]: preferredRoute(visibleRoutes).id,
			};
		});
	}, [selectedVersion.id, visibleRoutes]);

	const selectedRoute =
		visibleRoutes.find((routeItem) => routeItem.id === selectedRouteIds[selectedVersion.id]) ??
		preferredRoute(visibleRoutes) ??
		fallbackCatalog.routes[0];
	const hasConfiguredRoutesForKind = configuredRoutesForKind.length > 0;
	const selectedParams = useMemo(
		() => routeParamValues(selectedRoute.params, routeParams[selectedRoute.id]),
		[routeParams, selectedRoute],
	);
	const selectedStylePreset: StylePreset | undefined = useMemo(
		() => stylePresets.find((preset) => preset.id === stylePresetId),
		[stylePresetId, stylePresets],
	);

	useEffect(() => {
		if (initialKind) setKind(initialKind);
	}, [initialKind]);

	useEffect(() => {
		if (!preferenceScopeId) {
			preferenceSyncRef.current = { initialized: false, scopeId: "" };
			pendingPreferenceSignatureRef.current = "";
			persistedPreferenceSignatureRef.current = "";
			return;
		}
		if (!generationPreferences) return;

		if (preferenceSyncRef.current.scopeId !== preferenceScopeId) {
			preferenceSyncRef.current = { initialized: false, scopeId: preferenceScopeId };
			pendingPreferenceSignatureRef.current = "";
			persistedPreferenceSignatureRef.current = "";
		}
		if (preferenceSyncRef.current.initialized) return;

		const localSelection = readGenerationModelSelection();
		const localStylePresetId = readGenerationStylePresetId();
		const shouldMigrate =
			persistSelection &&
			isEmptyGenerationPreference(generationPreferences) &&
			hasStoredGenerationPreference(localSelection, localStylePresetId);
		const preference = shouldMigrate
			? generationPreferenceFromStoredValues(preferenceScopeId, localSelection, localStylePresetId)
			: generationPreferences;
		const normalized = normalizeGenerationPreference(preference);

		setSelectedFamilyIds({
			...defaultFamilyIds,
			...normalized.familyIds,
		});
		setSelectedVersionIds(normalized.versionIds);
		setSelectedRouteIds(normalized.routeIds);
		setRouteParams(normalized.routeParams);
		setStylePresetId(normalized.stylePresetId);
		preferenceSyncRef.current = { initialized: true, scopeId: preferenceScopeId };
		persistedPreferenceSignatureRef.current = generationPreferenceSignature(normalized);

		if (shouldMigrate) {
			void updateGenerationPreferences(
				preferenceScopeId,
				generationPreferencePayload(normalized),
			).then(
				(nextPreference) => {
					void mutatePreferences(nextPreference, false);
				},
				() => undefined,
			);
		}
	}, [generationPreferences, mutatePreferences, persistSelection, preferenceScopeId]);

	useEffect(() => {
		if (!persistSelection) return;

		writeGenerationModelSelection({
			familyIds: selectedFamilyIds,
			routeIds: selectedRouteIds,
			routeParams,
			versionIds: selectedVersionIds,
		});
		writeGenerationStylePresetId(stylePresetId);

		if (!preferenceScopeId) {
			return;
		}
		if (
			!generationPreferences ||
			!preferenceSyncRef.current.initialized ||
			preferenceSyncRef.current.scopeId !== preferenceScopeId
		) {
			return;
		}

		const preference = normalizeGenerationPreference({
			scopeId: preferenceScopeId,
			familyIds: selectedFamilyIds,
			routeIds: selectedRouteIds,
			versionIds: selectedVersionIds,
			routeParams,
			stylePresetId,
		});
		const signature = generationPreferenceSignature(preference);
		if (
			signature === persistedPreferenceSignatureRef.current ||
			signature === pendingPreferenceSignatureRef.current
		) {
			return;
		}

		const timer = window.setTimeout(() => {
			if (
				signature === persistedPreferenceSignatureRef.current ||
				signature === pendingPreferenceSignatureRef.current
			) {
				return;
			}
			pendingPreferenceSignatureRef.current = signature;
			void updateGenerationPreferences(
				preferenceScopeId,
				generationPreferencePayload(preference),
			).then(
				(nextPreference) => {
					persistedPreferenceSignatureRef.current = signature;
					pendingPreferenceSignatureRef.current = "";
					void mutatePreferences(nextPreference, false);
				},
				() => {
					pendingPreferenceSignatureRef.current = "";
				},
			);
		}, generationPreferenceDebounceMs);

		return () => window.clearTimeout(timer);
	}, [
		generationPreferences,
		mutatePreferences,
		persistSelection,
		preferenceScopeId,
		routeParams,
		selectedFamilyIds,
		selectedRouteIds,
		selectedVersionIds,
		stylePresetId,
	]);

	useEffect(() => {
		if (!stylePresetId || stylePresets.length === 0) return;
		if (stylePresets.some((preset) => preset.id === stylePresetId)) return;

		setStylePresetId("");
	}, [stylePresetId, stylePresets]);

	const updateFamily = useCallback(
		(familyID: string) => {
			setSelectedFamilyIds((current) => ({
				...current,
				[kind]: familyID,
			}));
		},
		[kind],
	);

	const updateVersion = useCallback(
		(versionID: string) => {
			setSelectedVersionIds((current) => ({
				...current,
				[selectedFamily.id]: versionID,
			}));
		},
		[selectedFamily.id],
	);

	const updateRoute = useCallback(
		(routeID: string) => {
			setSelectedRouteIds((current) => ({
				...current,
				[selectedVersion.id]: routeID,
			}));
		},
		[selectedVersion.id],
	);

	const updateModelRoute = useCallback(
		(versionID: string, routeID: string) => {
			setSelectedVersionIds((current) => ({
				...current,
				[selectedFamily.id]: versionID,
			}));
			setSelectedRouteIds((current) => ({
				...current,
				[versionID]: routeID,
			}));
		},
		[selectedFamily.id],
	);

	const updateParam = useCallback(
		(name: string, value: unknown) => {
			setRouteParams((current) => ({
				...current,
				[selectedRoute.id]: {
					...current[selectedRoute.id],
					[name]: value,
				},
			}));
		},
		[selectedRoute.id],
	);

	const currentModelSelection = useCallback(
		(): StoredGenerationModelSelection => ({
			familyIds: {
				...selectedFamilyIds,
				[selectedRoute.kind]: selectedFamily.id,
			},
			routeIds: {
				...selectedRouteIds,
				[selectedVersion.id]: selectedRoute.id,
			},
			routeParams,
			versionIds: {
				...selectedVersionIds,
				[selectedFamily.id]: selectedVersion.id,
			},
		}),
		[
			routeParams,
			selectedFamily.id,
			selectedFamilyIds,
			selectedRoute.id,
			selectedRoute.kind,
			selectedRouteIds,
			selectedVersion.id,
			selectedVersionIds,
		],
	);

	const rememberSelectedModel = useCallback(() => {
		const selection = currentModelSelection();
		if (!persistSelection) return;

		writeGenerationModelSelection(selection);
		writeGenerationStylePresetId(stylePresetId);

		if (!preferenceScopeId) {
			return;
		}

		const preference = normalizeGenerationPreference({
			scopeId: preferenceScopeId,
			...selection,
			stylePresetId,
		});
		const signature = generationPreferenceSignature(preference);
		if (
			signature === persistedPreferenceSignatureRef.current ||
			signature === pendingPreferenceSignatureRef.current
		) {
			return;
		}

		pendingPreferenceSignatureRef.current = signature;
		void updateGenerationPreferences(
			preferenceScopeId,
			generationPreferencePayload(preference),
		).then(
			(nextPreference) => {
				persistedPreferenceSignatureRef.current = signature;
				pendingPreferenceSignatureRef.current = "";
				void mutatePreferences(nextPreference, false);
			},
			() => {
				pendingPreferenceSignatureRef.current = "";
			},
		);
	}, [
		currentModelSelection,
		mutatePreferences,
		persistSelection,
		preferenceScopeId,
		stylePresetId,
	]);

	return {
		catalog,
		configuredRoutesForKind,
		hasConfiguredRoutesForKind,
		hasLiveCatalog,
		kind,
		rememberSelectedModel,
		routeParams,
		selectedFamily,
		selectedFamilyIds,
		selectedParams,
		selectedRoute,
		selectedRouteIds,
		selectedStylePreset,
		selectedVersion,
		selectedVersionIds,
		setKind: setKind as Dispatch<SetStateAction<GenerationKind>>,
		setStylePresetId: setStylePresetId as Dispatch<SetStateAction<string>>,
		stylePresetId,
		updateFamily,
		updateParam,
		updateRoute,
		updateModelRoute,
		updateVersion,
		visibleFamilyRoutes,
		visibleFamilies,
		visibleRoutes,
		visibleVersions,
	};
};
