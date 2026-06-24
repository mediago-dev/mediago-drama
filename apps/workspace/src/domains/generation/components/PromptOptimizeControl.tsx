import { ChevronDown, Loader2, Wand2 } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import {
	generationComposerSelectClassName,
	generationComposerToolbarButtonClassName,
} from "@/domains/generation/components/GenerationComposerPanel";
import {
	GenerationBrandMark,
	generationFamilyBrand,
	generationModelBrand,
} from "@/domains/generation/components/GenerationBrandMark";
import { GenerationModelRoutePicker } from "@/domains/generation/components/GenerationModelRoutePicker";
import { PromptOptimizePicker } from "@/domains/generation/components/PromptOptimizePicker";
import type { PromptInsertItem } from "@/domains/generation/components/PromptSlashCommand";
import type { PromptOptimizeModelOption } from "@/domains/generation/hooks/usePromptOptimize";
import { preferredRoute } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

export interface PromptOptimizeControlProps {
	canOptimize: boolean;
	disabled?: boolean;
	isOptimizing: boolean;
	items: PromptInsertItem[];
	modelOptions: PromptOptimizeModelOption[];
	onSelect: (item: PromptInsertItem) => void;
	onSelectModel: (routeId: string) => void;
	selectedModelRouteId?: string | null;
}

export const PromptOptimizeControl: React.FC<PromptOptimizeControlProps> = ({
	canOptimize,
	disabled = false,
	isOptimizing,
	items,
	modelOptions,
	onSelect,
	onSelectModel,
	selectedModelRouteId,
}) => {
	const [open, setOpen] = useState(false);
	const unavailable = disabled || isOptimizing;
	const selectedModelOption =
		modelOptions.find((option) => option.id === selectedModelRouteId) ?? modelOptions[0] ?? null;
	const modelFamilies = useMemo(() => uniquePromptOptimizeFamilies(modelOptions), [modelOptions]);
	const selectedFamily =
		modelFamilies.find((family) => family.id === selectedModelOption?.family.id) ??
		modelFamilies[0] ??
		null;
	const selectedFamilyOptions = useMemo(
		() =>
			selectedFamily ? modelOptions.filter((option) => option.family.id === selectedFamily.id) : [],
		[modelOptions, selectedFamily],
	);
	const selectedFamilyRoutes = useMemo(
		() => selectedFamilyOptions.map((option) => option.route),
		[selectedFamilyOptions],
	);
	const selectedFamilyVersions = useMemo(
		() => uniquePromptOptimizeVersions(selectedFamilyOptions),
		[selectedFamilyOptions],
	);
	const selectedRoute =
		selectedFamilyRoutes.find((route) => route.id === selectedModelOption?.route.id) ??
		preferredRoute(selectedFamilyRoutes) ??
		selectedFamilyRoutes[0] ??
		null;
	const selectedVersion =
		selectedFamilyVersions.find((version) => version.id === selectedRoute?.versionId) ??
		selectedFamilyVersions[0] ??
		null;
	const modelSelectorDisabled = modelOptions.length === 0 || isOptimizing;

	const selectFamily = (familyId: string) => {
		const routes = modelOptions
			.filter((option) => option.family.id === familyId)
			.map((option) => option.route);
		const route = preferredRoute(routes) ?? routes[0];
		if (route) onSelectModel(route.id);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					aria-label="优化提示词"
					title={canOptimize ? "优化提示词" : "选择提示词包"}
					disabled={unavailable}
					className={cn(
						generationComposerToolbarButtonClassName(),
						open && "bg-ide-list-active text-ide-list-active-foreground",
					)}
				>
					{isOptimizing ? (
						<Loader2 className="size-4 animate-spin text-primary" />
					) : (
						<Wand2 className="size-4 text-primary" />
					)}
					<span>优化提示词</span>
					<ChevronDown className="size-3.5 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="end"
				aria-label="提示词包"
				className="w-[min(26rem,var(--generation-popover-max-inline))] overflow-hidden rounded-[var(--generation-popover-radius)] border-border bg-popover p-[var(--generation-popover-padding)] text-popover-foreground shadow-xl"
				style={{
					maxHeight:
						"min(30rem, calc(var(--radix-popover-content-available-height, 30rem) - 0.5rem))",
				}}
			>
				<div className="mb-[var(--generation-popover-gap)] flex min-w-0 items-center gap-2">
					<span className="shrink-0 text-2xs font-semibold text-muted-foreground">优化模型</span>
					{selectedFamily && selectedRoute && selectedVersion ? (
						<div className="flex min-w-0 flex-1 items-center gap-2">
							<Select
								value={selectedFamily.id}
								disabled={modelSelectorDisabled}
								onValueChange={selectFamily}
							>
								<SelectTrigger
									aria-label="优化模型名称"
									className={generationComposerSelectClassName("min-w-28 max-w-36 shrink-0")}
								>
									<GenerationBrandMark
										brand={generationFamilyBrand(selectedFamily)}
										className="size-4 text-[0.5rem]"
									/>
									<span>{selectedFamily.label}</span>
								</SelectTrigger>
								<SelectContent align="start">
									{modelFamilies.map((family) => (
										<SelectItem key={family.id} value={family.id} textValue={family.label}>
											<span className="flex min-w-0 items-center gap-2">
												<GenerationBrandMark
													brand={generationFamilyBrand(family)}
													className="size-4 text-[0.5rem]"
												/>
												<span className="min-w-0 truncate">{family.label}</span>
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<GenerationModelRoutePicker
								className="min-w-0 max-w-none flex-1"
								disabled={modelSelectorDisabled}
								routes={selectedFamilyRoutes}
								selectedRoute={selectedRoute}
								selectedVersion={selectedVersion}
								versions={selectedFamilyVersions}
								onSelect={(_versionId, routeId) => onSelectModel(routeId)}
							/>
						</div>
					) : (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled
							className={generationComposerSelectClassName("min-w-0 flex-1 justify-start")}
						>
							<GenerationBrandMark
								brand={generationModelBrand({})}
								className="size-4 text-[0.5rem]"
							/>
							<span>无可用文本模型</span>
						</Button>
					)}
				</div>
				<PromptOptimizePicker
					items={items}
					onSelect={(item) => {
						onSelect(item);
						setOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
};

const uniquePromptOptimizeFamilies = (options: PromptOptimizeModelOption[]) => {
	const families = new Map<string, PromptOptimizeModelOption["family"]>();
	for (const option of options) {
		if (!families.has(option.family.id)) families.set(option.family.id, option.family);
	}
	return Array.from(families.values());
};

const uniquePromptOptimizeVersions = (options: PromptOptimizeModelOption[]) => {
	const versions = new Map<string, PromptOptimizeModelOption["version"]>();
	for (const option of options) {
		if (!versions.has(option.version.id)) versions.set(option.version.id, option.version);
	}
	return Array.from(versions.values());
};
