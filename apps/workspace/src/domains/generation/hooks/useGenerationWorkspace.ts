import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR, { mutate as mutateSWR } from "swr";
import {
	type GenerationKind,
	type GenerationNotificationOpenTarget,
	generationModelsKey,
	generationPreferencesQueryKey,
	generationProjectConversationScopeId,
	generationTasksQueryKey,
	getGenerationModels,
	getGenerationPreferences,
	getGenerationTasks,
} from "@/domains/generation/api/generation";
import {
	getProjectBrief,
	getProjectConfig,
	projectBriefKey,
	projectConfigKey,
} from "@/domains/projects/api/projects";
import {
	type PromptLayer,
	type PromptPreset,
	listPromptPresets,
	listStylePresets,
	promptPresetsKey,
	stylePresetsKey,
} from "@/domains/generation/api/prompt-presets";
import {
	type GenerationTaskType,
	composeLayerStyle,
	taskTypeLayers,
} from "@/domains/generation/lib/prompt-layers";
import type { MediaAsset } from "@/domains/workspace/api/media";
import {
	isConfiguredRoute,
	resolveGenerationExtraValue,
	type GenerationExtraValue,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { useGenerationMediaLibrary } from "./useGenerationMediaLibrary";
import { useGenerationMessages } from "./useGenerationMessages";
import { useGenerationModelSelection } from "./useGenerationModelSelection";
import { useGenerationReferences } from "./useGenerationReferences";
import {
	useGenerationSubmit,
	generationRequestPrompt,
	type GenerationSubmitFailureEvent,
	type GenerationSubmitResponseEvent,
	type GenerationSubmitStartEvent,
} from "./useGenerationSubmit";
import { useGenerationTaskActions } from "./useGenerationTaskActions";

export type {
	GenerationSubmitFailureEvent,
	GenerationSubmitOverrides,
	GenerationSubmitResponseEvent,
	GenerationSubmitStartEvent,
} from "./useGenerationSubmit";

// 稳定的空数组引用,避免 SWR 加载中的新 `[]` 引用引发组合器 memo 反复重算。
const emptyPromptPresets: PromptPreset[] = [];

export interface UseGenerationWorkspaceOptions {
	extraPrompt?: GenerationExtraValue<string>;
	extraReferenceAssetIds?: GenerationExtraValue<string[]>;
	extraReferenceUrls?: GenerationExtraValue<string[]>;
	activeEntryId?: string | null;
	conversationId?: string | null;
	conversationScopeId?: string | null;
	conversationTitle?: string | null;
	historyScopeId?: string;
	initialKind?: GenerationKind;
	initialPrompt?: string;
	mediaAssetProjectId?: string | null;
	modelPreferenceScopeId?: string | null;
	notificationTarget?: GenerationNotificationOpenTarget | null;
	projectId?: string;
	projectHistory?: boolean;
	projectStyleOnly?: boolean;
	requireConversation?: boolean;
	sectionId?: string | null;
	taskType?: GenerationTaskType;
	uploadIdPrefix?: string;
	onActiveEntryIdChange?: (entryId: string | null) => void;
	onSubmitFailure?: (event: GenerationSubmitFailureEvent) => void;
	onSubmitResponse?: (event: GenerationSubmitResponseEvent) => void;
	onSubmitStart?: (event: GenerationSubmitStartEvent) => void;
	onSubmitSuccess?: (kind: GenerationKind) => void;
	onSubmitError?: (message: string) => void;
}

export const useGenerationWorkspace = ({
	activeEntryId: controlledActiveEntryId,
	conversationId,
	conversationScopeId,
	conversationTitle,
	extraPrompt = "",
	extraReferenceAssetIds = [],
	extraReferenceUrls = [],
	historyScopeId,
	initialKind,
	initialPrompt = "",
	mediaAssetProjectId: mediaAssetProjectIdOverride,
	modelPreferenceScopeId,
	notificationTarget,
	onActiveEntryIdChange,
	onSubmitError,
	onSubmitFailure,
	onSubmitResponse,
	onSubmitStart,
	onSubmitSuccess,
	projectId,
	projectHistory = false,
	projectStyleOnly = false,
	requireConversation = false,
	sectionId,
	taskType = "studio",
	uploadIdPrefix = "generation",
}: UseGenerationWorkspaceOptions = {}) => {
	const [prompt, setPrompt] = useState(initialPrompt);
	const [error, setError] = useState<string | null>(null);
	const resolvedConversationScopeId =
		conversationScopeId?.trim() ||
		(projectId ? generationProjectConversationScopeId(projectId) : undefined);
	const resolvedPreferenceScopeId =
		modelPreferenceScopeId?.trim() ||
		conversationScopeId?.trim() ||
		(projectId ? generationProjectConversationScopeId(projectId) : "");
	const mediaAssetProjectId =
		mediaAssetProjectIdOverride === undefined
			? (projectId?.trim() ?? "")
			: (mediaAssetProjectIdOverride?.trim() ?? "");
	const taskProjectId = projectHistory ? mediaAssetProjectId : "";
	const taskScopeId =
		projectHistory && mediaAssetProjectId
			? generationProjectConversationScopeId(mediaAssetProjectId)
			: resolvedConversationScopeId;
	const needsConversation = requireConversation && !conversationId?.trim();

	const { data: modelCatalog } = useSWR(generationModelsKey, getGenerationModels);
	const { data: generationPreferences, mutate: mutatePreferences } = useSWR(
		resolvedPreferenceScopeId ? generationPreferencesQueryKey(resolvedPreferenceScopeId) : null,
		() => getGenerationPreferences(resolvedPreferenceScopeId),
	);
	const { data: taskData, mutate: mutateTasks } = useSWR(
		needsConversation
			? null
			: generationTasksQueryKey(conversationId, initialKind, taskScopeId, taskProjectId),
		() => getGenerationTasks(conversationId, initialKind, taskScopeId, taskProjectId),
	);
	const { data: projectBrief, isLoading: isLoadingProjectBrief } = useSWR(
		projectId ? projectBriefKey(projectId) : null,
		() => getProjectBrief(projectId ?? ""),
	);
	const { data: stylePresets = [] } = useSWR(
		projectStyleOnly ? null : stylePresetsKey,
		listStylePresets,
	);
	// 项目每层默认:载入项目配置 + 全部预设,把默认层(风格/其他)解析成可叠加的风格串。
	const { data: projectConfig } = useSWR(projectId ? projectConfigKey(projectId) : null, () =>
		getProjectConfig(projectId ?? ""),
	);
	const { data: allPresets = emptyPromptPresets } = useSWR(promptPresetsKey, () =>
		listPromptPresets(),
	);
	// 分层组合器:该任务类型展示的库内文字层 + 每层选择(从项目默认初始化,可在生成处改)。
	const composerLayerKeys = useMemo(() => taskTypeLayers(taskType), [taskType]);
	const [layerSelections, setLayerSelections] = useState<Partial<Record<PromptLayer, string>>>({});
	useEffect(() => {
		const layerDefaults = projectConfig?.overview.layerDefaults ?? {};
		setLayerSelections(() => {
			const next: Partial<Record<PromptLayer, string>> = {};
			for (const layer of composerLayerKeys) next[layer] = layerDefaults[layer] ?? "";
			return next;
		});
	}, [projectConfig, composerLayerKeys]);
	const setLayerSelection = useCallback((layer: PromptLayer, presetId: string) => {
		setLayerSelections((current) => ({ ...current, [layer]: presetId }));
	}, []);
	const composerLayers = useMemo(
		() =>
			composerLayerKeys.map((layer) => ({
				layer,
				presets: allPresets.filter((preset) => preset.layer === layer),
				selectedId: layerSelections[layer] ?? "",
			})),
		[composerLayerKeys, allPresets, layerSelections],
	);
	const projectStylePrompt = useMemo(() => {
		const texts = composerLayerKeys.flatMap((layer) => {
			const presetID = layerSelections[layer];
			if (!presetID) return [];
			const preset = allPresets.find((item) => item.id === presetID && item.layer === layer);
			const text = preset?.prompt.trim();
			return text ? [text] : [];
		});
		const composed = composeLayerStyle(texts);
		if (composed) return composed;
		// 回退:旧 freeform 风格(无损迁移期)。
		return projectConfig?.overview.style?.trim() || projectBrief?.style?.trim() || "";
	}, [composerLayerKeys, layerSelections, allPresets, projectConfig, projectBrief]);
	const {
		catalog,
		hasConfiguredRoutesForKind,
		hasLiveCatalog,
		kind,
		selectedFamily,
		selectedParams,
		selectedRoute,
		selectedStylePreset,
		selectedVersion,
		setKind,
		setStylePresetId,
		stylePresetId,
		updateFamily,
		updateModelRoute,
		updateParam,
		updateRoute,
		updateVersion,
		visibleFamilyRoutes,
		visibleFamilies,
		visibleRoutes,
		visibleVersions,
	} = useGenerationModelSelection({
		generationPreferences,
		initialKind,
		modelCatalog,
		mutatePreferences,
		preferenceScopeId: resolvedPreferenceScopeId,
		stylePresets,
	});
	// 项目级会话里混了同项目所有章节/分镜的任务；按 sectionId 过滤出当前章节自己的。
	// 创作台不传 sectionId，看到全部。
	const trimmedSectionId = sectionId?.trim() ?? "";
	const allRecentTasks = taskData?.tasks ?? [];
	const recentTasks = trimmedSectionId
		? allRecentTasks.filter((task) => task.sectionId === trimmedSectionId)
		: allRecentTasks;
	const mutateProjectGenerationTasks = useCallback(
		(requestKind: GenerationKind) => {
			if (!mediaAssetProjectId) return;
			void mutateSWR(
				generationTasksQueryKey(
					null,
					requestKind,
					generationProjectConversationScopeId(mediaAssetProjectId),
					mediaAssetProjectId,
				),
			);
		},
		[mediaAssetProjectId],
	);
	const {
		activeMediaAssetId,
		filteredMediaAssets,
		mediaAssets,
		mediaKindFilter,
		mediaQuery,
		mutateMediaAssets,
		removeMediaAsset: removeMediaAssetFromLibrary,
		renameMediaAsset,
		setMediaKindFilter,
		setMediaQuery,
	} = useGenerationMediaLibrary({
		mediaAssetProjectId,
		setError,
	});
	const {
		effectiveReferenceAssetIds,
		effectiveReferenceUrls,
		isUploadingAsset,
		referenceCount,
		removeReferenceAsset,
		selectReferenceAsset,
		selectableReferenceKinds,
		selectedReferenceAssetIds,
		selectedReferenceAssets,
		toggleReferenceAsset,
		uploadReferenceAsset,
	} = useGenerationReferences({
		extraReferenceAssetIds,
		extraReferenceUrls,
		mediaAssetProjectId,
		mediaAssets,
		mutateMediaAssets,
		prompt,
		selectedRoute,
		setError,
	});
	const removeMediaAsset = useCallback(
		async (asset: MediaAsset) => {
			const didRemove = await removeMediaAssetFromLibrary(asset);
			if (didRemove) removeReferenceAsset(asset.id);
		},
		[removeMediaAssetFromLibrary, removeReferenceAsset],
	);
	const {
		activeEntry,
		activeEntryId,
		conversationMessages,
		generationEntries,
		orderedGenerationEntries,
		setActiveEntryId,
		setMessages,
	} = useGenerationMessages({
		activeEntryId: controlledActiveEntryId,
		catalog,
		historyScopeId,
		mediaAssets,
		onActiveEntryIdChange,
		recentTasks,
	});

	useEffect(() => {
		setPrompt(initialPrompt);
	}, [initialPrompt]);

	const { isSubmitting, submit, submitGeneration } = useGenerationSubmit({
		conversationId,
		conversationTitle,
		effectiveReferenceAssetIds,
		effectiveReferenceUrls,
		extraPrompt,
		isLoadingProjectBrief,
		mediaAssetProjectId,
		mediaAssets,
		mutateMediaAssets,
		mutateProjectGenerationTasks,
		mutateTasks,
		notificationTarget,
		onSubmitError,
		onSubmitFailure,
		onSubmitResponse,
		onSubmitStart,
		onSubmitSuccess,
		projectBrief,
		projectStylePrompt,
		projectId,
		prompt,
		requireConversation,
		resolvedConversationScopeId,
		sectionId: trimmedSectionId,
		selectedFamily,
		selectedParams,
		selectedRoute,
		selectedVersion,
		setActiveEntryId,
		setError,
		setMessages,
		setPrompt,
	});
	const {
		deletedAssetPlaceholderCounts,
		deleteGenerationEntry,
		deleteGenerationEntryAsset,
		deletingAssetKeys,
		deletingEntryIds,
		refreshVideo,
	} = useGenerationTaskActions({
		conversationId,
		conversationMessages,
		initialKind,
		kind,
		mutateMediaAssets,
		mutateProjectGenerationTasks,
		mutateTasks,
		resolvedConversationScopeId,
		setActiveEntryId,
		setError,
		setMessages,
	});

	const canSubmit =
		hasConfiguredRoutesForKind &&
		Boolean(prompt.trim()) &&
		!needsConversation &&
		!(projectId && isLoadingProjectBrief) &&
		isConfiguredRoute(selectedRoute);
	const fullPrompt = useMemo(() => {
		const nextPrompt = prompt.trim();
		if (!nextPrompt) return "";

		return generationRequestPrompt({
			extraPrompt: resolveGenerationExtraValue(extraPrompt, nextPrompt),
			kind: selectedRoute.kind,
			projectStylePrompt: projectStylePrompt?.trim() || projectBrief?.style,
			prompt: nextPrompt,
		});
	}, [extraPrompt, projectBrief?.style, projectStylePrompt, prompt, selectedRoute.kind]);

	return {
		activeEntry,
		activeEntryId,
		activeMediaAssetId,
		canSubmit,
		catalog,
		composerLayers,
		conversationMessages,
		deletedAssetPlaceholderCounts,
		deleteGenerationEntry,
		deleteGenerationEntryAsset,
		deletingAssetKeys,
		setLayerSelection,
		deletingEntryIds,
		error,
		filteredMediaAssets,
		fullPrompt,
		generationEntries,
		hasConfiguredRoutesForKind,
		hasLiveCatalog,
		isSubmitting,
		isUploadingAsset,
		kind,
		mediaAssets,
		mediaKindFilter,
		mediaQuery,
		mutateMediaAssets,
		needsConversation,
		orderedGenerationEntries,
		prompt,
		referenceCount,
		refreshVideo,
		removeMediaAsset,
		renameMediaAsset,
		selectableReferenceKinds,
		selectedFamily,
		selectedParams,
		selectedReferenceAssetIds,
		selectedReferenceAssets,
		selectedRoute,
		selectedStylePreset,
		selectedVersion,
		selectReferenceAsset,
		setActiveEntryId,
		setStylePresetId,
		setKind,
		setMediaKindFilter,
		setMediaQuery,
		setPrompt,
		submit,
		submitGeneration,
		toggleReferenceAsset,
		updateFamily,
		updateModelRoute,
		updateParam,
		updateRoute,
		updateVersion,
		uploadIdPrefix,
		uploadReferenceAsset,
		visibleFamilyRoutes,
		visibleFamilies,
		visibleRoutes,
		visibleVersions,
		stylePresetId,
		stylePresets,
	};
};
