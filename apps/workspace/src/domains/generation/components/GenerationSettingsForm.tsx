import {
	Check,
	ChevronDown,
	ChevronRight,
	Images,
	Library,
	Loader2,
	MessageSquarePlus,
	SlidersHorizontal,
	Sparkles,
	type LucideIcon,
	Wand2,
	X,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GenerationSettingsFormController } from "@/domains/generation/hooks/useGenerationSettingsForm";
import {
	kindLabel,
	paramLabel,
	routeProviderLabel,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { Badge } from "@/shared/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";
import { GenerationBrandMark, generationFamilyBrand } from "./GenerationBrandMark";
import { displayGenerationLabelWithoutAlias } from "./generationDisplayLabels";
import { GenerationModelRoutePicker } from "./GenerationModelRoutePicker";
import { ImageGenerationSpecControl } from "./ImageGenerationSpecControl";
import {
	GenerationCountControl,
	PrimaryParamControl,
	SecondaryParamSettings,
} from "./MediaGenerationDialogs";
import type { PromptInsertItem } from "./PromptSlashCommand";
import { ReferencePreviewStrip } from "./ReferencePreviewStrip";
import { ReferenceSelectionDialog, type ReferenceKindFilter } from "./ReferenceSelectionDialog";
import {
	type CascadedPickerPoint,
	pointerEventPoint,
	scrollCascadedPickerListOnWheel,
	shouldKeepCascadedPickerSourceActive,
} from "./cascadedPickerSafeTriangle";

export interface GenerationSettingsFormProps {
	controller: GenerationSettingsFormController;
	disabled?: boolean;
}

// GenerationSettingsForm is the shared, shell-free generation settings body.
// Modal titles, selected counts, footers and submit buttons stay with each adapter.
export const GenerationSettingsForm: React.FC<GenerationSettingsFormProps> = ({
	controller,
	disabled = false,
}) => {
	const effectiveDisabled = disabled || controller.isBusy;
	const { imageSpec, primaryParamGroups, secondaryRouteParams } = controller.routeParamControls;
	const selectedFamilyLabel = displayGenerationLabelWithoutAlias(controller.selectedFamily.label);
	const selectedFamilyBrand = generationFamilyBrand(controller.selectedFamily);
	const modelSummary = controller.hasAvailableRoute
		? `${selectedFamilyLabel} / ${displayGenerationLabelWithoutAlias(controller.selectedVersion.label)} / ${routeProviderLabel(controller.selectedRoute)}`
		: `暂无可用${kindLabel(controller.value.kind)}生成供应商`;
	const promptSupplementReady = controller.selectedPromptSupplementItems.length > 0;
	const promptOptimizationReady = Boolean(
		controller.selectedPromptOptimizationItem && controller.selectedPromptOptimizationModel?.route,
	);
	const primaryParamControls = primaryParamGroups.map((group) => {
		const param = group.params[0];
		if (!param) return null;
		return (
			<PrimaryParamControl
				key={`${group.id}:${param.name}`}
				label={group.label}
				param={param}
				value={controller.value.params[param.name]}
				onChange={(value) => controller.updateParam(param.name, value)}
			/>
		);
	});

	return (
		<>
			<fieldset
				disabled={effectiveDisabled}
				className="m-0 min-w-0 divide-y divide-border/70 border-0 p-0"
			>
				<section aria-label="模型设置" className={generationSettingsSectionClassName}>
					<div className="flex min-w-0 items-center justify-between gap-3">
						<div className="flex min-w-0 items-center gap-2.5">
							<div className={generationSettingsSectionIconClassName}>
								<GenerationBrandMark
									brand={selectedFamilyBrand}
									className="size-4 border-0 bg-transparent p-0 text-[0.5rem] shadow-none"
								/>
							</div>
							<div className="min-w-0">
								<h3 className="text-sm font-semibold text-foreground">模型</h3>
								<p className="truncate text-xs text-muted-foreground">{modelSummary}</p>
							</div>
						</div>
						{controller.hasLiveCatalog ? null : (
							<span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
								<Loader2 className="size-3.5 animate-spin" />
								加载中
							</span>
						)}
					</div>

					{controller.hasConfiguredRoutesForKind ? (
						<div className="grid gap-2 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
							<Select
								value={controller.selectedFamily.id}
								disabled={effectiveDisabled}
								onValueChange={controller.updateFamily}
							>
								<SelectTrigger
									aria-label="模型名称"
									className="h-9 rounded-md border-0 bg-muted px-2.5 text-xs font-semibold shadow-none focus:ring-2 focus:ring-ring data-[state=open]:ring-2 data-[state=open]:ring-ring"
								>
									<GenerationBrandMark
										brand={selectedFamilyBrand}
										className="size-4 text-[0.5rem]"
									/>
									<span className="min-w-0 truncate">{selectedFamilyLabel}</span>
								</SelectTrigger>
								<SelectContent align="start">
									{controller.visibleFamilies.map((family) => (
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
								className="h-9 max-w-none rounded-md bg-muted px-2.5 text-xs hover:bg-ide-list-hover"
								disabled={effectiveDisabled}
								routes={controller.visibleFamilyRoutes}
								selectedRoute={controller.selectedRoute}
								selectedVersion={controller.selectedVersion}
								versions={controller.visibleVersions}
								onSelect={controller.updateModelRoute}
							/>
						</div>
					) : (
						<div className="rounded-sm border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-foreground">
							请先在模型设置里配置可用的{kindLabel(controller.value.kind)}生成供应商。
						</div>
					)}
				</section>

				<section aria-label="参数设置" className={generationSettingsSectionClassName}>
					<div className="flex min-w-0 items-center gap-2">
						<div className={generationSettingsSectionIconClassName}>
							<SlidersHorizontal className="size-4 shrink-0" />
						</div>
						<h3 className="text-sm font-semibold text-foreground">参数</h3>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{controller.generationCountControl ? (
							<LabeledInlineControl label="每项生成数量">
								<GenerationCountControl {...controller.generationCountControl} />
							</LabeledInlineControl>
						) : (
							<LabeledInlineControl label="每项生成数量">
								<Badge variant="outline" className="h-8 rounded-sm bg-muted px-2">
									每项 1 个
								</Badge>
							</LabeledInlineControl>
						)}
						{imageSpec ? (
							<LabeledInlineControl
								label={controller.value.kind === "video" ? "视频大小" : "图片大小"}
							>
								<ImageGenerationSpecControl
									label={controller.value.kind === "video" ? "视频大小" : "图片大小"}
									showSizePreview={controller.value.kind === "image"}
									spec={imageSpec}
									onChange={controller.updateParam}
								/>
							</LabeledInlineControl>
						) : null}
						{primaryParamControls}
					</div>
					{secondaryRouteParams.length > 0 ? (
						<SecondaryParamSettings
							className="border-t border-border/70 pt-3"
							params={secondaryRouteParams}
							values={controller.value.params}
							onChange={controller.updateParam}
						/>
					) : null}
					{!imageSpec && primaryParamControls.length === 0 && secondaryRouteParams.length === 0 ? (
						<p className="text-xs text-muted-foreground">当前模型没有额外可配置参数。</p>
					) : null}
				</section>

				{controller.supportsReferenceImages ? (
					<section aria-label="参考图设置" className={generationSettingsSectionClassName}>
						<div className="flex min-w-0 items-center gap-2">
							<div className={generationSettingsSectionIconClassName}>
								<Images className="size-4 shrink-0" />
							</div>
							<h3 className="text-sm font-semibold text-foreground">参考图</h3>
						</div>
						<div className="grid gap-2">
							<LabeledInlineControl label="参考图">
								<button
									type="button"
									title="选择参考图"
									aria-label="选择参考图"
									disabled={effectiveDisabled}
									className="flex h-[var(--generation-control-height)] items-center gap-1.5 rounded-[var(--generation-control-radius)] border-0 bg-muted px-[var(--generation-control-padding-x)] text-2xs font-semibold text-foreground transition-colors hover:bg-ide-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
									onClick={() => controller.setReferenceDialogOpen(true)}
								>
									<Images className="size-4 shrink-0 text-muted-foreground" />
									<span>
										{controller.value.referenceAssetIds.length > 0
											? `已选 ${controller.value.referenceAssetIds.length} 张`
											: "选择"}
									</span>
								</button>
							</LabeledInlineControl>
							{controller.selectedReferenceAssets.length > 0 ? (
								<ReferencePreviewStrip
									tone="card"
									enableImagePreview
									references={controller.selectedReferenceAssets}
									simple
									onRemove={controller.toggleReferenceAsset}
								/>
							) : null}
							{controller.error ? (
								<p className="text-xs text-error-foreground">{controller.error}</p>
							) : null}
						</div>
					</section>
				) : null}

				<section aria-label="补充提示词设置" className={generationSettingsSectionClassName}>
					<div className="flex min-w-0 items-center justify-between gap-3">
						<div className="flex min-w-0 items-center gap-2.5">
							<div className={generationSettingsSectionIconClassName}>
								<MessageSquarePlus className="size-4 shrink-0" />
							</div>
							<h3 className="text-sm font-semibold text-foreground">补充提示词</h3>
						</div>
						<label className={generationSettingsToggleClassName}>
							<input
								type="checkbox"
								checked={controller.promptSupplementEnabled}
								className="size-4 rounded-sm border-border accent-primary"
								onChange={(event) => controller.setPromptSupplementEnabled(event.target.checked)}
							/>
							<span>生成时追加</span>
						</label>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<LabeledInlineControl label="提示词包">
							<PromptPackSelect
								ariaLabel="补充提示词包"
								disabled={
									effectiveDisabled ||
									!controller.promptSupplementEnabled ||
									controller.promptInsertItems.length === 0
								}
								items={controller.promptInsertItems}
								multiple
								selectedIds={controller.selectedPromptSupplementItems.map((item) => item.id)}
								onSelect={controller.togglePromptSupplementItem}
							/>
						</LabeledInlineControl>
						<PromptPackChips
							disabled={effectiveDisabled || !controller.promptSupplementEnabled}
							items={controller.selectedPromptSupplementItems}
							onRemove={controller.togglePromptSupplementItem}
						/>
					</div>
					{controller.promptSupplementEnabled && !promptSupplementReady ? (
						<p className="text-xs text-muted-foreground">
							{controller.promptInsertItems.length === 0
								? "需要可用的提示词包后才能追加并生成。"
								: "需要选择至少一个提示词包后才能追加并生成。"}
						</p>
					) : null}
				</section>

				<section aria-label="优化提示词设置" className={generationSettingsSectionClassName}>
					<div className="flex min-w-0 items-center justify-between gap-3">
						<div className="flex min-w-0 items-center gap-2.5">
							<div className={generationSettingsSectionIconClassName}>
								<Wand2 className="size-4 shrink-0" />
							</div>
							<h3 className="text-sm font-semibold text-foreground">优化提示词</h3>
						</div>
						<label className={generationSettingsToggleClassName}>
							<input
								type="checkbox"
								checked={controller.value.promptOptimization.enabled}
								className="size-4 rounded-sm border-border accent-primary"
								onChange={(event) => controller.setPromptOptimizationEnabled(event.target.checked)}
							/>
							<span>优化并生成时使用</span>
						</label>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<LabeledInlineControl label="提示词包">
							<PromptPackSelect
								ariaLabel="优化提示词包"
								disabled={
									effectiveDisabled ||
									!controller.value.promptOptimization.enabled ||
									controller.promptInsertItems.length === 0
								}
								items={controller.promptInsertItems}
								selectedIds={
									controller.selectedPromptOptimizationItem
										? [controller.selectedPromptOptimizationItem.id]
										: []
								}
								onSelect={(id) => controller.setPromptOptimizationItemId(id)}
							/>
						</LabeledInlineControl>
						<LabeledInlineControl label="优化模型">
							<Select
								value={controller.selectedPromptOptimizationModel?.id}
								disabled={
									effectiveDisabled ||
									!controller.value.promptOptimization.enabled ||
									controller.promptOptimizationModelOptions.length === 0
								}
								onValueChange={controller.setPromptOptimizationRouteId}
							>
								<SelectTrigger
									aria-label="优化模型"
									className="h-8 min-w-44 max-w-72 rounded-md border-0 bg-muted px-2.5 text-xs font-semibold shadow-none focus:ring-2 focus:ring-ring data-[state=open]:ring-2 data-[state=open]:ring-ring"
								>
									{controller.selectedPromptOptimizationModel ? (
										<>
											<GenerationBrandMark
												brand={generationFamilyBrand(
													controller.selectedPromptOptimizationModel.family,
												)}
												className="size-4 text-[0.5rem]"
											/>
											<span className="min-w-0 truncate">
												{controller.selectedPromptOptimizationModel.label}
											</span>
										</>
									) : (
										<span className="min-w-0 truncate">无可用文本模型</span>
									)}
								</SelectTrigger>
								<SelectContent align="start">
									{controller.promptOptimizationModelOptions.map((option) => (
										<SelectItem key={option.id} value={option.id} textValue={option.label}>
											<span className="flex min-w-0 items-center gap-2">
												<GenerationBrandMark
													brand={generationFamilyBrand(option.family)}
													className="size-4 text-[0.5rem]"
												/>
												<span className="min-w-0 truncate">{option.label}</span>
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</LabeledInlineControl>
					</div>
					{controller.value.promptOptimization.enabled && !promptOptimizationReady ? (
						<p className="text-xs text-muted-foreground">
							需要可用的提示词包和文本模型后才能优化并生成。
						</p>
					) : null}
				</section>
			</fieldset>

			<ReferenceSelectionDialog
				acceptedFileTypes="image/*"
				disabled={effectiveDisabled || !controller.supportsReferenceImages}
				entries={[]}
				inputId={controller.referenceInputId}
				isUploading={controller.isUploadingReference}
				maxReferences={controller.maxReferenceImages}
				mediaAssets={controller.imageReferenceAssets}
				open={controller.referenceDialogOpen}
				referenceCount={controller.value.referenceAssetIds.length}
				references={controller.selectedReferenceAssets}
				requiresReference={false}
				selectableKinds={imageReferenceKinds}
				selectedAssetIds={controller.value.referenceAssetIds}
				title="选择参考图"
				visibleKindFilters={imageReferenceKindFilters}
				onOpenChange={controller.setReferenceDialogOpen}
				onRefreshAssets={() => {
					void controller.mutateMediaAssets();
				}}
				onRemoveReference={controller.toggleReferenceAsset}
				onToggleReference={controller.toggleReferenceAsset}
				onUpload={controller.uploadReferenceAsset}
			/>
		</>
	);
};

const PromptPackSelect: React.FC<{
	ariaLabel: string;
	disabled: boolean;
	items: PromptInsertItem[];
	multiple?: boolean;
	onSelect: (value: string) => void;
	selectedIds: string[];
}> = ({ ariaLabel, disabled, items, multiple = false, onSelect, selectedIds }) => {
	const [open, setOpen] = useState(false);
	const groups = useMemo(() => groupPromptPackSelectItems(items), [items]);
	const primarySelectedId = selectedIds[0] ?? null;
	const selectedGroup = useMemo(
		() => groups.find((group) => group.items.some((item) => item.id === primarySelectedId)) ?? null,
		[groups, primarySelectedId],
	);
	const triggerLabel =
		items.length === 0
			? "无可用提示词包"
			: multiple
				? selectedIds.length > 0
					? `已选 ${selectedIds.length} 个`
					: "选择提示词包"
				: (items.find((item) => item.id === primarySelectedId)?.name ?? "选择提示词包");
	const [activeGroupId, setActiveGroupId] = useState(selectedGroup?.id ?? groups[0]?.id ?? "");
	const [suppressedGroupHoverId, setSuppressedGroupHoverId] = useState<string | null>(null);
	const groupButtonRefs = useRef(new Map<string, HTMLButtonElement>());
	const itemPanelRef = useRef<HTMLElement | null>(null);
	const safeTriangleOriginRef = useRef<{
		groupId: string;
		point: CascadedPickerPoint;
	} | null>(null);
	const groupActivationIntentTimerRef = useRef<number | null>(null);
	const activeGroup =
		groups.find((group) => group.id === activeGroupId) ?? selectedGroup ?? groups[0] ?? null;

	useEffect(() => {
		return () => {
			const timer = groupActivationIntentTimerRef.current;
			if (timer !== null) {
				window.clearTimeout(timer);
				groupActivationIntentTimerRef.current = null;
			}
		};
	}, []);

	useEffect(() => {
		if (disabled && open) setOpen(false);
	}, [disabled, open]);

	const openSyncedRef = useRef(false);
	useEffect(() => {
		if (!open) {
			openSyncedRef.current = false;
			return;
		}
		if (openSyncedRef.current) return;
		openSyncedRef.current = true;
		setActiveGroupId(selectedGroup?.id ?? groups[0]?.id ?? "");
	}, [groups, open, selectedGroup?.id]);

	useEffect(() => {
		if (!groups.length) {
			if (activeGroupId) setActiveGroupId("");
			return;
		}
		if (groups.some((group) => group.id === activeGroupId)) return;
		setActiveGroupId(selectedGroup?.id ?? groups[0]?.id ?? "");
	}, [activeGroupId, groups, selectedGroup?.id]);

	const selectItem = (item: PromptInsertItem) => {
		onSelect(item.id);
		if (!multiple) setOpen(false);
	};
	const popoverOpen = open && !disabled;
	const clearGroupActivationIntent = () => {
		const timer = groupActivationIntentTimerRef.current;
		if (timer !== null) {
			window.clearTimeout(timer);
			groupActivationIntentTimerRef.current = null;
		}
	};
	const clearSafeTriangle = () => {
		clearGroupActivationIntent();
		safeTriangleOriginRef.current = null;
		setSuppressedGroupHoverId(null);
	};
	const rememberActiveGroupPointer = (groupId: string, point: CascadedPickerPoint) => {
		clearGroupActivationIntent();
		safeTriangleOriginRef.current = { groupId, point };
		setSuppressedGroupHoverId(null);
	};
	const activateGroup = (groupId: string) => {
		setActiveGroupId(groupId);
		clearSafeTriangle();
	};
	const activateGroupFromPointer = (groupId: string, point: CascadedPickerPoint) => {
		setActiveGroupId(groupId);
		rememberActiveGroupPointer(groupId, point);
	};
	const scheduleGroupActivationIntent = (groupId: string, point: CascadedPickerPoint) => {
		setSuppressedGroupHoverId((currentId) => (currentId === groupId ? currentId : groupId));
		clearGroupActivationIntent();
		groupActivationIntentTimerRef.current = window.setTimeout(() => {
			groupActivationIntentTimerRef.current = null;
			activateGroupFromPointer(groupId, point);
		}, PROMPT_PACK_PICKER_SAFE_TRIANGLE_HOVER_INTENT_MS);
	};
	const shouldPreserveActiveGroup = (point: CascadedPickerPoint) => {
		const currentActiveGroupId = activeGroup?.id ?? "";
		const activeButton = currentActiveGroupId
			? groupButtonRefs.current.get(currentActiveGroupId)
			: null;
		const origin =
			safeTriangleOriginRef.current?.groupId === currentActiveGroupId
				? safeTriangleOriginRef.current.point
				: null;
		return shouldKeepCascadedPickerSourceActive({
			activeRect: activeButton?.getBoundingClientRect(),
			origin,
			point,
			submenuRect: itemPanelRef.current?.getBoundingClientRect(),
		});
	};
	const handleGroupPointer = (groupId: string, event: React.PointerEvent<HTMLButtonElement>) => {
		const point = pointerEventPoint(event);
		if (groupId === activeGroup?.id) {
			rememberActiveGroupPointer(groupId, point);
			return;
		}
		if (shouldPreserveActiveGroup(point)) {
			scheduleGroupActivationIntent(groupId, point);
			return;
		}
		activateGroupFromPointer(groupId, point);
	};

	return (
		<Popover open={popoverOpen} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={ariaLabel}
					aria-expanded={popoverOpen}
					aria-haspopup="dialog"
					disabled={disabled}
					className={cn(
						"flex h-8 min-w-52 max-w-80 items-center justify-between gap-2 rounded-sm bg-muted px-2 text-xs font-semibold text-foreground transition-colors hover:bg-ide-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
						popoverOpen && "bg-ide-list-active text-ide-list-active-foreground",
					)}
				>
					<span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="bottom"
				align="start"
				aria-label={`${ariaLabel}选择`}
				className="grid h-[var(--batch-prompt-pack-picker-menu-height)] max-h-[var(--generation-popover-max-block)] w-fit max-w-[var(--generation-popover-max-inline)] grid-cols-[fit-content(var(--generation-model-popover-version-column-max-width))_minmax(14rem,max-content)] overflow-hidden rounded-[var(--generation-popover-radius)] border-border bg-popover p-0 text-popover-foreground shadow-xl"
				style={promptPackSelectMenuStyle}
				onPointerLeave={clearSafeTriangle}
			>
				<section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-[var(--generation-popover-padding)]">
					<p className="mb-1.5 px-1 text-2xs font-semibold text-muted-foreground">分类</p>
					<div
						className="grid min-h-0 auto-rows-min gap-1 overflow-y-auto overscroll-contain pr-1"
						onWheel={scrollCascadedPickerListOnWheel}
					>
						{groups.map((group) => {
							const Icon = group.icon;
							const selected = group.id === activeGroup?.id;
							const suppressHover = group.id === suppressedGroupHoverId;
							return (
								<button
									key={group.id}
									type="button"
									ref={(node) => {
										if (node) groupButtonRefs.current.set(group.id, node);
										else groupButtonRefs.current.delete(group.id);
									}}
									aria-label={`${group.label} ${group.items.length} 项`}
									className={cn(
										"flex h-[var(--generation-model-popover-option-height)] min-w-0 items-center gap-1.5 rounded-[var(--generation-control-radius)] px-[var(--generation-control-padding-x)] text-left text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										selected
											? "bg-ide-list-active text-ide-list-active-foreground"
											: suppressHover
												? "text-foreground"
												: "text-foreground hover:bg-muted",
									)}
									onPointerEnter={(event) => handleGroupPointer(group.id, event)}
									onPointerMove={(event) => handleGroupPointer(group.id, event)}
									onFocus={() => activateGroup(group.id)}
									onClick={() => activateGroup(group.id)}
								>
									<Icon className="size-3.5 shrink-0 text-primary" />
									<span className="min-w-0 flex-1 truncate">{group.label}</span>
									<span className="shrink-0 text-muted-foreground/70">{group.items.length}</span>
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
				<section
					ref={itemPanelRef}
					className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-muted/40 p-[var(--generation-popover-padding)]"
					onPointerEnter={clearSafeTriangle}
				>
					<p className="mb-1.5 px-1 text-2xs font-semibold text-muted-foreground">提示词包</p>
					<div
						aria-label="提示词包列表"
						aria-multiselectable={multiple || undefined}
						className="grid min-h-0 auto-rows-min gap-1 overflow-y-auto overscroll-contain pr-1"
						onWheel={scrollCascadedPickerListOnWheel}
						role="listbox"
					>
						{activeGroup?.items.map((item) => {
							const selected = selectedIds.includes(item.id);
							return (
								<button
									key={item.id}
									type="button"
									role="option"
									aria-label={item.name}
									aria-selected={selected}
									className={cn(
										"flex h-[var(--generation-model-popover-option-height)] min-w-0 items-center gap-1.5 rounded-[var(--generation-control-radius)] px-[var(--generation-control-padding-x)] text-left text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										selected
											? "bg-ide-list-active text-ide-list-active-foreground"
											: "text-foreground hover:bg-card",
									)}
									onClick={() => selectItem(item)}
								>
									<Library className="size-3.5 shrink-0 text-primary" />
									<span className="min-w-0 flex-1 truncate">{item.name}</span>
									{selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
								</button>
							);
						}) ?? null}
					</div>
				</section>
			</PopoverContent>
		</Popover>
	);
};

const PromptPackChips: React.FC<{
	disabled: boolean;
	items: PromptInsertItem[];
	onRemove: (id: string) => void;
}> = ({ disabled, items, onRemove }) => {
	const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
	const pendingFocusIdRef = useRef<string | null>(null);

	useEffect(() => {
		const id = pendingFocusIdRef.current;
		if (id === null) return;
		pendingFocusIdRef.current = null;
		removeButtonRefs.current.get(id)?.focus();
	}, [items]);

	if (items.length === 0) return null;
	const removeAt = (index: number) => {
		const item = items[index];
		if (!item) return;
		pendingFocusIdRef.current = (items[index + 1] ?? items[index - 1])?.id ?? null;
		onRemove(item.id);
	};

	return (
		<div className={cn("flex flex-wrap items-center gap-1.5", disabled && "opacity-50")}>
			{items.map((item, index) => (
				<span
					key={item.id}
					className="flex h-8 max-w-52 items-center gap-1 rounded-sm bg-muted pl-2 pr-1 text-2xs font-semibold text-foreground"
				>
					<span className="min-w-0 truncate">{item.name}</span>
					<button
						type="button"
						aria-label={`移除${item.name}`}
						disabled={disabled}
						ref={(node) => {
							if (node) removeButtonRefs.current.set(item.id, node);
							else removeButtonRefs.current.delete(item.id);
						}}
						className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-ide-list-hover enabled:hover:text-foreground disabled:cursor-not-allowed"
						onClick={() => removeAt(index)}
					>
						<X className="size-3" />
					</button>
				</span>
			))}
		</div>
	);
};

const LabeledInlineControl: React.FC<{ children: React.ReactNode; label: string }> = ({
	children,
	label,
}) => (
	<div className="flex min-w-0 items-center gap-2 py-1.5">
		<span className="shrink-0 pl-1 text-2xs font-semibold text-muted-foreground">
			{paramLabel(label)}
		</span>
		<div className="min-w-0">{children}</div>
	</div>
);

const generationSettingsSectionClassName = "grid gap-4 py-4 first:pt-0 last:pb-0";
const generationSettingsSectionIconClassName =
	"flex size-5 shrink-0 items-center justify-center text-primary";
const generationSettingsToggleClassName =
	"flex shrink-0 cursor-pointer items-center gap-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground";
const imageReferenceKinds = new Set<"image">(["image"]);
const imageReferenceKindFilters: ReferenceKindFilter[] = ["image"];

interface PromptPackSelectGroup {
	icon: LucideIcon;
	id: string;
	items: PromptInsertItem[];
	label: string;
}

const PROMPT_PACK_PICKER_MAX_VISIBLE_ROWS = 5;
const PROMPT_PACK_PICKER_SAFE_TRIANGLE_HOVER_INTENT_MS = 180;
const promptPackSelectMenuHeight = () => {
	const gapCount = Math.max(PROMPT_PACK_PICKER_MAX_VISIBLE_ROWS - 1, 0);
	return `calc(var(--generation-popover-padding) * 2 + 1.25rem + ${PROMPT_PACK_PICKER_MAX_VISIBLE_ROWS} * var(--generation-control-height-lg) + ${gapCount} * 0.25rem)`;
};
const promptPackSelectMenuStyle = {
	"--batch-prompt-pack-picker-menu-height": promptPackSelectMenuHeight(),
} as React.CSSProperties;

const groupPromptPackSelectItems = (items: PromptInsertItem[]): PromptPackSelectGroup[] => {
	const groups: PromptPackSelectGroup[] = [];
	const groupsById = new Map<string, PromptPackSelectGroup>();
	for (const item of items) {
		const label = item.categoryLabel || "提示词";
		let group = groupsById.get(label);
		if (!group) {
			group = { icon: promptPackSelectGroupIcon(item), id: label, items: [], label };
			groupsById.set(label, group);
			groups.push(group);
		}
		group.items.push(item);
	}
	return groups;
};

const promptPackSelectGroupIcon = (item: PromptInsertItem): LucideIcon =>
	item.categoryLabel === "风格" ? Sparkles : Library;
