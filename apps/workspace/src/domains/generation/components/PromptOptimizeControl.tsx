import { ChevronDown, Loader2, Sparkles, Wand2 } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
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
import { displayGenerationLabelWithoutAlias } from "@/domains/generation/components/generationDisplayLabels";
import { PromptOptimizePicker } from "@/domains/generation/components/PromptOptimizePicker";
import type { PromptInsertItem } from "@/domains/generation/components/PromptSlashCommand";
import type { PromptOptimizeModelOption } from "@/domains/generation/hooks/usePromptOptimize";
import { preferredRoute } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

const codexModelValue = "__codex__";

export interface PromptOptimizeControlProps {
	canOptimize: boolean;
	canGenerate?: boolean;
	codexAvailable?: boolean;
	disabled?: boolean;
	isOptimizing: boolean;
	items: PromptInsertItem[];
	modelOptions: PromptOptimizeModelOption[];
	onOptimize: (item: PromptInsertItem) => void;
	onOptimizeAndSubmit: (item: PromptInsertItem) => void;
	onSelectModel: (routeId: string) => void;
	selectedModelRouteId?: string | null;
}

export const PromptOptimizeControl: React.FC<PromptOptimizeControlProps> = ({
	canOptimize,
	canGenerate = false,
	codexAvailable = false,
	disabled = false,
	isOptimizing,
	items,
	modelOptions,
	onOptimize,
	onOptimizeAndSubmit,
	onSelectModel,
	selectedModelRouteId,
}) => {
	const [open, setOpen] = useState(false);
	const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
	const unavailable = disabled || isOptimizing;
	const selectedItem = useMemo(
		() => items.find((item) => item.id === selectedItemId) ?? null,
		[items, selectedItemId],
	);
	const selectedModelOption =
		modelOptions.find((option) => option.id === selectedModelRouteId) ??
		(codexAvailable ? null : (modelOptions[0] ?? null));
	const codexSelected = codexAvailable && !selectedModelOption;
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
	const selectedFamilyLabel = selectedFamily
		? displayGenerationLabelWithoutAlias(selectedFamily.label)
		: "";
	const modelSelectorDisabled = (!codexAvailable && modelOptions.length === 0) || isOptimizing;

	const selectFamily = (familyId: string) => {
		if (familyId === codexModelValue) {
			onSelectModel("");
			return;
		}
		const routes = modelOptions
			.filter((option) => option.family.id === familyId)
			.map((option) => option.route);
		const route = preferredRoute(routes) ?? routes[0];
		if (route) onSelectModel(route.id);
	};
	useEffect(() => {
		if (selectedItemId && !items.some((item) => item.id === selectedItemId)) {
			setSelectedItemId(null);
		}
	}, [items, selectedItemId]);

	const runOptimize = () => {
		if (!selectedItem) return;
		onOptimize(selectedItem);
		setOpen(false);
	};

	const runOptimizeAndSubmit = () => {
		if (!selectedItem) return;
		onOptimizeAndSubmit(selectedItem);
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					aria-label="优化提示词"
					title={canOptimize ? "优化提示词" : "选择技能包"}
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
				aria-label="技能包"
				className="flex w-[min(26rem,var(--generation-popover-max-inline))] flex-col overflow-hidden rounded-[var(--generation-popover-radius)] border-border bg-popover p-[var(--generation-popover-padding)] text-popover-foreground shadow-xl"
				style={{
					maxHeight:
						"min(30rem, calc(var(--radix-popover-content-available-height, 30rem) - 0.5rem))",
				}}
			>
				<div className="mb-[var(--generation-popover-gap)] flex min-w-0 items-center gap-2">
					<span className="shrink-0 text-2xs font-semibold text-muted-foreground">优化模型</span>
					{codexSelected ? (
						<div className="flex min-w-0 flex-1 items-center gap-2">
							<Select
								value={codexModelValue}
								disabled={modelSelectorDisabled}
								onValueChange={selectFamily}
							>
								<SelectTrigger
									aria-label="优化模型名称"
									className={generationComposerSelectClassName("min-w-28 max-w-36 shrink-0")}
								>
									<GenerationBrandMark brand="openai" className="size-4 text-[0.5rem]" />
									<span>Codex</span>
								</SelectTrigger>
								<SelectContent align="start">
									<SelectItem value={codexModelValue} textValue="Codex">
										<span className="flex min-w-0 items-center gap-2">
											<GenerationBrandMark brand="openai" className="size-4 text-[0.5rem]" />
											<span>Codex</span>
										</span>
									</SelectItem>
									{modelFamilies.map((family) => (
										<SelectItem
											key={family.id}
											value={family.id}
											textValue={displayGenerationLabelWithoutAlias(family.label)}
										>
											<span className="flex min-w-0 items-center gap-2">
												<GenerationBrandMark
													brand={generationFamilyBrand(family)}
													className="size-4 text-[0.5rem]"
												/>
												<span className="min-w-0 truncate">
													{displayGenerationLabelWithoutAlias(family.label)}
												</span>
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled
								className={generationComposerSelectClassName("min-w-0 flex-1 justify-start")}
							>
								<GenerationBrandMark brand="openai" className="size-4 text-[0.5rem]" />
								<span>当前登录账户</span>
							</Button>
						</div>
					) : selectedFamily && selectedRoute && selectedVersion ? (
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
									<span>{selectedFamilyLabel}</span>
								</SelectTrigger>
								<SelectContent align="start">
									{codexAvailable ? (
										<SelectItem value={codexModelValue} textValue="Codex">
											<span className="flex min-w-0 items-center gap-2">
												<GenerationBrandMark brand="openai" className="size-4 text-[0.5rem]" />
												<span>Codex</span>
											</span>
										</SelectItem>
									) : null}
									{modelFamilies.map((family) => (
										<SelectItem
											key={family.id}
											value={family.id}
											textValue={displayGenerationLabelWithoutAlias(family.label)}
										>
											<span className="flex min-w-0 items-center gap-2">
												<GenerationBrandMark
													brand={generationFamilyBrand(family)}
													className="size-4 text-[0.5rem]"
												/>
												<span className="min-w-0 truncate">
													{displayGenerationLabelWithoutAlias(family.label)}
												</span>
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
						setSelectedItemId(item.id);
					}}
					selectedItemId={selectedItemId}
				/>
				{selectedItem ? (
					<div className="mt-[var(--generation-popover-gap)] flex shrink-0 flex-col gap-2 border-t border-border pt-[var(--generation-popover-gap)]">
						<p className="min-w-0 truncate text-2xs text-muted-foreground">
							已选择：<span className="font-semibold text-foreground">{selectedItem.name}</span>
						</p>
						<div className="flex min-w-0 items-center justify-end gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={unavailable}
								className="h-[var(--generation-control-height)] rounded-[var(--generation-control-radius)] border-0 bg-muted px-[var(--generation-control-padding-x)] text-2xs font-semibold text-foreground shadow-none hover:bg-ide-list-hover"
								onClick={runOptimize}
							>
								<Wand2 className="size-4 text-primary" />
								<span>优化</span>
							</Button>
							<Button
								type="button"
								size="sm"
								disabled={unavailable || !canGenerate}
								title={canGenerate ? "优化并生成" : "当前生成模型不可用"}
								className="h-[var(--generation-control-height)] rounded-[var(--generation-control-radius)] bg-primary px-[var(--generation-control-padding-x)] text-2xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
								onClick={runOptimizeAndSubmit}
							>
								<Sparkles className="size-4" />
								<span>优化并生成</span>
							</Button>
						</div>
					</div>
				) : null}
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
