import type {
	GenerationFamily,
	GenerationModelsResponse,
	GenerationRoute,
	GenerationVersion,
} from "@/domains/generation/api/generation";
import { displayGenerationLabelWithoutAlias } from "@/domains/generation/components/generationDisplayLabels";
import {
	resolveImageGenerationSpec,
	type ImageGenerationSpec,
} from "@/domains/generation/components/imageGenerationSpec";
import { providerLabel } from "@/domains/generation/hooks/generationFormatters";

// GenerationParamsFieldValue is the submitted value of a `generation_params`
// form field: the chosen route, a human-readable label for summaries and the
// agent, and the route params surfaced by the card (ratio/resolution/count).
export interface GenerationParamsFieldValue {
	routeId: string;
	label: string;
	params: Record<string, unknown>;
}

export interface GenerationCountBounds {
	min: number;
	max: number;
	value: number;
}

export interface ResolvedGenerationSelection {
	value: GenerationParamsFieldValue;
	route: GenerationRoute;
	family: GenerationFamily;
	families: GenerationFamily[];
	familyRoutes: Map<string, GenerationRoute[]>;
	versions: GenerationVersion[];
	version: GenerationVersion;
	spec: ImageGenerationSpec | null;
	count: GenerationCountBounds | null;
}

// resolveGenerationRoute maps whatever value the agent (or a previous edit)
// provided onto the configured image catalog: unknown routes fall back to the
// first configured route, params are validated against the route's schema and
// combo table, and the picker's family/version groupings are derived.
export const resolveGenerationRoute = (
	catalog: GenerationModelsResponse,
	imageRoutes: GenerationRoute[],
	rawValue: unknown,
): ResolvedGenerationSelection | null => {
	if (imageRoutes.length === 0) return null;

	const raw = parseFieldValue(rawValue);
	const route = imageRoutes.find((candidate) => candidate.id === raw.routeId) ?? imageRoutes[0];

	const familyRoutes = new Map<string, GenerationRoute[]>();
	for (const candidate of imageRoutes) {
		const existing = familyRoutes.get(candidate.familyId);
		if (existing) {
			existing.push(candidate);
		} else {
			familyRoutes.set(candidate.familyId, [candidate]);
		}
	}
	const families = catalog.families.filter((family) => familyRoutes.has(family.id));
	const family = families.find((candidate) => candidate.id === route.familyId);
	const versions = catalog.versions.filter((candidate) => candidate.familyId === route.familyId);
	const version = versions.find((candidate) => candidate.id === route.versionId);
	if (!family || !version) return null;

	const value = normalizeGenerationParamsValue(catalog, route, raw.params);
	return {
		value,
		route,
		family,
		families,
		familyRoutes,
		versions,
		version,
		spec: resolveImageGenerationSpec(route.params, value.params, route.paramCombos),
		count: countBounds(route, value.params),
	};
};

// normalizeGenerationParamsValue coerces raw params onto route's schema: the
// ratio/resolution pair is validated (and combo-corrected) by the shared spec
// resolver, and the count is clamped to the route's n bounds.
export const normalizeGenerationParamsValue = (
	catalog: GenerationModelsResponse,
	route: GenerationRoute,
	rawParams: Record<string, unknown>,
): GenerationParamsFieldValue => {
	const params: Record<string, unknown> = {};
	const spec = resolveImageGenerationSpec(route.params, rawParams, route.paramCombos);
	if (spec?.ratioParam && spec.selectedRatio) {
		params[spec.ratioParam.name] = spec.selectedRatio.value;
	}
	if (spec?.resolutionParam && spec.selectedResolution) {
		params[spec.resolutionParam.name] = spec.selectedResolution.value;
	}
	const count = countBounds(route, rawParams);
	if (count) {
		params.n = count.value;
	}
	return {
		routeId: route.id,
		label: generationRouteDisplayLabel(catalog, route),
		params,
	};
};

// countBounds derives the count (张数) control from route's `n` number param.
export const countBounds = (
	route: GenerationRoute,
	params: Record<string, unknown>,
): GenerationCountBounds | null => {
	const param = route.params.find(
		(candidate) => candidate.name === "n" && candidate.type === "number",
	);
	if (!param) return null;
	const min = param.min ?? 1;
	const max = param.max ?? 10;
	const raw = Number(params.n);
	const fallback = typeof param.default === "number" ? param.default : min;
	const value = Math.min(max, Math.max(min, Math.round(Number.isFinite(raw) ? raw : fallback)));
	return { min, max, value };
};

// generationRouteDisplayLabel renders "提供方 · 模型" (e.g. "MediaGo · GPT
// Image 2") for summaries and for the agent to echo back to the user.
export const generationRouteDisplayLabel = (
	catalog: GenerationModelsResponse,
	route: GenerationRoute,
) => {
	const version = catalog.versions.find((candidate) => candidate.id === route.versionId);
	const model = version ? displayGenerationLabelWithoutAlias(version.label) : route.model;
	return `${providerLabel(route.provider)} · ${model}`;
};

// formatGenerationParamsValue renders the submitted composite value for the
// frozen form summary, e.g. "MediaGo · GPT Image 2（1:1 · 2K · 4张）".
export const formatGenerationParamsValue = (value: unknown) => {
	const raw = parseFieldValue(value);
	const label =
		typeof (value as { label?: unknown })?.label === "string"
			? (value as { label: string }).label
			: raw.routeId;
	const parts: string[] = [];
	const ratio = raw.params.aspectRatio ?? raw.params.ratio;
	if (typeof ratio === "string" && ratio) parts.push(ratio);
	const resolution = raw.params.resolution ?? raw.params.resolutionType ?? raw.params.imageSize;
	if (typeof resolution === "string" && resolution) parts.push(resolution);
	const count = Number(raw.params.n);
	if (Number.isFinite(count) && count > 0) parts.push(`${count}张`);
	return parts.length > 0 ? `${label}（${parts.join(" · ")}）` : label;
};

const parseFieldValue = (
	rawValue: unknown,
): { routeId: string; params: Record<string, unknown> } => {
	if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
		return { routeId: "", params: {} };
	}
	const record = rawValue as Record<string, unknown>;
	const routeId = typeof record.routeId === "string" ? record.routeId : "";
	const params =
		record.params && typeof record.params === "object" && !Array.isArray(record.params)
			? (record.params as Record<string, unknown>)
			: {};
	return { routeId, params };
};
