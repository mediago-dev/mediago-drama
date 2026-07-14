import { LoaderCircle } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { generationModelsKey, getGenerationModels } from "@/domains/generation/api/generation";
import {
	GenerationBrandMark,
	generationFamilyBrand,
} from "@/domains/generation/components/GenerationBrandMark";
import { displayGenerationLabelWithoutAlias } from "@/domains/generation/components/generationDisplayLabels";
import { GenerationModelRoutePicker } from "@/domains/generation/components/GenerationModelRoutePicker";
import { resolveGenerationRouteParamControls } from "@/domains/generation/components/generationRouteParamControls";
import { ImageGenerationSpecControl } from "@/domains/generation/components/ImageGenerationSpecControl";
import {
	GenerationCountControl,
	PrimaryParamControl,
	SecondaryParamSettings,
} from "@/domains/generation/components/MediaGenerationDialogs";
import { isConfiguredRoute } from "@/domains/generation/hooks/generationCatalog";
import { useGenerationCountControl } from "@/domains/generation/components/useGenerationCountControl";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/shared/components/ui/select";
import {
	normalizeGenerationParamsValue,
	resolveGenerationRoute,
	type GenerationParamsFieldValue,
} from "./agentFormGenerationParams.helpers";

// AgentFormGenerationParams renders the composite `generation_params` form
// field: the configured model catalog for the field's kind (image by default,
// or video/audio) — family → model → provider — plus the selected route's
// complete schema-driven parameter controls, mirroring the batch generation
// dialog. It submits {routeId, label, params}.
export const AgentFormGenerationParams: React.FC<{
	value: unknown;
	kind?: "image" | "video" | "audio";
	disabled: boolean;
	onChange: (value: GenerationParamsFieldValue) => void;
}> = ({ value, kind = "image", disabled, onChange }) => {
	const { data: catalog } = useSWR(generationModelsKey, getGenerationModels);

	const kindRoutes = (catalog?.routes ?? []).filter(
		(route) => route.kind === kind && isConfiguredRoute(route),
	);
	const resolved = catalog ? resolveGenerationRoute(catalog, kindRoutes, value) : null;

	// The spec control reports combo corrections as consecutive onChange calls
	// (ratio, then adjusted resolution); accumulate them against the latest
	// params instead of the render-time snapshot so no update is lost.
	const paramsRef = useRef<Record<string, unknown>>({});
	paramsRef.current = resolved?.value.params ?? {};
	const routeParamControls = resolved
		? resolveGenerationRouteParamControls(resolved.route, resolved.value.params)
		: null;
	const patchParam = useCallback(
		(name: string, paramValue: unknown) => {
			if (!catalog || !resolved) return;
			const nextParams = { ...paramsRef.current, [name]: paramValue };
			paramsRef.current = nextParams;
			onChange(normalizeGenerationParamsValue(catalog, resolved.route, nextParams));
		},
		[catalog, onChange, resolved],
	);
	const { generationCountControl } = useGenerationCountControl({
		hasConfiguredRoutesForKind: Boolean(resolved),
		onParamChange: patchParam,
		params: routeParamControls?.countGroupParams ?? [],
		selectedParams: resolved?.value.params ?? {},
	});

	// Keep the form value complete and valid: normalize whatever the agent (or
	// a previous route) left in the value as soon as the catalog is available.
	const normalizedJSON = resolved ? JSON.stringify(resolved.value) : null;
	const valueJSON = JSON.stringify(value ?? null);
	useEffect(() => {
		if (!resolved || !normalizedJSON || normalizedJSON === valueJSON) return;
		onChange(resolved.value);
	}, [normalizedJSON, onChange, resolved, valueJSON]);

	if (!catalog) {
		return (
			<p className="flex items-center gap-1.5 text-muted-foreground">
				<LoaderCircle className="size-3 animate-spin" />
				正在加载模型目录…
			</p>
		);
	}
	if (!resolved || !routeParamControls) {
		const kindLabel = kind === "video" ? "视频" : kind === "audio" ? "音频" : "生图";
		return (
			<p className="text-muted-foreground">
				当前没有可用的{kindLabel}模型，请先在设置中配置供应商。
			</p>
		);
	}

	const { route, family, families, familyRoutes, versions, version } = resolved;
	const { imageSpec, primaryParamGroups, secondaryRouteParams } = routeParamControls;

	const selectFamily = (familyId: string) => {
		if (familyId === family.id) return;
		const nextRoute = familyRoutes.get(familyId)?.[0];
		if (!nextRoute) return;
		onChange(normalizeGenerationParamsValue(catalog, nextRoute, {}));
	};
	const selectRoute = (_versionId: string, routeId: string) => {
		const nextRoute = kindRoutes.find((candidate) => candidate.id === routeId);
		if (!nextRoute || nextRoute.id === route.id) return;
		// Carry the current selections over; normalization drops what the new
		// route does not support and re-applies its defaults.
		onChange(normalizeGenerationParamsValue(catalog, nextRoute, paramsRef.current));
	};

	return (
		<fieldset disabled={disabled} className="m-0 grid min-w-0 gap-2 border-0 p-0">
			<div className="flex flex-wrap items-center gap-1.5">
				<Select value={family.id} onValueChange={selectFamily} disabled={disabled}>
					<SelectTrigger
						aria-label="模型名称"
						className="h-7 w-auto gap-1.5 rounded-sm border-border bg-background px-2.5 text-xs font-medium shadow-none"
					>
						<GenerationBrandMark
							brand={generationFamilyBrand(family)}
							className="size-4 text-[0.5rem]"
						/>
						<span>{displayGenerationLabelWithoutAlias(family.label)}</span>
					</SelectTrigger>
					<SelectContent align="start">
						{families.map((item) => (
							<SelectItem
								key={item.id}
								value={item.id}
								textValue={displayGenerationLabelWithoutAlias(item.label)}
							>
								<span className="flex min-w-0 items-center gap-2">
									<GenerationBrandMark
										brand={generationFamilyBrand(item)}
										className="size-4 text-[0.5rem]"
									/>
									<span className="min-w-0 truncate">
										{displayGenerationLabelWithoutAlias(item.label)}
									</span>
								</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<GenerationModelRoutePicker
					routes={familyRoutes.get(family.id) ?? []}
					selectedRoute={route}
					selectedVersion={version}
					versions={versions}
					onSelect={selectRoute}
					disabled={disabled}
				/>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				{generationCountControl ? <GenerationCountControl {...generationCountControl} /> : null}
				{imageSpec ? (
					<ImageGenerationSpecControl
						label={kind === "video" ? "视频大小" : "图片大小"}
						showSizePreview={kind === "image"}
						spec={imageSpec}
						onChange={patchParam}
					/>
				) : null}
				{primaryParamGroups.map((group) => {
					const param = group.params[0];
					if (!param) return null;

					return (
						<PrimaryParamControl
							key={`${group.id}:${param.name}`}
							label={group.label}
							param={param}
							value={resolved.value.params[param.name]}
							onChange={(paramValue) => patchParam(param.name, paramValue)}
						/>
					);
				})}
			</div>
			{secondaryRouteParams.length > 0 ? (
				<SecondaryParamSettings
					className="border-t border-border/70 pt-2"
					params={secondaryRouteParams}
					values={resolved.value.params}
					onChange={patchParam}
				/>
			) : null}
		</fieldset>
	);
};

export type { GenerationParamsFieldValue };
