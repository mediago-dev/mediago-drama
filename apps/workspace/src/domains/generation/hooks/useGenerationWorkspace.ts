import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate as mutateSWR } from "swr";
import {
	type GenerationKind,
	type GenerationMessageRequest,
	type GenerationNotificationOpenTarget,
	generationConversationsQueryKey,
	generationModelsKey,
	generationPreferencesQueryKey,
	generationProjectConversationScopeId,
	generationTasksQueryKey,
	getGenerationModels,
	getGenerationPreferences,
	getGenerationTasks,
	importGenerationMediaAssets,
} from "@/domains/generation/api/generation";
import {
	type PromptPreset,
	listPromptPresets,
	listStylePresets,
	promptPresetsKey,
	stylePresetsKey,
} from "@/domains/generation/api/prompt-presets";
import {
	listPromptCategories,
	type PromptCategory,
	promptCategoriesKey,
} from "@/domains/generation/api/prompt-categories";
import {
	defaultPromptCategories,
	type GenerationTaskType,
} from "@/domains/generation/lib/prompt-categories";
import { promptInsertItemsFromPresets } from "@/domains/generation/lib/prompt-insertions";
import type { MediaAsset } from "@/domains/workspace/api/media";
import {
	filterGenerationTasksForScope,
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

// 稳定的空数组引用,避免 SWR 加载中的新 `[]` 引用引发 slash 插入项反复重算。
const emptyPromptPresets: PromptPreset[] = [];
const emptyPromptCategories: PromptCategory[] = defaultPromptCategories;

export interface UseGenerationWorkspaceOptions {
	extraPrompt?: GenerationExtraValue<string>;
	extraReferenceAssetIds?: GenerationExtraValue<string[]>;
	extraReferenceUrls?: GenerationExtraValue<string[]>;
	assetTitle?: string | null;
	activeEntryId?: string | null;
	conversationId?: string | null;
	conversationScopeId?: string | null;
	conversationTitle?: string | null;
	documentContext?: GenerationMessageRequest["documentContext"] | null;
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
	useRawPrompt?: boolean;
	onActiveEntryIdChange?: (entryId: string | null) => void;
	onSubmitFailure?: (event: GenerationSubmitFailureEvent) => void;
	onSubmitResponse?: (event: GenerationSubmitResponseEvent) => void;
	onSubmitStart?: (event: GenerationSubmitStartEvent) => void;
	onSubmitSuccess?: (kind: GenerationKind) => void;
	onSubmitError?: (message: string) => void;
}

interface ImportMediaAssetsToHistoryOptions {
	assetTitle?: string;
	prompt?: string;
}

export const useGenerationWorkspace = ({
	activeEntryId: controlledActiveEntryId,
	assetTitle,
	conversationId,
	conversationScopeId,
	conversationTitle,
	documentContext,
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
	useRawPrompt = false,
}: UseGenerationWorkspaceOptions = {}) => {
	const promptRef = useRef(initialPrompt);
	const [prompt, setPromptState] = useState(initialPrompt);
	const setPrompt = useCallback((next: React.SetStateAction<string>) => {
		const resolved =
			typeof next === "function" ? (next as (current: string) => string)(promptRef.current) : next;
		promptRef.current = resolved;
		setPromptState(resolved);
	}, []);
	const [error, setError] = useState<string | null>(null);
	const [isImportingMediaAssets, setIsImportingMediaAssets] = useState(false);
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
	const { data: stylePresets = [] } = useSWR(
		projectStyleOnly ? null : stylePresetsKey,
		listStylePresets,
	);
	const { data: allPresets = emptyPromptPresets } = useSWR(promptPresetsKey, () =>
		listPromptPresets(),
	);
	const { data: promptCategories = emptyPromptCategories } = useSWR(
		promptCategoriesKey,
		listPromptCategories,
	);
	const {
		catalog,
		hasConfiguredRoutesForKind,
		hasLiveCatalog,
		kind,
		rememberSelectedModel,
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
	const promptInsertItems = useMemo(
		() => promptInsertItemsFromPresets(allPresets, promptCategories),
		[allPresets, promptCategories],
	);
	// 项目级会话里混了同项目所有章节/分镜的任务；按 project/document/section 过滤出当前节点自己的。
	// 创作台不传 sectionId，看到全部。
	const trimmedSectionId = sectionId?.trim() ?? "";
	const trimmedDocumentId = documentContext?.documentId?.trim() ?? "";
	const trimmedTaskProjectId =
		documentContext?.projectId?.trim() || mediaAssetProjectId || projectId?.trim() || "";
	const allRecentTasks = taskData?.tasks ?? [];
	const recentTasks = filterGenerationTasksForScope(allRecentTasks, {
		documentId: trimmedDocumentId,
		projectId: trimmedTaskProjectId,
		sectionId: trimmedSectionId,
	});
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
	}, [initialPrompt, setPrompt]);

	const { isSubmitting, submit, submitGeneration } = useGenerationSubmit({
		assetTitle,
		conversationId,
		conversationTitle,
		documentContext,
		documentContextInitialPrompt: initialPrompt,
		effectiveReferenceAssetIds,
		effectiveReferenceUrls,
		extraPrompt,
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
		rememberSelectedModel,
		prompt,
		promptRef,
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
		taskType,
		useRawPrompt,
	});
	const {
		deletedAssetPlaceholderCounts,
		deleteGenerationEntry,
		deleteGenerationEntryAsset,
		deleteGenerationEntryAssetPlaceholder,
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

	const importMediaAssetsToHistory = useCallback(
		async (assets: MediaAsset[], options: ImportMediaAssetsToHistoryOptions = {}) => {
			const assetIds = assets
				.filter((asset) => asset.kind === "image")
				.map((asset) => asset.id.trim())
				.filter(Boolean);
			if (assetIds.length === 0) return [];

			setError(null);
			setIsImportingMediaAssets(true);
			try {
				const response = await importGenerationMediaAssets({
					kind: "image",
					conversationId: conversationId ?? undefined,
					scopeId: resolvedConversationScopeId,
					conversationTitle: conversationTitle ?? undefined,
					projectId: mediaAssetProjectId || undefined,
					documentId: trimmedDocumentId || undefined,
					sectionId: trimmedSectionId || undefined,
					capabilityId: taskType,
					assetIds,
					assetTitle: options.assetTitle,
					prompt: options.prompt,
				});
				await mutateTasks();
				mutateProjectGenerationTasks("image");
				void mutateSWR(generationConversationsQueryKey("image", resolvedConversationScopeId));
				void mutateSWR(generationConversationsQueryKey("image", "", { allScopes: true }));
				return response.tasks;
			} finally {
				setIsImportingMediaAssets(false);
			}
		},
		[
			conversationId,
			conversationTitle,
			mediaAssetProjectId,
			mutateProjectGenerationTasks,
			mutateTasks,
			resolvedConversationScopeId,
			taskType,
			trimmedSectionId,
		],
	);

	const canSubmit =
		hasConfiguredRoutesForKind &&
		Boolean(prompt.trim()) &&
		!needsConversation &&
		isConfiguredRoute(selectedRoute);
	const fullPrompt = useMemo(() => {
		const nextPrompt = prompt.trim();
		if (!nextPrompt) return "";
		if (useRawPrompt) return prompt;

		return generationRequestPrompt({
			extraPrompt: resolveGenerationExtraValue(extraPrompt, nextPrompt),
			prompt: nextPrompt,
		});
	}, [extraPrompt, prompt, useRawPrompt]);

	return {
		activeEntry,
		activeEntryId,
		activeMediaAssetId,
		canSubmit,
		catalog,
		conversationMessages,
		deletedAssetPlaceholderCounts,
		deleteGenerationEntry,
		deleteGenerationEntryAsset,
		deleteGenerationEntryAssetPlaceholder,
		deletingAssetKeys,
		deletingEntryIds,
		error,
		filteredMediaAssets,
		fullPrompt,
		generationEntries,
		hasConfiguredRoutesForKind,
		hasLiveCatalog,
		isSubmitting,
		isImportingMediaAssets,
		isUploadingAsset,
		importMediaAssetsToHistory,
		kind,
		mediaAssets,
		mediaKindFilter,
		mediaQuery,
		mutateMediaAssets,
		mutateTasks,
		needsConversation,
		orderedGenerationEntries,
		prompt,
		promptInsertItems,
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
