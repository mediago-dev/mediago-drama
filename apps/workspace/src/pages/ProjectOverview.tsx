import {
	ArrowUpRight,
	Check,
	FileText,
	Film,
	GitBranch,
	List,
	Loader2,
	Pause,
	Palette,
	Play,
	ReceiptText,
	Rows3,
	X,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { PhotoProvider, PhotoView } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { dialogContentMotion } from "@/shared/components/ui/dialog-motion";
import { Navigate, useLocation } from "react-router-dom";
import useSWR from "swr";
import type {
	GenerationBatchRequest,
	GenerationMessageRequest,
	GenerationNotificationOpenTarget,
	GenerationTask,
} from "@/domains/generation/api/generation";
import {
	generationProjectConversationScopeId,
	generationTasksQueryKey,
	projectGenerationConversation,
	type SelectedGenerationAsset,
	getGenerationTasks,
	sendGenerationBatch,
} from "@/domains/generation/api/generation";
import { MediaGenerationDialog } from "@/domains/generation/components/MediaGenerationDialog";
import { useSelectedGenerationAssets } from "@/domains/generation/hooks/useSelectedGenerationAssets";
import {
	type MediaGenerationDialogRequest,
	useMediaGenerationStore,
} from "@/domains/generation/stores/media-generation";
import { GenerationModalShell } from "@/domains/documents/components/GenerationModalShell";
import { EpisodeTimelineView } from "@/domains/episode/components/EpisodeTimelineView";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { useDocumentsStore } from "@/domains/documents/stores";
import { generationAssetSource } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import {
	appendBatchPromptSupplements,
	BatchGenerationSettingsDialog,
	type BatchGenerationSettings,
} from "@/domains/generation/components/BatchGenerationSettingsDialog";
import {
	selectedGenerationResourceDescriptorMap,
	selectedGenerationResourceDescriptors,
} from "@/domains/generation/lib/selected-resources";
import {
	generationStatusForSection,
	generationTaskTime,
	hasPendingGenerationTasks,
	isPendingGenerationStatus,
	mergeResourceGenerationStatusMaps,
	type ResourceGenerationStatus,
	resourceGenerationStatusBadgeClassName,
	resourceGenerationStatusKind,
	resourceGenerationStatusTime,
	resourceGenerationStatusTitle,
	visibleResourceGenerationStatus,
} from "@/domains/generation/lib/resource-generation-status";
import { taskTypeForCategory } from "@/domains/generation/lib/prompt-categories";
import {
	billingSummaryKey,
	getBillingSummary,
	type BillingSummaryResponse,
} from "@/domains/billing/api/billing";
import { getProjectConfig, projectConfigKey } from "@/domains/projects/api/projects";
import {
	getWorkspaceDocumentResources,
	getWorkspaceDocuments,
	getWorkspaceStoryboardVideoResources,
	workspaceDocumentResourcesKey,
	workspaceDocumentsKey,
	workspaceStoryboardVideoResourcesKey,
	type WorkspaceDocumentResource,
	type WorkspaceStoryboardVideoDocumentGroup,
	type WorkspaceStoryboardVideoReel,
} from "@/domains/workspace/api/workspace";
import { ProjectWorkspaceShell } from "@/domains/workspace/components/ProjectWorkspaceShell";
import { getRouteProjectId, type AgentResourceType } from "@/domains/workspace/lib/workbench-route";
import { useProjectStore } from "@/domains/projects/stores";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { DialogClose } from "@/shared/components/ui/dialog-dismiss";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { useToast } from "@/hooks/useToast";
import { apiResourceURL } from "@/shared/lib/api-base";
import { cn } from "@/shared/lib/utils";

const numberFormatter = new Intl.NumberFormat("zh-CN");
const moneyFormatter = new Intl.NumberFormat("zh-CN", {
	maximumFractionDigits: 6,
	minimumFractionDigits: 0,
});

type OverviewBatchGenerationDialogState =
	| {
			kind: "image";
			resources: WorkspaceDocumentResource[];
	  }
	| {
			group: WorkspaceStoryboardVideoDocumentGroup;
			kind: "video";
			reels: WorkspaceStoryboardVideoReel[];
	  };

type StoryboardVideoResourcesDialogTab = "list" | "canvas" | "preview";

export const ProjectOverview: React.FC = () => {
	const location = useLocation();
	const toast = useToast();
	const projectId = getRouteProjectId(location.search);
	const activeProjectId = useProjectStore((state) => state.activeProjectId);
	const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);
	const [documentResourceDialogType, setDocumentResourceDialogType] =
		useState<AgentResourceType | null>(null);
	const [batchGenerationDialog, setBatchGenerationDialog] =
		useState<OverviewBatchGenerationDialogState | null>(null);
	const [mediaGenerationRequest, setMediaGenerationRequest] =
		useState<MediaGenerationDialogRequest | null>(null);
	const optimisticGenerationStatuses = useMediaGenerationStore((state) => state.optimisticStatuses);
	const markGenerating = useMediaGenerationStore((state) => state.markGenerating);
	const markFailed = useMediaGenerationStore((state) => state.markFailed);
	const clearStatus = useMediaGenerationStore((state) => state.clearStatus);
	const clearStatuses = useMediaGenerationStore((state) => state.clearStatuses);
	const [storyboardVideoDocumentId, setStoryboardVideoDocumentId] = useState<string | null>(null);
	const refreshedSelectedAssetTaskKeysRef = useRef<Set<string>>(new Set());
	const hydrateWorkspaceDocuments = useDocumentsStore((state) => state.hydrateWorkspaceDocuments);
	const convertDocumentToWorkbenchDraft = useDocumentsStore(
		(state) => state.convertDocumentToWorkbenchDraft,
	);
	const usageParams = useMemo(
		() => (projectId ? { groupBy: "capability", projectId } : null),
		[projectId],
	);
	const projectGenerationScopeId = useMemo(
		() => (projectId ? generationProjectConversationScopeId(projectId) : ""),
		[projectId],
	);
	const hasPendingOptimisticGenerationStatuses = useMemo(
		() =>
			Object.values(optimisticGenerationStatuses).some((status) =>
				isPendingGenerationStatus(status.status),
			),
		[optimisticGenerationStatuses],
	);
	const {
		data: config,
		error,
		isLoading,
	} = useSWR(projectId ? projectConfigKey(projectId) : null, () =>
		getProjectConfig(projectId ?? ""),
	);
	const {
		data: usageSummary,
		error: usageError,
		isLoading: isUsageLoading,
	} = useSWR(usageParams ? billingSummaryKey(usageParams) : null, () =>
		getBillingSummary(usageParams ?? { groupBy: "capability" }),
	);
	const { assets: selectedGenerationAssets, mutate: mutateSelectedResources } =
		useSelectedGenerationAssets(projectId);
	const { data: imageTaskData, mutate: mutateImageTasks } = useSWR(
		projectId ? generationTasksQueryKey(null, "image", projectGenerationScopeId, projectId) : null,
		() => getGenerationTasks(null, "image", projectGenerationScopeId, projectId),
		{
			refreshInterval: (data) =>
				hasPendingGenerationTasks(data?.tasks ?? []) || hasPendingOptimisticGenerationStatuses
					? 5000
					: 0,
		},
	);
	const { data: videoTaskData, mutate: mutateVideoTasks } = useSWR(
		projectId ? generationTasksQueryKey(null, "video", projectGenerationScopeId, projectId) : null,
		() => getGenerationTasks(null, "video", projectGenerationScopeId, projectId),
		{
			refreshInterval: (data) =>
				hasPendingGenerationTasks(data?.tasks ?? []) || hasPendingOptimisticGenerationStatuses
					? 5000
					: 0,
		},
	);
	const {
		data: storyboardVideoResources,
		error: storyboardVideoResourcesError,
		isLoading: isStoryboardVideoResourcesLoading,
		mutate: mutateStoryboardVideoResources,
	} = useSWR(projectId ? workspaceStoryboardVideoResourcesKey(projectId) : null, () =>
		getWorkspaceStoryboardVideoResources(projectId ?? ""),
	);
	const { data: workspaceDocuments } = useSWR(
		projectId ? workspaceDocumentsKey(projectId) : null,
		() => getWorkspaceDocuments(projectId ?? ""),
	);
	const {
		data: workspaceDocumentResources,
		error: documentResourcesError,
		isLoading: isDocumentResourcesLoading,
		mutate: mutateDocumentResources,
	} = useSWR(projectId ? workspaceDocumentResourcesKey(projectId) : null, () =>
		getWorkspaceDocumentResources(projectId ?? ""),
	);

	useEffect(() => {
		if (projectId && activeProjectId !== projectId) setActiveProjectId(projectId);
	}, [activeProjectId, projectId, setActiveProjectId]);

	useEffect(() => {
		if (workspaceDocuments) hydrateWorkspaceDocuments(workspaceDocuments);
	}, [hydrateWorkspaceDocuments, workspaceDocuments]);

	useEffect(() => {
		setDocumentResourceDialogType(null);
		setBatchGenerationDialog(null);
		setMediaGenerationRequest(null);
		clearStatuses();
		setStoryboardVideoDocumentId(null);
		refreshedSelectedAssetTaskKeysRef.current.clear();
	}, [projectId]);

	const documentResources = workspaceDocumentResources?.resources ?? [];
	const storyboardVideoGroups = storyboardVideoResources?.groups ?? [];
	const optimisticGenerationStatusMap = useMemo(
		() => new Map(Object.entries(optimisticGenerationStatuses)),
		[optimisticGenerationStatuses],
	);
	const documentResourceTaskStatuses = useMemo(
		() => documentResourceGenerationStatusMap(documentResources, imageTaskData?.tasks ?? []),
		[documentResources, imageTaskData?.tasks],
	);
	const storyboardReelTaskStatuses = useMemo(
		() => storyboardReelGenerationStatusMap(storyboardVideoGroups, videoTaskData?.tasks ?? []),
		[storyboardVideoGroups, videoTaskData?.tasks],
	);
	const documentResourceGenerationStatuses = useMemo(
		() =>
			mergeResourceGenerationStatusMaps(
				documentResourceTaskStatuses,
				optimisticGenerationStatusMap,
			),
		[documentResourceTaskStatuses, optimisticGenerationStatusMap],
	);
	const storyboardReelGenerationStatuses = useMemo(
		() =>
			mergeResourceGenerationStatusMaps(storyboardReelTaskStatuses, optimisticGenerationStatusMap),
		[storyboardReelTaskStatuses, optimisticGenerationStatusMap],
	);
	const activeStoryboardVideoGroup = useMemo(
		() =>
			storyboardVideoGroups.find((group) => group.documentId === storyboardVideoDocumentId) ?? null,
		[storyboardVideoDocumentId, storyboardVideoGroups],
	);
	const batchGenerationDialogSelectedCount =
		batchGenerationDialog?.kind === "image"
			? batchGenerationDialog.resources.length
			: (batchGenerationDialog?.reels.length ?? 0);

	useEffect(() => {
		const realStatuses = new Map([
			...documentResourceTaskStatuses.entries(),
			...storyboardReelTaskStatuses.entries(),
		]);
		if (realStatuses.size === 0) return;

		for (const [resourceId, status] of Object.entries(
			useMediaGenerationStore.getState().optimisticStatuses,
		)) {
			const realStatus = realStatuses.get(resourceId);
			if (
				realStatus &&
				resourceGenerationStatusTime(realStatus) >= resourceGenerationStatusTime(status)
			) {
				clearStatus(resourceId);
			}
		}
	}, [clearStatus, documentResourceTaskStatuses, storyboardReelTaskStatuses]);

	useEffect(() => {
		if (!projectId) return;

		// 生成完成后服务端会把选中切到最新结果；这里检测到新完成的图片/视频任务就重拉
		// 选中资源 + 视频生成/图片和音频列表，让外部列表反映新的选中与「已生成」计数。
		const refreshKeys = [
			...completedResourceTaskSelectedAssetsRefreshKeys(imageTaskData?.tasks ?? []),
			...completedResourceTaskSelectedAssetsRefreshKeys(videoTaskData?.tasks ?? []),
		];
		const pendingKeys = refreshKeys.filter(
			(key) => !refreshedSelectedAssetTaskKeysRef.current.has(key),
		);
		if (pendingKeys.length === 0) return;

		for (const key of pendingKeys) {
			refreshedSelectedAssetTaskKeysRef.current.add(key);
		}
		void mutateSelectedResources();
		void mutateStoryboardVideoResources();
		void mutateDocumentResources();
	}, [
		imageTaskData?.tasks,
		videoTaskData?.tasks,
		mutateSelectedResources,
		mutateStoryboardVideoResources,
		mutateDocumentResources,
		projectId,
	]);

	const createdAtLabel = useMemo(() => {
		if (!config?.createdAt) return "";
		const date = new Date(config.createdAt);
		if (Number.isNaN(date.getTime())) return config.createdAt;
		return date.toLocaleString();
	}, [config?.createdAt]);

	const openDocumentResourceType = useCallback((resourceType: AgentResourceType) => {
		setDocumentResourceDialogType(resourceType);
	}, []);
	const openImageGeneration = useCallback(
		(resource: WorkspaceDocumentResource) => {
			setMediaGenerationRequest({
				kind: "image",
				projectId: projectId ?? undefined,
				section: documentResourceToSectionContext(resource),
				statusResourceKey: resource.id,
			});
		},
		[projectId],
	);
	const openAudioSelection = useCallback(
		(resource: WorkspaceDocumentResource) => {
			setMediaGenerationRequest({
				kind: "audio",
				projectId: projectId ?? undefined,
				section: documentResourceToSectionContext(resource),
				selectedAssetResourceType: resource.type,
				statusResourceKey: resource.id,
			});
		},
		[projectId],
	);
	const openImageGenerationBatch = useCallback((resources: WorkspaceDocumentResource[]) => {
		if (resources.length === 0) return;
		setBatchGenerationDialog({ kind: "image", resources });
	}, []);
	const openStoryboardVideoGeneration = useCallback(
		(group: WorkspaceStoryboardVideoDocumentGroup, reel: WorkspaceStoryboardVideoReel) => {
			setMediaGenerationRequest({
				kind: "video",
				projectId: projectId ?? undefined,
				section: storyboardReelToSectionContext(group, reel),
				resolveLatestSection: false,
				statusResourceKey: reel.id,
			});
		},
		[projectId],
	);
	const openStoryboardVideoGenerationBatch = useCallback(
		(group: WorkspaceStoryboardVideoDocumentGroup, reels: WorkspaceStoryboardVideoReel[]) => {
			if (reels.length === 0) return;
			setBatchGenerationDialog({ group, kind: "video", reels });
		},
		[],
	);
	const prepareStoryboardWorkbench = useCallback(
		(group: WorkspaceStoryboardVideoDocumentGroup) => {
			convertDocumentToWorkbenchDraft(group.documentId);
		},
		[convertDocumentToWorkbenchDraft],
	);
	const confirmBatchGeneration = useCallback(
		async (settings: BatchGenerationSettings) => {
			if (!batchGenerationDialog || !projectId) return;
			const kind = batchGenerationDialog.kind;
			const items = overviewBatchGenerationItems(batchGenerationDialog, settings, projectId);
			if (items.length === 0) return;

			setBatchGenerationDialog(null);
			for (const item of items) {
				if (!item.id) continue;
				markGenerating(item.id, {
					message: "正在提交服务端批量生成。",
					taskId: `local:${item.id}`,
				});
			}
			const submissionToastKey = toast.info("正在提交批量生成", {
				description: `本次共 ${items.length} 项，将由服务端统一创建任务。`,
			});

			try {
				const conversation = projectGenerationConversation(projectId, kind, config?.name);
				const response = await sendGenerationBatch({
					conversationTitle: conversation?.conversationTitle,
					kind,
					projectId,
					scopeId: conversation?.conversationScopeId ?? projectGenerationScopeId,
					sessionId: conversation?.conversationId,
					items,
				});
				for (const result of response.items) {
					const resourceId = result.id.trim();
					if (!resourceId) continue;
					if (result.taskId && !isFailedGenerationBatchStatus(result.status)) {
						markGenerating(resourceId, {
							message: result.message || "批量生成任务已提交。",
							taskId: result.taskId,
						});
					} else {
						markFailed(resourceId, {
							message: result.error || "批量生成子任务提交失败。",
							taskId: `batch:${response.id}:${result.index}`,
						});
					}
				}
				if (kind === "image") void mutateImageTasks();
				if (kind === "video") void mutateVideoTasks();
				if (response.failed > 0) {
					toast.update(submissionToastKey, "部分批量任务提交失败", "error", {
						description: `成功 ${response.accepted} 项，失败 ${response.failed} 项。`,
					});
				} else {
					toast.update(submissionToastKey, "批量任务已提交", "success", {
						description: `服务端批次 ${response.id} 已创建 ${response.accepted} 个任务。`,
					});
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : "批量生成提交失败。";
				for (const item of items) {
					if (!item.id) continue;
					markFailed(item.id, { message, taskId: `local:${item.id}` });
				}
				toast.update(submissionToastKey, "批量生成提交失败", "error", {
					description: message,
				});
			}
		},
		[
			batchGenerationDialog,
			config?.name,
			markFailed,
			markGenerating,
			mutateImageTasks,
			mutateVideoTasks,
			projectGenerationScopeId,
			projectId,
			toast,
		],
	);
	const closeBatchGenerationDialog = useCallback((open: boolean) => {
		if (!open) setBatchGenerationDialog(null);
	}, []);

	if (!projectId) return <Navigate to="/" replace />;

	return (
		<ProjectWorkspaceShell>
			<div className="flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
				<div className="min-h-0 flex-1 overflow-y-auto bg-ide-editor">
					<main className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 px-4 py-4">
						<header className="flex flex-col gap-3 border-b border-border pb-3 md:flex-row md:items-center">
							<div className="flex min-w-0 items-center gap-2">
								<Palette className="size-5 shrink-0 text-muted-foreground" />
								<div className="min-w-0">
									<p className="truncate text-sm font-medium text-foreground">
										{config?.name || projectId}
									</p>
									{createdAtLabel ? (
										<p className="truncate text-xs text-muted-foreground">
											创建于 {createdAtLabel}
										</p>
									) : null}
								</div>
							</div>
						</header>

						{isLoading ? (
							<div className="grid min-h-56 place-items-center border border-border bg-card">
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<Loader2 className="size-4 animate-spin" />
									<span>正在加载项目概览</span>
								</div>
							</div>
						) : null}

						{error ? (
							<div className="rounded-sm border border-error-border bg-error-surface p-4 text-sm text-error-foreground">
								项目概览加载失败。
							</div>
						) : null}

						{config && !isLoading ? (
							<section className="grid gap-4">
								<ProjectUsageSummary
									data={usageSummary}
									error={usageError}
									isLoading={isUsageLoading}
								/>
								<DocumentResourcesSummary
									assets={selectedGenerationAssets}
									error={documentResourcesError}
									isLoading={isDocumentResourcesLoading}
									resources={documentResources}
									onOpen={openDocumentResourceType}
								/>
								<StoryboardVideoResourcesSummary
									error={storyboardVideoResourcesError}
									groups={storyboardVideoGroups}
									isLoading={isStoryboardVideoResourcesLoading}
									onOpen={setStoryboardVideoDocumentId}
								/>
								<StoryboardVideoResourcesDialog
									error={storyboardVideoResourcesError}
									generationStatuses={storyboardReelGenerationStatuses}
									group={activeStoryboardVideoGroup}
									isLoading={isStoryboardVideoResourcesLoading}
									open={Boolean(activeStoryboardVideoGroup)}
									onBatchGenerate={openStoryboardVideoGenerationBatch}
									onGenerate={openStoryboardVideoGeneration}
									onPrepareWorkbench={prepareStoryboardWorkbench}
									onOpenChange={(open) => {
										if (!open) setStoryboardVideoDocumentId(null);
									}}
								/>
								<DocumentResourcesDialog
									assets={selectedGenerationAssets}
									error={documentResourcesError}
									generationStatuses={documentResourceGenerationStatuses}
									isLoading={isDocumentResourcesLoading}
									open={Boolean(documentResourceDialogType)}
									resourceType={documentResourceDialogType}
									resources={documentResources}
									onBatchGenerate={openImageGenerationBatch}
									onGenerate={openImageGeneration}
									onSelectAudio={openAudioSelection}
									onOpenChange={(open) => {
										if (!open) setDocumentResourceDialogType(null);
									}}
								/>
								<MediaGenerationDialog
									open={Boolean(mediaGenerationRequest)}
									request={mediaGenerationRequest}
									onOpenChange={(open) => {
										if (!open) setMediaGenerationRequest(null);
									}}
								/>
								{batchGenerationDialog ? (
									<BatchGenerationSettingsDialog
										kind={batchGenerationDialog.kind}
										open
										projectId={projectId}
										selectedCount={batchGenerationDialogSelectedCount}
										onConfirm={confirmBatchGeneration}
										onOpenChange={closeBatchGenerationDialog}
									/>
								) : null}
							</section>
						) : null}
					</main>
				</div>
			</div>
		</ProjectWorkspaceShell>
	);
};

const DocumentResourcesDialog: React.FC<{
	assets: SelectedGenerationAsset[];
	error?: unknown;
	generationStatuses: Map<string, ResourceGenerationStatus>;
	isLoading: boolean;
	open: boolean;
	resourceType: AgentResourceType | null;
	resources: WorkspaceDocumentResource[];
	onBatchGenerate: (resources: WorkspaceDocumentResource[]) => void;
	onGenerate: (resource: WorkspaceDocumentResource) => void;
	onOpenChange: (open: boolean) => void;
	onSelectAudio: (resource: WorkspaceDocumentResource) => void;
}> = ({
	assets,
	error,
	generationStatuses,
	isLoading,
	open,
	resourceType,
	resources,
	onBatchGenerate,
	onGenerate,
	onOpenChange,
	onSelectAudio,
}) => {
	const descriptor = resourceType ? selectedGenerationResourceDescriptorMap[resourceType] : null;
	const filteredResources = useMemo(
		() => (resourceType ? resources.filter((resource) => resource.type === resourceType) : []),
		[resources, resourceType],
	);
	const selectableResources = useMemo(
		() => filteredResources.filter((resource) => resource.canGenerate),
		[filteredResources],
	);
	const selectableResourceIds = useMemo(
		() => selectableResources.map((resource) => resource.id),
		[selectableResources],
	);
	const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
	const selectedResourceIdSet = useMemo(() => new Set(selectedResourceIds), [selectedResourceIds]);
	const selectedResources = useMemo(
		() =>
			filteredResources.filter(
				(resource) => resource.canGenerate && selectedResourceIdSet.has(resource.id),
			),
		[filteredResources, selectedResourceIdSet],
	);
	const allSelectableResourcesSelected =
		selectableResources.length > 0 && selectedResources.length === selectableResources.length;
	const audioPreview = useDocumentResourceAudioPreview(open);

	useEffect(() => {
		setSelectedResourceIds([]);
	}, [open, resourceType]);

	useEffect(() => {
		const selectableIdSet = new Set(selectableResourceIds);
		setSelectedResourceIds((current) => current.filter((id) => selectableIdSet.has(id)));
	}, [selectableResourceIds]);

	const selectAllResources = useCallback(() => {
		setSelectedResourceIds(selectableResourceIds);
	}, [selectableResourceIds]);

	const clearSelectedResources = useCallback(() => {
		setSelectedResourceIds([]);
	}, []);
	const generateSelectedResources = useCallback(() => {
		if (selectedResources.length === 0) return;

		onBatchGenerate(selectedResources);
		setSelectedResourceIds([]);
	}, [onBatchGenerate, selectedResources]);

	const toggleSelectedResource = useCallback((resource: WorkspaceDocumentResource) => {
		if (!resource.canGenerate) return;
		setSelectedResourceIds((current) =>
			current.includes(resource.id)
				? current.filter((id) => id !== resource.id)
				: [...current, resource.id],
		);
	}, []);

	if (!descriptor) return null;

	const Icon = descriptor.icon;
	const titleId = `document-derived-resources-${descriptor.key}-title`;
	const supportsAudioSelection = descriptor.key === "character";
	const mediaLabel = supportsAudioSelection ? "图片和音频" : "图片";

	return (
		<GenerationModalShell
			open={open}
			title={
				<span className="flex min-w-0 items-center gap-2">
					<Icon className="size-4 shrink-0 text-muted-foreground" />
					<span className="truncate">
						{descriptor.label} · {mediaLabel}
					</span>
				</span>
			}
			titleId={titleId}
			contentClassName="h-[min(86vh,760px)]"
			onOpenChange={onOpenChange}
		>
			<div className="flex h-full min-h-0 flex-col bg-ide-editor">
				{isLoading ? (
					<div className="grid min-h-56 flex-1 place-items-center">
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							<span>正在解析{mediaLabel}</span>
						</div>
					</div>
				) : null}

				{!isLoading && error ? (
					<div className="m-4 rounded-sm border border-error-border bg-error-surface p-4 text-sm text-error-foreground">
						{mediaLabel}加载失败。
					</div>
				) : null}

				{!isLoading && !error && filteredResources.length === 0 ? (
					<div className="p-4 text-sm text-muted-foreground">
						当前没有从 {descriptor.label} 文档中解析出资源。
					</div>
				) : null}

				{!isLoading && !error && filteredResources.length > 0 ? (
					<>
						<BatchSelectionToolbar
							allSelected={allSelectableResourcesSelected}
							generateLabel="批量生成图片"
							selectedCount={selectedResources.length}
							totalCount={selectableResources.length}
							onClear={clearSelectedResources}
							onGenerate={generateSelectedResources}
							onSelectAll={selectAllResources}
						/>
						<div className="min-h-0 flex-1 overflow-y-auto p-4">
							<TooltipProvider delayDuration={180}>
								<PhotoProvider maskOpacity={0.84}>
									<div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
										{filteredResources.map((resource) => (
											<DocumentResourceCard
												key={resource.id}
												canSelectAudio={supportsAudioSelection}
												generationStatus={generationStatuses.get(resource.id)}
												generatedImageCount={resource.generatedImageCount}
												selectedAudio={
													supportsAudioSelection ? resourceSelectedAudio(resource, assets) : null
												}
												selectedImages={resourceSelectedImages(resource, assets)}
												resource={resource}
												selected={selectedResourceIdSet.has(resource.id)}
												playingAudioKey={audioPreview.playingAudioKey}
												onGenerate={onGenerate}
												onSelectAudio={onSelectAudio}
												onToggleAudioPreview={audioPreview.toggleAudioPreview}
												onToggleSelected={() => toggleSelectedResource(resource)}
											/>
										))}
									</div>
								</PhotoProvider>
							</TooltipProvider>
						</div>
					</>
				) : null}
			</div>
		</GenerationModalShell>
	);
};

const DocumentResourceCard: React.FC<{
	canSelectAudio: boolean;
	generationStatus?: ResourceGenerationStatus;
	generatedImageCount: number;
	playingAudioKey: string;
	resource: WorkspaceDocumentResource;
	selectedAudio: DocumentResourceSelectedAudio | null;
	selectedImages: DocumentResourceSelectedImage[];
	selected: boolean;
	onGenerate: (resource: WorkspaceDocumentResource) => void;
	onSelectAudio: (resource: WorkspaceDocumentResource) => void;
	onToggleAudioPreview: (audio: DocumentResourceSelectedAudio) => void;
	onToggleSelected: () => void;
}> = ({
	canSelectAudio,
	generationStatus,
	generatedImageCount,
	playingAudioKey,
	resource,
	selectedAudio,
	selectedImages,
	selected,
	onGenerate,
	onSelectAudio,
	onToggleAudioPreview,
	onToggleSelected,
}) => {
	const preview = selectedImages[0];
	const assetCount = selectedImages.length;
	const visibleGenerationStatus = visibleResourceGenerationStatus(generationStatus);
	const audioPlaying = Boolean(selectedAudio && playingAudioKey === selectedAudio.key);

	return (
		<article
			className={cn(
				"flex h-full min-w-0 flex-col overflow-hidden rounded-sm border bg-card transition-colors",
				selected ? "border-primary" : "border-border",
			)}
		>
			<div className="relative flex aspect-video items-center justify-center overflow-hidden bg-ide-toolbar">
				{preview ? (
					<PhotoView src={preview.src}>
						<img
							src={preview.src}
							alt={preview.title || resource.title}
							className="max-h-full max-w-full cursor-zoom-in"
						/>
					</PhotoView>
				) : (
					<div className="grid size-full place-items-center px-3 text-center text-xs text-muted-foreground">
						暂无已选图片
					</div>
				)}
				<ResourceCardSelectionButton
					disabled={!resource.canGenerate}
					label={resource.title}
					selected={selected}
					onToggle={onToggleSelected}
				/>
				{canSelectAudio && selectedAudio ? (
					<ResourceAudioPreviewButton
						audio={selectedAudio}
						playing={audioPlaying}
						onToggle={() => onToggleAudioPreview(selectedAudio)}
					/>
				) : null}
				<ResourceGenerationStatusBadge status={visibleGenerationStatus} />
				{assetCount > 1 ? (
					<div className="absolute bottom-2 right-2 flex max-w-[70%] gap-1">
						{selectedImages.slice(1, 4).map((image) => (
							<PhotoView key={image.src} src={image.src}>
								<img
									src={image.src}
									alt=""
									className="size-10 cursor-zoom-in rounded-sm border border-border bg-card object-cover shadow-sm"
								/>
							</PhotoView>
						))}
					</div>
				) : null}
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<h3 className="min-w-0 max-w-full truncate text-sm font-semibold text-foreground">
						{resource.title}
					</h3>
					<Badge variant="secondary" className="shrink-0">
						已生成 {generatedImageCount} 张
					</Badge>
				</div>
				<div
					className={cn("mt-auto grid gap-2 pt-1", canSelectAudio ? "grid-cols-2" : "grid-cols-1")}
				>
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="h-8 w-full rounded-sm"
						disabled={!resource.canGenerate}
						onClick={() => onGenerate(resource)}
					>
						<ArrowUpRight className="size-4" />
						<span>生成图片</span>
					</Button>
					{canSelectAudio ? (
						<Button
							type="button"
							size="sm"
							variant="outline"
							className="h-8 w-full rounded-sm"
							disabled={!resource.canGenerate}
							onClick={() => onSelectAudio(resource)}
						>
							<ArrowUpRight className="size-4" />
							<span>选择音频</span>
						</Button>
					) : null}
				</div>
			</div>
		</article>
	);
};

const BatchSelectionToolbar: React.FC<{
	allSelected: boolean;
	generateLabel: string;
	selectedCount: number;
	totalCount: number;
	onClear: () => void;
	onGenerate: () => void;
	onSelectAll: () => void;
}> = ({
	allSelected,
	generateLabel,
	selectedCount,
	totalCount,
	onClear,
	onGenerate,
	onSelectAll,
}) => (
	<div className="flex shrink-0 flex-col gap-2 border-b border-border bg-card px-4 py-3 md:flex-row md:items-center md:justify-between">
		<p className="text-xs text-muted-foreground">
			已选择 {selectedCount} / {totalCount} 项
		</p>
		<div className="flex flex-wrap items-center gap-2">
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="h-8 rounded-sm"
				disabled={totalCount === 0 || allSelected}
				onClick={onSelectAll}
			>
				<Check className="size-4" />
				<span>全选</span>
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="h-8 rounded-sm"
				disabled={selectedCount === 0}
				onClick={onClear}
			>
				<span>清空</span>
			</Button>
			<Button
				type="button"
				size="sm"
				className="h-8 rounded-sm"
				disabled={selectedCount === 0}
				onClick={onGenerate}
			>
				<ArrowUpRight className="size-4" />
				<span>
					{generateLabel}（{selectedCount}）
				</span>
			</Button>
		</div>
	</div>
);

const ResourceCardSelectionButton: React.FC<{
	disabled?: boolean;
	label: string;
	selected: boolean;
	onToggle: () => void;
}> = ({ disabled = false, label, selected, onToggle }) => (
	<button
		type="button"
		role="checkbox"
		aria-checked={selected}
		aria-label={disabled ? `${label} 暂不可生成` : selected ? `取消选择 ${label}` : `选择 ${label}`}
		title={disabled ? "暂不可生成" : selected ? "取消选择" : "选择"}
		className={cn(
			"absolute left-2 top-2 z-10 flex size-7 items-center justify-center rounded-sm border shadow-sm ring-1 ring-black/10 transition-colors",
			selected
				? "border-primary bg-primary text-primary-foreground"
				: "border-white/80 bg-background/90 text-transparent hover:bg-background",
			disabled ? "cursor-not-allowed opacity-50 hover:bg-background/90" : "",
		)}
		disabled={disabled}
		onClick={(event) => {
			event.preventDefault();
			event.stopPropagation();
			onToggle();
		}}
	>
		<Check className={cn("size-4", selected ? "opacity-100" : "opacity-0")} />
	</button>
);

const ResourceAudioPreviewButton: React.FC<{
	audio: DocumentResourceSelectedAudio;
	playing: boolean;
	onToggle: () => void;
}> = ({ audio, playing, onToggle }) => {
	const label = playing ? `停止播放 ${audio.title} 音频` : `播放 ${audio.title} 音频`;
	const Icon = playing ? Pause : Play;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					size="icon"
					variant="outline"
					aria-label={label}
					title={label}
					className="absolute bottom-2 left-2 z-10 size-8 rounded-sm border-white/80 bg-background/90 text-foreground shadow-sm ring-1 ring-black/10 hover:bg-background"
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onToggle();
					}}
				>
					<Icon className={cn("size-4", playing ? "" : "translate-x-px")} />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="top">{label}</TooltipContent>
		</Tooltip>
	);
};

const ResourceGenerationStatusBadge: React.FC<{ status?: ResourceGenerationStatus }> = ({
	status,
}) => {
	if (!status) return null;

	const icon =
		status.kind === "pending" ? (
			<Loader2 className="size-3 animate-spin" />
		) : status.kind === "completed" ? (
			<Check className="size-3" />
		) : null;

	return (
		<Badge
			variant="outline"
			className={cn(
				"absolute right-2 top-2 z-10 shrink-0 shadow-sm backdrop-blur-sm",
				resourceGenerationStatusBadgeClassName(status.kind),
			)}
			title={resourceGenerationStatusTitle(status)}
		>
			{icon}
			<span>{status.label}</span>
		</Badge>
	);
};

const DocumentResourcesSummary: React.FC<{
	assets: SelectedGenerationAsset[];
	error?: unknown;
	isLoading: boolean;
	resources: WorkspaceDocumentResource[];
	onOpen: (resourceType: AgentResourceType) => void;
}> = ({ assets, error, isLoading, resources, onOpen }) => {
	const counts = useMemo(() => {
		const next: Record<AgentResourceType, { assets: number; resources: number }> = {
			character: { assets: 0, resources: 0 },
			scene: { assets: 0, resources: 0 },
			storyboard: { assets: 0, resources: 0 },
			prop: { assets: 0, resources: 0 },
		};
		for (const resource of resources) {
			next[resource.type].resources += 1;
			next[resource.type].assets += resourceAssetCount(resource, assets);
		}
		for (const descriptor of selectedGenerationResourceDescriptors) {
			next[descriptor.key].assets = Math.max(
				next[descriptor.key].assets,
				selectedAssetCountForResourceType(assets, descriptor.key),
			);
		}
		return next;
	}, [assets, resources]);

	return (
		<section className="bg-card">
			<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
				<div className="flex min-w-0 items-center gap-2">
					<FileText className="size-4 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<h2 className="text-sm font-semibold text-foreground">图片和音频</h2>
					</div>
				</div>
				{isLoading ? (
					<span className="flex items-center gap-1 text-xs text-muted-foreground">
						<Loader2 className="size-3 animate-spin" />
						解析中
					</span>
				) : null}
			</div>
			{error ? (
				<div className="mt-3 rounded-sm border border-error-border bg-error-surface px-3 py-2 text-xs text-error-foreground">
					图片和音频加载失败。
				</div>
			) : null}
			<div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
				{selectedGenerationResourceDescriptors.map(({ key, label, icon: Icon }) => {
					const mediaLabel = key === "character" ? "图片和音频" : "图片";

					return (
						<button
							key={key}
							type="button"
							aria-label={`${label} ${mediaLabel}`}
							className="group flex min-h-24 min-w-0 flex-col items-start justify-between rounded-sm border border-border bg-ide-editor px-3 py-3 text-left transition-colors hover:border-input hover:bg-ide-list-hover"
							onClick={() => onOpen(key)}
						>
							<span className="flex w-full min-w-0 items-center justify-between gap-2">
								<span className="flex min-w-0 items-center gap-2">
									<Icon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
									<span className="truncate text-sm font-medium text-foreground">{label}</span>
								</span>
							</span>
							<span className="text-xs text-muted-foreground">
								文档 {counts[key].resources} 项 · 图片 {counts[key].assets} 张
							</span>
						</button>
					);
				})}
			</div>
		</section>
	);
};

const StoryboardVideoResourcesSummary: React.FC<{
	error?: unknown;
	groups: WorkspaceStoryboardVideoDocumentGroup[];
	isLoading: boolean;
	onOpen: (documentId: string) => void;
}> = ({ error, groups, isLoading, onOpen }) => {
	return (
		<section className="bg-card">
			<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
				<div className="flex min-w-0 items-center gap-2">
					<Film className="size-4 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<h2 className="text-sm font-semibold text-foreground">视频生成</h2>
					</div>
				</div>
				{isLoading ? (
					<span className="flex items-center gap-1 text-xs text-muted-foreground">
						<Loader2 className="size-3 animate-spin" />
						加载中
					</span>
				) : null}
			</div>
			{error ? (
				<div className="mt-3 rounded-sm border border-error-border bg-error-surface px-3 py-2 text-xs text-error-foreground">
					视频生成加载失败。
				</div>
			) : null}
			{groups.length > 0 ? (
				<div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
					{groups.map((group) => (
						<button
							key={group.documentId}
							type="button"
							aria-label={`${group.documentTitle} 视频生成`}
							className="group flex min-h-24 min-w-0 flex-col items-start justify-between rounded-sm border border-border bg-ide-editor px-3 py-3 text-left transition-colors hover:border-input hover:bg-ide-list-hover"
							onClick={() => onOpen(group.documentId)}
						>
							<span className="flex w-full min-w-0 items-center justify-between gap-2">
								<span className="flex min-w-0 items-center gap-2">
									<Film className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
									<span className="truncate text-sm font-medium text-foreground">
										{group.documentTitle}
									</span>
								</span>
							</span>
							<span className="text-xs text-muted-foreground">
								分镜组 {group.reels.length} 项 · 成片 {storyboardDocumentGroupVideoCount(group)} 个
							</span>
						</button>
					))}
				</div>
			) : (
				<div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
					<div className="flex min-h-24 min-w-0 flex-col items-start justify-between rounded-sm border border-border bg-ide-editor px-3 py-3 text-left">
						<span className="flex min-w-0 items-center gap-2">
							<Film className="size-4 shrink-0 text-muted-foreground" />
							<span className="truncate text-sm font-medium text-foreground">成片</span>
						</span>
						<span className="text-xs text-muted-foreground">暂无分镜文档</span>
					</div>
				</div>
			)}
		</section>
	);
};

const StoryboardVideoResourcesDialog: React.FC<{
	error?: unknown;
	generationStatuses: Map<string, ResourceGenerationStatus>;
	group: WorkspaceStoryboardVideoDocumentGroup | null;
	isLoading: boolean;
	open: boolean;
	onGenerate: (
		group: WorkspaceStoryboardVideoDocumentGroup,
		reel: WorkspaceStoryboardVideoReel,
	) => void;
	onBatchGenerate: (
		group: WorkspaceStoryboardVideoDocumentGroup,
		reels: WorkspaceStoryboardVideoReel[],
	) => void;
	onOpenChange: (open: boolean) => void;
	onPrepareWorkbench: (group: WorkspaceStoryboardVideoDocumentGroup) => void;
}> = ({
	error,
	generationStatuses,
	group,
	isLoading,
	open,
	onBatchGenerate,
	onGenerate,
	onOpenChange,
	onPrepareWorkbench,
}) => {
	const [activeTab, setActiveTab] = useState<StoryboardVideoResourcesDialogTab>("list");
	// 已访问过的重型 tab(画布/预览)首次进入后常驻挂载,之后切换瞬时完成,无需重建画布/播放器。
	const [visitedTabs, setVisitedTabs] = useState<Set<StoryboardVideoResourcesDialogTab>>(
		() => new Set<StoryboardVideoResourcesDialogTab>(["list"]),
	);
	const selectableReels = useMemo(
		() => (group?.reels ?? []).filter((reel) => reel.canGenerate),
		[group?.reels],
	);
	const selectableReelIds = useMemo(
		() => selectableReels.map((reel) => reel.id),
		[selectableReels],
	);
	const [selectedReelIds, setSelectedReelIds] = useState<string[]>([]);
	const selectedReelIdSet = useMemo(() => new Set(selectedReelIds), [selectedReelIds]);
	const selectedReels = useMemo(
		() => (group?.reels ?? []).filter((reel) => reel.canGenerate && selectedReelIdSet.has(reel.id)),
		[group?.reels, selectedReelIdSet],
	);
	const allSelectableReelsSelected =
		selectableReels.length > 0 && selectedReels.length === selectableReels.length;

	useEffect(() => {
		setSelectedReelIds([]);
		setActiveTab("list");
		setVisitedTabs(new Set<StoryboardVideoResourcesDialogTab>(["list"]));
	}, [open, group?.documentId]);

	useEffect(() => {
		const selectableIdSet = new Set(selectableReelIds);
		setSelectedReelIds((current) => current.filter((id) => selectableIdSet.has(id)));
	}, [selectableReelIds]);

	const selectAllReels = useCallback(() => {
		setSelectedReelIds(selectableReelIds);
	}, [selectableReelIds]);

	const clearSelectedReels = useCallback(() => {
		setSelectedReelIds([]);
	}, []);
	const generateSelectedReels = useCallback(() => {
		if (!group || selectedReels.length === 0) return;

		onBatchGenerate(group, selectedReels);
		setSelectedReelIds([]);
	}, [group, onBatchGenerate, selectedReels]);

	const toggleSelectedReel = useCallback((reel: WorkspaceStoryboardVideoReel) => {
		if (!reel.canGenerate) return;
		setSelectedReelIds((current) =>
			current.includes(reel.id) ? current.filter((id) => id !== reel.id) : [...current, reel.id],
		);
	}, []);
	const switchTab = useCallback(
		(tab: string) => {
			if (!isStoryboardVideoResourcesDialogTab(tab)) return;
			if ((tab === "canvas" || tab === "preview") && group) onPrepareWorkbench(group);
			setActiveTab(tab);
			setVisitedTabs((current) => (current.has(tab) ? current : new Set(current).add(tab)));
		},
		[group, onPrepareWorkbench],
	);

	useEffect(() => {
		if (!group || activeTab === "list") return;
		onPrepareWorkbench(group);
	}, [activeTab, group, onPrepareWorkbench]);

	if (!group) return null;

	return (
		<Tabs value={activeTab} onValueChange={switchTab}>
			<GenerationModalShell
				open={open}
				title={
					<span className="flex min-w-0 items-center gap-2">
						<Film className="size-4 shrink-0 text-muted-foreground" />
						<span className="truncate">视频生成 · {group.documentTitle}</span>
					</span>
				}
				titleAside={
					<div className="flex items-center gap-3">
						<TabsList className="shrink-0">
							<TabsTrigger value="list">
								<List className="size-3.5" />
								<span>列表</span>
							</TabsTrigger>
							<TabsTrigger value="canvas">
								<GitBranch className="size-3.5" />
								<span>画布</span>
							</TabsTrigger>
							<TabsTrigger value="preview">
								<Rows3 className="size-3.5" />
								<span>预览</span>
							</TabsTrigger>
						</TabsList>
					</div>
				}
				titleId="storyboard-video-resources-title"
				contentClassName="h-[min(90vh,860px)]"
				onOpenChange={onOpenChange}
			>
				<div className="flex h-full min-h-0 flex-col bg-ide-editor">
					<TabsContent value="list" className="m-0 flex h-full min-h-0 flex-col">
						{isLoading ? (
							<div className="grid min-h-56 flex-1 place-items-center">
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<Loader2 className="size-4 animate-spin" />
									<span>正在加载视频生成</span>
								</div>
							</div>
						) : null}

						{!isLoading && error ? (
							<div className="m-4 rounded-sm border border-error-border bg-error-surface p-4 text-sm text-error-foreground">
								视频生成加载失败。
							</div>
						) : null}

						{!isLoading && !error && group.reels.length === 0 ? (
							<div className="p-4 text-sm text-muted-foreground">
								当前分镜文档还没有解析出分镜组。
							</div>
						) : null}

						{!isLoading && !error && group.reels.length > 0 ? (
							<>
								<BatchSelectionToolbar
									allSelected={allSelectableReelsSelected}
									generateLabel="批量生成视频"
									selectedCount={selectedReels.length}
									totalCount={selectableReels.length}
									onClear={clearSelectedReels}
									onGenerate={generateSelectedReels}
									onSelectAll={selectAllReels}
								/>
								<div className="min-h-0 flex-1 overflow-y-auto p-4">
									<div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
										{group.reels.map((reel) => (
											<StoryboardReelVideoCard
												key={reel.id}
												generationStatus={generationStatuses.get(reel.id)}
												reel={reel}
												selected={selectedReelIdSet.has(reel.id)}
												onGenerate={() => onGenerate(group, reel)}
												onToggleSelected={() => toggleSelectedReel(reel)}
											/>
										))}
									</div>
								</div>
							</>
						) : null}
					</TabsContent>
					{visitedTabs.has("canvas") ? (
						<TabsContent
							value="canvas"
							forceMount
							className="m-0 h-full min-h-0 overflow-hidden data-[state=inactive]:hidden"
						>
							<EpisodeTimelineView
								active={activeTab === "canvas"}
								documentId={group.documentId}
								workbench="canvas"
							/>
						</TabsContent>
					) : null}
					{visitedTabs.has("preview") ? (
						<TabsContent
							value="preview"
							forceMount
							className="m-0 h-full min-h-0 overflow-hidden data-[state=inactive]:hidden"
						>
							<EpisodeTimelineView
								active={activeTab === "preview"}
								documentId={group.documentId}
								workbench="timeline"
							/>
						</TabsContent>
					) : null}
				</div>
			</GenerationModalShell>
		</Tabs>
	);
};

const isStoryboardVideoResourcesDialogTab = (
	value: string,
): value is StoryboardVideoResourcesDialogTab =>
	value === "list" || value === "canvas" || value === "preview";

// 成片封面点击后的视频预览弹窗，复用共享的 VideoPlayer。作为 Radix 弹窗嵌在资源弹窗之上，
// 由 dismissable-layer 层级栈处理，不会误关外层 GenerationModalShell。
const VideoResourcePreviewDialog: React.FC<{
	mimeType?: string;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	poster?: string;
	source: string;
	title?: string;
}> = ({ mimeType, onOpenChange, open, poster, source, title }) => (
	<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-foreground/70 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200" />
			<DialogPrimitive.Content
				aria-describedby={undefined}
				className={cn(
					"fixed left-1/2 top-1/2 z-[61] w-[min(80rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-sm border border-border bg-card shadow-2xl outline-none",
					dialogContentMotion,
				)}
			>
				<div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
					<DialogPrimitive.Title className="truncate text-sm font-semibold text-foreground">
						{title?.trim() || "预览视频"}
					</DialogPrimitive.Title>
					<DialogClose asChild>
						<Button type="button" variant="ghost" size="icon" aria-label="关闭预览">
							<X className="size-4" />
						</Button>
					</DialogClose>
				</div>
				<div className="bg-black">
					<VideoPlayer
						src={source}
						poster={poster}
						mimeType={mimeType || "video/mp4"}
						load="eager"
						showTitleInControls={false}
						className="aspect-video h-auto max-h-[calc(100vh-10rem)] w-full"
					/>
				</div>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	</DialogPrimitive.Root>
);

const StoryboardReelVideoCard: React.FC<{
	generationStatus?: ResourceGenerationStatus;
	reel: WorkspaceStoryboardVideoReel;
	selected: boolean;
	onGenerate: () => void;
	onToggleSelected: () => void;
}> = ({ generationStatus, reel, selected, onGenerate, onToggleSelected }) => {
	const preview = reel.videos[0];
	const coverSource = preview?.posterUrl ? apiResourceURL(preview.posterUrl) : "";
	const videoSource = preview?.src ? apiResourceURL(preview.src) : "";
	const visibleGenerationStatus = visibleResourceGenerationStatus(generationStatus);
	const [previewOpen, setPreviewOpen] = useState(false);

	return (
		<article
			className={cn(
				"flex h-full min-w-0 flex-col overflow-hidden rounded-sm border bg-card transition-colors",
				selected ? "border-primary" : "border-border",
			)}
		>
			<div className="relative flex aspect-video items-center justify-center overflow-hidden bg-ide-toolbar">
				{coverSource ? (
					<button
						type="button"
						className="flex size-full items-center justify-center outline-none"
						onClick={() => videoSource && setPreviewOpen(true)}
						aria-label={`预览 ${reel.title} 视频`}
					>
						<img
							src={coverSource}
							alt={preview?.title || reel.title}
							className="max-h-full max-w-full"
							draggable={false}
						/>
					</button>
				) : (
					<div className="grid size-full place-items-center px-3 text-center text-xs text-muted-foreground">
						<div className="grid gap-2 justify-items-center">
							<Film className="size-5" />
							<span>{preview ? "已有成片" : "暂无成片"}</span>
						</div>
					</div>
				)}
				{videoSource ? (
					<VideoResourcePreviewDialog
						open={previewOpen}
						onOpenChange={setPreviewOpen}
						source={videoSource}
						poster={coverSource}
						mimeType={preview?.mimeType}
						title={preview?.title || reel.title}
					/>
				) : null}
				<ResourceCardSelectionButton
					disabled={!reel.canGenerate}
					label={reel.title}
					selected={selected}
					onToggle={onToggleSelected}
				/>
				<ResourceGenerationStatusBadge status={visibleGenerationStatus} />
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<h3 className="min-w-0 max-w-full truncate text-sm font-semibold text-foreground">
						{reel.title}
					</h3>
					<Badge variant="secondary" className="shrink-0">
						已生成 {reel.generatedVideoCount} 个
					</Badge>
				</div>
				<div className="mt-auto pt-1">
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="h-8 w-full rounded-sm"
						disabled={!reel.canGenerate}
						onClick={onGenerate}
					>
						<ArrowUpRight className="size-4" />
						<span>生成视频</span>
					</Button>
				</div>
			</div>
		</article>
	);
};

const ProjectUsageSummary: React.FC<{
	data?: BillingSummaryResponse;
	error?: unknown;
	isLoading: boolean;
}> = ({ data, error, isLoading }) => {
	const currencies = data?.currencies ?? [];

	return (
		<section className="bg-card">
			<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
				<div className="flex min-w-0 items-center gap-2">
					<ReceiptText className="size-4 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<h2 className="text-sm font-semibold text-foreground">项目消耗</h2>
					</div>
				</div>
				{isLoading ? (
					<span className="flex items-center gap-1 text-xs text-muted-foreground">
						<Loader2 className="size-3 animate-spin" />
						加载中
					</span>
				) : null}
			</div>
			{error ? (
				<div className="mt-3 rounded-sm border border-error-border bg-error-surface px-3 py-2 text-xs text-error-foreground">
					项目消耗加载失败。
				</div>
			) : null}
			<div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
				<UsageMetric label="累计花费" value={formatCostTotals(data?.totals.costs, currencies)} />
				<UsageMetric label="总 Token" value={formatNumber(data?.totals.totalTokens ?? 0)} />
				<UsageMetric label="调用次数" value={formatNumber(data?.totals.calls ?? 0)} />
				<UsageMetric
					label="输入 / 输出"
					value={`${formatNumber(data?.totals.inputTokens ?? 0)} / ${formatNumber(data?.totals.outputTokens ?? 0)}`}
				/>
			</div>
		</section>
	);
};

const UsageMetric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
	<div className="rounded-sm border border-border bg-ide-editor px-3 py-2">
		<p className="text-xs text-muted-foreground">{label}</p>
		<p className="mt-1 truncate text-base font-semibold text-foreground">{value}</p>
	</div>
);

interface DocumentResourceSelectedImage {
	src: string;
	title?: string;
}

interface DocumentResourceSelectedAudio {
	key: string;
	mimeType?: string;
	src: string;
	title: string;
}

const useDocumentResourceAudioPreview = (open: boolean) => {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const [playingAudioKey, setPlayingAudioKey] = useState("");

	const stopAudioPreview = useCallback((targetKey?: string) => {
		audioRef.current?.pause();
		if (audioRef.current) audioRef.current.onended = null;
		audioRef.current = null;
		setPlayingAudioKey((current) => (!targetKey || current === targetKey ? "" : current));
	}, []);

	const toggleAudioPreview = useCallback(
		(audio: DocumentResourceSelectedAudio) => {
			if (!audio.src) return;
			if (playingAudioKey === audio.key) {
				stopAudioPreview(audio.key);
				return;
			}

			stopAudioPreview();
			const player = new Audio(audio.src);
			player.onended = () => {
				if (audioRef.current !== player) return;
				audioRef.current = null;
				setPlayingAudioKey((current) => (current === audio.key ? "" : current));
			};
			audioRef.current = player;
			void player
				.play()
				.then(() => setPlayingAudioKey(audio.key))
				.catch(() => {
					if (audioRef.current === player) audioRef.current = null;
					setPlayingAudioKey((current) => (current === audio.key ? "" : current));
				});
		},
		[playingAudioKey, stopAudioPreview],
	);

	useEffect(() => {
		if (!open) stopAudioPreview();
	}, [open, stopAudioPreview]);

	useEffect(
		() => () => {
			audioRef.current?.pause();
			if (audioRef.current) audioRef.current.onended = null;
			audioRef.current = null;
		},
		[],
	);

	return { playingAudioKey, toggleAudioPreview };
};

const storyboardDocumentGroupVideoCount = (group: WorkspaceStoryboardVideoDocumentGroup) =>
	group.reels.reduce((total, reel) => total + reel.videos.length, 0);

const documentResourceGenerationStatusMap = (
	resources: WorkspaceDocumentResource[],
	tasks: GenerationTask[],
) => {
	const next = new Map<string, ResourceGenerationStatus>();
	for (const resource of resources) {
		const status = generationStatusForSection(tasks, resource.documentId, resource.sectionId);
		if (status) next.set(resource.id, status);
	}
	return next;
};

const storyboardReelGenerationStatusMap = (
	groups: WorkspaceStoryboardVideoDocumentGroup[],
	tasks: GenerationTask[],
) => {
	const next = new Map<string, ResourceGenerationStatus>();
	for (const group of groups) {
		for (const reel of group.reels) {
			const status = generationStatusForSection(tasks, group.documentId, reel.sectionId);
			if (status) next.set(reel.id, status);
		}
	}
	return next;
};

const completedResourceTaskSelectedAssetsRefreshKeys = (tasks: GenerationTask[]) =>
	tasks.flatMap((task) => {
		if (
			(task.kind !== "image" && task.kind !== "video") ||
			resourceGenerationStatusKind(task.status) !== "completed" ||
			!task.documentId?.trim() ||
			!task.sectionId?.trim() ||
			!task.assets.some(
				(asset) => asset.kind === task.kind && Boolean(generationAssetSource(asset)),
			)
		) {
			return [];
		}

		return [`${task.id}:${generationTaskTime(task)}:${task.assets.length}`];
	});

const resourceAssetCount = (
	resource: WorkspaceDocumentResource,
	assets: SelectedGenerationAsset[],
) => resourceSelectedImages(resource, assets).length;

const resourceSelectedImages = (
	resource: WorkspaceDocumentResource,
	assets: SelectedGenerationAsset[],
) => uniqueSelectedImages(selectedImagesFromAssets(resource, assets));

const resourceSelectedAudio = (
	resource: WorkspaceDocumentResource,
	assets: SelectedGenerationAsset[],
) => uniqueSelectedAudio(selectedAudioFromAssets(resource, assets))[0] ?? null;

const selectedImagesFromAssets = (
	resource: WorkspaceDocumentResource,
	assets: SelectedGenerationAsset[],
): DocumentResourceSelectedImage[] =>
	assets.flatMap((asset) => {
		if (asset.kind !== "image" || !selectedAssetMatchesDocumentResource(asset, resource)) {
			return [];
		}

		const src = selectedAssetSource(asset);
		return src
			? [
					{
						src,
						title: asset.title?.trim() || resource.title,
					},
				]
			: [];
	});

const selectedAudioFromAssets = (
	resource: WorkspaceDocumentResource,
	assets: SelectedGenerationAsset[],
): DocumentResourceSelectedAudio[] =>
	assets.flatMap((asset) => {
		if (asset.kind !== "audio" || !selectedAssetMatchesDocumentResource(asset, resource)) {
			return [];
		}

		const src = selectedAssetSource(asset);
		return src
			? [
					{
						key: `${asset.id}:${src}`,
						mimeType: asset.mimeType,
						src,
						title: asset.title?.trim() || asset.resourceTitle?.trim() || resource.title,
					},
				]
			: [];
	});

const selectedAssetMatchesDocumentResource = (
	asset: SelectedGenerationAsset,
	resource: WorkspaceDocumentResource,
) =>
	asset.resourceType === resource.type &&
	asset.resourceId === resource.sectionId &&
	(!asset.sourceDocumentId || asset.sourceDocumentId === resource.documentId);

const selectedAssetSource = (asset: SelectedGenerationAsset) =>
	generationAssetSource({
		kind: asset.kind,
		url: asset.url,
		base64: asset.base64,
		mimeType: asset.mimeType,
	});

const uniqueSelectedImages = (images: DocumentResourceSelectedImage[]) => {
	const seen = new Set<string>();
	const next: DocumentResourceSelectedImage[] = [];
	for (const image of images) {
		const key = image.src.trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		next.push(image);
	}
	return next;
};

const uniqueSelectedAudio = (items: DocumentResourceSelectedAudio[]) => {
	const seen = new Set<string>();
	const next: DocumentResourceSelectedAudio[] = [];
	for (const item of items) {
		const key = item.src.trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		next.push(item);
	}
	return next;
};

const documentResourceToSectionContext = (
	resource: WorkspaceDocumentResource,
): MarkdownSectionContext => ({
	blockId: resource.blockId,
	documentId: resource.documentId,
	headingLevel: resource.headingLevel,
	headingOccurrence: resource.headingOccurrence,
	headingText: resource.title,
	markdown: resource.markdown,
	plainText: resource.plainText ?? "",
	prompt: resource.prompt ?? resource.title,
});

const storyboardReelToSectionContext = (
	group: WorkspaceStoryboardVideoDocumentGroup,
	reel: WorkspaceStoryboardVideoReel,
): MarkdownSectionContext => ({
	blockId: reel.blockId || reel.sectionId,
	documentId: group.documentId,
	headingLevel: reel.headingLevel,
	headingOccurrence: reel.headingOccurrence,
	headingText: reel.title,
	markdown: reel.markdown,
	plainText: reel.plainText ?? "",
	prompt: reel.prompt ?? reel.markdown,
});

const overviewBatchGenerationItems = (
	dialog: OverviewBatchGenerationDialogState,
	settings: BatchGenerationSettings,
	projectId: string,
): GenerationBatchRequest["items"] => {
	if (dialog.kind === "image") {
		return dialog.resources.map((resource) => ({
			id: resource.id,
			request: generationBatchRequestForSection({
				assetTitle: resource.title,
				capabilityId: taskTypeForCategory(resource.sourceCategory),
				documentId: resource.documentId,
				documentTitle: resource.documentTitle,
				kind: "image",
				projectId,
				prompt: resource.prompt ?? resource.title,
				resourceType: resource.type,
				section: documentResourceToSectionContext(resource),
				settings,
			}),
		}));
	}

	return dialog.reels.map((reel) => ({
		id: reel.id,
		request: generationBatchRequestForSection({
			assetTitle: reel.title,
			capabilityId: "storyboard",
			documentId: dialog.group.documentId,
			documentTitle: dialog.group.documentTitle,
			kind: "video",
			projectId,
			prompt: reel.prompt ?? reel.markdown,
			resourceType: "storyboard",
			section: storyboardReelToSectionContext(dialog.group, reel),
			settings,
		}),
	}));
};

const generationBatchRequestForSection = ({
	assetTitle,
	capabilityId,
	documentId,
	documentTitle,
	kind,
	projectId,
	prompt,
	resourceType,
	section,
	settings,
}: {
	assetTitle: string;
	capabilityId: string;
	documentId: string;
	documentTitle: string;
	kind: "image" | "video";
	projectId: string;
	prompt: string;
	resourceType: AgentResourceType;
	section: MarkdownSectionContext;
	settings: BatchGenerationSettings;
}): GenerationMessageRequest => ({
	assetTitle,
	capabilityId,
	documentContext: {
		documentId,
		projectId,
		sectionId: section.blockId,
	},
	documentId,
	familyId: settings.family.id,
	kind,
	model: settings.route.model,
	modelId: settings.route.legacyModelId ?? "",
	notificationTarget: generationBatchNotificationTarget(
		projectId,
		documentId,
		documentTitle,
		section,
	),
	params: settings.params,
	projectId,
	prompt: appendBatchPromptSupplements(prompt, settings.promptSupplements),
	promptOptimization: settings.promptOptimization,
	provider: settings.route.provider,
	referenceAssetIds: settings.referenceAssetIds ?? [],
	referenceBindings: [],
	referenceUrls: [],
	resourceType,
	routeId: settings.route.id,
	sectionId: section.blockId,
	versionId: settings.version.id,
});

const generationBatchNotificationTarget = (
	projectId: string,
	documentId: string,
	documentTitle: string,
	section: MarkdownSectionContext,
): GenerationNotificationOpenTarget => ({
	documentId,
	documentTitle,
	kind: "document-section",
	projectId,
	section: {
		blockId: section.blockId,
		documentId,
		headingLevel: section.headingLevel,
		headingOccurrence: section.headingOccurrence,
		headingText: section.headingText,
		markdown: section.markdown,
		plainText: section.plainText,
		prompt: section.prompt,
	},
});

const isFailedGenerationBatchStatus = (status: string) =>
	["failed", "error", "cancelled", "canceled"].includes(status.trim().toLowerCase());

const selectedAssetCountForResourceType = (
	assets: SelectedGenerationAsset[],
	resourceType: AgentResourceType,
) => assets.filter((asset) => asset.kind === "image" && asset.resourceType === resourceType).length;

const formatNumber = (value: number | undefined) => numberFormatter.format(value ?? 0);

const formatMoney = (value: number, currency: string) =>
	`${currency} ${moneyFormatter.format(value)}`;

const formatCosts = (costs: Record<string, number>, currencies: string[]) => {
	const visible = currencies.length > 0 ? currencies : Object.keys(costs).sort();
	if (visible.length === 0) return "-";
	return visible.map((currency) => formatMoney(costs[currency] ?? 0, currency)).join(" / ");
};

const formatCostTotals = (costs: Record<string, number> | undefined, currencies: string[]) =>
	formatCosts(costs ?? {}, currencies);
