import type { GenerationParam, GenerationRoute } from "@/domains/generation/api/generation";
import {
	filterImageGenerationSpecParams,
	resolveImageGenerationSpec,
	type ImageGenerationSpec,
	type ImageGenerationSpecContext,
} from "@/domains/generation/components/imageGenerationSpec";
import {
	resolveParamGroups,
	type ResolvedParamGroup,
} from "@/domains/generation/components/mediaGenerationHelpers";

export interface ResolvedGenerationRouteParamControls {
	countGroupParams: GenerationParam[];
	generationCountParam: GenerationParam | null;
	imageSpec: ImageGenerationSpec | null;
	primaryParamGroups: ResolvedParamGroup[];
	routeParamGroups: ResolvedParamGroup[];
	secondaryRouteParams: GenerationParam[];
	sizeGroupParams: GenerationParam[];
}

// resolveGenerationRouteParamControls is the shared presentation contract for
// route-schema parameters. Both the batch dialog and Agent confirmation card
// use it so every schema parameter is rendered by the same kind of control.
export const resolveGenerationRouteParamControls = (
	route: GenerationRoute,
	selectedParams: Record<string, unknown>,
	context?: ImageGenerationSpecContext,
): ResolvedGenerationRouteParamControls => {
	const routeParamGroups = routeParamGroupsIncludingUngroupedParams(route);
	const sizeGroupParams = routeParamGroups.find((group) => group.id === "size")?.params ?? [];
	const countGroupParams = routeParamGroups.find((group) => group.id === "count")?.params ?? [];
	const otherParamGroup = routeParamGroups.find((group) => group.id === "other") ?? null;
	const imageSpec = resolveImageGenerationSpec(
		sizeGroupParams,
		selectedParams,
		route.paramCombos,
		context,
	);
	const generationCountParam =
		countGroupParams.find((param) => param.name === "n" && param.type === "number") ?? null;
	const primaryParamGroups = routeParamGroups.filter(
		(group) =>
			group.id !== "size" &&
			group.id !== "count" &&
			group.id !== "other" &&
			group.params.length === 1 &&
			group.params[0]?.type === "select",
	);
	const renderedPrimaryParamNames = new Set(imageSpec?.controlledParamNames ?? []);
	if (generationCountParam) renderedPrimaryParamNames.add(generationCountParam.name);
	for (const group of primaryParamGroups) {
		const param = group.params[0];
		if (param) renderedPrimaryParamNames.add(param.name);
	}
	const secondaryRouteParams = filterImageGenerationSpecParams(
		[
			...(otherParamGroup?.params ?? []),
			...routeParamGroups.flatMap((group) =>
				group.id === "other"
					? []
					: group.params.filter((param) => !renderedPrimaryParamNames.has(param.name)),
			),
		],
		imageSpec,
	);

	return {
		countGroupParams,
		generationCountParam,
		imageSpec,
		primaryParamGroups,
		routeParamGroups,
		secondaryRouteParams,
		sizeGroupParams,
	};
};

const routeParamGroupsIncludingUngroupedParams = (route: GenerationRoute): ResolvedParamGroup[] => {
	const groups = resolveParamGroups(route);
	const groupedNames = new Set(groups.flatMap((group) => group.params.map((param) => param.name)));
	const ungroupedParams = route.params.filter((param) => !groupedNames.has(param.name));
	if (ungroupedParams.length === 0) return groups;

	const otherGroup = groups.find((group) => group.id === "other");
	if (!otherGroup) {
		return [...groups, { id: "other", label: "其他", params: ungroupedParams }];
	}

	return groups.map((group) =>
		group.id === "other" ? { ...group, params: [...group.params, ...ungroupedParams] } : group,
	);
};
