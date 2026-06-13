import { useMemo } from "react";
import type { GenerationParam } from "@/domains/generation/api/generation";
import type { MediaGenerationCountControlConfig } from "@/domains/generation/components/MediaGenerationInputPanel";
import { clampNumber } from "@/domains/generation/components/mediaGenerationHelpers";

export const useGenerationCountControl = ({
	hasConfiguredRoutesForKind,
	onParamChange,
	params,
	selectedParams,
}: {
	hasConfiguredRoutesForKind: boolean;
	onParamChange: (name: string, value: unknown) => void;
	params: GenerationParam[];
	selectedParams: Record<string, unknown>;
}) => {
	const generationCountParam = useMemo(
		() =>
			hasConfiguredRoutesForKind
				? params.find((param) => param.name === "n" && param.type === "number")
				: undefined,
		[hasConfiguredRoutesForKind, params],
	);
	const generationCountMin = generationCountParam?.min ?? 1;
	const generationCountMax = generationCountParam?.max ?? 10;
	const generationCount = useMemo(() => {
		if (!generationCountParam) return 1;

		const rawValue = Number(selectedParams[generationCountParam.name]);
		const fallbackValue =
			typeof generationCountParam.default === "number" ? generationCountParam.default : 1;

		return clampNumber(
			Math.round(Number.isFinite(rawValue) ? rawValue : fallbackValue),
			generationCountMin,
			generationCountMax,
		);
	}, [generationCountMax, generationCountMin, generationCountParam, selectedParams]);
	const generationCountControl = useMemo<MediaGenerationCountControlConfig | null>(() => {
		if (!generationCountParam) return null;

		return {
			max: generationCountMax,
			min: generationCountMin,
			value: generationCount,
			onChange: (nextCount: number) => {
				onParamChange(
					generationCountParam.name,
					clampNumber(Math.round(nextCount), generationCountMin, generationCountMax),
				);
			},
		};
	}, [
		generationCount,
		generationCountMax,
		generationCountMin,
		generationCountParam,
		onParamChange,
	]);

	return {
		generationCountControl,
	};
};
