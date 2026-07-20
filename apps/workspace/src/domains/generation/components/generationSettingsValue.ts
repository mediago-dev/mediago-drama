import type {
	GenerationKind,
	GenerationModelsResponse,
	GenerationPreference,
	GenerationRoute,
} from "@/domains/generation/api/generation";
import type { TextExecutorType } from "@/api/types/generation";
import type { PromptInsertItem } from "@/domains/generation/components/PromptSlashCommand";
import { resolveGenerationRouteParamControls } from "@/domains/generation/components/generationRouteParamControls";
import { isConfiguredRoute, routeParamValues } from "@/domains/generation/hooks/generationCatalog";
import type { BatchGenerationStoredSettings } from "@/domains/generation/stores/batch-generation-settings";

export type GenerationSettingsKind = Extract<GenerationKind, "image" | "video">;

export interface GenerationPromptSupplementValue {
	referenceId?: string;
	referenceName: string;
	referencePrompt: string;
}

export interface GenerationPromptOptimizationValue {
	enabled: boolean;
	executor?: TextExecutorType;
	label?: string;
	referenceId?: string;
	referenceName?: string;
	referencePrompt?: string;
	routeId?: string;
}

export interface GenerationSettingsValue {
	kind: GenerationSettingsKind;
	label: string;
	params: Record<string, unknown>;
	promptOptimization: GenerationPromptOptimizationValue;
	promptSupplements: GenerationPromptSupplementValue[];
	referenceAssetIds: string[];
	routeId: string;
}

export interface ResolveGenerationSettingsValueOptions {
	catalog: GenerationModelsResponse;
	contextValue?: unknown;
	currentValue?: unknown;
	generationPreference?: GenerationPreference | null;
	kind: GenerationSettingsKind;
	promptItems?: readonly PromptInsertItem[];
	storedSettings?: BatchGenerationStoredSettings | null;
}

// normalizeGenerationSettingsValue resolves a complete, catalog-backed value.
// A supplied promptItems list is authoritative; undefined means packs are still
// loading, so existing snapshots/ids are retained until the catalog arrives.
export const normalizeGenerationSettingsValue = (
	catalog: GenerationModelsResponse,
	kind: GenerationSettingsKind,
	rawValue: unknown,
	promptItems?: readonly PromptInsertItem[],
): GenerationSettingsValue => {
	const raw = recordValue(rawValue);
	const route =
		usableRoute(catalog, kind, stringValue(raw?.routeId)) ?? firstUsableRoute(catalog, kind);
	if (!route) return emptyGenerationSettingsValue(kind);
	const referenceAssetIds = normalizeReferenceAssetIDs(raw?.referenceAssetIds, route);

	return {
		kind,
		label: route.label.trim() || route.id,
		params: normalizeRouteParams(route, raw?.params, referenceAssetIds.length),
		promptOptimization: normalizePromptOptimization(catalog, raw?.promptOptimization, promptItems),
		promptSupplements: normalizePromptSupplements(raw?.promptSupplements, promptItems),
		referenceAssetIds,
		routeId: route.id,
	};
};

// resolveGenerationSettingsValue applies the shared default precedence:
// current edits > task context > saved batch preference > scoped generation
// preference > first configured route.
export const resolveGenerationSettingsValue = ({
	catalog,
	contextValue,
	currentValue,
	generationPreference,
	kind,
	promptItems,
	storedSettings,
}: ResolveGenerationSettingsValueOptions): GenerationSettingsValue => {
	const storedValue = storedSettingsValue(storedSettings);
	const preferenceValue = generationPreferenceValue(catalog, kind, generationPreference);
	for (const candidate of [currentValue, contextValue, storedValue, preferenceValue]) {
		if (!hasUsableExplicitRoute(catalog, kind, candidate)) continue;
		return normalizeGenerationSettingsValue(catalog, kind, candidate, promptItems);
	}
	return normalizeGenerationSettingsValue(catalog, kind, undefined, promptItems);
};

// generationSettingsValueForSubmit returns a fully resolved request snapshot,
// or null while any explicitly enabled composite control is incomplete.
export const generationSettingsValueForSubmit = (
	catalog: GenerationModelsResponse,
	value: unknown,
	promptItems?: readonly PromptInsertItem[],
): GenerationSettingsValue | null => {
	const raw = recordValue(value);
	const kind = generationSettingsKind(raw?.kind);
	if (!kind || !hasUsableExplicitRoute(catalog, kind, raw)) return null;

	const requestedOptimization = recordValue(raw?.promptOptimization)?.enabled === true;
	const normalized = normalizeGenerationSettingsValue(catalog, kind, raw, promptItems);
	if (
		requestedOptimization &&
		(!normalized.promptOptimization.enabled ||
			(!normalized.promptOptimization.routeId &&
				normalized.promptOptimization.executor !== "codex") ||
			(!normalized.promptOptimization.referenceId?.trim() &&
				!normalized.promptOptimization.referencePrompt?.trim()))
	) {
		return null;
	}
	if (
		normalized.promptSupplements.some(
			(item) => !item.referenceId?.trim() && !item.referencePrompt.trim(),
		)
	)
		return null;
	return normalized;
};

export const generationSettingsValueFromStoredSettings = (
	catalog: GenerationModelsResponse,
	kind: GenerationSettingsKind,
	settings: BatchGenerationStoredSettings | null | undefined,
	promptItems?: readonly PromptInsertItem[],
) => normalizeGenerationSettingsValue(catalog, kind, storedSettingsValue(settings), promptItems);

export const batchGenerationStoredSettingsFromValue = (
	catalog: GenerationModelsResponse,
	value: GenerationSettingsValue,
): BatchGenerationStoredSettings => {
	const route = usableRoute(catalog, value.kind, value.routeId);
	const promptSupplementItemIds = uniqueStrings(
		value.promptSupplements.map((item) => item.referenceId ?? ""),
	);
	const optimization = value.promptOptimization.enabled ? value.promptOptimization : null;

	return {
		...(route ? { familyId: route.familyId, versionId: route.versionId } : {}),
		params: { ...value.params },
		...(optimization?.referenceId ? { promptOptimizeItemId: optimization.referenceId } : {}),
		...(optimization?.routeId ? { promptOptimizeRouteId: optimization.routeId } : {}),
		...(promptSupplementItemIds.length > 0 ? { promptSupplementItemIds } : {}),
		routeId: value.routeId,
		usePromptOptimization: Boolean(optimization),
		usePromptSupplement: value.promptSupplements.length > 0,
	};
};

export const formatGenerationSettingsValue = (value: GenerationSettingsValue) => {
	const parts = [value.label || value.routeId];
	for (const paramValue of Object.values(value.params)) {
		const formatted = formatParamValue(paramValue);
		if (formatted) parts.push(formatted);
	}
	if (value.referenceAssetIds.length > 0) {
		parts.push(`${value.referenceAssetIds.length} 张参考图`);
	}
	if (value.promptSupplements.length > 0) {
		parts.push(`${value.promptSupplements.length} 项附加提示词`);
	}
	if (value.promptOptimization.enabled) parts.push("已开启提示词优化");
	return parts.join(" · ");
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

const normalizeRouteParams = (
	route: GenerationRoute,
	rawValue: unknown,
	referenceCount: number,
) => {
	const rawParams = recordValue(rawValue);
	const declaredParamNames = new Set(route.params.map((param) => param.name));
	const declaredValues = Object.fromEntries(
		Object.entries(rawParams ?? {}).filter(([name]) => declaredParamNames.has(name)),
	);
	const params = routeParamValues(route.params, declaredValues);
	const controls = resolveGenerationRouteParamControls(route, params, { referenceCount });

	if (controls.imageSpec) {
		const { ratioParam, resolutionParam, selectedRatio, selectedResolution } = controls.imageSpec;
		if (ratioParam && selectedRatio) params[ratioParam.name] = selectedRatio.value;
		if (resolutionParam && selectedResolution) {
			params[resolutionParam.name] = selectedResolution.value;
		}
	}
	const countParam = controls.generationCountParam;
	if (countParam) {
		const fallback = typeof countParam.default === "number" ? countParam.default : 1;
		const rawCount = Number(params[countParam.name]);
		const rounded = Math.round(Number.isFinite(rawCount) ? rawCount : fallback);
		params[countParam.name] = clampNumber(rounded, countParam.min ?? 1, countParam.max ?? 10);
	}
	return params;
};

const normalizeReferenceAssetIDs = (rawValue: unknown, route: GenerationRoute) => {
	if (!route.supportsReferenceUrls || !Array.isArray(rawValue)) return [];
	const ids = uniqueStrings(rawValue);
	const max = route.maxReferenceUrls;
	return typeof max === "number" && max > 0 ? ids.slice(0, max) : ids;
};

const normalizePromptSupplements = (
	rawValue: unknown,
	promptItems?: readonly PromptInsertItem[],
) => {
	if (!Array.isArray(rawValue)) return [];
	const itemsByID = promptItems && new Map(promptItems.map((item) => [item.id, item]));
	const seenIDs = new Set<string>();
	const seenPrompts = new Set<string>();
	const supplements: GenerationPromptSupplementValue[] = [];

	for (const rawItem of rawValue) {
		const raw = recordValue(rawItem);
		if (!raw) continue;
		const referenceId = stringValue(raw.referenceId);
		const liveItem = referenceId && itemsByID ? itemsByID.get(referenceId) : undefined;
		if (referenceId && promptItems !== undefined && !liveItem) continue;
		const referenceName = (liveItem?.name ?? stringValue(raw.referenceName) ?? "").trim();
		const referencePrompt = (liveItem?.prompt ?? stringValue(raw.referencePrompt) ?? "").trim();
		// Preserve an id-only value while the prompt-pack request is still loading.
		if (!referencePrompt && !referenceId) continue;
		if (referenceId && seenIDs.has(referenceId)) continue;
		if (referencePrompt && seenPrompts.has(referencePrompt)) continue;
		if (referenceId) seenIDs.add(referenceId);
		if (referencePrompt) seenPrompts.add(referencePrompt);
		supplements.push({
			...(referenceId ? { referenceId } : {}),
			referenceName,
			referencePrompt,
		});
	}
	return supplements;
};

const normalizePromptOptimization = (
	catalog: GenerationModelsResponse,
	rawValue: unknown,
	promptItems?: readonly PromptInsertItem[],
): GenerationPromptOptimizationValue => {
	const raw = recordValue(rawValue);
	if (raw?.enabled !== true) return { enabled: false };

	const referenceId = stringValue(raw.referenceId);
	const liveItem =
		referenceId && promptItems ? promptItems.find((item) => item.id === referenceId) : undefined;
	if (referenceId && promptItems !== undefined && !liveItem) return { enabled: false };

	const routeId = stringValue(raw.routeId);
	const executor = stringValue(raw.executor) === "codex" ? "codex" : undefined;
	const route = routeId
		? catalog.routes.find(
				(item) => item.id === routeId && item.kind === "text" && isConfiguredRoute(item),
			)
		: undefined;
	const referenceName = (liveItem?.name ?? stringValue(raw.referenceName) ?? "").trim();
	const referencePrompt = (liveItem?.prompt ?? stringValue(raw.referencePrompt) ?? "").trim();

	return {
		enabled: true,
		...(!route && executor ? { executor } : {}),
		...(route
			? { label: route.label.trim() || route.id, routeId: route.id }
			: routeId
				? { routeId }
				: {}),
		...(referenceId ? { referenceId } : {}),
		...(referenceName ? { referenceName } : {}),
		...(referencePrompt ? { referencePrompt } : {}),
	};
};

const storedSettingsValue = (settings: BatchGenerationStoredSettings | null | undefined) => {
	if (!settings) return undefined;
	return {
		params: settings.params,
		promptOptimization: {
			enabled: settings.usePromptOptimization === true,
			referenceId: settings.promptOptimizeItemId,
			routeId: settings.promptOptimizeRouteId,
		},
		promptSupplements:
			settings.usePromptSupplement === true
				? (settings.promptSupplementItemIds ?? []).map((referenceId) => ({ referenceId }))
				: [],
		routeId: settings.routeId,
	};
};

const generationPreferenceValue = (
	catalog: GenerationModelsResponse,
	kind: GenerationSettingsKind,
	preference: GenerationPreference | null | undefined,
) => {
	if (!preference) return undefined;
	const familyID = preference.familyIds[kind];
	const versionID = familyID ? preference.versionIds[familyID] : undefined;
	const routeID = versionID ? preference.routeIds[versionID] : undefined;
	const route = usableRoute(catalog, kind, routeID);
	if (!route) return undefined;
	return { params: preference.routeParams[route.id], routeId: route.id };
};

const hasUsableExplicitRoute = (
	catalog: GenerationModelsResponse,
	kind: GenerationSettingsKind,
	value: unknown,
) => {
	const raw = recordValue(value);
	return Boolean(usableRoute(catalog, kind, stringValue(raw?.routeId)));
};

const usableRoute = (
	catalog: GenerationModelsResponse,
	kind: GenerationSettingsKind,
	routeID: string | undefined,
) =>
	routeID
		? catalog.routes.find(
				(route) => route.id === routeID && route.kind === kind && isConfiguredRoute(route),
			)
		: undefined;

const firstUsableRoute = (catalog: GenerationModelsResponse, kind: GenerationSettingsKind) =>
	catalog.routes.find((route) => route.kind === kind && isConfiguredRoute(route));

const generationSettingsKind = (value: unknown): GenerationSettingsKind | undefined =>
	value === "image" || value === "video" ? value : undefined;

const uniqueStrings = (values: readonly unknown[]) => [
	...new Set(values.map(stringValue).filter((value): value is string => Boolean(value))),
];

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

const stringValue = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : undefined;

const clampNumber = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

const formatParamValue = (value: unknown) => {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "boolean") return value ? "开启" : "关闭";
	return "";
};
