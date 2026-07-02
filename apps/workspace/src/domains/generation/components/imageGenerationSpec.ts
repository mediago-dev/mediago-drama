import type { GenerationParam, GenerationParamCombo } from "@/domains/generation/api/generation";
import { paramOptionLabel } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";

export type SpecAxis = "ratio" | "resolution";

export interface SpecOption {
	disabled?: boolean;
	height?: number;
	id: string;
	label: string;
	ratio?: string;
	resolution?: string;
	smart?: boolean;
	value: string;
	width?: number;
}

interface SplitCombo {
	allowed: Array<{ ratio: string; resolution: string }>;
	outputs?: Record<string, string>;
}

export interface SpecParamUpdate {
	name: string;
	value: string;
}

export interface ImageGenerationSpec {
	allowedCombos?: SplitCombo;
	controlledParamNames: string[];
	mode: "split";
	ratioOptions: SpecOption[];
	resolutionOptions: SpecOption[];
	selectedRatio: SpecOption | null;
	selectedResolution: SpecOption | null;
	sizePreview: ImageGenerationSizePreview | null;
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
	paramCombos?: GenerationParamCombo[],
): ImageGenerationSpec | null => {
	return resolveSplitImageGenerationSpec(params, values, paramCombos);
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
): { updates: SpecParamUpdate[] } | null => {
	if (option.disabled) return null;

	const param = axis === "ratio" ? spec.ratioParam : spec.resolutionParam;
	if (!param) return null;

	const updates: SpecParamUpdate[] = [{ name: param.name, value: option.value }];
	if (axis === "ratio" && spec.resolutionParam) {
		const currentResolution = spec.selectedResolution;
		if (
			currentResolution &&
			!isSplitComboAllowed(spec.allowedCombos, option.value, currentResolution.value)
		) {
			const nextResolution = spec.resolutionOptions.find((resolution) =>
				isSplitComboAllowed(spec.allowedCombos, option.value, resolution.value),
			);
			if (nextResolution && nextResolution.value !== currentResolution.value) {
				updates.push({ name: spec.resolutionParam.name, value: nextResolution.value });
			}
		}
	}

	return { updates };
};

const resolveSplitImageGenerationSpec = (
	params: GenerationParam[],
	values: Record<string, unknown>,
	paramCombos?: GenerationParamCombo[],
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

	const allowedCombos = resolveSplitCombo(paramCombos, ratioParam.name, resolutionParam.name);
	const selectedRatioValue = selectedParamValue(ratioParam, values);
	const selectedResolutionValue = selectedParamValue(resolutionParam, values);
	const selectedRatio =
		ratioOptions.find((option) => option.value === selectedRatioValue) ?? ratioOptions[0];
	let selectedResolution =
		resolutionOptions.find((option) => option.value === selectedResolutionValue) ??
		resolutionOptions[0];
	if (!isSplitComboAllowed(allowedCombos, selectedRatio.value, selectedResolution.value)) {
		selectedResolution =
			resolutionOptions.find((option) =>
				isSplitComboAllowed(allowedCombos, selectedRatio.value, option.value),
			) ?? selectedResolution;
	}
	const orderedRatioOptions = orderRatioOptions(ratioOptions).map((option) => ({
		...option,
		disabled: !hasAnySplitComboForRatio(allowedCombos, option.value),
	}));
	const orderedResolutionOptions = orderResolutionOptions(resolutionOptions).map((option) => ({
		...option,
		disabled: !isSplitComboAllowed(allowedCombos, selectedRatio.value, option.value),
	}));

	return {
		allowedCombos,
		controlledParamNames: [ratioParam.name, resolutionParam.name],
		mode: "split",
		ratioOptions: orderedRatioOptions,
		resolutionOptions: orderedResolutionOptions,
		selectedRatio,
		selectedResolution,
		sizePreview: inferSizePreview(selectedRatio, selectedResolution, allowedCombos),
		ratioParam,
		resolutionParam,
	};
};

const resolveSplitCombo = (
	paramCombos: GenerationParamCombo[] | undefined,
	ratioParamName: string,
	resolutionParamName: string,
): SplitCombo | undefined => {
	const combo = paramCombos?.find(
		(item) => item.params.includes(ratioParamName) && item.params.includes(resolutionParamName),
	);
	if (!combo) return undefined;

	const ratioIndex = combo.params.indexOf(ratioParamName);
	const resolutionIndex = combo.params.indexOf(resolutionParamName);
	if (ratioIndex < 0 || resolutionIndex < 0) return undefined;

	const allowed = combo.allowed
		.map((values) => {
			const ratio = values[ratioIndex];
			const resolution = values[resolutionIndex];
			if (!ratio || !resolution) return null;

			return { ratio, resolution };
		})
		.filter(isPresent);
	if (allowed.length === 0) return undefined;

	return { allowed, outputs: combo.outputs };
};

const isSplitComboAllowed = (
	combo: SplitCombo | undefined,
	ratioValue: string,
	resolutionValue: string,
) => {
	if (!combo) return true;

	return combo.allowed.some(
		(allowed) => allowed.ratio === ratioValue && allowed.resolution === resolutionValue,
	);
};

const hasAnySplitComboForRatio = (combo: SplitCombo | undefined, ratioValue: string) => {
	if (!combo) return true;

	return combo.allowed.some((allowed) => allowed.ratio === ratioValue);
};

const isRatioParam = (param: GenerationParam) => {
	if (param.type !== "select" || !param.options?.length) return false;
	return param.name === "aspectRatio" || param.name === "ratio";
};

const isResolutionParam = (param: GenerationParam) => {
	if (param.type !== "select" || !param.options?.length) return false;
	return (
		param.name === "resolution" || param.name === "resolutionType" || param.name === "imageSize"
	);
};

const selectedParamValue = (param: GenerationParam, values: Record<string, unknown>) => {
	const rawValue = values[param.name] ?? param.default ?? param.options?.[0]?.value ?? "";
	return String(rawValue);
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
		const kiloMatch = value.match(/([1-9])\s*k/i);
		if (kiloMatch) return `${kiloMatch[1]}K`;

		const verticalPixelsMatch = value.match(/([1-9]\d{2,3})\s*p/i);
		if (verticalPixelsMatch) return `${verticalPixelsMatch[1]}p`;
	}

	return undefined;
};

const uniqueSpecOptions = (options: SpecOption[]) => {
	const seen = new Set<string>();
	const result: SpecOption[] = [];
	for (const option of options) {
		const key = option.smart
			? "smart"
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

const preferredRatioOrder = ["smart", "21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"];

const orderRatioOptions = (options: SpecOption[]) =>
	[...options].sort((left, right) => {
		const leftKey = left.smart ? "smart" : (left.ratio ?? left.label);
		const rightKey = right.smart ? "smart" : (right.ratio ?? right.label);
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

const inferSizePreview = (
	ratio: SpecOption | null,
	resolution: SpecOption | null,
	combo?: SplitCombo,
) => {
	if (ratio?.width && ratio.height) return { height: ratio.height, width: ratio.width };
	if (resolution?.width && resolution.height) {
		return { height: resolution.height, width: resolution.width };
	}
	if (!ratio?.ratio || !resolution?.resolution) return null;

	const exactPreview = comboOutputSizePreview(combo, ratio.value, resolution.value);
	if (exactPreview) return exactPreview;

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

const comboOutputSizePreview = (
	combo: SplitCombo | undefined,
	ratioValue: string,
	resolutionValue: string,
) => {
	const output = combo?.outputs?.[`${ratioValue}|${resolutionValue}`];
	if (!output) return null;

	const match = output.match(/^(\d+)x(\d+)$/i);
	if (!match) return null;

	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return null;
	}

	return { width, height };
};

const resolutionBasePixels = (resolution: string) => {
	const match = resolution.match(/^([1-9])K$/i);
	if (!match) return undefined;

	return Number(match[1]) * 1024;
};

const isPresent = <T>(value: T | null | undefined): value is T =>
	value !== null && value !== undefined;
