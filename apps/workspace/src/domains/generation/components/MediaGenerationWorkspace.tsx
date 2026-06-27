import { FileText } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mutate as mutateSWR } from "swr";
import type {
	GenerationAsset,
	GenerationKind,
	GenerationMessageRequest,
	GenerationMessageResponse,
	GenerationNotificationOpenTarget,
} from "@/domains/generation/api/generation";
import {
	generationConversationsQueryKey,
	generationModelsKey,
	generationTasksQueryKey,
	previewGenerationVoice,
	projectGenerationConversation,
	selectedGenerationAssetsKey,
	updateSelectedGenerationAsset,
} from "@/domains/generation/api/generation";
import { uploadMediaAsset, type MediaAsset } from "@/domains/workspace/api/media";
import {
	workspaceDocumentResourcesKey,
	workspaceStoryboardVideoResourcesKey,
} from "@/domains/workspace/api/workspace";
import { HistoryGenerationList } from "@/domains/generation/components/MediaGenerationHistory";
import {
	ImageStickerEditorDialog,
	type ImageStickerEditorSaveResult,
} from "@/domains/generation/components/ImageStickerEditorDialog";
import {
	filterImageGenerationSpecParams,
	resolveImageGenerationSpec,
} from "@/domains/generation/components/imageGenerationSpec";
import { ImageGenerationSpecControl } from "@/domains/generation/components/ImageGenerationSpecControl";
import {
	GenerationBrandMark,
	generationFamilyBrand,
	generationModelBrand,
} from "@/domains/generation/components/GenerationBrandMark";
import {
	generationComposerPromptInputClassName,
	generationComposerSelectClassName,
	generationComposerToolbarGhostButtonClassName,
} from "@/domains/generation/components/GenerationComposerPanel";
import { GenerationModelRoutePicker } from "@/domains/generation/components/GenerationModelRoutePicker";
import { MediaGenerationInputPanel } from "@/domains/generation/components/MediaGenerationInputPanel";
import { MediaGenerationWorkspaceDialogs } from "@/domains/generation/components/MediaGenerationWorkspaceDialogs";
import { PromptOptimizeControl } from "@/domains/generation/components/PromptOptimizeControl";
import {
	MaterialLibraryImportDialog,
	PrimaryParamControl,
	type ReferenceSelectionShortcutGroup,
	SecondaryParamsDropdown,
} from "@/domains/generation/components/MediaGenerationDialogs";
import type { GenerationTaskType } from "@/domains/generation/lib/prompt-categories";
import {
	entryPromptText,
	mediaAssetIdFromGeneratedSource,
	mergeReferencePreviewAssets,
	resolveParamGroups,
} from "@/domains/generation/components/mediaGenerationHelpers";
import { GenerationResultGallery } from "@/domains/generation/components/MediaGenerationResultGallery";
import { PromptEditor, type PromptEditorProps } from "@/domains/generation/components/PromptEditor";
import { useMediaGenerationLifecycle } from "@/domains/generation/components/useMediaGenerationLifecycle";
import {
	historyPanelWidth,
	historyResizeHandleWidth,
	resizeKeyboardStep,
	useMediaGenerationWorkspaceLayout,
} from "@/domains/generation/components/useMediaGenerationWorkspaceLayout";
import {
	generationAssetFile,
	useGeneratedResultActions,
} from "@/domains/generation/components/generatedResultActions";
import { useGenerationCountControl } from "@/domains/generation/components/useGenerationCountControl";
import { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import {
	promptOptimizeModelOptions as listPromptOptimizeModelOptions,
	usePromptOptimize,
} from "@/domains/generation/hooks/usePromptOptimize";
import {
	type GenerationEntry,
	generationAssetSelectionKey,
	generationAssetSource,
	preferredRoute,
	routeProviderLabel,
	taskIdFromGenerationEntryId,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/shared/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/shared/components/ui/select";
import { openExternalUrl } from "@/shared/desktop/actions";
import { cn } from "@/shared/lib/utils";

type GenerationExtraValue<T> = T | ((prompt: string) => T);
export type MediaGenerationWorkspaceViewMode = "edit" | "history";

export type { PromptEditorProps } from "@/domains/generation/components/PromptEditor";

const openDocumentationUrl = async (url: string) => {
	await openExternalUrl(url);
};

const voicePreviewPlaybackBlockedMessage = "浏览器拦截了自动播放，请再点一次播放。";

const generationKindCopy: Record<
	GenerationKind,
	{
		emptyResultText: string;
		generatedLabel: string;
		mediaLabel: string;
		promptPlaceholder: string;
		submitLabel: string;
	}
> = {
	audio: {
		emptyResultText: "生成后会在这里显示可试听的音频素材。",
		generatedLabel: "音频",
		mediaLabel: "音频",
		promptPlaceholder: "输入要合成的语音文案、语气、角色声线和节奏",
		submitLabel: "生成语音",
	},
	image: {
		emptyResultText: "生成后会在这里显示图片素材。",
		generatedLabel: "图像",
		mediaLabel: "图片",
		promptPlaceholder: "描述要生成的图片素材",
		submitLabel: "生成图片",
	},
	text: {
		emptyResultText: "生成后会在这里显示文本结果。",
		generatedLabel: "文本",
		mediaLabel: "文本",
		promptPlaceholder: "描述要生成或改写的文本内容",
		submitLabel: "生成文本",
	},
	video: {
		emptyResultText: "生成后会在这里显示可预览的视频素材。",
		generatedLabel: "视频",
		mediaLabel: "视频",
		promptPlaceholder: "描述当前分镜的视频镜头、运动、机位、时长、画幅和质量",
		submitLabel: "生成视频",
	},
};

const errorMessage = (err: unknown) =>
	err && typeof err === "object" && "message" in err
		? String((err as { message?: unknown }).message || "")
		: "";

const appendPromptOptimizeReference = (currentPrompt: string, referencePrompt: string) => {
	const current = currentPrompt.trim();
	const reference = referencePrompt.trim();
	if (!current) return reference;
	if (!reference || current.includes(reference)) return current;
	return `${current}\n\n${reference}`;
};

const promptOptimizeConversationKindLabel = "提示词优化";
const conversationTitleSeparator = " · ";

const projectNameFromConversationTitle = (title?: string | null) => {
	const trimmed = title?.trim();
	if (!trimmed) return "";

	const separatorIndex = trimmed.lastIndexOf(conversationTitleSeparator);
	if (separatorIndex < 0) return trimmed;

	return trimmed.slice(0, separatorIndex).trim();
};

const isPlaybackBlockedError = (err: unknown) =>
	err instanceof DOMException
		? err.name === "NotAllowedError"
		: err && typeof err === "object" && "name" in err
			? String((err as { name?: unknown }).name || "") === "NotAllowedError"
			: false;

export interface MediaGenerationWorkspaceProps {
	assetTitle?: string | null;
	className?: string;
	conversationId?: string | null;
	conversationScopeId?: string | null;
	conversationTitle?: string | null;
	documentContext?: GenerationMessageRequest["documentContext"] | null;
	emptyResultText?: string;
	extraPrompt?: GenerationExtraValue<string>;
	extraReferenceAssetIds?: GenerationExtraValue<string[]>;
	extraReferenceUrls?: GenerationExtraValue<string[]>;
	defaultHistorySourceLabel?: string;
	historyScopeId: string;
	initialPrompt: string;
	kind: GenerationKind;
	mediaAssetProjectId?: string | null;
	materialLibraryImportOpen?: boolean;
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
	onMaterialLibraryImportOpenChange?: (open: boolean) => void;
	onAssetSelectionPersisted?: () => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	onViewModeChange?: (viewMode: MediaGenerationWorkspaceViewMode) => void;
	persistAssetSelection?: boolean;
	projectId?: string;
	promptExtras?: React.ReactNode | ((prompt: string) => React.ReactNode);
	promptPlaceholder?: string;
	referenceBadges?: Record<string, string> | ((prompt: string) => Record<string, string>);
	referencePreviewAssets?: MediaAsset[] | ((prompt: string) => MediaAsset[]);
	referenceShortcutGroups?: ReferenceSelectionShortcutGroup[];
	renderPromptEditor?: (props: PromptEditorProps) => React.ReactNode;
	sectionId?: string | null;
	taskType?: GenerationTaskType;
	selectedAssetKeys?: string[];
	selectedAssetResourceId?: string | null;
	selectedAssetSourceDocumentId?: string | null;
	selectedAssetTitle?: string | null;
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
	documentContext,
	emptyResultText,
	extraPrompt = "",
	extraReferenceAssetIds = [],
	extraReferenceUrls = [],
	defaultHistorySourceLabel,
	historyScopeId,
	initialPrompt,
	kind,
	mediaAssetProjectId,
	materialLibraryImportOpen,
	modelPreferenceScopeId,
	notificationTarget,
	onGenerationComplete,
	onGenerationError,
	onGenerationResponse,
	onGenerationStart,
	onHistoryCountChange,
	onMaterialLibraryImportOpenChange,
	onAssetSelectionPersisted,
	onRemoveReferencePreview,
	onToggleAsset,
	onViewModeChange,
	persistAssetSelection = false,
	projectId,
	promptExtras,
	promptPlaceholder,
	referenceBadges,
	referencePreviewAssets,
	referenceShortcutGroups = [],
	renderPromptEditor,
	sectionId,
	taskType,
	selectedAssetKeys = [],
	selectedAssetResourceId,
	selectedAssetSourceDocumentId,
	selectedAssetTitle,
	submitLabel,
	uploadIdPrefix = "generation-workspace",
	viewMode,
	assetTitle,
}) => {
	const toast = useToast();
	const [inlineHistoryReferences, setInlineHistoryReferences] = useState<MediaAsset[]>([]);
	const [inlineResultReferences, setInlineResultReferences] = useState<MediaAsset[]>([]);
	const [inlineShortcutReferences, setInlineShortcutReferences] = useState<MediaAsset[]>([]);
	const [assetSelectionOverrides, setAssetSelectionOverrides] = useState<Record<string, boolean>>(
		{},
	);
	const syncedDocumentSelectionKeysRef = useRef<Set<string>>(new Set());
	const assetSelectionPersistRequestIdsRef = useRef<Record<string, number>>({});
	const [editingImageTarget, setEditingImageTarget] = useState<{
		asset: GenerationAsset;
		entry: GenerationEntry;
		source: string;
	} | null>(null);
	const [referenceDialogOpen, setReferenceDialogOpen] = useState(false);
	const syncedPromptEntryIdRef = useRef<string | null>(null);
	const editingImageObjectUrlRef = useRef<string | null>(null);
	const editingImageRequestIdRef = useRef(0);
	const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
	const voicePreviewSourceCacheRef = useRef(new Map<string, string>());
	const voicePreviewCatalogRefreshRef = useRef("");
	const workspaceRef = useRef<HTMLFormElement>(null);
	const rightPaneRef = useRef<HTMLDivElement>(null);
	const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
	const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
	const inlineReferenceAssets = useMemo(
		() =>
			mergeReferencePreviewAssets(
				mergeReferencePreviewAssets(inlineHistoryReferences, inlineResultReferences),
				inlineShortcutReferences,
			),
		[inlineHistoryReferences, inlineResultReferences, inlineShortcutReferences],
	);
	const inlineReferenceUrls = useMemo(
		() => inlineReferenceAssets.map((asset) => referenceUrlFromGenerationSource(asset.url)),
		[inlineReferenceAssets],
	);
	const inlineShortcutReferenceIds = useMemo(
		() => inlineShortcutReferences.map((asset) => asset.id),
		[inlineShortcutReferences],
	);
	const workspaceExtraReferenceUrls = useCallback(
		(prompt: string) =>
			uniqueStrings([
				...resolveStringArrayExtraValue(extraReferenceUrls, prompt).map(
					referenceUrlFromGenerationSource,
				),
				...inlineReferenceUrls,
			]),
		[extraReferenceUrls, inlineReferenceUrls],
	);
	const { historyWidth, nudgeHistoryWidth, startHistoryResize } = useMediaGenerationWorkspaceLayout(
		{ rightPaneRef, workspaceRef },
	);
	const generatedKindLabel = generationKindCopy[kind].generatedLabel;
	const resolvedSubmitLabel = submitLabel ?? generationKindCopy[kind].submitLabel;
	const resolvedPromptPlaceholder = promptPlaceholder ?? generationKindCopy[kind].promptPlaceholder;
	const resolvedEmptyResultText = emptyResultText ?? generationKindCopy[kind].emptyResultText;
	const mediaKindLabel = generationKindCopy[kind].mediaLabel;
	const referenceButtonLabel = kind === "image" ? "参考图" : "参考素材";
	const pendingDefaultSelectedAssetRef = useRef<GenerationAsset | null>(null);
	const handleGenerationComplete = useCallback(
		(pendingId: string, assets: GenerationAsset[], sourceTaskId: string) => {
			onGenerationComplete?.(pendingId, assets, sourceTaskId);
			if (kind !== "image" || pendingDefaultSelectedAssetRef.current) return;

			const firstSelectableImage = assets.find(
				(asset) => asset.kind === "image" && generationAssetSelectionKey(asset),
			);
			if (firstSelectableImage) pendingDefaultSelectedAssetRef.current = firstSelectableImage;
		},
		[kind, onGenerationComplete],
	);
	const {
		clearDeletedEntry,
		syncGenerationEntries,
		trackGenerationFailure,
		trackGenerationResponse,
		trackGenerationStart,
	} = useMediaGenerationLifecycle({
		kind,
		onGenerationComplete: handleGenerationComplete,
		onGenerationError,
		onGenerationResponse,
		onGenerationStart,
	});
	const tabbedView = viewMode !== undefined;
	const currentViewMode = viewMode ?? "history";
	const showTabbedHistory = tabbedView && currentViewMode === "history";
	const showHistoryResult = !tabbedView || currentViewMode === "history";
	const handleSubmitStart = useCallback(
		(event: Parameters<typeof trackGenerationStart>[0]) => {
			if (tabbedView && event.kind === kind) onViewModeChange?.("history");
			trackGenerationStart(event);
		},
		[kind, onViewModeChange, tabbedView, trackGenerationStart],
	);
	const ws = useGenerationWorkspace({
		assetTitle,
		extraPrompt,
		extraReferenceAssetIds,
		extraReferenceUrls: workspaceExtraReferenceUrls,
		conversationId,
		conversationScopeId,
		conversationTitle,
		documentContext,
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
		useRawPrompt: true,
	});
	const resolvedMediaAssetProjectId =
		mediaAssetProjectId === undefined ? (projectId?.trim() ?? "") : (mediaAssetProjectId ?? "");
	const defaultDownloadTitle = selectedAssetTitle?.trim() || assetTitle?.trim() || undefined;
	const [selectedPromptOptimizeRouteId, setSelectedPromptOptimizeRouteId] = useState("");
	const promptOptimizeProjectName = useMemo(
		() => projectNameFromConversationTitle(conversationTitle),
		[conversationTitle],
	);
	const promptOptimizeProjectConversation = useMemo(
		() =>
			projectGenerationConversation(
				resolvedMediaAssetProjectId || projectId,
				"text",
				promptOptimizeProjectName,
				{ kindLabel: promptOptimizeConversationKindLabel },
			),
		[projectId, promptOptimizeProjectName, resolvedMediaAssetProjectId],
	);
	const promptOptimizeConversationId =
		promptOptimizeProjectConversation?.conversationId ?? conversationId;
	const promptOptimizeConversationScopeId =
		promptOptimizeProjectConversation?.conversationScopeId ?? conversationScopeId;
	const promptOptimizeConversationTitle =
		promptOptimizeProjectConversation?.conversationTitle ?? conversationTitle;
	const promptOptimizeModelOptions = useMemo(
		() => listPromptOptimizeModelOptions(ws.catalog),
		[ws.catalog],
	);
	const preferredPromptOptimizeModel = useMemo(() => {
		const route = preferredRoute(promptOptimizeModelOptions.map((option) => option.route));
		if (!route) return promptOptimizeModelOptions[0] ?? null;
		return (
			promptOptimizeModelOptions.find((option) => option.route.id === route.id) ??
			promptOptimizeModelOptions[0] ??
			null
		);
	}, [promptOptimizeModelOptions]);
	useEffect(() => {
		if (promptOptimizeModelOptions.length === 0) {
			if (selectedPromptOptimizeRouteId) setSelectedPromptOptimizeRouteId("");
			return;
		}
		if (promptOptimizeModelOptions.some((option) => option.id === selectedPromptOptimizeRouteId)) {
			return;
		}
		setSelectedPromptOptimizeRouteId(
			preferredPromptOptimizeModel?.id ?? promptOptimizeModelOptions[0]?.id ?? "",
		);
	}, [preferredPromptOptimizeModel?.id, promptOptimizeModelOptions, selectedPromptOptimizeRouteId]);
	const selectedPromptOptimizeModel =
		promptOptimizeModelOptions.find((option) => option.id === selectedPromptOptimizeRouteId) ??
		preferredPromptOptimizeModel ??
		promptOptimizeModelOptions[0] ??
		null;
	const refreshPromptOptimizeHistory = useCallback(() => {
		const refreshConversationId = promptOptimizeConversationId?.trim() || undefined;
		const refreshScopeId = promptOptimizeConversationScopeId?.trim() || undefined;
		const refreshProjectId = (resolvedMediaAssetProjectId || projectId || "").trim() || undefined;
		void mutateSWR(
			generationTasksQueryKey(refreshConversationId, "text", refreshScopeId, refreshProjectId),
		);
		void mutateSWR(generationConversationsQueryKey("text", refreshScopeId));
		void mutateSWR(generationConversationsQueryKey("text", "", { allScopes: true }));
	}, [
		projectId,
		promptOptimizeConversationId,
		promptOptimizeConversationScopeId,
		resolvedMediaAssetProjectId,
	]);
	const {
		canOptimize: canOptimizePrompt,
		error: promptOptimizeError,
		isOptimizing: isPromptOptimizing,
		optimize: optimizePrompt,
	} = usePromptOptimize({
		capabilityId: taskType ?? "studio",
		catalog: ws.catalog,
		conversationId: promptOptimizeConversationId,
		conversationScopeId: promptOptimizeConversationScopeId,
		conversationTitle: promptOptimizeConversationTitle,
		onSuccess: refreshPromptOptimizeHistory,
		projectId: resolvedMediaAssetProjectId || projectId,
		route: selectedPromptOptimizeModel?.route,
		onOptimized: ws.setPrompt,
	});
	useEffect(() => {
		if (!promptOptimizeError) return;
		toast.error("提示词优化失败", { description: promptOptimizeError });
	}, [promptOptimizeError, toast]);
	const canSubmitPromptOverride =
		ws.hasConfiguredRoutesForKind &&
		!ws.needsConversation &&
		ws.selectedRoute.status === "available" &&
		ws.selectedRoute.configured;
	const handlePromptOptimizeSelect = useCallback(
		(item: (typeof ws.promptInsertItems)[number]) => {
			const referencePrompt = item.prompt.trim();
			if (!referencePrompt) return;

			if (!ws.prompt.trim()) {
				ws.setPrompt(referencePrompt);
				toast.success("已填入提示词包", { description: item.name });
				return;
			}

			if (!canOptimizePrompt) {
				ws.setPrompt((currentPrompt) =>
					appendPromptOptimizeReference(currentPrompt, referencePrompt),
				);
				toast.warning("没有可用文本模型", { description: "已追加提示词包内容。" });
				return;
			}

			void optimizePrompt({
				currentPrompt: ws.prompt,
				referenceName: item.name,
				referencePrompt,
			});
		},
		[canOptimizePrompt, optimizePrompt, toast, ws],
	);
	const handlePromptOptimizeAndSubmitSelect = useCallback(
		async (item: (typeof ws.promptInsertItems)[number]) => {
			if (!canSubmitPromptOverride) return;
			const referencePrompt = item.prompt.trim();
			if (!referencePrompt) return;

			if (!ws.prompt.trim()) {
				ws.setPrompt(referencePrompt);
				await ws.submitGeneration({ prompt: referencePrompt });
				return;
			}

			if (!canOptimizePrompt) {
				const fallbackPrompt = appendPromptOptimizeReference(ws.prompt, referencePrompt);
				ws.setPrompt(fallbackPrompt);
				toast.warning("没有可用文本模型", {
					description: "已使用追加后的提示词生成。",
				});
				await ws.submitGeneration({ prompt: fallbackPrompt });
				return;
			}

			const textRoute = selectedPromptOptimizeModel?.route;
			if (!textRoute) return;
			await ws.submitGeneration({
				prompt: ws.prompt,
				promptOptimization: {
					routeId: textRoute.id,
					model: textRoute.model,
					referenceName: item.name,
					referencePrompt,
				},
			});
		},
		[canOptimizePrompt, canSubmitPromptOverride, selectedPromptOptimizeModel?.route, toast, ws],
	);
	const resultActions = useGeneratedResultActions({
		defaultDownloadTitle,
		mediaAssetProjectId: resolvedMediaAssetProjectId,
		mutateMediaAssets: ws.mutateMediaAssets,
		projectId,
	});
	const uploadMaterialImportAsset = useCallback(
		async (file: File) => {
			const mediaAsset = await uploadMediaAsset(file, resolvedMediaAssetProjectId);
			await ws.mutateMediaAssets();
			return mediaAsset;
		},
		[resolvedMediaAssetProjectId, ws.mutateMediaAssets],
	);

	useEffect(() => {
		if (ws.kind !== kind) ws.setKind(kind);
	}, [kind, ws.kind, ws.setKind]);

	useEffect(
		() => () => {
			voicePreviewAudioRef.current?.pause();
			if (voicePreviewAudioRef.current) voicePreviewAudioRef.current.onended = null;
			voicePreviewAudioRef.current = null;
			voicePreviewSourceCacheRef.current.clear();
		},
		[],
	);

	const modelSummary = ws.hasConfiguredRoutesForKind
		? `${ws.selectedFamily.label} / ${ws.selectedVersion.label} / ${routeProviderLabel(ws.selectedRoute)}`
		: `暂无可用${generatedKindLabel}供应商`;
	const selectedFamilyBrand = generationModelBrand({
		family: ws.selectedFamily,
		route: ws.selectedRoute,
		version: ws.selectedVersion,
	});
	const modelControls = ws.hasConfiguredRoutesForKind ? (
		<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
			<Select value={ws.selectedFamily.id} onValueChange={ws.updateFamily}>
				<SelectTrigger
					aria-label="模型名称"
					className={generationComposerSelectClassName("min-w-32 max-w-56 shrink-0")}
				>
					<GenerationBrandMark brand={selectedFamilyBrand} className="size-4 text-[0.5rem]" />
					<span>{ws.selectedFamily.label}</span>
				</SelectTrigger>
				<SelectContent align="start">
					{ws.visibleFamilies.map((family) => (
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
				className="min-w-44 max-w-72 flex-1"
				routes={ws.visibleFamilyRoutes}
				selectedRoute={ws.selectedRoute}
				selectedVersion={ws.selectedVersion}
				versions={ws.visibleVersions}
				onSelect={ws.updateModelRoute}
			/>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				aria-label="打开模型文档"
				className={generationComposerToolbarGhostButtonClassName("shrink-0")}
				onClick={() => void openDocumentationUrl(ws.selectedRoute.docUrl)}
			>
				<FileText className="size-4 shrink-0 text-muted-foreground" />
				<span>文档</span>
			</Button>
		</div>
	) : null;
	const generationEntries = ws.orderedGenerationEntries.filter((entry) => entry.kind === kind);
	const isAssetSelectionControlled = Boolean(onToggleAsset);
	const canPersistGeneratedAssetSelection = Boolean(
		projectId?.trim() &&
		selectedAssetResourceId?.trim() &&
		selectedGenerationResourceTypeForTaskType(taskType),
	);
	const shouldPersistGeneratedAssetSelection =
		canPersistGeneratedAssetSelection && (!isAssetSelectionControlled || persistAssetSelection);
	const effectiveSelectedAssetKeys = useMemo(() => {
		const baseKeys = isAssetSelectionControlled
			? Array.from(new Set(selectedAssetKeys))
			: generationSelectionBaseKeys(generationEntries, selectedAssetKeys);
		return selectionKeysWithOverrides(baseKeys, assetSelectionOverrides);
	}, [assetSelectionOverrides, generationEntries, isAssetSelectionControlled, selectedAssetKeys]);
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
	const routeParamGroups = useMemo(() => resolveParamGroups(ws.selectedRoute), [ws.selectedRoute]);
	const sizeGroupParams = useMemo(
		() => routeParamGroups.find((group) => group.id === "size")?.params ?? [],
		[routeParamGroups],
	);
	const countGroupParams = useMemo(
		() => routeParamGroups.find((group) => group.id === "count")?.params ?? [],
		[routeParamGroups],
	);
	const otherParamGroup = useMemo(
		() => routeParamGroups.find((group) => group.id === "other") ?? null,
		[routeParamGroups],
	);
	const imageSpec = useMemo(
		() =>
			resolveImageGenerationSpec(sizeGroupParams, ws.selectedParams, ws.selectedRoute.paramCombos),
		[sizeGroupParams, ws.selectedParams, ws.selectedRoute.paramCombos],
	);
	const { generationCountControl } = useGenerationCountControl({
		hasConfiguredRoutesForKind: ws.hasConfiguredRoutesForKind,
		onParamChange: ws.updateParam,
		params: countGroupParams,
		selectedParams: ws.selectedParams,
	});
	const generationCountParamName = useMemo(
		() => countGroupParams.find((param) => param.name === "n" && param.type === "number")?.name,
		[countGroupParams],
	);
	const voicePreviewRouteIds = useMemo(() => {
		const routeIds = new Set<string>();
		if (ws.selectedRoute.kind !== "audio") return routeIds;

		routeIds.add(ws.selectedRoute.id);
		for (const route of ws.visibleFamilyRoutes) {
			if (route.kind === "audio" && route.familyId === ws.selectedRoute.familyId) {
				routeIds.add(route.id);
			}
		}
		return routeIds;
	}, [
		ws.selectedRoute.familyId,
		ws.selectedRoute.id,
		ws.selectedRoute.kind,
		ws.visibleFamilyRoutes,
	]);
	const voicePreviewAssetsByVoiceId = useMemo(() => {
		const assets = new Map<string, NonNullable<typeof ws.catalog.voicePreviews>[number]>();
		for (const preview of ws.catalog?.voicePreviews ?? []) {
			if (!voicePreviewRouteIds.has(preview.routeId)) continue;
			const current = assets.get(preview.voiceId);
			if (!current || preview.routeId === ws.selectedRoute.id) {
				assets.set(preview.voiceId, preview);
			}
		}
		return assets;
	}, [voicePreviewRouteIds, ws.catalog?.voicePreviews, ws.selectedRoute.id]);
	const previewableVoiceIds = useMemo(
		() => new Set(voicePreviewAssetsByVoiceId.keys()),
		[voicePreviewAssetsByVoiceId],
	);
	useEffect(() => {
		if (ws.selectedRoute.kind !== "audio" || voicePreviewAssetsByVoiceId.size > 0) return;
		if (voicePreviewCatalogRefreshRef.current === ws.selectedRoute.id) return;

		voicePreviewCatalogRefreshRef.current = ws.selectedRoute.id;
		void mutateSWR(generationModelsKey);
	}, [voicePreviewAssetsByVoiceId.size, ws.selectedRoute.id, ws.selectedRoute.kind]);
	const stopVoicePreview = useCallback((voiceID?: string) => {
		voicePreviewAudioRef.current?.pause();
		if (voicePreviewAudioRef.current) voicePreviewAudioRef.current.onended = null;
		voicePreviewAudioRef.current = null;
		setPlayingVoiceId((current) => (!voiceID || current === voiceID ? null : current));
	}, []);
	const playVoicePreviewSource = useCallback(
		async (source: string, voiceID: string) => {
			stopVoicePreview();
			const audio = new Audio(source);
			audio.onended = () => {
				if (voicePreviewAudioRef.current !== audio) return;

				voicePreviewAudioRef.current = null;
				setPlayingVoiceId((current) => (current === voiceID ? null : current));
			};
			voicePreviewAudioRef.current = audio;
			try {
				await audio.play();
				setPlayingVoiceId(voiceID);
			} catch (err) {
				if (voicePreviewAudioRef.current === audio) {
					audio.onended = null;
					voicePreviewAudioRef.current = null;
				}
				setPlayingVoiceId((current) => (current === voiceID ? null : current));
				throw err;
			}
		},
		[stopVoicePreview],
	);
	const previewVoice = useCallback(
		async (voiceID: string) => {
			const normalizedVoiceID = voiceID.trim();
			if (!normalizedVoiceID) return;
			if (playingVoiceId === normalizedVoiceID) {
				stopVoicePreview(normalizedVoiceID);
				return;
			}
			if (!ws.hasConfiguredRoutesForKind || ws.selectedRoute.kind !== "audio") {
				toast.warning("当前模型不支持音色预览。");
				return;
			}
			const previewAsset = voicePreviewAssetsByVoiceId.get(normalizedVoiceID);
			if (!previewAsset) {
				toast.warning("这个音色暂无本地试听。");
				return;
			}

			const cacheKey = JSON.stringify({
				routeId: previewAsset.routeId,
				voiceId: normalizedVoiceID,
			});
			const cachedSource = voicePreviewSourceCacheRef.current.get(cacheKey);
			if (cachedSource) {
				try {
					await playVoicePreviewSource(cachedSource, normalizedVoiceID);
				} catch (err) {
					const message = errorMessage(err);
					toast.error("音色预览失败", {
						description: message || "浏览器暂时无法播放这个试听音频。",
					});
				}
				return;
			}

			setPreviewingVoiceId(normalizedVoiceID);
			try {
				const response = await previewGenerationVoice({
					routeId: previewAsset.routeId,
					voiceId: normalizedVoiceID,
				});
				const source = generationAssetSource(response.asset);
				if (!source) throw new Error("音色预览未返回可播放音频。");

				voicePreviewSourceCacheRef.current.set(cacheKey, source);
				try {
					await playVoicePreviewSource(source, normalizedVoiceID);
				} catch (err) {
					if (isPlaybackBlockedError(err)) {
						toast.warning("试听已生成", {
							description: voicePreviewPlaybackBlockedMessage,
						});
						return;
					}
					throw err;
				}
			} catch (err) {
				const message = errorMessage(err);
				toast.error("音色预览失败", {
					description: message || "这个音色暂无可播放的本地试听文件。",
				});
			} finally {
				setPreviewingVoiceId((current) => (current === normalizedVoiceID ? null : current));
			}
		},
		[
			playingVoiceId,
			playVoicePreviewSource,
			stopVoicePreview,
			voicePreviewAssetsByVoiceId,
			toast,
			ws.hasConfiguredRoutesForKind,
			ws.selectedRoute.kind,
		],
	);
	const imageSpecControlledParamNames = useMemo(
		() => new Set(imageSpec?.controlledParamNames ?? []),
		[imageSpec],
	);
	const primaryParamGroups = useMemo(
		() =>
			routeParamGroups.filter(
				(group) =>
					group.id !== "size" &&
					group.id !== "count" &&
					group.id !== "other" &&
					group.params.length === 1 &&
					group.params[0]?.type === "select",
			),
		[routeParamGroups],
	);
	const renderedPrimaryParamNames = useMemo(() => {
		const names = new Set(imageSpecControlledParamNames);
		if (generationCountParamName) names.add(generationCountParamName);
		for (const group of primaryParamGroups) {
			const param = group.params[0];
			if (param) names.add(param.name);
		}
		return names;
	}, [generationCountParamName, imageSpecControlledParamNames, primaryParamGroups]);
	const secondaryRouteParams = useMemo(
		() =>
			filterImageGenerationSpecParams(
				[
					...(otherParamGroup?.params ?? []),
					...routeParamGroups.flatMap((group) =>
						group.id === "other"
							? []
							: group.params.filter((param) => !renderedPrimaryParamNames.has(param.name)),
					),
				],
				imageSpec,
			),
		[imageSpec, otherParamGroup, renderedPrimaryParamNames, routeParamGroups],
	);
	const primaryParamControls = useMemo(
		() =>
			primaryParamGroups.map((group) => {
				const param = group.params[0];
				if (!param) return null;

				return (
					<PrimaryParamControl
						key={`${group.id}:${param.name}`}
						label={group.label}
						param={param}
						playingVoiceId={param.name === "voiceId" ? playingVoiceId : undefined}
						previewableVoiceIds={param.name === "voiceId" ? previewableVoiceIds : undefined}
						previewingVoiceId={previewingVoiceId}
						value={ws.selectedParams[param.name]}
						onChange={(value) => ws.updateParam(param.name, value)}
						onPreviewVoice={previewVoice}
					/>
				);
			}),
		[
			previewVoice,
			playingVoiceId,
			previewableVoiceIds,
			previewingVoiceId,
			primaryParamGroups,
			ws.selectedParams,
			ws.updateParam,
		],
	);
	const secondaryParamControls = useMemo(
		() =>
			secondaryRouteParams.length > 0 ? (
				<SecondaryParamsDropdown
					label={otherParamGroup?.label}
					params={secondaryRouteParams}
					values={ws.selectedParams}
					onChange={ws.updateParam}
				/>
			) : null,
		[otherParamGroup?.label, secondaryRouteParams, ws.selectedParams, ws.updateParam],
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

			if (inlineShortcutReferences.some((reference) => reference.id === asset.id)) {
				setInlineShortcutReferences((current) =>
					current.filter((reference) => reference.id !== asset.id),
				);
				return;
			}

			onRemoveReferencePreview?.(asset);
		},
		[
			inlineHistoryReferences,
			inlineResultReferences,
			inlineShortcutReferences,
			onRemoveReferencePreview,
			selectedReferenceAssetIds,
			ws,
		],
	);
	const useAssetAsReference = useCallback(
		(asset: GenerationAsset) => {
			if (!canSelectReferenceImages) {
				toast.warning(`当前供应商不支持${referenceButtonLabel}`, {
					description:
						kind === "video"
							? "请切换到支持参考素材的视频供应商后再使用参考。"
							: "请切换到支持图生图的供应商后再使用参考图。",
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

			if (!showTabbedHistory) onViewModeChange?.("edit");
			window.requestAnimationFrame(() => focusGenerationPromptEditor(rightPaneRef.current));
		},
		[
			canSelectReferenceImages,
			onViewModeChange,
			showTabbedHistory,
			toast,
			kind,
			referenceButtonLabel,
			ws.mediaAssets,
			ws.selectReferenceAsset,
		],
	);
	const setGeneratedAssetSelectionOverride = useCallback(
		(selectionKey: string, selected: boolean) => {
			setAssetSelectionOverrides((current) => {
				const next = { ...current, [selectionKey]: selected };
				if (selected) {
					for (const entry of generationEntries) {
						for (const asset of entry.assets ?? []) {
							if (asset.kind !== kind) continue;
							const key = generationAssetSelectionKey(asset);
							if (key && key !== selectionKey) next[key] = false;
						}
					}
				}
				return next;
			});
			if (selected) syncedDocumentSelectionKeysRef.current.add(selectionKey);
			else syncedDocumentSelectionKeysRef.current.delete(selectionKey);
		},
		[generationEntries, kind],
	);
	const persistGeneratedAssetSelection = useCallback(
		async (
			asset: GenerationAsset,
			selected: boolean,
			sourceType: "edited" | "generated" = "generated",
		) => {
			const persistTarget = resolveGeneratedAssetTaskSlot(asset, generationEntries);
			const normalizedProjectId = projectId?.trim();
			const resourceId = selectedAssetResourceId?.trim();
			const resourceType = selectedGenerationResourceTypeForTaskType(taskType);
			if (
				!normalizedProjectId ||
				!resourceId ||
				!isSelectableGenerationAssetKind(asset.kind) ||
				!persistTarget ||
				!resourceType
			) {
				return true;
			}

			const persistedTitle = asset.title?.trim() || selectedAssetTitle?.trim() || undefined;

			try {
				await updateSelectedGenerationAsset(normalizedProjectId, {
					assetIndex: persistTarget.slotIndex,
					base64: asset.base64,
					kind: asset.kind,
					mimeType: asset.mimeType,
					resourceId,
					resourceTitle: selectedAssetTitle?.trim() || asset.title?.trim() || undefined,
					resourceType,
					selected,
					sourceAssetIndex: persistTarget.slotIndex,
					sourceDocumentId: selectedAssetSourceDocumentId?.trim() || undefined,
					sourceTaskId: persistTarget.taskId,
					sourceType,
					taskId: persistTarget.taskId,
					title: persistedTitle,
					url: asset.url,
				});
				void ws.mutateTasks();
				refreshSelectedGenerationAssetDependents(normalizedProjectId);
				onAssetSelectionPersisted?.();
				return true;
			} catch (err) {
				const message = err instanceof Error ? err.message : "已选资源保存失败。";
				toast.error(message);
				return false;
			}
		},
		[
			generationEntries,
			projectId,
			selectedAssetResourceId,
			selectedAssetSourceDocumentId,
			selectedAssetTitle,
			taskType,
			onAssetSelectionPersisted,
			toast,
			ws.mutateTasks,
		],
	);
	const toggleGeneratedAsset = useCallback(
		(asset: GenerationAsset, selected: boolean) => {
			const selectionKey = generationAssetSelectionKey(asset);
			const previousSelected = selectionKey
				? effectiveSelectedAssetKeys.includes(selectionKey)
				: false;
			const persistRequestId =
				selectionKey && shouldPersistGeneratedAssetSelection
					? (assetSelectionPersistRequestIdsRef.current[selectionKey] ?? 0) + 1
					: null;
			if (selectionKey) {
				if (persistRequestId !== null) {
					assetSelectionPersistRequestIdsRef.current[selectionKey] = persistRequestId;
				}
				setGeneratedAssetSelectionOverride(selectionKey, selected);
			}

			onToggleAsset?.(asset, selected);
			if (shouldPersistGeneratedAssetSelection) {
				void persistGeneratedAssetSelection(asset, selected).then((persisted) => {
					if (persisted || !selectionKey || persistRequestId === null) return;
					if (assetSelectionPersistRequestIdsRef.current[selectionKey] !== persistRequestId) return;

					delete assetSelectionPersistRequestIdsRef.current[selectionKey];
					setGeneratedAssetSelectionOverride(selectionKey, previousSelected);
					onToggleAsset?.(asset, previousSelected);
				});
			}
		},
		[
			effectiveSelectedAssetKeys,
			onToggleAsset,
			persistGeneratedAssetSelection,
			setGeneratedAssetSelectionOverride,
			shouldPersistGeneratedAssetSelection,
		],
	);
	const confirmMaterialAssets = useCallback(
		async (selectedAssets: MediaAsset[]) => {
			let lastEntryId: string | null = null;
			let existingCount = 0;
			const assetsToImport: MediaAsset[] = [];

			for (const asset of selectedAssets) {
				if (asset.kind !== "image") continue;

				const existing = findImportedMaterialAsset(generationEntries, asset);
				if (existing) {
					existingCount += 1;
					lastEntryId = existing.entry.id;
					continue;
				}

				assetsToImport.push(asset);
			}

			let addedCount = 0;
			try {
				const importedTasks =
					assetsToImport.length > 0
						? await ws.importMediaAssetsToHistory(assetsToImport, {
								assetTitle: selectedAssetTitle?.trim() || undefined,
							})
						: [];
				addedCount = importedTasks.length;
				lastEntryId = importedTasks.at(-1)?.id ?? lastEntryId;

				if (lastEntryId) ws.setActiveEntryId(lastEntryId);
				if (tabbedView) onViewModeChange?.("history");
				onMaterialLibraryImportOpenChange?.(false);

				toast.success(addedCount > 0 ? "已加入生成记录" : "生成记录未变化", {
					description: materialSelectionToastDescription({
						addedCount,
						existingCount,
						totalCount: selectedAssets.length,
					}),
				});
			} catch (error) {
				toast.error("导入失败", {
					description: apiErrorMessage(error, "素材库图片加入生成记录失败。"),
				});
			}
		},
		[
			generationEntries,
			onMaterialLibraryImportOpenChange,
			onViewModeChange,
			selectedAssetTitle,
			tabbedView,
			toast,
			ws.importMediaAssetsToHistory,
			ws.setActiveEntryId,
		],
	);
	const generatedAssetToggleHandler =
		onToggleAsset || canPersistGeneratedAssetSelection ? toggleGeneratedAsset : undefined;

	useEffect(() => {
		if (isAssetSelectionControlled || !projectId?.trim() || selectedAssetKeys.length === 0) return;

		const selectedKeys = new Set(selectedAssetKeys);
		for (const entry of generationEntries) {
			for (const asset of entry.assets ?? []) {
				if (asset.kind !== "image" || asset.selected) continue;

				const selectionKey = generationAssetSelectionKey(asset);
				if (!selectionKey || !selectedKeys.has(selectionKey)) continue;
				if (syncedDocumentSelectionKeysRef.current.has(selectionKey)) continue;

				const persistRequestId =
					(assetSelectionPersistRequestIdsRef.current[selectionKey] ?? 0) + 1;
				assetSelectionPersistRequestIdsRef.current[selectionKey] = persistRequestId;
				syncedDocumentSelectionKeysRef.current.add(selectionKey);
				void persistGeneratedAssetSelection(asset, true).then((persisted) => {
					if (persisted) return;
					if (assetSelectionPersistRequestIdsRef.current[selectionKey] !== persistRequestId) return;

					delete assetSelectionPersistRequestIdsRef.current[selectionKey];
					syncedDocumentSelectionKeysRef.current.delete(selectionKey);
				});
			}
		}
	}, [
		generationEntries,
		isAssetSelectionControlled,
		persistGeneratedAssetSelection,
		projectId,
		selectedAssetKeys,
	]);
	const releaseEditingImageObjectUrl = useCallback(() => {
		if (!editingImageObjectUrlRef.current) return;
		URL.revokeObjectURL(editingImageObjectUrlRef.current);
		editingImageObjectUrlRef.current = null;
	}, []);
	const openImageEditor = useCallback(
		async (entry: GenerationEntry, asset: GenerationAsset) => {
			if (asset.kind !== "image") return;
			const source = generationAssetSource(asset);
			if (!source) {
				toast.error("无法编辑图片", { description: "找不到可编辑的图片源。" });
				return;
			}
			const editableSource = sameOriginDevApiSource(source);
			const requestId = editingImageRequestIdRef.current + 1;
			editingImageRequestIdRef.current = requestId;
			releaseEditingImageObjectUrl();
			let editorSource = editableSource;
			try {
				const file = await generationAssetFile(
					asset,
					editableSource,
					asset.title?.trim() || "编辑图片.png",
				);
				if (editingImageRequestIdRef.current !== requestId) return;
				const objectUrl = URL.createObjectURL(file);
				editingImageObjectUrlRef.current = objectUrl;
				editorSource = objectUrl;
			} catch {
				if (editingImageRequestIdRef.current !== requestId) return;
			}
			setEditingImageTarget({ asset, entry, source: editorSource });
		},
		[releaseEditingImageObjectUrl, toast],
	);
	const closeImageEditor = useCallback(
		(open: boolean) => {
			if (open) return;
			editingImageRequestIdRef.current += 1;
			setEditingImageTarget(null);
			releaseEditingImageObjectUrl();
		},
		[releaseEditingImageObjectUrl],
	);
	const saveEditedImage = useCallback(
		async (result: ImageStickerEditorSaveResult) => {
			if (!editingImageTarget) return;
			const baseTitle =
				editingImageTarget.asset.title?.trim() || selectedAssetTitle?.trim() || "编辑图片";
			const editedTitle = `${baseTitle} 编辑版`;
			try {
				const file = renameFile(result.file, `${editedTitle}.png`, result.mimeType);
				const mediaAsset = await uploadMediaAsset(file, resolvedMediaAssetProjectId);
				await ws.mutateMediaAssets();
				const importedTasks = await ws.importMediaAssetsToHistory([mediaAsset], {
					assetTitle: editedTitle,
					prompt: editingImageTarget.entry.prompt,
				});
				const editedTask = importedTasks.at(-1);
				if (editedTask?.id) ws.setActiveEntryId(editedTask.id);
				setEditingImageTarget(null);
				releaseEditingImageObjectUrl();
				toast.success("已保存编辑版", { description: "编辑后的图片已加入历史记录。" });
			} catch (error) {
				toast.error("保存失败", {
					description: apiErrorMessage(error, "编辑图片上传失败。"),
				});
				throw error;
			}
		},
		[
			editingImageTarget,
			releaseEditingImageObjectUrl,
			resolvedMediaAssetProjectId,
			selectedAssetTitle,
			toast,
			ws,
		],
	);
	const toggleShortcutReference = useCallback(
		(asset: MediaAsset) => {
			if (!canSelectReferenceImages) {
				toast.warning(`当前供应商不支持${referenceButtonLabel}`, {
					description:
						kind === "video"
							? "请切换到支持参考素材的视频供应商后再使用参考。"
							: "请切换到支持图生图的供应商后再使用参考图。",
				});
				return;
			}
			if (!ws.selectableReferenceKinds.has(asset.kind)) return;

			setInlineShortcutReferences((current) =>
				current.some((reference) => reference.id === asset.id)
					? current.filter((reference) => reference.id !== asset.id)
					: [...current, asset],
			);
		},
		[canSelectReferenceImages, kind, referenceButtonLabel, toast, ws.selectableReferenceKinds],
	);

	useEffect(() => {
		if (generationEntries.length === 0) return;
		if (ws.activeEntryId && generationEntries.some((entry) => entry.id === ws.activeEntryId))
			return;

		ws.setActiveEntryId(generationEntries[0].id);
	}, [generationEntries, ws.activeEntryId, ws.setActiveEntryId]);

	useEffect(() => () => releaseEditingImageObjectUrl(), [releaseEditingImageObjectUrl]);

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

	useEffect(() => {
		const asset = pendingDefaultSelectedAssetRef.current;
		if (!asset) return;

		pendingDefaultSelectedAssetRef.current = null;
		if (!generatedAssetToggleHandler || effectiveSelectedAssetKeys.length > 0) return;

		generatedAssetToggleHandler(asset, true);
	}, [effectiveSelectedAssetKeys.length, generatedAssetToggleHandler]);

	const deleteEntry = useCallback(
		async (entry: GenerationEntry) => {
			const deleted = await ws.deleteGenerationEntry(entry.id);
			if (!deleted) return;

			clearDeletedEntry(entry);
		},
		[clearDeletedEntry, ws.deleteGenerationEntry],
	);
	const deleteEntryAsset = useCallback(
		async (entry: GenerationEntry, _asset: GenerationAsset, assetIndex: number) => {
			if (isImportedMaterialEntry(entry)) {
				await deleteEntry(entry);
				return;
			}

			try {
				const deleted = await ws.deleteGenerationEntryAsset(entry.id, assetIndex);
				if (!deleted) {
					toast.error("删除失败", { description: `找不到可删除的生成${mediaKindLabel}。` });
				}
			} catch (error) {
				toast.error("删除失败", {
					description: apiErrorMessage(error, `生成${mediaKindLabel}删除失败。`),
				});
			}
		},
		[deleteEntry, mediaKindLabel, toast, ws.deleteGenerationEntryAsset],
	);
	const deleteEntryAssetPlaceholder = useCallback(
		async (entry: GenerationEntry, assetIndex: number) => {
			try {
				const deleted = await ws.deleteGenerationEntryAssetPlaceholder(entry.id, assetIndex);
				if (!deleted) {
					toast.error("删除失败", { description: `找不到可删除的生成${mediaKindLabel}。` });
				}
			} catch (error) {
				toast.error("删除失败", {
					description: apiErrorMessage(error, `生成${mediaKindLabel}删除失败。`),
				});
			}
		},
		[mediaKindLabel, toast, ws.deleteGenerationEntryAssetPlaceholder],
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

	const useHistoryPrompt = useCallback(
		(entry: GenerationEntry) => {
			const prompt = entryPromptText(entry);
			syncedPromptEntryIdRef.current = entry.id;
			setInlineHistoryReferences(historyReferencePreviewAssetsFromEntry(entry));
			ws.setPrompt(prompt);
			if (!showTabbedHistory) onViewModeChange?.("edit");
			window.requestAnimationFrame(() => focusGenerationPromptEditor(rightPaneRef.current));
		},
		[onViewModeChange, showTabbedHistory, ws.setPrompt],
	);
	const promptSlashItems = ws.promptInsertItems;
	const promptEditorClassName = generationComposerPromptInputClassName;

	const promptEditor = renderPromptEditor ? (
		renderPromptEditor({
			value: ws.prompt,
			placeholder: resolvedPromptPlaceholder,
			onChange: ws.setPrompt,
			className: promptEditorClassName,
			slashItems: promptSlashItems,
		})
	) : (
		<PromptEditor
			value={ws.prompt}
			onChange={ws.setPrompt}
			placeholder={resolvedPromptPlaceholder}
			className={promptEditorClassName}
			slashItems={promptSlashItems}
		/>
	);
	const showSidebarHistory = !tabbedView;
	const editorResultEntries =
		!showTabbedHistory && showHistoryResult && activeGenerationEntry ? [activeGenerationEntry] : [];
	const editorPane = (
		<section
			ref={rightPaneRef}
			aria-label="编辑"
			className={cn(
				showTabbedHistory
					? "min-h-0 min-w-0 border-t border-border bg-card"
					: "grid h-full min-h-0 min-w-0 bg-card",
			)}
			style={
				showTabbedHistory
					? undefined
					: {
							gridTemplateRows: "minmax(0, 1fr) auto",
						}
			}
		>
			{showTabbedHistory ? null : (
				<section className="flex min-h-0 min-w-0 flex-col bg-card">
					<div className="min-h-0 flex-1 overflow-hidden px-4">
						<GenerationResultGallery
							emptyText={currentViewMode === "edit" ? "" : resolvedEmptyResultText}
							entries={editorResultEntries}
							kind={kind}
							selectedAssetKeys={effectiveSelectedAssetKeys}
							onSaveAsset={resultActions.saveAsset}
							onToggleAsset={generatedAssetToggleHandler}
							onUseAssetAsReference={useAssetAsReference}
							savedAssetKeys={resultActions.savedKeys}
							savingAssetKeys={resultActions.savingKeys}
						/>
					</div>
				</section>
			)}

			<MediaGenerationInputPanel
				canSelectReferenceImages={canSelectReferenceImages}
				canCopyPrompt={Boolean(ws.fullPrompt.trim())}
				canSubmit={ws.canSubmit}
				error={ws.error}
				generationCountControl={generationCountControl}
				imageSpecControl={
					imageSpec ? (
						<ImageGenerationSpecControl
							label={kind === "video" ? "视频大小" : "图片大小"}
							showSizePreview={kind === "image"}
							spec={imageSpec}
							onChange={ws.updateParam}
						/>
					) : null
				}
				isSubmitting={ws.isSubmitting}
				modelControls={modelControls}
				modelSummary={modelSummary}
				previewReferenceAssets={previewReferenceAssets}
				primaryParamControls={primaryParamControls}
				promptOptimizeControl={
					<PromptOptimizeControl
						canOptimize={canOptimizePrompt}
						canGenerate={canSubmitPromptOverride}
						disabled={ws.isSubmitting}
						isOptimizing={isPromptOptimizing}
						items={ws.promptInsertItems}
						modelOptions={promptOptimizeModelOptions}
						onOptimize={handlePromptOptimizeSelect}
						onOptimizeAndSubmit={handlePromptOptimizeAndSubmitSelect}
						onSelectModel={setSelectedPromptOptimizeRouteId}
						selectedModelRouteId={selectedPromptOptimizeModel?.id}
					/>
				}
				referenceButtonLabel={referenceButtonLabel}
				promptEditor={promptEditor}
				promptExtras={renderedPromptExtras}
				referenceBadges={resolvedReferenceBadges}
				requiresReference={false}
				secondaryParamControls={secondaryParamControls}
				showReferencePreviewStrip={showReferencePreviewStrip}
				submitLabel={resolvedSubmitLabel}
				submitTone={kind === "video" ? "video" : "image"}
				onCopyPrompt={() => void resultActions.copyText(ws.fullPrompt, "没有可复制的完整提示词")}
				onOpenReferenceDialog={() => setReferenceDialogOpen(true)}
				onRemoveReferencePreview={removePreviewReferenceAsset}
			/>
		</section>
	);

	return (
		<form
			ref={workspaceRef}
			onSubmit={ws.submit}
			className={cn(
				showTabbedHistory
					? "relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] bg-card text-card-foreground"
					: showSidebarHistory
						? "relative grid h-full min-h-0 grid-rows-[minmax(13rem,34%)_minmax(0,1fr)] bg-card text-card-foreground lg:grid-cols-[var(--generation-history-width)_var(--generation-history-resize-width)_minmax(0,1fr)] lg:grid-rows-none"
						: "relative grid h-full min-h-0 bg-card text-card-foreground",
				className,
			)}
			style={
				{
					"--generation-history-resize-width": `${historyResizeHandleWidth}px`,
					"--generation-history-width": `${historyWidth}px`,
				} as React.CSSProperties
			}
		>
			{showTabbedHistory ? (
				<>
					<section aria-label="历史记录" className="flex h-full min-h-0 min-w-0 flex-col bg-card">
						<HistoryGenerationList
							activeEntryId={highlightedHistoryEntryId}
							deletedAssetPlaceholderCounts={ws.deletedAssetPlaceholderCounts}
							deletingEntryIds={ws.deletingEntryIds}
							defaultSourceLabel={defaultHistorySourceLabel}
							entries={generationEntries}
							kind={kind}
							deletingAssetKeys={ws.deletingAssetKeys}
							selectedAssetKeys={effectiveSelectedAssetKeys}
							onDeleteEntry={deleteEntry}
							onDeleteAsset={deleteEntryAsset}
							onDeletePlaceholder={deleteEntryAssetPlaceholder}
							onCopyPrompt={resultActions.copyPrompt}
							onEditAsset={openImageEditor}
							onSaveAsset={resultActions.saveAsset}
							onSelectEntry={selectHistoryEntry}
							onToggleAsset={generatedAssetToggleHandler}
							onUseAssetAsReference={useAssetAsReference}
							onUsePrompt={useHistoryPrompt}
							savedAssetKeys={resultActions.savedKeys}
							savingAssetKeys={resultActions.savingKeys}
							variant="list"
						/>
					</section>
					{editorPane}
				</>
			) : (
				<>
					{showSidebarHistory ? (
						<>
							<section className="flex min-h-0 min-w-0 flex-col border-b border-border bg-card lg:border-b-0">
								<HistoryGenerationList
									activeEntryId={highlightedHistoryEntryId}
									deletingEntryIds={ws.deletingEntryIds}
									defaultSourceLabel={defaultHistorySourceLabel}
									entries={generationEntries}
									kind={kind}
									selectedAssetKeys={effectiveSelectedAssetKeys}
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
						</>
					) : null}

					{editorPane}
				</>
			)}

			<MediaGenerationWorkspaceDialogs
				generationEntries={generationEntries}
				inlineReferenceAssetIds={inlineShortcutReferenceIds}
				referenceDialogOpen={referenceDialogOpen}
				referenceShortcutGroups={referenceShortcutGroups}
				workspace={ws}
				onReferenceDialogOpenChange={setReferenceDialogOpen}
				onToggleInlineReference={toggleShortcutReference}
			/>
			{onMaterialLibraryImportOpenChange ? (
				<MaterialLibraryImportDialog
					confirming={ws.isImportingMediaAssets}
					mediaAssets={ws.mediaAssets}
					open={Boolean(materialLibraryImportOpen)}
					onOpenChange={onMaterialLibraryImportOpenChange}
					onRefreshAssets={() => {
						void ws.mutateMediaAssets();
					}}
					onUploadAsset={uploadMaterialImportAsset}
					onConfirmSelection={confirmMaterialAssets}
				/>
			) : null}
			<ImageStickerEditorDialog
				open={Boolean(editingImageTarget)}
				source={editingImageTarget?.source ?? ""}
				title={editingImageTarget?.asset.title?.trim() || "图片编辑工作台"}
				onOpenChange={closeImageEditor}
				onSave={saveEditedImage}
			/>
		</form>
	);
};

const inlineReferenceTimestamp = "1970-01-01T00:00:00.000Z";

const generationSelectionBaseKeys = (entries: GenerationEntry[], selectedAssetKeys: string[]) => {
	const keys = new Set(selectedAssetKeys);
	for (const entry of entries) {
		for (const asset of entry.assets ?? []) {
			if (!asset.selected) continue;
			const key = generationAssetSelectionKey(asset);
			if (key) keys.add(key);
		}
	}
	return Array.from(keys);
};

const selectionKeysWithOverrides = (
	selectedAssetKeys: string[],
	overrides: Record<string, boolean>,
) => {
	const keys = new Set(selectedAssetKeys);
	for (const [key, selected] of Object.entries(overrides)) {
		if (selected) keys.add(key);
		else keys.delete(key);
	}
	return Array.from(keys);
};

const refreshSelectedGenerationAssetDependents = (projectId: string) => {
	void mutateSWR(
		(key) => Array.isArray(key) && key[0] === selectedGenerationAssetsKey && key[1] === projectId,
	);
	void mutateSWR(workspaceDocumentResourcesKey(projectId));
	void mutateSWR(workspaceStoryboardVideoResourcesKey(projectId));
};

const renameFile = (file: File, filename: string, mimeType: string) => {
	const sanitizedFilename = sanitizeEditedImageFilename(filename);
	if (file.name === sanitizedFilename && file.type === mimeType) return file;
	return new File([file], sanitizedFilename, { type: mimeType || file.type || "image/png" });
};

const sanitizeEditedImageFilename = (value: string) => {
	const withoutExtension = value.trim().replace(/\.(png|jpe?g|webp)$/iu, "");
	const sanitized = withoutExtension
		.replace(/[\\/:*?"<>|]+/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
	return `${sanitized || "编辑图片"}.png`;
};

const selectedGenerationResourceTypeForTaskType = (taskType?: GenerationTaskType) => {
	switch (taskType) {
		case "character":
		case "scene":
		case "storyboard":
		case "prop":
			return taskType;
		default:
			return undefined;
	}
};

const isSelectableGenerationAssetKind = (kind?: string) =>
	kind === "audio" || kind === "image" || kind === "video";

const resolveGeneratedAssetTaskSlot = (
	asset: GenerationAsset,
	entries: GenerationEntry[],
): { slotIndex: number; taskId: string } | null => {
	const directTaskId = asset.taskId?.trim();
	const directSlotIndex = normalizedGeneratedAssetSlotIndex(asset.slotIndex);
	if (directTaskId && directSlotIndex !== null) {
		return { slotIndex: directSlotIndex, taskId: directTaskId };
	}

	const source = generationAssetSource(asset);
	if (!source) return null;

	for (const entry of entries) {
		const entryTaskId = directTaskId || taskIdFromGenerationEntryId(entry.id);
		if (!entryTaskId) continue;

		const entryAssets = entry.assets ?? [];
		for (const [index, candidate] of entryAssets.entries()) {
			if (candidate.kind !== asset.kind) continue;
			const candidateSource = generationAssetSource(candidate);
			if (candidate !== asset && candidateSource !== source) continue;

			const slotIndex = normalizedGeneratedAssetSlotIndex(candidate.slotIndex) ?? index;
			const taskId = candidate.taskId?.trim() || entryTaskId;
			return { slotIndex, taskId };
		}
	}

	return null;
};

const normalizedGeneratedAssetSlotIndex = (value: number | undefined) =>
	typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

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
				posterUrl: asset.posterUrl,
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

const findImportedMaterialAsset = (entries: GenerationEntry[], mediaAsset: MediaAsset) => {
	const targetKey = mediaAssetSelectionKey(mediaAsset);
	const targetSource = generationAssetSource(mediaAssetGenerationAsset(mediaAsset));

	for (const entry of entries) {
		for (const asset of entry.assets ?? []) {
			if (asset.kind !== mediaAsset.kind) continue;
			const assetKey = generationAssetSelectionKey(asset);
			const assetSource = generationAssetSource(asset);
			if ((targetKey && assetKey === targetKey) || (targetSource && assetSource === targetSource)) {
				return { asset, entry };
			}
		}
	}

	return null;
};

const isImportedMaterialEntry = (entry: GenerationEntry) =>
	entry.id.startsWith("media-library:") ||
	(entry.id.startsWith("media-library-") &&
		entry.requestDetails?.some(
			(detail) => detail.label.trim() === "来源" && detail.value.trim() === "素材库",
		));

const mediaAssetSelectionKey = (asset: MediaAsset) =>
	generationAssetSelectionKey(mediaAssetGenerationAsset(asset));

const mediaAssetGenerationAsset = (asset: MediaAsset): GenerationAsset => ({
	kind: asset.kind,
	mimeType: asset.mimeType,
	posterUrl: asset.posterUrl,
	url: asset.url,
});

const materialSelectionToastDescription = ({
	addedCount,
	existingCount,
	totalCount,
}: {
	addedCount: number;
	existingCount: number;
	totalCount: number;
}) => {
	const parts: string[] = [];
	if (addedCount > 0) parts.push(`新增 ${addedCount} 张`);
	if (existingCount > 0) parts.push(`已有 ${existingCount} 张`);
	if (parts.length > 0) return parts.join("，");
	return totalCount > 0 ? `已有 ${totalCount} 张在生成记录中` : "当前未选择素材";
};

const referenceUrlFromGenerationSource = (source: string) => {
	if (/^(data|https?):/iu.test(source)) return source;
	if (typeof window === "undefined") return source;

	try {
		return new URL(source, window.location.origin).toString();
	} catch {
		return source;
	}
};

const sameOriginDevApiSource = (source: string) => {
	if (typeof window === "undefined") return source;
	if (!/^https?:\/\//iu.test(source)) return source;
	if (!/^https?:$/iu.test(window.location.protocol)) return source;

	try {
		const url = new URL(source);
		const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
		if (!localHosts.has(url.hostname) || !localHosts.has(window.location.hostname)) {
			return source;
		}
		if (!url.pathname.startsWith("/api/")) return source;
		if (url.origin === window.location.origin) return source;
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return source;
	}
};

const resolveStringArrayExtraValue = (
	value: GenerationExtraValue<string[]>,
	prompt: string,
): string[] => (typeof value === "function" ? value(prompt) : value);

const apiErrorMessage = (error: unknown, fallback: string) => {
	if (error instanceof Error && error.message.trim()) return error.message;
	if (error && typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}

	return fallback;
};

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
