import type {
	GenerationAsset,
	GenerationKind,
	GenerationModelsResponse,
	GenerationParam,
	GenerationProviderInfo,
	GenerationProviderType,
	GenerationRoute,
} from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { apiResourceURL } from "@/shared/lib/api-base";
import { fallbackCatalog } from "./generationFallbackCatalog";

export { fallbackCatalog } from "./generationFallbackCatalog";

export const defaultFamilyIds: Record<GenerationKind, string> = {
	image: "gpt-image",
	text: "text",
	video: "seedance",
};

export const catalogOrFallback = (catalog?: GenerationModelsResponse): GenerationModelsResponse => {
	if (catalog?.families?.length && catalog.versions?.length && catalog.routes?.length) {
		return catalog;
	}

	return fallbackCatalog;
};

export const isConfiguredRoute = (route: GenerationRoute) =>
	route.status === "available" && route.configured === true;

export const referenceKindsForRoute = (route: GenerationRoute) => {
	if (!route.supportsReferenceUrls) return new Set<MediaAsset["kind"]>();
	if (route.adapter === "openrouter.video") {
		return new Set<MediaAsset["kind"]>(["image", "video"]);
	}

	return new Set<MediaAsset["kind"]>(["image"]);
};

export const canUseAssetAsReference = (
	asset: MediaAsset,
	route: GenerationRoute,
	selectableKinds = referenceKindsForRoute(route),
) => route.supportsReferenceUrls && selectableKinds.has(asset.kind);

const mediaAssetContentPathPattern =
	/\/api(?:\/v1)?\/(?:media\/assets|media-assets)\/[^/?#]+\/content/;

export const generatedAssetsIncludeMediaAssets = (assets: GenerationAsset[] = []) =>
	assets.some((asset) => mediaAssetContentPathPattern.test(generationAssetSource(asset)));

export const preferredRoute = (routes: GenerationRoute[]) =>
	preferredTextRoute(routes.filter(isConfiguredRoute)) ??
	routes.find(isConfiguredRoute) ??
	routes[0];

const preferredTextRoute = (routes: GenerationRoute[]) => {
	if (!routes.some((route) => route.kind === "text")) return undefined;
	return (
		routes.find(
			(route) => route.kind === "text" && providerTypeOf(route.provider) === "official",
		) ??
		routes.find((route) => route.kind === "text" && route.provider === "openrouter") ??
		routes.find((route) => route.kind === "text" && route.provider === "dmx")
	);
};

const fallbackProviderTypes: Record<string, GenerationProviderType> = {
	openai: "official",
	google: "official",
	volcengine: "official",
	dmx: "aggregator",
	openrouter: "aggregator",
	jimeng: "local",
};

export const providerTypeOf = (
	provider: string,
	providers: GenerationProviderInfo[] = fallbackCatalog.providers,
): GenerationProviderType | undefined =>
	providers.find((item) => item.id === provider)?.providerType ?? fallbackProviderTypes[provider];

export const defaultParamValues = (params: GenerationParam[]) =>
	params.reduce<Record<string, unknown>>((values, param) => {
		if (param.default !== undefined) {
			values[param.name] = param.default;
		}

		return values;
	}, {});

export const routeParamValues = (
	params: GenerationParam[],
	values: Record<string, unknown> | undefined,
) => {
	const result = defaultParamValues(params);
	if (!values) return result;

	const specs = new Map(params.map((param) => [param.name, param]));
	for (const [name, value] of Object.entries(values)) {
		const spec = specs.get(name);
		if (!spec) {
			result[name] = value;
			continue;
		}

		const normalized = normalizeParamValue(spec, value);
		if (normalized !== undefined) result[name] = normalized;
	}

	return result;
};

const normalizeParamValue = (param: GenerationParam, value: unknown) => {
	if (value === undefined || value === null) return undefined;

	switch (param.type) {
		case "select":
			return normalizeSelectParamValue(param, value);
		case "number":
			return normalizeNumberParamValue(param, value);
		case "boolean":
			return normalizeBooleanParamValue(value);
		case "text":
			return typeof value === "string" ? value : undefined;
		default:
			return value;
	}
};

const normalizeSelectParamValue = (param: GenerationParam, value: unknown) => {
	const selected = optionComparableString(value);
	if (!selected) return undefined;

	return param.options?.some((option) => option.value === selected) ? selected : undefined;
};

const normalizeNumberParamValue = (param: GenerationParam, value: unknown) => {
	const number = numericParamValue(value);
	if (number === undefined) return undefined;
	if (param.min !== undefined && number < param.min) return undefined;
	if (param.max !== undefined && number > param.max) return undefined;

	return number;
};

const normalizeBooleanParamValue = (value: unknown) => {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return undefined;

	switch (value.trim().toLowerCase()) {
		case "true":
		case "1":
		case "yes":
		case "on":
			return true;
		case "false":
		case "0":
		case "no":
		case "off":
			return false;
		default:
			return undefined;
	}
};

const optionComparableString = (value: unknown) => {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);

	return "";
};

const numericParamValue = (value: unknown) => {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return undefined;

	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const number = Number(trimmed);
	return Number.isFinite(number) ? number : undefined;
};

export const generationAssetSource = (asset: GenerationAsset) => {
	if (asset.url) return apiResourceURL(asset.url);
	if (!asset.base64) return "";

	return `data:${asset.mimeType || "image/png"};base64,${asset.base64}`;
};

export const generationAssetSelectionKey = (asset: GenerationAsset) => {
	const source = generationAssetSource(asset);
	if (!source || (asset.kind !== "image" && asset.kind !== "video")) return null;

	return `${asset.kind}:${source}`;
};
