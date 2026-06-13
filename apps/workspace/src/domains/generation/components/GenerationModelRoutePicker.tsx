import { Box, Check } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import type { GenerationRoute, GenerationVersion } from "@/domains/generation/api/generation";
import { providerLabel } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { Button } from "@/shared/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

export const GenerationModelRoutePicker: React.FC<{
	className?: string;
	onSelect: (versionID: string, routeID: string) => void;
	routes: GenerationRoute[];
	selectedRoute: GenerationRoute;
	selectedVersion: GenerationVersion;
	versions: GenerationVersion[];
}> = ({ className, onSelect, routes, selectedRoute, selectedVersion, versions }) => {
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
	const selectedProvider = providerLabel(selectedRoute.provider);
	const selectedLabel = selectedVersion.label
		? `${compactLabel(selectedVersion.label)} · ${selectedProvider}`
		: selectedRoute.model;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					aria-label="模型版本和供应商"
					className={cn(
						"h-9 w-auto max-w-72 justify-start rounded-md border-border bg-ide-editor px-3 text-xs font-medium shadow-none hover:bg-ide-list-hover",
						className,
					)}
				>
					<Box className="size-4 shrink-0" />
					<span className="min-w-0 truncate">{selectedLabel}</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="top" align="start" className="w-64">
				{visibleVersions.map((version) => {
					const versionRoutes = routesByVersion.get(version.id) ?? [];
					const isSelectedVersion = version.id === selectedVersion.id;

					return (
						<DropdownMenuSub key={version.id}>
							<DropdownMenuSubTrigger className="gap-2">
								<span className="flex size-4 shrink-0 items-center justify-center">
									{isSelectedVersion ? <Check className="size-4" /> : null}
								</span>
								<span className="min-w-0 flex-1 truncate">{version.label}</span>
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent sideOffset={6} className="w-48">
								{versionRoutes.map((route) => {
									const selected = route.id === selectedRoute.id;

									return (
										<DropdownMenuItem
											key={route.id}
											disabled={route.status !== "available"}
											className="gap-2"
											onSelect={() => onSelect(version.id, route.id)}
										>
											<span className="flex size-4 shrink-0 items-center justify-center">
												{selected ? <Check className="size-4" /> : null}
											</span>
											<span className="min-w-0 truncate">{providerLabel(route.provider)}</span>
										</DropdownMenuItem>
									);
								})}
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

const compactLabel = (label: string) => label.replace(/\s+/g, " ").trim();
