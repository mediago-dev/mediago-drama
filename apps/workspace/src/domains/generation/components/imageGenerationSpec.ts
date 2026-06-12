import type { GenerationParam } from "@/domains/generation/api/generation";
import {
	paramLabel,
	paramOptionLabel,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";

export type SpecMode = "split" | "size";
export type SpecAxis = "ratio" | "resolution";

export interface SpecOption {
	defaultRatio?: boolean;
	height?: number;
	id: string;
	label: string;
	ratio?: string;
	resolution?: string;
	smart?: boolean;
	value: string;
	width?: number;
}

interface SizeCandidate extends SpecOption {
	ratio?: string;
	resolution?: string;
}

export interface ImageGenerationSpec {
	controlledParamNames: string[];
	mode: SpecMode;
	ratioOptions: SpecOption[];
	resolutionOptions: SpecOption[];
	selectedRatio: SpecOption | null;
	selectedResolution: SpecOption | null;
	sizeCandidates: SizeCandidate[];
	sizePreview: ImageGenerationSizePreview | null;
	sizeParam?: GenerationParam;
	ratioParam?: GenerationParam;
	resolutionParam?: GenerationParam;
}

export interface ImageGenerationSizePreview {
	height?: number;
	width?: number;
}

export const resolveImageGenerationSpec = (
	params: GenerationParam[],
	values: Record<string, unknown>,
): ImageGenerationSpec | null => {
	const splitSpec = resolveSplitImageGenerationSpec(params, values);
	if (splitSpec) return splitSpec;

	return resolveSizeImageGenerationSpec(params, values);
};

export const filterImageGenerationSpecParams = (
	params: GenerationParam[],
	spec: ImageGenerationSpec | null,
) => {
	if (!spec) return params;

	const controlledNames = new Set(spec.controlledParamNames);
	return params.filter((param) => !controlledNames.has(param.name));
};

export const imageGenerationSpecUpdate = (
	spec: ImageGenerationSpec,
	axis: SpecAxis,
	option: SpecOption,
) => {
	if (spec.mode === "split") {
		const param = axis === "ratio" ? spec.ratioParam : spec.resolutionParam;
		if (!param) return null;

		return { name: param.name, value: option.value };
	}

	const candidate = selectSizeCandidate(spec, axis, option);
	if (!candidate || !spec.sizeParam) return null;

	return { name: spec.sizeParam.name, value: candidate.value };
};

const resolveSplitImageGenerationSpec = (
	params: GenerationParam[],
	values: Record<string, unknown>,
): ImageGenerationSpec | null => {
	const ratioParam = params.find(isRatioParam);
	const resolutionParam = params.find(isResolutionParam);
	if (!ratioParam || !resolutionParam) return null;

	const ratioOptions = uniqueSpecOptions(
		(ratioParam.options ?? [])
			.map((option) => ratioSpecOption(option.value, paramOptionLabel(option.label)))
			.filter(isPresent),
	);
	const resolutionOptions = uniqueSpecOptions(
		(resolutionParam.options ?? [])
			.map((option) => resolutionSpecOption(option.value, paramOptionLabel(option.label)))
			.filter(isPresent),
	);
	if (ratioOptions.length === 0 || resolutionOptions.length === 0) return null;

	const selectedRatioValue = selectedParamValue(ratioParam, values);
	const selectedResolutionValue = selectedParamValue(resolutionParam, values);
	const selectedRatio =
		ratioOptions.find((option) => option.value === selectedRatioValue) ?? ratioOptions[0];
	const selectedResolution =
		resolutionOptions.find((option) => option.value === selectedResolutionValue) ??
		resolutionOptions[0];

	return {
		controlledParamNames: [ratioParam.name, resolutionParam.name],
		mode: "split",
		ratioOptions: orderRatioOptions(ratioOptions),
		resolutionOptions: orderResolutionOptions(resolutionOptions),
		selectedRatio,
		selectedResolution,
		sizeCandidates: [],
		sizePreview: inferSizePreview(selectedRatio, selectedResolution),
		ratioParam,
		resolutionParam,
	};
};

const resolveSizeImageGenerationSpec = (
	params: GenerationParam[],
	values: Record<string, unknown>,
): ImageGenerationSpec | null => {
	const sizeParam = params.find(isSizeParam);
	if (!sizeParam?.options?.length) return null;

	const sizeCandidates = sizeParam.options
		.map((option) => sizeCandidate(option.value, paramOptionLabel(option.label)))
		.filter(isPresent);
	const ratioOptions = uniqueSpecOptions(
		sizeCandidates
			.flatMap((candidate) => {
				if (candidate.smart) return [{ ...candidate, id: `ratio:${candidate.value}` }];
				if (!candidate.ratio) return [];

				return [
					{
						id: `ratio:${candidate.ratio}`,
						label: candidate.ratio,
						ratio: candidate.ratio,
						value: candidate.ratio,
					},
				];
			})
			.filter(isPresent),
	);
	const defaultRatioCandidate = sizeCandidates.find(
		(candidate) => candidate.resolution && !candidate.ratio && !candidate.smart,
	);
	if (defaultRatioCandidate && !ratioOptions.some((option) => option.defaultRatio)) {
		ratioOptions.unshift({
			defaultRatio: true,
			id: "ratio:default",
			label: "默认",
			value: "default",
		});
	}
	const resolutionOptions = uniqueSpecOptions(
		sizeCandidates
			.flatMap((candidate) => {
				if (!candidate.resolution) return [];

				return [
					{
						id: `resolution:${candidate.resolution}`,
						label: candidate.resolution,
						resolution: candidate.resolution,
						value: candidate.resolution,
					},
				];
			})
			.filter(isPresent),
	);
	if (ratioOptions.length === 0 || resolutionOptions.length === 0) return null;

	const selectedValue = selectedParamValue(sizeParam, values);
	const selectedCandidate =
		sizeCandidates.find((candidate) => candidate.value === selectedValue) ?? sizeCandidates[0];
	const selectedRatio = selectedCandidate.smart
		? (ratioOptions.find((option) => option.smart) ?? null)
		: (ratioOptions.find((option) => option.ratio === selectedCandidate.ratio) ??
			ratioOptions.find((option) => option.defaultRatio) ??
			null);
	const selectedResolution =
		resolutionOptions.find((option) => option.resolution === selectedCandidate.resolution) ?? null;

	return {
		controlledParamNames: [sizeParam.name],
		mode: "size",
		ratioOptions: orderRatioOptions(ratioOptions),
		resolutionOptions: orderResolutionOptions(resolutionOptions),
		selectedRatio,
		selectedResolution,
		sizeCandidates,
		sizePreview: selectedCandidate
			? exactOrInferredSizePreview(selectedCandidate, selectedRatio, selectedResolution)
			: null,
		sizeParam,
	};
};

const selectSizeCandidate = (
	spec: ImageGenerationSpec,
	axis: SpecAxis,
	option: SpecOption,
): SizeCandidate | undefined => {
	if (axis === "ratio" && option.smart) {
		return spec.sizeCandidates.find((candidate) => candidate.smart);
	}
	if (axis === "ratio" && option.defaultRatio) {
		return spec.sizeCandidates.find(
			(candidate) =>
				candidate.resolution === spec.selectedResolution?.resolution &&
				!candidate.ratio &&
				!candidate.smart,
		);
	}

	const nextRatio = axis === "ratio" ? option.ratio : spec.selectedRatio?.ratio;
	const nextResolution =
		axis === "resolution" ? option.resolution : spec.selectedResolution?.resolution;
	const exact = spec.sizeCandidates.find(
		(candidate) => candidate.ratio === nextRatio && candidate.resolution === nextResolution,
	);
	if (exact) return exact;

	if (axis === "ratio") {
		return spec.sizeCandidates.find((candidate) => candidate.ratio === nextRatio);
	}

	return spec.sizeCandidates.find((candidate) => candidate.resolution === nextResolution);
};

const isRatioParam = (param: GenerationParam) => {
	if (param.type !== "select" || !param.options?.length) return false;
	if (param.name === "aspectRatio" || param.name === "ratio") return true;

	const label = paramLabel(param.label);
	return label.includes("比例") || label.includes("画幅");
};

const isResolutionParam = (param: GenerationParam) => {
	if (param.type !== "select" || !param.options?.length) return false;
	if (param.name === "resolutionType" || param.name === "imageSize") return true;

	const label = paramLabel(param.label);
	if (!label.includes("分辨率") && !label.includes("图像尺寸")) return false;

	return param.options.some((option) => parseResolutionLabel(option.value, option.label));
};

const isSizeParam = (param: GenerationParam) =>
	param.type === "select" && param.name === "size" && Boolean(param.options?.length);

const selectedParamValue = (param: GenerationParam, values: Record<string, unknown>) => {
	const rawValue = values[param.name] ?? param.default ?? param.options?.[0]?.value ?? "";
	return String(rawValue);
};

const sizeCandidate = (value: string, label: string): SizeCandidate | null => {
	const smart = isSmartOption(value, label);
	const ratio = parseRatioLabel(label) ?? parseRatioLabel(value);
	const dimensions = parseDimensions(value) ?? parseDimensions(label);
	const dimensionRatio = dimensions
		? normalizeRatio(dimensions.width, dimensions.height)
		: undefined;
	const resolution = parseResolutionLabel(label, value) ?? resolutionFromDimensions(dimensions);

	if (smart) {
		return {
			id: `size:${value}`,
			label,
			smart: true,
			value,
		};
	}
	if (!ratio && !dimensionRatio && !resolution) return null;

	return {
		id: `size:${value}`,
		label,
		ratio: ratio ?? dimensionRatio,
		resolution,
		value,
		width: dimensions?.width,
		height: dimensions?.height,
	};
};

const ratioSpecOption = (value: string, label: string): SpecOption | null => {
	if (isSmartOption(value, label)) {
		return {
			id: `ratio:${value}`,
			label: "智能",
			smart: true,
			value,
		};
	}

	const ratio = parseRatioLabel(value) ?? parseRatioLabel(label);
	if (!ratio) return null;

	return {
		id: `ratio:${value}`,
		label,
		ratio,
		value,
	};
};

const resolutionSpecOption = (value: string, label: string): SpecOption | null => {
	const resolution = parseResolutionLabel(label, value) ?? parseResolutionLabel(value, label);
	if (!resolution) return null;

	return {
		id: `resolution:${value}`,
		label,
		resolution,
		value,
	};
};

const isSmartOption = (value: string, label: string) => {
	const normalized = `${value} ${label}`.toLowerCase();
	return normalized.includes("auto") || normalized.includes("adaptive") || label.includes("自动");
};

const parseRatioLabel = (value: string) => {
	const match = value.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
	if (!match) return undefined;

	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return undefined;
	}

	return `${width}:${height}`;
};

const parseResolutionLabel = (...values: string[]) => {
	for (const value of values) {
		const match = value.match(/([1-9])\s*k/i);
		if (match) return `${match[1]}K`;
	}

	return undefined;
};

const parseDimensions = (value: string) => {
	const match = value.match(/(\d{3,5})\s*x\s*(\d{3,5})/i);
	if (!match) return undefined;

	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return undefined;
	}

	return { height, width };
};

const resolutionFromDimensions = (dimensions?: { height: number; width: number }) => {
	if (!dimensions) return undefined;

	const longSide = Math.max(dimensions.width, dimensions.height);
	if (longSide >= 3600) return "4K";
	if (longSide >= 2800) return "3K";
	if (longSide >= 1800) return "2K";
	if (longSide >= 960) return "1K";

	return undefined;
};

const normalizeRatio = (width: number, height: number) => {
	const divisor = greatestCommonDivisor(width, height);
	return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
};

const greatestCommonDivisor = (left: number, right: number): number => {
	let a = Math.abs(Math.round(left));
	let b = Math.abs(Math.round(right));
	while (b > 0) {
		const next = a % b;
		a = b;
		b = next;
	}

	return a || 1;
};

const uniqueSpecOptions = (options: SpecOption[]) => {
	const seen = new Set<string>();
	const result: SpecOption[] = [];
	for (const option of options) {
		const key = option.smart
			? "smart"
			: option.defaultRatio
				? "default"
				: option.ratio
					? `ratio:${option.ratio}`
					: option.resolution
						? `resolution:${option.resolution}`
						: option.value;
		if (seen.has(key)) continue;

		seen.add(key);
		result.push(option);
	}

	return result;
};

const preferredRatioOrder = [
	"smart",
	"default",
	"21:9",
	"16:9",
	"3:2",
	"4:3",
	"1:1",
	"3:4",
	"2:3",
	"9:16",
];

const orderRatioOptions = (options: SpecOption[]) =>
	[...options].sort((left, right) => {
		const leftKey = left.smart
			? "smart"
			: left.defaultRatio
				? "default"
				: (left.ratio ?? left.label);
		const rightKey = right.smart
			? "smart"
			: right.defaultRatio
				? "default"
				: (right.ratio ?? right.label);
		const leftIndex = preferredRatioOrder.indexOf(leftKey);
		const rightIndex = preferredRatioOrder.indexOf(rightKey);
		if (leftIndex !== rightIndex) {
			return (
				(leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
				(rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
			);
		}

		return leftKey.localeCompare(rightKey);
	});

const orderResolutionOptions = (options: SpecOption[]) =>
	[...options].sort(
		(left, right) => resolutionRank(left.resolution) - resolutionRank(right.resolution),
	);

const resolutionRank = (resolution?: string) => {
	const match = resolution?.match(/(\d+)/);
	return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

const inferSizePreview = (ratio: SpecOption | null, resolution: SpecOption | null) => {
	if (ratio?.width && ratio.height) return { height: ratio.height, width: ratio.width };
	if (resolution?.width && resolution.height) {
		return { height: resolution.height, width: resolution.width };
	}
	if (!ratio?.ratio || !resolution?.resolution) return null;

	const base = resolutionBasePixels(resolution.resolution);
	if (!base) return null;

	const [ratioWidth, ratioHeight] = ratio.ratio.split(":").map(Number);
	if (!ratioWidth || !ratioHeight) return null;

	if (ratioWidth >= ratioHeight) {
		return {
			width: base,
			height: Math.round((base * ratioHeight) / ratioWidth),
		};
	}

	return {
		width: Math.round((base * ratioWidth) / ratioHeight),
		height: base,
	};
};

const exactOrInferredSizePreview = (
	candidate: SizeCandidate,
	ratio: SpecOption | null,
	resolution: SpecOption | null,
) => {
	if (candidate.width && candidate.height) {
		return { height: candidate.height, width: candidate.width };
	}

	return inferSizePreview(ratio, resolution);
};

const resolutionBasePixels = (resolution: string) => {
	const match = resolution.match(/([1-9])/);
	if (!match) return undefined;

	return Number(match[1]) * 1024;
};

const isPresent = <T>(value: T | null | undefined): value is T =>
	value !== null && value !== undefined;
