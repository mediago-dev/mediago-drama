import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GenerationRoute, GenerationVersion } from "@/domains/generation/api/generation";
import {
	GenerationBrandMark,
	GenerationBrandStack,
	generationModelBrand,
	generationProviderBrand,
	generationVersionBrand,
} from "@/domains/generation/components/GenerationBrandMark";
import { providerLabel } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";
import {
	type CascadedPickerSafeTriangleInput,
	scrollCascadedPickerListOnWheel,
	shouldKeepCascadedPickerSourceActive,
	useCascadedPickerHoverIntent,
} from "./cascadedPickerSafeTriangle";
import { displayGenerationLabelWithoutAlias } from "./generationDisplayLabels";

export const GenerationModelRoutePicker: React.FC<{
	className?: string;
	disabled?: boolean;
	onSelect: (versionID: string, routeID: string) => void;
	routes: GenerationRoute[];
	selectedRoute: GenerationRoute;
	selectedVersion: GenerationVersion;
	versions: GenerationVersion[];
}> = ({
	className,
	disabled = false,
	onSelect,
	routes,
	selectedRoute,
	selectedVersion,
	versions,
}) => {
	const [open, setOpen] = useState(false);
	const [activeVersionId, setActiveVersionId] = useState(selectedVersion.id);
	const versionListRef = useRef<HTMLDivElement | null>(null);
	const routeListRef = useRef<HTMLDivElement | null>(null);
	const [versionListCanScrollDown, setVersionListCanScrollDown] = useState(false);
	const [routeListCanScrollDown, setRouteListCanScrollDown] = useState(false);
	const routesByVersion = useMemo(() => {
		const grouped = new Map<string, GenerationRoute[]>();
		for (const route of routes) {
			if (route.status !== "available" || route.configured === false) {
				continue;
			}
			const existing = grouped.get(route.versionId);
			if (existing) {
				existing.push(route);
				continue;
			}
			grouped.set(route.versionId, [route]);
		}
		return grouped;
	}, [routes]);
	const visibleVersions = useMemo(
		() => versions.filter((version) => (routesByVersion.get(version.id)?.length ?? 0) > 0),
		[routesByVersion, versions],
	);
	const activeVersion =
		visibleVersions.find((version) => version.id === activeVersionId) ??
		visibleVersions.find((version) => version.id === selectedVersion.id) ??
		visibleVersions[0];
	const activeRoutes = activeVersion ? (routesByVersion.get(activeVersion.id) ?? []) : [];
	const {
		activateSource: activateVersion,
		clearHoverIntent,
		handleSourcePanePointerEnter,
		handleSourcePointerEnter,
		handleSourcePointerMove,
		handleSubmenuPointerLeave,
		registerSourceButton,
		sourcePaneRef,
		submenuRef: routePanelRef,
		suppressedSourceHoverId: suppressedVersionHoverId,
	} = useCascadedPickerHoverIntent({
		activeSourceId: activeVersion?.id,
		forwardDelayMs: GENERATION_ROUTE_PICKER_SAFE_TRIANGLE_HOVER_INTENT_MS,
		onActivateSource: setActiveVersionId,
	});
	const selectedProvider = providerLabel(selectedRoute.provider);
	const selectedVersionLabel = displayGenerationLabelWithoutAlias(selectedVersion.label);
	const selectedLabel = selectedVersion.label
		? `${selectedVersionLabel} · ${selectedProvider}`
		: selectedRoute.model;
	const selectedModelBrand = generationModelBrand({
		route: selectedRoute,
		version: selectedVersion,
	});
	const selectedProviderBrand = generationProviderBrand(selectedRoute.provider);
	const routePickerMenuStyle = {
		"--generation-route-picker-menu-height": generationModelRoutePickerMenuHeight(),
	} as React.CSSProperties;

	useEffect(() => {
		setActiveVersionId(selectedVersion.id);
	}, [selectedVersion.id]);

	const updateVersionListScrollHint = useCallback(() => {
		setVersionListCanScrollDown(canShowGenerationRoutePickerScrollHint(versionListRef.current));
	}, []);

	const updateRouteListScrollHint = useCallback(() => {
		setRouteListCanScrollDown(canShowGenerationRoutePickerScrollHint(routeListRef.current));
	}, []);

	const handleVersionListWheel = useCallback(
		(event: React.WheelEvent<HTMLDivElement>) => {
			scrollCascadedPickerListOnWheel(event, updateVersionListScrollHint);
		},
		[updateVersionListScrollHint],
	);

	const handleRouteListWheel = useCallback(
		(event: React.WheelEvent<HTMLDivElement>) => {
			scrollCascadedPickerListOnWheel(event, updateRouteListScrollHint);
		},
		[updateRouteListScrollHint],
	);

	useEffect(() => {
		if (!open) {
			setVersionListCanScrollDown(false);
			setRouteListCanScrollDown(false);
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			if (versionListRef.current) {
				versionListRef.current.scrollTop = 0;
			}
			updateVersionListScrollHint();
			updateRouteListScrollHint();
		});
		return () => window.cancelAnimationFrame(frame);
	}, [open, updateRouteListScrollHint, updateVersionListScrollHint, visibleVersions.length]);

	useEffect(() => {
		if (!open) return;
		const frame = window.requestAnimationFrame(() => {
			if (routeListRef.current) {
				routeListRef.current.scrollTop = 0;
			}
			updateRouteListScrollHint();
		});
		return () => window.cancelAnimationFrame(frame);
	}, [activeVersion?.id, activeRoutes.length, open, updateRouteListScrollHint]);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					aria-label="模型版本和供应商"
					disabled={disabled}
					className={cn(
						"h-[var(--generation-control-height)] w-auto max-w-56 justify-start rounded-[var(--generation-control-radius)] border-0 bg-muted px-[var(--generation-control-padding-x)] text-2xs font-semibold text-foreground shadow-none hover:bg-ide-list-hover",
						open && "bg-ide-list-active text-ide-list-active-foreground",
						className,
					)}
				>
					<GenerationBrandStack
						modelBrand={selectedModelBrand}
						providerBrand={selectedProviderBrand}
					/>
					<span className="min-w-0 truncate">{selectedLabel}</span>
					<ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="start"
				aria-label="模型版本和供应商"
				className="grid h-[var(--generation-route-picker-menu-height)] max-h-[var(--generation-popover-max-block)] w-fit max-w-[var(--generation-popover-max-inline)] grid-cols-[fit-content(var(--generation-model-popover-version-column-max-width))_minmax(var(--generation-model-popover-provider-column-min-width),max-content)] overflow-hidden rounded-[var(--generation-popover-radius)] border-border bg-popover p-0 text-popover-foreground shadow-xl"
				style={routePickerMenuStyle}
				onPointerLeave={clearHoverIntent}
			>
				<section
					ref={sourcePaneRef}
					className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-[var(--generation-popover-padding)]"
					onPointerEnter={handleSourcePanePointerEnter}
				>
					<p className="mb-1.5 px-1 text-2xs font-semibold text-muted-foreground">模型</p>
					<div className="relative min-h-0 flex-1 overflow-hidden">
						<div
							ref={versionListRef}
							className="grid h-full min-h-0 auto-rows-min gap-1 overflow-y-auto overscroll-contain pr-1"
							data-generation-version-list
							onScroll={updateVersionListScrollHint}
							onWheel={handleVersionListWheel}
						>
							{visibleVersions.map((version) => {
								const versionRoutes = routesByVersion.get(version.id) ?? [];
								const selected = version.id === activeVersion?.id;
								const versionBrand = generationVersionBrand(version, versionRoutes[0]);
								const suppressHover = version.id === suppressedVersionHoverId;
								const versionLabel = displayGenerationLabelWithoutAlias(version.label);

								return (
									<button
										key={version.id}
										type="button"
										ref={(node) => registerSourceButton(version.id, node)}
										className={cn(
											"flex h-[var(--generation-model-popover-option-height)] min-w-0 items-center gap-1.5 rounded-[var(--generation-control-radius)] px-[var(--generation-control-padding-x)] text-left text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
											selected
												? "bg-ide-list-active text-ide-list-active-foreground"
												: suppressHover
													? "text-foreground"
													: "text-foreground hover:bg-muted",
										)}
										onPointerEnter={(event) => handleSourcePointerEnter(version.id, event)}
										onPointerMove={(event) => handleSourcePointerMove(version.id, event)}
										onFocus={() => activateVersion(version.id)}
										onClick={() => activateVersion(version.id)}
									>
										<GenerationBrandMark
											brand={versionBrand}
											className="size-3.5 border-0 bg-transparent p-0 text-[0.45rem] shadow-none"
										/>
										<span className="min-w-0 flex-1 truncate">{versionLabel}</span>
										<ChevronRight
											className={cn(
												"size-4 shrink-0",
												selected ? "text-primary" : "text-muted-foreground",
											)}
										/>
									</button>
								);
							})}
						</div>
						{versionListCanScrollDown ? (
							<div
								aria-hidden="true"
								className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-popover/95 via-popover/70 to-popover/0"
								data-generation-version-scroll-hint
							/>
						) : null}
					</div>
				</section>
				<section
					ref={routePanelRef}
					className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-muted/40 p-[var(--generation-popover-padding)]"
					onPointerEnter={clearHoverIntent}
					onPointerLeave={handleSubmenuPointerLeave}
				>
					<p className="mb-1.5 px-1 text-2xs font-semibold text-muted-foreground">提供方</p>
					<div className="relative min-h-0 flex-1 overflow-hidden">
						<div
							ref={routeListRef}
							className="grid h-full min-h-0 auto-rows-min gap-1 overflow-y-auto overscroll-contain pr-1"
							data-generation-route-list
							onScroll={updateRouteListScrollHint}
							onWheel={handleRouteListWheel}
						>
							{activeRoutes.map((route) => {
								const selected = route.id === selectedRoute.id;

								return (
									<button
										key={route.id}
										type="button"
										disabled={disabled}
										className={cn(
											"flex h-[var(--generation-model-popover-option-height)] min-w-0 items-center gap-1.5 rounded-[var(--generation-control-radius)] px-[var(--generation-control-padding-x)] text-left text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45",
											selected
												? "bg-ide-list-active text-ide-list-active-foreground"
												: "text-foreground hover:bg-card",
										)}
										onClick={() => {
											if (disabled) return;
											if (!activeVersion) return;

											onSelect(activeVersion.id, route.id);
											setOpen(false);
										}}
									>
										<GenerationBrandMark
											brand={generationProviderBrand(route.provider)}
											className="size-3.5 border-0 bg-transparent p-0 text-[0.45rem] shadow-none"
										/>
										<span className="min-w-0 flex-1 truncate">{providerLabel(route.provider)}</span>
										{selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
									</button>
								);
							})}
						</div>
						{routeListCanScrollDown ? (
							<div
								aria-hidden="true"
								className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-muted/95 via-muted/70 to-muted/0"
								data-generation-route-scroll-hint
							/>
						) : null}
					</div>
				</section>
			</PopoverContent>
		</Popover>
	);
};

const GENERATION_ROUTE_PICKER_SAFE_TRIANGLE_HOVER_INTENT_MS = 180;
const GENERATION_ROUTE_PICKER_MAX_VISIBLE_ROWS = 5;
const GENERATION_ROUTE_PICKER_SCROLL_HINT_MIN_REMAINING_PX = 8;

const generationModelRoutePickerMenuHeight = () => {
	const gapCount = Math.max(GENERATION_ROUTE_PICKER_MAX_VISIBLE_ROWS - 1, 0);
	return `calc(var(--generation-popover-padding) * 2 + 1.25rem + ${GENERATION_ROUTE_PICKER_MAX_VISIBLE_ROWS} * var(--generation-model-popover-option-height) + ${gapCount} * 0.25rem)`;
};

const canShowGenerationRoutePickerScrollHint = (node: HTMLElement | null) => {
	if (!node) return false;

	const maxScrollTop = node.scrollHeight - node.clientHeight;
	if (maxScrollTop <= GENERATION_ROUTE_PICKER_SCROLL_HINT_MIN_REMAINING_PX) return false;

	const remainingScroll = maxScrollTop - node.scrollTop;
	if (remainingScroll <= GENERATION_ROUTE_PICKER_SCROLL_HINT_MIN_REMAINING_PX) return false;

	const lastOption = Array.from(node.children)
		.filter((child): child is HTMLElement => child instanceof HTMLElement)
		.at(-1);
	if (!lastOption || lastOption.offsetHeight <= 0) return true;

	const visibleBottom = node.scrollTop + node.clientHeight;
	const lastOptionBottom = lastOption.offsetTop + lastOption.offsetHeight;
	return lastOptionBottom - visibleBottom > GENERATION_ROUTE_PICKER_SCROLL_HINT_MIN_REMAINING_PX;
};

export const shouldKeepGenerationRoutePickerVersionActive = (
	input: CascadedPickerSafeTriangleInput,
) => shouldKeepCascadedPickerSourceActive(input);
