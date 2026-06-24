import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
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
	const routesByVersion = useMemo(() => {
		const grouped = new Map<string, GenerationRoute[]>();
		for (const route of routes) {
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
	const selectedProvider = providerLabel(selectedRoute.provider);
	const selectedLabel = selectedVersion.label
		? `${compactLabel(selectedVersion.label)} · ${selectedProvider}`
		: selectedRoute.model;
	const selectedModelBrand = generationModelBrand({
		route: selectedRoute,
		version: selectedVersion,
	});
	const selectedProviderBrand = generationProviderBrand(selectedRoute.provider);

	useEffect(() => {
		setActiveVersionId(selectedVersion.id);
	}, [selectedVersion.id]);

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
				className="grid w-[min(var(--generation-model-popover-width),var(--generation-popover-max-inline))] grid-cols-2 overflow-hidden rounded-[var(--generation-popover-radius)] border-border bg-popover p-0 text-popover-foreground shadow-xl"
			>
				<section className="min-w-0 p-[var(--generation-popover-padding)]">
					<p className="mb-1.5 px-1 text-2xs font-semibold text-muted-foreground">模型</p>
					<div className="grid gap-1">
						{visibleVersions.map((version) => {
							const versionRoutes = routesByVersion.get(version.id) ?? [];
							const selected = version.id === activeVersion?.id;
							const versionBrand = generationVersionBrand(version, versionRoutes[0]);

							return (
								<button
									key={version.id}
									type="button"
									className={cn(
										"flex h-[var(--generation-model-popover-option-height)] min-w-0 items-center gap-1.5 rounded-[var(--generation-control-radius)] px-[var(--generation-control-padding-x)] text-left text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										selected
											? "bg-ide-list-active text-ide-list-active-foreground"
											: "text-foreground hover:bg-muted",
									)}
									onMouseEnter={() => setActiveVersionId(version.id)}
									onFocus={() => setActiveVersionId(version.id)}
									onClick={() => setActiveVersionId(version.id)}
								>
									<GenerationBrandMark
										brand={versionBrand}
										className="size-3.5 border-0 bg-transparent p-0 text-[0.45rem] shadow-none"
									/>
									<span className="min-w-0 flex-1 truncate">{version.label}</span>
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
				</section>
				<section className="min-w-0 border-l border-border bg-muted/40 p-[var(--generation-popover-padding)]">
					<p className="mb-1.5 px-1 text-2xs font-semibold text-muted-foreground">提供方</p>
					<div className="grid gap-1">
						{activeRoutes.map((route) => {
							const selected = route.id === selectedRoute.id;

							return (
								<button
									key={route.id}
									type="button"
									disabled={disabled || route.status !== "available"}
									className={cn(
										"flex h-[var(--generation-model-popover-option-height)] min-w-0 items-center gap-1.5 rounded-[var(--generation-control-radius)] px-[var(--generation-control-padding-x)] text-left text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45",
										selected
											? "bg-ide-list-active text-ide-list-active-foreground"
											: "text-foreground hover:bg-card",
									)}
									onClick={() => {
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
				</section>
			</PopoverContent>
		</Popover>
	);
};

const compactLabel = (label: string) => label.replace(/\s+/g, " ").trim();
