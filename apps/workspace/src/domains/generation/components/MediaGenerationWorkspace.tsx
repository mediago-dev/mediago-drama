import { Clipboard, PencilLine } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	GenerationAsset,
	GenerationKind,
	GenerationMessageResponse,
	GenerationNotificationOpenTarget,
} from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { HistoryGenerationList } from "@/domains/generation/components/MediaGenerationHistory";
import {
	filterImageGenerationSpecParams,
	resolveImageGenerationSpec,
} from "@/domains/generation/components/imageGenerationSpec";
import { ImageGenerationSpecControl } from "@/domains/generation/components/ImageGenerationSpecControl";
import { MediaGenerationInputPanel } from "@/domains/generation/components/MediaGenerationInputPanel";
import { MediaGenerationWorkspaceDialogs } from "@/domains/generation/components/MediaGenerationWorkspaceDialogs";
import { PromptLibraryPicker } from "@/domains/generation/components/PromptLibraryPicker";
import { ReferencePreviewStrip } from "@/domains/generation/components/ReferencePreviewStrip";
import { LayeredPromptComposer } from "@/domains/generation/components/LayeredPromptComposer";
import type { GenerationTaskType } from "@/domains/generation/lib/prompt-layers";
import {
	entryGeneratedAssets,
	entryPromptText,
	mediaAssetIdFromGeneratedSource,
	mergeReferencePreviewAssets,
} from "@/domains/generation/components/mediaGenerationHelpers";
import { GenerationResultGallery } from "@/domains/generation/components/MediaGenerationResultGallery";
import {
	PromptEditor,
	PromptMarkdownPreview,
	type PromptEditorProps,
} from "@/domains/generation/components/PromptEditor";
import { useMediaGenerationLifecycle } from "@/domains/generation/components/useMediaGenerationLifecycle";
import {
	historyPanelWidth,
	historyResizeHandleWidth,
	resizeHandleHeight,
	resizeKeyboardStep,
	useMediaGenerationWorkspaceLayout,
} from "@/domains/generation/components/useMediaGenerationWorkspaceLayout";
import { useGeneratedResultActions } from "@/domains/generation/components/generatedResultActions";
import { useGenerationCountControl } from "@/domains/generation/components/useGenerationCountControl";
import { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import {
	type GenerationEntry,
	generationAssetSelectionKey,
	generationAssetSource,
	generationStatusLabel,
	routeProviderLabel,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

type GenerationExtraValue<T> = T | ((prompt: string) => T);
export type MediaGenerationWorkspaceViewMode = "edit" | "history";

export type { PromptEditorProps } from "@/domains/generation/components/PromptEditor";

export interface MediaGenerationWorkspaceProps {
	className?: string;
	conversationId?: string | null;
	conversationScopeId?: string | null;
	conversationTitle?: string | null;
	emptyResultText?: string;
	extraPrompt?: GenerationExtraValue<string>;
	extraReferenceAssetIds?: GenerationExtraValue<string[]>;
	extraReferenceUrls?: GenerationExtraValue<string[]>;
	defaultHistorySourceLabel?: string;
	historyScopeId: string;
	initialPrompt: string;
	kind: GenerationKind;
	mediaAssetProjectId?: string | null;
	modelPreferenceScopeId?: string | null;
	notificationTarget?: GenerationNotificationOpenTarget | null;
	onGenerationComplete?: (
		pendingId: string,
		assets: GenerationAsset[],
		sourceEntryId: string,
	) => void;
	onGenerationError?: (pendingId: string) => void;
	onGenerationResponse?: (pendingId: string, response: GenerationMessageResponse) => void;
	onGenerationStart?: (pendingId: string, prompt: string) => void;
	onHistoryCountChange?: (count: number) => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	onViewModeChange?: (viewMode: MediaGenerationWorkspaceViewMode) => void;
	projectId?: string;
	promptExtras?: React.ReactNode | ((prompt: string) => React.ReactNode);
	promptPlaceholder?: string;
	referenceBadges?: Record<string, string> | ((prompt: string) => Record<string, string>);
	referencePreviewAssets?: MediaAsset[] | ((prompt: string) => MediaAsset[]);
	renderPromptEditor?: (props: PromptEditorProps) => React.ReactNode;
	sectionId?: string | null;
	taskType?: GenerationTaskType;
	selectedAssetKeys?: string[];
	submitLabel?: string;
	uploadIdPrefix?: string;
	viewMode?: MediaGenerationWorkspaceViewMode;
	onRemoveReferencePreview?: (asset: MediaAsset) => void;
}

export const MediaGenerationWorkspace: React.FC<MediaGenerationWorkspaceProps> = ({
	className,
	conversationId,
	conversationScopeId,
	conversationTitle,
	emptyResultText,
	extraPrompt = "",
	extraReferenceAssetIds = [],
	extraReferenceUrls = [],
	defaultHistorySourceLabel,
	historyScopeId,
	initialPrompt,
	kind,
	mediaAssetProjectId,
	modelPreferenceScopeId,
	notificationTarget,
	onGenerationComplete,
	onGenerationError,
	onGenerationResponse,
	onGenerationStart,
	onHistoryCountChange,
	onRemoveReferencePreview,
	onToggleAsset,
	onViewModeChange,
	projectId,
	promptExtras,
	promptPlaceholder,
	referenceBadges,
	referencePreviewAssets,
	renderPromptEditor,
	sectionId,
	taskType,
	selectedAssetKeys = [],
	submitLabel,
	uploadIdPrefix = "generation-workspace",
	viewMode,
}) => {
	const toast = useToast();
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [inlineHistoryReferences, setInlineHistoryReferences] = useState<MediaAsset[]>([]);
	const [inlineResultReferences, setInlineResultReferences] = useState<MediaAsset[]>([]);
	const [referenceDialogOpen, setReferenceDialogOpen] = useState(false);
	const syncedPromptEntryIdRef = useRef<string | null>(null);
	const workspaceRef = useRef<HTMLFormElement>(null);
	const rightPaneRef = useRef<HTMLDivElement>(null);
	const inlineReferenceAssets = useMemo(
		() => mergeReferencePreviewAssets(inlineHistoryReferences, inlineResultReferences),
		[inlineHistoryReferences, inlineResultReferences],
	);
	const inlineReferenceUrls = useMemo(
		() => inlineReferenceAssets.map((asset) => referenceUrlFromGenerationSource(asset.url)),
		[inlineReferenceAssets],
	);
	const workspaceExtraReferenceUrls = useCallback(
		(prompt: string) =>
			uniqueStrings([
				...resolveStringArrayExtraValue(extraReferenceUrls, prompt),
				...inlineReferenceUrls,
			]),
		[extraReferenceUrls, inlineReferenceUrls],
	);
	const {
		historyWidth,
		inputPanelHeight,
		nudgeHistoryWidth,
		nudgeInputPanelHeight,
		startHistoryResize,
		startInputPanelResize,
	} = useMediaGenerationWorkspaceLayout({ rightPaneRef, workspaceRef });
	const generatedKindLabel = kind === "image" ? "图像" : "视频";
	const promptLibraryKind = kind === "video" ? "video" : "image";
	const resolvedSubmitLabel = submitLabel ?? (kind === "image" ? "生成图片" : "生成视频");
	const resolvedPromptPlaceholder =
		promptPlaceholder ??
		(kind === "image"
			? "描述要生成的图片素材"
			: "描述当前分镜的视频镜头、运动、机位、时长、画幅和质量");
	const resolvedEmptyResultText =
		emptyResultText ??
		(kind === "image" ? "生成后会在这里显示图片素材。" : "生成后会在这里显示可预览的视频素材。");
	const {
		clearDeletedEntry,
		syncGenerationEntries,
		trackGenerationFailure,
		trackGenerationResponse,
		trackGenerationStart,
	} = useMediaGenerationLifecycle({
		kind,
		onGenerationComplete,
		onGenerationError,
		onGenerationResponse,
		onGenerationStart,
	});
	const tabbedView = viewMode !== undefined;
	const currentViewMode = viewMode ?? "history";
	const showHistoryResult = !tabbedView || currentViewMode === "history";
	const handleSubmitStart = useCallback(
		(event: Parameters<typeof trackGenerationStart>[0]) => {
			if (tabbedView && event.kind === kind) onViewModeChange?.("history");
			trackGenerationStart(event);
		},
		[kind, onViewModeChange, tabbedView, trackGenerationStart],
	);
	const ws = useGenerationWorkspace({
		extraPrompt,
		extraReferenceAssetIds,
		extraReferenceUrls: workspaceExtraReferenceUrls,
		conversationId,
		conversationScopeId,
		conversationTitle,
		historyScopeId,
		initialKind: kind,
		initialPrompt,
		mediaAssetProjectId,
		modelPreferenceScopeId,
		notificationTarget,
		onSubmitFailure: trackGenerationFailure,
		onSubmitResponse: trackGenerationResponse,
		onSubmitStart: handleSubmitStart,
		projectId,
		projectStyleOnly: true,
		sectionId,
		taskType,
		uploadIdPrefix,
	});
	const resolvedMediaAssetProjectId =
		mediaAssetProjectId === undefined ? (projectId?.trim() ?? "") : (mediaAssetProjectId ?? "");
	const resultActions = useGeneratedResultActions({
		mediaAssetProjectId: resolvedMediaAssetProjectId,
		mutateMediaAssets: ws.mutateMediaAssets,
		projectId,
	});

	useEffect(() => {
		if (ws.kind !== kind) ws.setKind(kind);
	}, [kind, ws.kind, ws.setKind]);

	const modelSummary = ws.hasConfiguredRoutesForKind
		? `${ws.selectedFamily.label} / ${ws.selectedVersion.label} / ${routeProviderLabel(ws.selectedRoute)}`
		: `暂无可用${generatedKindLabel}供应商`;
	const generationEntries = ws.orderedGenerationEntries.filter((entry) => entry.kind === kind);
	const activeGenerationEntry =
		generationEntries.find((entry) => entry.id === ws.activeEntryId) ??
		generationEntries[0] ??
		null;
	const highlightedHistoryEntryId =
		tabbedView && currentViewMode === "edit" ? null : (activeGenerationEntry?.id ?? null);
	const renderedPromptExtras =
		typeof promptExtras === "function" ? promptExtras(ws.prompt) : promptExtras;
	const resolvedReferenceBadges =
		typeof referenceBadges === "function" ? referenceBadges(ws.prompt) : referenceBadges;
	const externalReferencePreviewAssets =
		typeof referencePreviewAssets === "function"
			? referencePreviewAssets(ws.prompt)
			: (referencePreviewAssets ?? []);
	const resolvedReferencePreviewAssets = useMemo(
		() => mergeReferencePreviewAssets(externalReferencePreviewAssets, inlineReferenceAssets),
		[externalReferencePreviewAssets, inlineReferenceAssets],
	);
	const canSelectReferenceImages =
		ws.hasConfiguredRoutesForKind && ws.selectedRoute.supportsReferenceUrls;
	const { advancedRouteParams, generationCountControl } = useGenerationCountControl({
		hasConfiguredRoutesForKind: ws.hasConfiguredRoutesForKind,
		onParamChange: ws.updateParam,
		params: ws.selectedRoute.params,
		selectedParams: ws.selectedParams,
	});
	const imageSpec = useMemo(
		() =>
			kind === "image"
				? resolveImageGenerationSpec(
						ws.selectedRoute.params,
						ws.selectedParams,
						ws.selectedRoute.paramCombos,
					)
				: null,
		[kind, ws.selectedParams, ws.selectedRoute.paramCombos, ws.selectedRoute.params],
	);
	const filteredAdvancedRouteParams = useMemo(
		() => filterImageGenerationSpecParams(advancedRouteParams, imageSpec),
		[advancedRouteParams, imageSpec],
	);
	const previewReferenceAssets = useMemo(
		() => mergeReferencePreviewAssets(ws.selectedReferenceAssets, resolvedReferencePreviewAssets),
		[resolvedReferencePreviewAssets, ws.selectedReferenceAssets],
	);
	const showReferencePreviewStrip = !canSelectReferenceImages || previewReferenceAssets.length > 0;
	const selectedReferenceAssetIds = useMemo(
		() => new Set(ws.selectedReferenceAssetIds),
		[ws.selectedReferenceAssetIds],
	);
	const removePreviewReferenceAsset = useCallback(
		(asset: MediaAsset) => {
			if (selectedReferenceAssetIds.has(asset.id)) {
				ws.toggleReferenceAsset(asset);
				return;
			}

			if (inlineResultReferences.some((reference) => reference.id === asset.id)) {
				setInlineResultReferences((current) =>
					current.filter((reference) => reference.id !== asset.id),
				);
				return;
			}

			if (inlineHistoryReferences.some((reference) => reference.id === asset.id)) {
				setInlineHistoryReferences((current) =>
					current.filter((reference) => reference.id !== asset.id),
				);
				return;
			}

			onRemoveReferencePreview?.(asset);
		},
		[
			inlineHistoryReferences,
			inlineResultReferences,
			onRemoveReferencePreview,
			selectedReferenceAssetIds,
			ws,
		],
	);
	const useAssetAsReference = useCallback(
		(asset: GenerationAsset) => {
			if (!canSelectReferenceImages) {
				toast.warning("当前供应商不支持参考图", {
					description: "请切换到支持图生图的供应商后再使用参考图。",
				});
				return;
			}

			const source = generationAssetSource(asset);
			if (!source) return;

			const mediaAssetId = mediaAssetIdFromGeneratedSource(source);
			const mediaAsset = mediaAssetId
				? ws.mediaAssets.find((item) => item.id === mediaAssetId && item.kind === "image")
				: null;
			if (mediaAsset) {
				ws.selectReferenceAsset(mediaAsset);
			} else {
				const referenceAsset = createInlineResultReferenceAsset(asset, source);
				setInlineResultReferences((current) =>
					current.some((item) => item.id === referenceAsset.id)
						? current
						: [...current, referenceAsset],
				);
			}

			onViewModeChange?.("edit");
			window.requestAnimationFrame(() => focusGenerationPromptEditor(rightPaneRef.current));
		},
		[canSelectReferenceImages, onViewModeChange, toast, ws.mediaAssets, ws.selectReferenceAsset],
	);

	useEffect(() => {
		if (generationEntries.length === 0) return;
		if (ws.activeEntryId && generationEntries.some((entry) => entry.id === ws.activeEntryId))
			return;

		ws.setActiveEntryId(generationEntries[0].id);
	}, [generationEntries, ws.activeEntryId, ws.setActiveEntryId]);

	useEffect(() => {
		onHistoryCountChange?.(generationEntries.length);
	}, [generationEntries.length, onHistoryCountChange]);

	useEffect(() => {
		if (tabbedView) return;
		if (!activeGenerationEntry) return;
		if (syncedPromptEntryIdRef.current === activeGenerationEntry.id) return;

		syncedPromptEntryIdRef.current = activeGenerationEntry.id;
		ws.setPrompt(entryPromptText(activeGenerationEntry));
	}, [activeGenerationEntry, tabbedView, ws.setPrompt]);

	useEffect(() => {
		syncGenerationEntries(generationEntries);
	}, [generationEntries, syncGenerationEntries]);

	const deleteEntry = useCallback(
		async (entry: GenerationEntry) => {
			const deleted = await ws.deleteGenerationEntry(entry.id);
			if (!deleted) return;

			clearDeletedEntry(entry);
		},
		[clearDeletedEntry, ws.deleteGenerationEntry],
	);

	const selectHistoryEntry = useCallback(
		(entry: GenerationEntry) => {
			ws.setActiveEntryId(entry.id);
			if (tabbedView) {
				onViewModeChange?.("history");
				return;
			}

			syncedPromptEntryIdRef.current = entry.id;
			ws.setPrompt(entryPromptText(entry));
		},
		[onViewModeChange, tabbedView, ws.setActiveEntryId, ws.setPrompt],
	);

	const useActiveHistoryPrompt = useCallback(() => {
		if (!activeGenerationEntry) return;

		const prompt = entryPromptText(activeGenerationEntry);
		syncedPromptEntryIdRef.current = activeGenerationEntry.id;
		setInlineHistoryReferences(historyReferencePreviewAssetsFromEntry(activeGenerationEntry));
		ws.setPrompt(prompt);
		onViewModeChange?.("edit");
		window.requestAnimationFrame(() => focusGenerationPromptEditor(rightPaneRef.current));
	}, [activeGenerationEntry, onViewModeChange, ws.setPrompt]);

	const promptEditor = renderPromptEditor ? (
		renderPromptEditor({
			value: ws.prompt,
			placeholder: resolvedPromptPlaceholder,
			onChange: ws.setPrompt,
		})
	) : (
		<PromptEditor
			value={ws.prompt}
			onChange={ws.setPrompt}
			placeholder={resolvedPromptPlaceholder}
		/>
	);

	return (
		<form
			ref={workspaceRef}
			onSubmit={ws.submit}
			className={cn(
				"relative grid h-full min-h-0 grid-rows-[minmax(13rem,34%)_minmax(0,1fr)] bg-card text-card-foreground lg:grid-cols-[var(--generation-history-width)_var(--generation-history-resize-width)_minmax(0,1fr)] lg:grid-rows-none",
				className,
			)}
			style={
				{
					"--generation-history-resize-width": `${historyResizeHandleWidth}px`,
					"--generation-history-width": `${historyWidth}px`,
				} as React.CSSProperties
			}
		>
			<section className="flex min-h-0 min-w-0 flex-col border-b border-border bg-card lg:border-b-0">
				<HistoryGenerationList
					activeEntryId={highlightedHistoryEntryId}
					deletingEntryIds={ws.deletingEntryIds}
					defaultSourceLabel={defaultHistorySourceLabel}
					entries={generationEntries}
					kind={kind}
					selectedAssetKeys={selectedAssetKeys}
					onDeleteEntry={deleteEntry}
					onCopyPrompt={resultActions.copyPrompt}
					onSelectEntry={selectHistoryEntry}
				/>
			</section>

			<div
				role="separator"
				aria-label="调整历史生成宽度"
				aria-orientation="vertical"
				aria-valuemax={historyPanelWidth.max}
				aria-valuemin={historyPanelWidth.min}
				aria-valuenow={Math.round(historyWidth)}
				tabIndex={0}
				className="group relative z-10 -mx-[5.5px] hidden w-3 cursor-col-resize touch-none items-stretch justify-center bg-transparent lg:flex"
				onPointerDown={startHistoryResize}
				onKeyDown={(event) => {
					if (event.key === "ArrowLeft") {
						event.preventDefault();
						nudgeHistoryWidth(-resizeKeyboardStep);
					}
					if (event.key === "ArrowRight") {
						event.preventDefault();
						nudgeHistoryWidth(resizeKeyboardStep);
					}
				}}
			>
				<span className="h-full w-px bg-border transition-colors group-hover:bg-muted-foreground/70" />
			</div>

			<div
				ref={rightPaneRef}
				className="grid min-h-0 min-w-0"
				style={{
					gridTemplateRows: `minmax(0, 1fr) ${resizeHandleHeight}px ${inputPanelHeight}px`,
				}}
			>
				<section className="flex min-h-0 min-w-0 flex-col bg-card">
					<div className="min-h-0 flex-1 overflow-hidden px-4">
						<GenerationResultGallery
							emptyText={currentViewMode === "edit" ? "" : resolvedEmptyResultText}
							entries={showHistoryResult && activeGenerationEntry ? [activeGenerationEntry] : []}
							kind={kind}
							selectedAssetKeys={selectedAssetKeys}
							onSaveAsset={resultActions.saveAsset}
							onToggleAsset={onToggleAsset}
							onUseAssetAsReference={useAssetAsReference}
							savedAssetKeys={resultActions.savedKeys}
							savingAssetKeys={resultActions.savingKeys}
						/>
					</div>
				</section>

				<div
					role="separator"
					aria-label="调整生成输入区高度"
					aria-orientation="horizontal"
					tabIndex={0}
					className="group relative z-10 -my-[5.5px] flex h-3 cursor-row-resize items-center justify-center bg-transparent"
					onPointerDown={startInputPanelResize}
					onKeyDown={(event) => {
						if (event.key === "ArrowUp") {
							event.preventDefault();
							nudgeInputPanelHeight(resizeKeyboardStep);
						}
						if (event.key === "ArrowDown") {
							event.preventDefault();
							nudgeInputPanelHeight(-resizeKeyboardStep);
						}
					}}
				>
					<span className="h-px w-full bg-border transition-colors group-hover:bg-muted-foreground/70" />
				</div>

				{currentViewMode === "history" && tabbedView ? (
					<HistoryPromptPreviewPanel
						entry={activeGenerationEntry}
						kind={kind}
						onCopyPrompt={resultActions.copyPrompt}
						onUsePrompt={useActiveHistoryPrompt}
					/>
				) : (
					<MediaGenerationInputPanel
						canSelectReferenceImages={canSelectReferenceImages}
						canCopyPrompt={Boolean(ws.fullPrompt.trim())}
						canSubmit={ws.canSubmit}
						error={ws.error}
						generationCountControl={generationCountControl}
						imageSpecControl={
							imageSpec ? (
								<ImageGenerationSpecControl spec={imageSpec} onChange={ws.updateParam} />
							) : null
						}
						isSubmitting={ws.isSubmitting}
						modelSummary={modelSummary}
						previewReferenceAssets={previewReferenceAssets}
						layeredComposer={
							<LayeredPromptComposer layers={ws.composerLayers} onSelect={ws.setLayerSelection} />
						}
						promptEditor={promptEditor}
						promptExtras={renderedPromptExtras}
						promptLibraryPicker={
							<PromptLibraryPicker
								kind={promptLibraryKind}
								prompt={ws.prompt}
								onPromptChange={ws.setPrompt}
							/>
						}
						referenceBadges={resolvedReferenceBadges}
						requiresReference={false}
						showReferencePreviewStrip={showReferencePreviewStrip}
						submitLabel={resolvedSubmitLabel}
						onCopyPrompt={() =>
							void resultActions.copyText(ws.fullPrompt, "没有可复制的完整提示词")
						}
						onOpenAdvancedSettings={() => setAdvancedOpen(true)}
						onOpenReferenceDialog={() => setReferenceDialogOpen(true)}
						onRemoveReferencePreview={removePreviewReferenceAsset}
					/>
				)}
			</div>

			<MediaGenerationWorkspaceDialogs
				advancedOpen={advancedOpen}
				advancedRouteParams={filteredAdvancedRouteParams}
				generationEntries={generationEntries}
				modelSummary={modelSummary}
				referenceDialogOpen={referenceDialogOpen}
				workspace={ws}
				onAdvancedOpenChange={setAdvancedOpen}
				onReferenceDialogOpenChange={setReferenceDialogOpen}
			/>
		</form>
	);
};

const HistoryPromptPreviewPanel: React.FC<{
	entry: GenerationEntry | null;
	kind: GenerationKind;
	onCopyPrompt: (entry: GenerationEntry) => void;
	onUsePrompt: () => void;
}> = ({ entry, kind, onCopyPrompt, onUsePrompt }) => {
	const prompt = entry ? entryPromptText(entry).trim() : "";
	const generatedAssets = entry ? entryGeneratedAssets(entry, kind) : [];
	const requestReferenceAssets = entry ? historyReferencePreviewAssetsFromEntry(entry) : [];
	const statusLabel = entry?.status ? generationStatusLabel(entry.status) : "历史记录";
	const assetUnit = kind === "image" ? "张" : "个";

	return (
		<section className="flex min-h-0 min-w-0 flex-col bg-card">
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-ide-editor">
				<div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4 py-2">
					<div className="min-w-0">
						<p className="text-xs font-medium text-foreground">历史提示词</p>
						<p className="mt-0.5 truncate text-2xs text-muted-foreground">
							{entry ? `${statusLabel} · ${generatedAssets.length} ${assetUnit}` : "暂无历史记录"}
						</p>
					</div>
					{entry ? (
						<div className="flex shrink-0 items-center gap-2">
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label="复制历史提示词"
								title="复制历史提示词"
								className="size-7 rounded-sm border border-border bg-card text-muted-foreground shadow-none hover:bg-ide-list-hover hover:text-foreground [&_svg]:size-3.5"
								onClick={() => onCopyPrompt(entry)}
							>
								<Clipboard />
							</Button>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								className="h-7"
								onClick={onUsePrompt}
							>
								<PencilLine />
								<span>用此提示词编辑</span>
							</Button>
						</div>
					) : null}
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs leading-6 text-foreground">
					{prompt ? (
						<>
							{requestReferenceAssets.length > 0 ? (
								<div className="mb-3 border-b border-border/70 pb-3">
									<div className="mb-2 flex items-center justify-between gap-2">
										<p className="text-xs font-medium text-foreground">历史参考图</p>
										<p className="text-2xs text-muted-foreground">
											生成时使用 {requestReferenceAssets.length} 个
										</p>
									</div>
									<ReferencePreviewStrip
										enableImagePreview
										references={requestReferenceAssets}
										simple
										tone="card"
									/>
								</div>
							) : null}
							<PromptMarkdownPreview value={prompt} className="h-full p-0" />
						</>
					) : (
						<div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
							选择一条历史记录查看提示词。
						</div>
					)}
				</div>
			</div>
		</section>
	);
};

const inlineReferenceTimestamp = "1970-01-01T00:00:00.000Z";

const historyReferencePreviewAssetsFromEntry = (entry: GenerationEntry): MediaAsset[] =>
	(entry.requestAssets ?? []).flatMap((asset, index) => {
		if (asset.kind !== "image" && asset.kind !== "video") return [];

		const source = generationAssetSource(asset);
		if (!source) return [];

		const kindLabel = asset.kind === "image" ? "图" : "视频";
		return [
			{
				createdAt: entry.createdAt ?? inlineReferenceTimestamp,
				filename: `历史参考${kindLabel} ${index + 1}`,
				id: `history-reference:${entry.id}:${generationAssetSelectionKey(asset) ?? source}:${index}`,
				kind: asset.kind,
				mimeType: asset.mimeType ?? (asset.kind === "image" ? "image/*" : "video/*"),
				sizeBytes: 0,
				sourceUrl: source,
				updatedAt: entry.updatedAt ?? entry.createdAt ?? inlineReferenceTimestamp,
				url: source,
			},
		];
	});

const createInlineResultReferenceAsset = (asset: GenerationAsset, source: string): MediaAsset => ({
	createdAt: inlineReferenceTimestamp,
	filename: "参考图",
	id: `inline-result-reference:${generationAssetSelectionKey(asset) ?? source}`,
	kind: "image",
	mimeType: asset.mimeType ?? "image/*",
	sizeBytes: 0,
	sourceUrl: source,
	updatedAt: inlineReferenceTimestamp,
	url: source,
});

const referenceUrlFromGenerationSource = (source: string) => {
	if (/^(data|https?):/iu.test(source)) return source;
	if (typeof window === "undefined") return source;

	try {
		return new URL(source, window.location.origin).toString();
	} catch {
		return source;
	}
};

const resolveStringArrayExtraValue = (
	value: GenerationExtraValue<string[]>,
	prompt: string,
): string[] => (typeof value === "function" ? value(prompt) : value);

const uniqueStrings = (values: string[]) => {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		unique.push(trimmed);
	}
	return unique;
};

const focusGenerationPromptEditor = (container: HTMLElement | null) => {
	const target = container?.querySelector<HTMLElement>(
		"textarea, [contenteditable='true'], .ProseMirror",
	);
	target?.focus();
};
