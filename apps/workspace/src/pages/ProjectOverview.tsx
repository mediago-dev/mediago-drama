import {
	ArrowUpRight,
	Check,
	FileText,
	Film,
	GitBranch,
	List,
	Loader2,
	Pause,
	Play,
	ReceiptText,
	Rows3,
	ShieldAlert,
	Sparkles,
	X,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { PhotoProvider, PhotoView } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { dialogContentMotion } from "@/shared/components/ui/dialog-motion";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
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
	updateSelectedGenerationAsset,
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
import { type MarkdownDocument, useDocumentsStore } from "@/domains/documents/stores";
import {
	buildMentionReferenceInputs,
	resolveMentionPayloadWithSelectedAssets,
	uniqueResolvedMention,
} from "@/domains/documents/lib/mention-generation-references";
import { parseMentionsFromMarkdown } from "@/domains/documents/lib/mention-resolver";
import {
	generationAssetSelectionKey,
	generationAssetSource,
	uniqueStrings,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import {
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
	getProjectConfig,
	projectConfigKey,
	projectProductionStages,
	type ProjectConfig,
	type ProjectProductionGraph,
	type ProjectOutputArchiveRecord,
	type ProjectProductionState,
	type ProjectShotRecord,
	type ProjectVersionRecord,
	updateProjectProduction,
	type ProductionWorkbenchExecutionState,
} from "@/domains/projects/api/projects";
import {
	billingSummaryKey,
	getBillingSummary,
	type BillingSummaryResponse,
} from "@/domains/billing/api/billing";
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
import {
	getProjectAssets,
	projectAssetsKey,
	uploadProjectAsset,
	type ProjectAsset,
} from "@/domains/workspace/api/project-assets";
import { ProjectWorkspaceShell } from "@/domains/workspace/components/ProjectWorkspaceShell";
import {
	agentProjectPath,
	getRouteProjectId,
	getRouteProjectWorkspace,
	getRouteStageId,
	type AgentResourceType,
	type ProjectWorkspaceView,
} from "@/domains/workspace/lib/workbench-route";
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
import { copyDesktopFileToDirectory } from "@/shared/desktop/actions";
import { isDesktopRuntime } from "@/shared/desktop/runtime";
import { cn } from "@/shared/lib/utils";
import { buildProductionPipeline } from "@/lib/overview/production-pipeline";
import {
	buildProjectRecoveryNotices,
	projectRecoveryDismissalStorageKey,
	projectRecoveryNoticeFingerprint,
} from "@/lib/production/project-recovery";
import {
	productionStageStateLabels,
	type ProductionStageState,
} from "@/lib/production/production-templates";
import { ReferenceTransferModule } from "@/domains/production/components/ReferenceTransferModule";
import { ProductionWorkbench } from "@/domains/production/components/ProductionWorkbench";
import { ProductionControlPanel } from "@/domains/production/components/ProductionControlPanel";
import { CreatorProjectWorkspace } from "@/domains/creator/components/CreatorProjectWorkspace";
import {
	buildProjectProductionContext,
	type ProjectProductionContext,
} from "@/lib/production/project-context";
import {
	buildOutputFilename,
	ensureUniqueOutputFilename,
	mergeOutputArchives,
	outputArchiveKey,
} from "@/lib/production/output-archive";

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

interface OverviewBatchGenerationReferenceContext {
	allAssets: ProjectAsset[];
	allDocuments: MarkdownDocument[];
	selectedGenerationAssets: SelectedGenerationAsset[];
}

type StoryboardVideoResourcesDialogTab = "list" | "canvas" | "preview";

type StoryboardImageIntent = "single-shot" | "first-frame" | "last-frame";

const storyboardImageIntentLabels: Record<StoryboardImageIntent, string> = {
	"single-shot": "单镜执行图",
	"first-frame": "生成首帧",
	"last-frame": "生成尾帧",
};

export const ProjectOverview: React.FC = () => {
	const location = useLocation();
	const navigate = useNavigate();
	const toast = useToast();
	const projectId = getRouteProjectId(location.search);
	const activeWorkspace = getRouteProjectWorkspace(location.search);
	const isCreatorWorkspace = activeWorkspace === "shots";
	const routeStageId = getRouteStageId(location.search);
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
	const copiedOutputAssetKeysRef = useRef<Set<string>>(new Set());
	const copyingOutputAssetKeysRef = useRef<Set<string>>(new Set());
	const generationTaskStatusRef = useRef<Map<string, string>>(new Map());
	const archivedGenerationTaskIdsRef = useRef<Set<string>>(new Set());
	const hydrateWorkspaceDocuments = useDocumentsStore((state) => state.hydrateWorkspaceDocuments);
	const mentionDocuments = useDocumentsStore((state) => state.documents);
	const mentionAssets = useDocumentsStore((state) => state.assets);
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
		mutate: mutateProjectConfig,
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
	const archivedProductionAssetIdsRef = useRef(new Set<string>());
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
	/**
	 * Production state is stored as one JSON object on disk. Several controls in the
	 * workbench can save at nearly the same time (brief, memory note, completion,
	 * review), so a normal read/modify/write from a React closure can overwrite a
	 * newer field with an older snapshot. Keep writes serial and read the canonical
	 * project file immediately before each mutation.
	 */
	const enqueueProductionMutation = useCallback(
		(mutator: (production: ProjectProductionState) => ProjectProductionState | null) => {
			if (!projectId) return Promise.resolve();
			return updateProjectProduction(projectId, mutator).then(async () => {
				// Revalidate only after the PATCH has completed. Revalidating inside the
				// mutator reads the old config and leaves lock buttons visually stale.
				await mutateProjectConfig();
			});
		},
		[mutateProjectConfig, projectId],
	);
	const { data: projectAssetsData, mutate: mutateProjectAssets } = useSWR(
		projectId ? projectAssetsKey(projectId) : null,
		() => getProjectAssets(projectId ?? ""),
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
		copiedOutputAssetKeysRef.current.clear();
		copyingOutputAssetKeysRef.current.clear();
		generationTaskStatusRef.current.clear();
	}, [projectId]);

	const documentResources = workspaceDocumentResources?.resources ?? [];
	const storyboardVideoGroups = storyboardVideoResources?.groups ?? [];
	const generationTasks = useMemo(
		() => [...(imageTaskData?.tasks ?? []), ...(videoTaskData?.tasks ?? [])],
		[imageTaskData?.tasks, videoTaskData?.tasks],
	);
	/**
	 * 项目资产库是生产关系图的落点，不应只显示“选中的生成结果”。
	 * 生成完成后关系图已经保存了角色/场景/分镜节点；这里把它们和接口资产
	 * 合并为同一份目录，按 asset id 去重，保证刷新后角色三视图仍然可见。
	 */
	const projectCatalogAssets = useMemo(
		() =>
			mergeProductionCatalogAssets(
				selectedGenerationAssets,
				config?.overview.production?.productionGraph,
				projectAssetsData?.assets ?? [],
				documentResources,
			),
		[
			config?.overview.production?.productionGraph,
			documentResources,
			projectAssetsData?.assets,
			selectedGenerationAssets,
		],
	);
	/**
	 * 旧项目的生成结果可能已经写入项目文件和 productionGraph，
	 * 但没有写入 generation/selected-assets。资源弹窗只认后者，
	 * 于是会出现“关系图里有图，角色卡却是 0 张”的假丢失。
	 * 启动项目时把已有项目资产补进选中资产库；以 mediaAssetId 做幂等键，
	 * 不覆盖历史版本，也不会重复创建同一张图。
	 */
	useEffect(() => {
		if (
			!projectId ||
			!config?.overview.production?.productionGraph ||
			!projectAssetsData?.assets?.length
		)
			return;
		const selectedMediaIds = new Set(
			selectedGenerationAssets
				.map((asset) => asset.mediaAssetId || asset.id)
				.filter((value): value is string => Boolean(value)),
		);
		const resourcesByDocumentAndType = new Map<string, WorkspaceDocumentResource>();
		for (const resource of documentResources) {
			const key = `${resource.type}:${resource.documentId}`;
			const current = resourcesByDocumentAndType.get(key);
			if (!current || /生成|结果|输出/i.test(resource.title))
				resourcesByDocumentAndType.set(key, resource);
		}
		const projectAssetsById = new Map(projectAssetsData.assets.map((asset) => [asset.id, asset]));
		const pending = (config.overview.production.productionGraph.nodes ?? [])
			.filter((node) => node.type === "asset" && node.assetId && node.metadata?.resourceType)
			.map((node) => {
				const assetId = node.assetId as string;
				const resourceType = node.metadata?.resourceType as AgentResourceType;
				if (!productionResourceTypes.has(resourceType as SelectedGenerationAsset["resourceType"]))
					return null;
				if (selectedMediaIds.has(assetId) || archivedProductionAssetIdsRef.current.has(assetId))
					return null;
				const file = projectAssetsById.get(assetId);
				if (!file || file.kind !== "image") return null;
				const resource = resourcesByDocumentAndType.get(`${resourceType}:${node.documentId ?? ""}`);
				return {
					assetIndex: 0,
					kind: "image" as const,
					mediaAssetId: assetId,
					mimeType: file.mimeType,
					downloadPath: file.downloadPath,
					resourceId: resource?.sectionId ?? node.documentId ?? "",
					resourceTitle: resource?.title ?? node.title ?? file.filename,
					resourceType,
					selected: true,
					shotIds: Array.isArray(node.metadata?.usedInShots)
						? node.metadata.usedInShots.filter(
								(value): value is string => typeof value === "string",
							)
						: [],
					sourceDocumentId: node.documentId,
					sourceTaskId:
						typeof node.metadata?.sourceTaskId === "string"
							? node.metadata.sourceTaskId
							: undefined,
					sourceType: "generated" as const,
					title: node.title ?? file.filename,
					url: file.url,
				};
			})
			.filter((value): value is NonNullable<typeof value> => Boolean(value));
		if (pending.length === 0) return;
		for (const item of pending)
			archivedProductionAssetIdsRef.current.add(item.mediaAssetId as string);
		void Promise.all(pending.map((item) => updateSelectedGenerationAsset(projectId, item)))
			.then(() => mutateSelectedResources())
			.catch(() => {
				for (const item of pending)
					archivedProductionAssetIdsRef.current.delete(item.mediaAssetId as string);
			});
	}, [
		config?.overview.production?.productionGraph,
		documentResources,
		mutateSelectedResources,
		projectAssetsData?.assets,
		projectId,
		selectedGenerationAssets,
	]);
	const productionPipeline = useMemo(
		() =>
			buildProductionPipeline({
				documents: workspaceDocuments?.documents ?? [],
				resources: documentResources,
				storyboardGroups: storyboardVideoGroups,
				selectedImageCount: projectCatalogAssets.filter((asset) => asset.kind === "image").length,
				production: config?.overview.production,
				generationTasks,
			}),
		[
			config?.overview.production,
			documentResources,
			projectCatalogAssets,
			storyboardVideoGroups,
			generationTasks,
			workspaceDocuments?.documents,
		],
	);
	const productionContext = useMemo(
		() =>
			buildProjectProductionContext({
				projectId: projectId ?? "",
				name: config?.name || projectId || "",
				pipeline: productionPipeline,
				resourceCount: documentResources.length,
				selectedAssetCount: projectCatalogAssets.length,
				shotCount: config?.overview.production?.shotCount ?? 0,
				draftStoryboardCount: storyboardVideoGroups.reduce(
					(total, group) => total + group.reels.length,
					0,
				),
				outputDirectory: config?.overview.outputDirectory,
				production: config?.overview.production,
			}),
		[
			config?.name,
			config?.overview.production,
			documentResources.length,
			productionPipeline,
			projectId,
			projectCatalogAssets.length,
			storyboardVideoGroups,
		],
	);
	const productionTaskSummary = useMemo(() => {
		const tasks = generationTasks;
		const pendingStatuses = new Set(["queued", "pending", "running", "in_progress", "processing"]);
		const failedStatuses = new Set(["failed", "error", "cancelled"]);
		return {
			total: tasks.length,
			pending: tasks.filter((task) => pendingStatuses.has(task.status.toLowerCase())).length,
			failed: tasks.filter(
				(task) => failedStatuses.has(task.status.toLowerCase()) || Boolean(task.error),
			).length,
		};
	}, [generationTasks]);
	const [savingStageId, setSavingStageId] = useState<string | null>(null);
	const updateStageCompletion = useCallback(
		async (stageId: string, completion: number) => {
			if (!projectId) return;
			const normalizedCompletion = Math.max(0, Math.min(100, Math.round(completion)));
			try {
				await enqueueProductionMutation((production) => {
					const stages = projectProductionStages(production);
					const stageCompletionTotal = stages.reduce(
						(total, stage) =>
							total +
							(stage.id === stageId
								? normalizedCompletion
								: (production.stageStates?.[stage.id]?.completion ?? 0)),
						0,
					);
					const current = production.stageStates?.[stageId];
					const now = new Date().toISOString();
					return {
						...production,
						stageStates: {
							...production.stageStates,
							[stageId]: {
								...current,
								status: current?.status ?? "NOT_STARTED",
								manualStatus: current?.manualStatus ?? "",
								documentId: current?.documentId ?? "",
								completion: normalizedCompletion,
								updatedAt: now,
							},
						},
						overallProgress:
							stages.length > 0 ? Math.round(stageCompletionTotal / stages.length) : 0,
						updatedAt: now,
					};
				});
			} catch (completionError) {
				toast.error("保存阶段完成度失败", {
					description: completionError instanceof Error ? completionError.message : "请稍后重试。",
				});
			}
		},
		[enqueueProductionMutation, projectId, toast],
	);
	const updateStageState = useCallback(
		async (stageId: string, status: ProductionStageState | null) => {
			if (!projectId) return;
			const derivedStage = productionPipeline.stages.find((item) => item.id === stageId);
			setSavingStageId(stageId);
			try {
				await enqueueProductionMutation((production) => {
					const effectiveStatus = status ?? derivedStage?.autoState ?? "NOT_STARTED";
					const runtimeStages = projectProductionStages(production).map((stage) =>
						stage.id === stageId ? { ...stage, status: effectiveStatus } : stage,
					);
					const stage = runtimeStages.find((item) => item.id === stageId);
					const now = new Date().toISOString();
					const stageStates = {
						...production.stageStates,
						[stageId]: {
							...production.stageStates?.[stageId],
							status: status ?? "NOT_STARTED",
							manualStatus: status ?? ("" as const),
							documentId: production.stageStates?.[stageId]?.documentId ?? "",
							completion:
								status === "PASS" ? 100 : (production.stageStates?.[stageId]?.completion ?? 0),
							updatedAt: now,
						},
					};
					const nextCurrent =
						runtimeStages.find((item) => item.id === stageId && status !== "PASS") ??
						runtimeStages.find((item) => item.status !== "PASS") ??
						runtimeStages.at(-1);
					return {
						...production,
						stageStates,
						currentStageId: nextCurrent?.id,
						overallProgress:
							runtimeStages.length > 0
								? Math.round(
										(runtimeStages.filter((item) => item.status === "PASS").length /
											runtimeStages.length) *
											100,
									)
								: 0,
						updatedAt: now,
						nextAction: stage
							? status === "PASS"
								? `继续“${nextCurrent?.title ?? "项目复盘"}”。`
								: status === null
									? `跟随自动判断，继续处理“${stage.title}”。`
									: `继续处理“${stage.title}”。`
							: production.nextAction,
					};
				});
				toast.success("阶段状态已保存", {
					description: `${derivedStage?.label ?? "当前阶段"} · ${status ? productionStageStateLabels[status] : "跟随自动判断"}`,
				});
			} catch (stageError) {
				toast.error("保存阶段状态失败", {
					description: stageError instanceof Error ? stageError.message : "请稍后重试。",
				});
			} finally {
				setSavingStageId(null);
			}
		},
		[enqueueProductionMutation, productionPipeline.stages, projectId, toast],
	);
	const updateWorkbenchState = useCallback(
		async (stageId: string, state: ProductionWorkbenchExecutionState) => {
			if (!projectId || !stageId) return;
			try {
				await enqueueProductionMutation((production) => ({
					...production,
					workbenchStates: {
						...production.workbenchStates,
						[stageId]: state,
					},
					updatedAt: new Date().toISOString(),
				}));
			} catch (workbenchError) {
				toast.error("保存工作台状态失败", {
					description: workbenchError instanceof Error ? workbenchError.message : "请稍后重试。",
				});
			}
		},
		[enqueueProductionMutation, projectId, toast],
	);
	const updateProductionPatch = useCallback(
		async (patch: Partial<ProjectProductionState>) => {
			if (!projectId) return;
			try {
				await enqueueProductionMutation((production) => ({
					...production,
					...patch,
					sharedContext: patch.sharedContext
						? { ...production.sharedContext, ...patch.sharedContext }
						: production.sharedContext,
					updatedAt: new Date().toISOString(),
				}));
			} catch (productionError) {
				toast.error("保存项目记忆失败", {
					description: productionError instanceof Error ? productionError.message : "请稍后重试。",
				});
			}
		},
		[enqueueProductionMutation, projectId, toast],
	);
	type ExternalAssetImportMetadata = {
		provider?: string;
		model?: string;
		sourceTaskId?: string;
		prompt?: string;
		shotIds?: string[];
		shotIdsByAssetId?: Record<string, string[]>;
	};
	const archiveExternalAssets = useCallback(
		async (assets: ProjectAsset[], importMetadata: ExternalAssetImportMetadata = {}) => {
			if (!projectId || assets.length === 0) return;
			await enqueueProductionMutation((production) => {
				const now = new Date().toISOString();
				const nodes = [...(production.productionGraph?.nodes ?? [])];
				const edges = [...(production.productionGraph?.edges ?? [])];
				const versions = [...(production.versions ?? [])];
				for (const asset of assets) {
					const shotIds = uniqueStrings(
						importMetadata.shotIdsByAssetId?.[asset.id] ?? importMetadata.shotIds ?? [],
					);
					const nodeId = `asset:${asset.id}`;
					const metadata = {
						sourceType: "external-import",
						filename: asset.filename,
						mimeType: asset.mimeType,
						projectAssetId: asset.id,
						provider: importMetadata.provider?.trim() || undefined,
						model: importMetadata.model?.trim() || undefined,
						sourceTaskId: importMetadata.sourceTaskId?.trim() || undefined,
						prompt: importMetadata.prompt?.trim() || undefined,
						shotIds,
						usedInShots: shotIds,
					};
					const existing = nodes.find((node) => node.id === nodeId);
					if (existing) existing.metadata = { ...(existing.metadata ?? {}), ...metadata };
					if (!nodes.some((node) => node.id === nodeId)) {
						nodes.push({
							id: nodeId,
							type: "asset",
							title: asset.filename,
							assetId: asset.id,
							path: asset.downloadPath,
							status: "待审核",
							metadata,
							createdAt: asset.createdAt || now,
						});
					}
					for (const shotId of shotIds) {
						const shotNodeId = `shot:${shotId}`;
						if (!nodes.some((node) => node.id === shotNodeId)) {
							nodes.push({
								id: shotNodeId,
								type: "shot",
								title: `镜头 ${shotId}`,
								status: "待制作",
								metadata: { shotId },
								createdAt: now,
							});
						}
						if (!edges.some((edge) => edge.from === nodeId && edge.to === shotNodeId)) {
							edges.push({ from: nodeId, to: shotNodeId, relation: "uses", createdAt: now });
						}
					}
					const priorVersions = versions.filter(
						(version) => version.entityType === "asset" && version.entityId === asset.id,
					);
					if (priorVersions.length === 0) {
						versions.push({
							id: `version:asset:${asset.id}:V01`,
							entityType: "asset",
							entityId: asset.id,
							version: "V01",
							status: "DRAFT",
							label: asset.filename,
							prompt: importMetadata.prompt?.trim() || undefined,
							model: importMetadata.model?.trim() || undefined,
							provider: importMetadata.provider?.trim() || undefined,
							outputPath: asset.downloadPath,
							note: shotIds.length
								? `外部平台导入${importMetadata.sourceTaskId?.trim() ? `；任务：${importMetadata.sourceTaskId.trim()}` : ""}；用途：${shotIds.join("、")}；待完成资产审核。`
								: `外部平台导入${importMetadata.sourceTaskId?.trim() ? `；任务：${importMetadata.sourceTaskId.trim()}` : ""}；待绑定镜头并完成资产审核。`,
							createdAt: asset.createdAt || now,
							updatedAt: now,
						});
					}
				}
				return {
					...production,
					coreAssetCount: Math.max(
						production.coreAssetCount ?? 0,
						nodes.filter((node) => node.type === "asset").length,
					),
					versions,
					productionGraph: { nodes, edges, updatedAt: now },
					sharedContext: {
						...production.sharedContext,
						generationHistory: [
							...(production.sharedContext?.generationHistory ?? []),
							...assets.map((asset) => {
								const assetShotIds = uniqueStrings(
									importMetadata.shotIdsByAssetId?.[asset.id] ?? importMetadata.shotIds ?? [],
								);
								return `外部导入：${asset.filename}（${asset.id}）${assetShotIds.length ? `｜用途：${assetShotIds.join("、")}` : ""}`;
							}),
						],
						updatedAt: now,
					},
					updatedAt: now,
				};
			});
		},
		[enqueueProductionMutation, projectId],
	);
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
		void mutateProjectAssets();
	}, [
		imageTaskData?.tasks,
		videoTaskData?.tasks,
		mutateSelectedResources,
		mutateStoryboardVideoResources,
		mutateDocumentResources,
		mutateProjectAssets,
		projectId,
	]);

	useEffect(() => {
		if (!projectId) return;

		const tasks = [...(imageTaskData?.tasks ?? []), ...(videoTaskData?.tasks ?? [])];
		const completedTasks = tasks.filter((task) => {
			const status = task.status.trim().toLowerCase();
			return status === "completed" || status === "success";
		});
		const outputDirectory = config?.overview.outputDirectory?.trim() ?? "";
		const persistedOutputArchiveKeys = new Set(
			(config?.overview.production?.outputArchives ?? []).map((record) => outputArchiveKey(record)),
		);
		const newlyCompletedTasks = tasks.filter((task) => {
			const nextStatus = task.status.trim().toLowerCase();
			const previousStatus = generationTaskStatusRef.current.get(task.id);
			generationTaskStatusRef.current.set(task.id, nextStatus);
			return (
				(previousStatus === "pending" ||
					previousStatus === "queued" ||
					previousStatus === "running" ||
					previousStatus === "processing") &&
				(nextStatus === "completed" || nextStatus === "success")
			);
		});

		const persistedGenerationTaskIds = new Set(
			(config?.overview.production?.productionGraph?.nodes ?? [])
				.filter((node) => node.type === "generation-task" && node.taskId)
				.map((node) => node.taskId as string),
		);
		const toArchive = completedTasks.filter(
			(task) =>
				!archivedGenerationTaskIdsRef.current.has(task.id) &&
				!persistedGenerationTaskIds.has(task.id),
		);

		if (newlyCompletedTasks.length > 0) {
			toast.success("生成完成，结果已归档", {
				description: outputDirectory
					? "已保存到项目资产库，并将复制到你指定的输出目录。"
					: "已保存到项目资产库，任务记录、Prompt 和参考资产均已保留。",
			});
		}
		for (const task of toArchive) archivedGenerationTaskIdsRef.current.add(task.id);
		if (toArchive.length > 0) {
			void updateProjectProduction(projectId, (production) => {
				const now = new Date().toISOString();
				const versions = [...(production.versions ?? [])];
				const nodes = [...(production.productionGraph?.nodes ?? [])];
				const edges = [...(production.productionGraph?.edges ?? [])];
				const shots = [...(production.shots ?? [])];
				const generationHistory = [...(production.sharedContext?.generationHistory ?? [])];
				for (const task of toArchive) {
					const resolvedShotIds = Array.from(
						new Set(
							[...(task.shotIds ?? []), task.sectionId ?? ""]
								.map((value) => value.trim())
								.filter(Boolean),
						),
					);
					const taskNodeId = `generation-task:${task.id}`;
					const isShotExecutionImage =
						task.kind === "image" && /单镜执行图/.test(task.assetTitle ?? "");
					if (!nodes.some((node) => node.id === taskNodeId))
						nodes.push({
							id: taskNodeId,
							type: "generation-task",
							title: `${task.kind === "video" ? "视频" : "图片"}生成任务 ${task.id}`,
							taskId: task.id,
							documentId: task.documentId,
							status: "已完成",
							metadata: {
								prompt: task.prompt,
								model: task.model,
								provider: task.provider,
								resourceType: task.resourceType,
								params: task.params,
								referenceAssetIds: task.referenceAssetIds,
								shotIds: resolvedShotIds,
								sourceType: "generated",
							},
							createdAt: task.createdAt || now,
						});
					if (task.documentId) {
						const documentNodeId = `document:${task.documentId}`;
						if (!nodes.some((node) => node.id === documentNodeId))
							nodes.push({
								id: documentNodeId,
								type: "shot",
								title: task.sectionId ? `镜头 ${task.sectionId}` : `制作文档 ${task.documentId}`,
								documentId: task.documentId,
								shotId: task.sectionId,
								status: "已关联",
								createdAt: task.createdAt || now,
							});
						if (!edges.some((edge) => edge.from === taskNodeId && edge.to === documentNodeId))
							edges.push({
								from: taskNodeId,
								to: documentNodeId,
								relation: "belongs-to",
								createdAt: now,
							});
					}
					for (const shotId of resolvedShotIds) {
						const shotNodeId =
							nodes.find(
								(node) =>
									node.type === "shot" &&
									(node.shotId === shotId || node.id === shotId || node.id === `shot:${shotId}`),
							)?.id ?? `shot:${shotId}`;
						if (!nodes.some((node) => node.id === shotNodeId))
							nodes.push({
								id: shotNodeId,
								type: "shot",
								title: `镜头 ${shotId}`,
								shotId,
								status: "已关联",
								createdAt: task.createdAt || now,
							});
						if (!edges.some((edge) => edge.from === taskNodeId && edge.to === shotNodeId))
							edges.push({
								from: taskNodeId,
								to: shotNodeId,
								relation: "belongs-to",
								createdAt: now,
							});
					}
					for (const referenceId of task.referenceAssetIds ?? []) {
						const referenceNode = nodes.find(
							(node) =>
								node.assetId === referenceId ||
								node.id === `asset:${referenceId}` ||
								node.id === `reference:${referenceId}`,
						);
						const referenceNodeId = referenceNode?.id ?? `reference:${referenceId}`;
						if (!referenceNode)
							nodes.push({
								id: referenceNodeId,
								type: "reference",
								title: `参考素材 ${referenceId}`,
								assetId: referenceId,
								status: "已使用",
								createdAt: now,
							});
						if (!edges.some((edge) => edge.from === referenceNodeId && edge.to === taskNodeId))
							edges.push({
								from: referenceNodeId,
								to: taskNodeId,
								relation: "uses",
								createdAt: now,
							});
					}
					const existingEntityVersions = versions.filter(
						(item) => item.entityType === "task" && item.entityId === task.id,
					);
					if (existingEntityVersions.length === 0)
						versions.push({
							id: `version:task:${task.id}`,
							entityType: "task",
							entityId: task.id,
							version: `V${String(existingEntityVersions.length + 1).padStart(2, "0")}`,
							status: "PASS",
							label: task.assetTitle || `${task.kind === "video" ? "视频" : "图片"}生成结果`,
							prompt: task.prompt,
							model: task.model,
							provider: task.provider,
							params: task.params,
							referenceIds: task.referenceAssetIds,
							createdAt: task.createdAt || now,
							updatedAt: now,
						});
					for (const [index, asset] of task.assets.entries()) {
						const assetId = asset.assetId || `${task.id}:${index}`;
						const nodeId = `${task.kind === "video" ? "video" : "asset"}:${assetId}`;
						if (!nodes.some((node) => node.id === nodeId))
							nodes.push({
								id: nodeId,
								type: task.kind === "video" ? "video" : "asset",
								title: asset.title || task.assetTitle || `生成结果 ${index + 1}`,
								assetId,
								taskId: task.id,
								path: asset.downloadPath,
								status: "已完成",
								metadata: {
									prompt: task.prompt,
									model: task.model,
									provider: task.provider,
									resourceType: task.resourceType,
									params: task.params,
									referenceAssetIds: task.referenceAssetIds,
									sourceTaskId: task.id,
									sourceType: "generated",
									shotIds: resolvedShotIds,
									usedInShots: resolvedShotIds,
								},
								createdAt: now,
							});
						if (!edges.some((edge) => edge.from === taskNodeId && edge.to === nodeId))
							edges.push({
								from: taskNodeId,
								to: nodeId,
								relation: "generated-by",
								createdAt: now,
							});
						if (task.documentId) {
							const documentNodeId = `document:${task.documentId}`;
							if (!edges.some((edge) => edge.from === nodeId && edge.to === documentNodeId)) {
								edges.push({
									from: nodeId,
									to: documentNodeId,
									relation: "belongs-to",
									createdAt: now,
								});
							}
						}
						for (const shotId of resolvedShotIds) {
							const shotNodeId =
								nodes.find(
									(node) =>
										node.type === "shot" &&
										(node.shotId === shotId || node.id === shotId || node.id === `shot:${shotId}`),
								)?.id ?? `shot:${shotId}`;
							if (!edges.some((edge) => edge.from === nodeId && edge.to === shotNodeId))
								edges.push({
									from: nodeId,
									to: shotNodeId,
									relation: "uses",
									createdAt: now,
								});
						}
						const existingAssetVersions = versions.filter(
							(item) => item.entityType === "asset" && item.entityId === assetId,
						);
						const nextAssetVersion = `V${String(existingAssetVersions.length + 1).padStart(2, "0")}`;
						if (!existingAssetVersions.some((item) => item.version === nextAssetVersion))
							versions.push({
								id: `version:asset:${assetId}:${nextAssetVersion}`,
								entityType: "asset",
								entityId: assetId,
								version: nextAssetVersion,
								status: "DRAFT",
								label: asset.title || task.assetTitle || `生成结果 ${index + 1}`,
								prompt: task.prompt,
								model: task.model,
								provider: task.provider,
								params: task.params,
								referenceIds: task.referenceAssetIds,
								outputPath: asset.downloadPath,
								note: `App 内生成；用途：${resolvedShotIds.join("、") || "尚未指定镜头"}`,
								createdAt: task.createdAt || now,
								updatedAt: now,
							});
					}
					if (task.kind === "video") {
						const archiveNodeId = `archive:rough-cut:${task.id}`;
						if (!nodes.some((node) => node.id === archiveNodeId)) {
							nodes.push({
								id: archiveNodeId,
								type: "document",
								title: `08 粗剪归档 · ${resolvedShotIds.join("、") || task.assetTitle || task.id}`,
								status: "已归档",
								metadata: { stage: 8, taskId: task.id, shotIds: resolvedShotIds },
								createdAt: now,
							});
						}
						for (const video of nodes.filter(
							(node) => node.type === "video" && node.taskId === task.id,
						)) {
							if (
								!edges.some(
									(edge) =>
										edge.from === video.id &&
										edge.to === archiveNodeId &&
										edge.relation === "archived-in",
								)
							) {
								edges.push({
									from: video.id,
									to: archiveNodeId,
									relation: "archived-in",
									createdAt: now,
								});
							}
						}
					}
					for (const shotId of resolvedShotIds) {
						const shotIndex = shots.findIndex(
							(shot) => shot.id === shotId || shot.shotCode === shotId,
						);
						if (shotIndex < 0) continue;
						const primaryAssetId = task.assets[0]?.assetId;
						if (isShotExecutionImage && primaryAssetId) {
							shots[shotIndex] = {
								...shots[shotIndex],
								firstFrameAssetId: primaryAssetId,
								completion: Math.max(shots[shotIndex].completion, 65),
								status: "IN_PROGRESS",
								updatedAt: now,
							};
						}
						if (task.kind === "video") {
							shots[shotIndex] = {
								...shots[shotIndex],
								completion: 100,
								status: "PASS",
								updatedAt: now,
							};
						}
					}
					generationHistory.push(
						`App 内生成：${task.assetTitle || (task.kind === "video" ? "视频" : "图片")}｜${task.id}｜${task.model} / ${task.provider}｜用途：${resolvedShotIds.join("、") || "尚未指定"}`,
					);
				}
				return {
					...production,
					shots,
					versions,
					sharedContext: {
						...production.sharedContext,
						generationHistory,
					},
					productionGraph: { nodes, edges, updatedAt: now },
					updatedAt: now,
				};
			}).catch(() => undefined);
		}

		if (!outputDirectory || !isDesktopRuntime()) return;

		let cancelled = false;
		const copyCompletedAssets = async () => {
			let copiedCount = 0;
			let failedCount = 0;
			const copiedArchives: ProjectOutputArchiveRecord[] = [];
			// 文件名去重必须覆盖“历史归档 + 本次批量归档”，否则同一批次
			// 的两个结果可能得到同名文件，后写入的文件会覆盖先写入的文件。
			const existingFilenames = new Set(
				(config?.overview.production?.outputArchives ?? []).map((item) => item.filename),
			);
			for (const task of completedTasks) {
				for (const [assetIndex, asset] of task.assets.entries()) {
					const sourcePath = asset.downloadPath?.trim();
					if (!sourcePath || !sourcePath.startsWith("/")) continue;
					const assetKey = asset.assetId || `${asset.slotIndex ?? assetIndex}`;
					const copyKey = `${task.id}:${assetKey}:${outputDirectory}`;
					if (
						persistedOutputArchiveKeys.has(copyKey) ||
						copiedOutputAssetKeysRef.current.has(copyKey) ||
						copyingOutputAssetKeysRef.current.has(copyKey)
					) {
						copiedOutputAssetKeysRef.current.add(copyKey);
						continue;
					}

					copyingOutputAssetKeysRef.current.add(copyKey);
					try {
						const sourceName = sourcePath.split(/[\\/]/).pop() || "";
						const fallbackExtension =
							asset.mimeType?.split("/")[1]?.split(";")[0]?.trim() ||
							(task.kind === "video" ? "mp4" : "png");
						const requestedFilename = buildOutputFilename({
							requestedName: asset.title,
							sourceName,
							fallbackBase: `${task.id}-${assetIndex + 1}`,
							fallbackExtension,
							shotId: task.sectionId || undefined,
							assetLabel: task.assetTitle || asset.title || undefined,
							version: `V${String(Math.max(1, (task.retryCount ?? 0) + 1)).padStart(2, "0")}`,
						});
						const filename = ensureUniqueOutputFilename(requestedFilename, existingFilenames);
						existingFilenames.add(filename);
						await copyDesktopFileToDirectory({
							directory: outputDirectory,
							filename,
							sourcePath,
						});
						copiedOutputAssetKeysRef.current.add(copyKey);
						copiedArchives.push({
							id: `archive-${task.id}-${assetKey}-${Date.now()}`,
							taskId: task.id,
							assetId: asset.assetId,
							shotId: task.sectionId || undefined,
							version: `V${String(Math.max(1, (task.retryCount ?? 0) + 1)).padStart(2, "0")}`,
							outputDirectory,
							outputPath: `${outputDirectory.replace(/[\\/]+$/, "")}/${filename}`,
							filename,
							kind: task.kind === "video" ? "video" : task.kind === "audio" ? "audio" : "image",
							createdAt: new Date().toISOString(),
						});
						copiedCount += 1;
					} catch {
						failedCount += 1;
					} finally {
						copyingOutputAssetKeysRef.current.delete(copyKey);
					}
				}
			}
			if (cancelled || (copiedCount === 0 && failedCount === 0)) return;
			if (copiedArchives.length > 0) {
				void updateProjectProduction(projectId, (production) => {
					const existing = production.outputArchives ?? [];
					const additions = copiedArchives.filter(
						(record) =>
							!existing.some((item) => outputArchiveKey(item) === outputArchiveKey(record)),
					);
					if (additions.length === 0) return production;
					return {
						...production,
						outputArchives: mergeOutputArchives(existing, additions),
						updatedAt: new Date().toISOString(),
					};
				}).catch(() => undefined);
			}
			if (failedCount > 0) {
				toast.warning("部分结果未复制到输出目录", {
					description: `已复制 ${copiedCount} 个，失败 ${failedCount} 个；项目资产库中的原始结果不受影响。`,
				});
			} else {
				toast.success("结果已复制到输出目录", {
					description: `本次归档 ${copiedCount} 个文件：${outputDirectory}`,
				});
			}
		};

		void copyCompletedAssets();
		return () => {
			cancelled = true;
		};
	}, [
		config?.overview.production?.productionGraph?.nodes,
		config?.overview.outputDirectory,
		imageTaskData?.tasks,
		projectId,
		toast,
		videoTaskData?.tasks,
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
				selectedAssetResourceType: "storyboard",
				resolveLatestSection: false,
				statusResourceKey: reel.id,
			});
		},
		[projectId],
	);
	const openStoryboardImageGeneration = useCallback(
		(
			group: WorkspaceStoryboardVideoDocumentGroup,
			reel: WorkspaceStoryboardVideoReel,
			intent: StoryboardImageIntent,
		) => {
			const baseSection = storyboardReelToSectionContext(group, reel);
			const intentLabel = storyboardImageIntentLabels[intent];
			setMediaGenerationRequest({
				kind: "image",
				projectId: projectId ?? undefined,
				section: {
					...baseSection,
					headingText: `${baseSection.headingText}｜${intentLabel}`,
					prompt: `【${intentLabel}】\n${baseSection.prompt ?? baseSection.markdown}`,
				},
				selectedAssetResourceType: "storyboard",
				resolveLatestSection: false,
				statusResourceKey: `${reel.id}:${intent}`,
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
	const openCreatorShotGeneration = useCallback(
		(kind: "image" | "video", shot: ProjectShotRecord) => {
			const prompt =
				kind === "image"
					? shot.executionPrompt || shot.prompt || shot.description || shot.title
					: shot.motionPrompt || shot.cameraLanguage || shot.description || shot.title;
			setMediaGenerationRequest({
				kind,
				projectId: projectId ?? undefined,
				section: {
					blockId: `creator:${shot.id}:${kind}`,
					documentId: `creator:${projectId ?? "project"}`,
					headingLevel: 2,
					headingOccurrence: shot.sequence,
					headingText: `${shot.shotCode} ${shot.title}`,
					markdown: prompt,
					plainText: prompt,
					prompt,
				},
				resolveLatestSection: false,
				shotIds: [shot.id],
				selectedAssetKeys: projectCatalogAssets
					.filter(
						(asset) =>
							shot.assetIds?.includes(asset.id) ||
							shot.assetIds?.includes(asset.mediaAssetId ?? ""),
					)
					.map(generationAssetSelectionKey)
					.filter((key): key is string => Boolean(key)),
				statusResourceKey: `${shot.id}:${kind}`,
			});
		},
		[projectCatalogAssets, projectId],
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
			const items = overviewBatchGenerationItems(batchGenerationDialog, settings, projectId, {
				allAssets: mentionAssets,
				allDocuments: mentionDocuments,
				selectedGenerationAssets,
			});
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
			mentionAssets,
			mentionDocuments,
			mutateImageTasks,
			mutateVideoTasks,
			projectGenerationScopeId,
			projectId,
			selectedGenerationAssets,
			toast,
		],
	);
	const closeBatchGenerationDialog = useCallback((open: boolean) => {
		if (!open) setBatchGenerationDialog(null);
	}, []);

	if (!projectId) return <Navigate to="/" replace />;
	const openWorkspace = (
		workspace: ProjectWorkspaceView,
		stage?: ReturnType<typeof buildProductionPipeline>["stages"][number],
	) => {
		navigate(
			agentProjectPath(projectId, {
				workspace,
				stageId: workspace === "workflow" ? (stage?.id ?? routeStageId ?? undefined) : undefined,
			}),
		);
	};

	return (
		<ProjectWorkspaceShell>
			<div className="flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
				<div className="min-h-0 flex-1 overflow-y-auto bg-ide-editor">
					<main
						className={cn(
							"mx-auto flex min-h-full w-full flex-col",
							isCreatorWorkspace ? "h-full max-w-none" : "max-w-7xl gap-5 px-4 py-5 lg:px-6",
						)}
					>
						{isLoading ? (
							<div className="grid min-h-56 place-items-center border border-border bg-card">
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<Loader2 className="size-4 animate-spin" />
									<span>正在加载项目概览</span>
								</div>
							</div>
						) : null}

						{error ? (
							<div className="rounded-xl border border-warning-border bg-warning-surface/60 p-4 text-sm text-warning-foreground">
								<p className="font-semibold">这个项目的总控信息暂时没有读到</p>
								<p className="mt-1 text-xs leading-5">
									先不要重复创建项目。旧文档和资产可能仍然在本地；你可以先从左侧进入旧文档继续编辑，稍后再重新绑定模板。
								</p>
							</div>
						) : null}

						{config && !isLoading && isCreatorWorkspace && productionContext ? (
							<>
								<CreatorProjectWorkspace
									assets={projectCatalogAssets}
									context={productionContext}
									onGenerate={openCreatorShotGeneration}
									onOpenWorkspace={() => openWorkspace("workflow")}
									onProductionPatch={updateProductionPatch}
								/>
								<MediaGenerationDialog
									open={Boolean(mediaGenerationRequest)}
									request={mediaGenerationRequest}
									onOpenChange={(open) => {
										if (!open) setMediaGenerationRequest(null);
									}}
								/>
							</>
						) : null}

						{config && !isLoading && !isCreatorWorkspace ? (
							<section className="grid gap-5">
								<ProjectRecoveryNotice
									config={config}
									documentCount={workspaceDocuments?.documents.length ?? 0}
									documentResourcesError={documentResourcesError}
									generationTasks={generationTasks}
									selectedAssetCount={projectCatalogAssets.length}
								/>
								{activeWorkspace === "dashboard" ? (
									<ProjectCommandCenter
										createdAtLabel={createdAtLabel}
										name={config.name || projectId}
										onOpenWorkspace={openWorkspace}
										pipeline={productionPipeline}
										resourceCount={documentResources.length}
										selectedAssetCount={projectCatalogAssets.length}
										pendingTaskCount={productionTaskSummary.pending}
										failedTaskCount={productionTaskSummary.failed}
										generationTasks={generationTasks}
										productionContext={productionContext}
										shotCount={config.overview.production?.shotCount ?? 0}
										draftStoryboardCount={storyboardVideoGroups.reduce(
											(total, group) => total + group.reels.length,
											0,
										)}
										templateId={config.overview.production?.template.id}
										currentStage={productionPipeline.stages.find(
											(stage) => stage.status === "current",
										)}
									/>
								) : null}
								{activeWorkspace === "dashboard" && productionContext ? (
									<ProductionControlPanel
										context={productionContext}
										tasks={productionTaskSummary}
										onProductionPatch={updateProductionPatch}
									/>
								) : null}
								{activeWorkspace === "workflow" ? (
									<ProductionWorkbench
										name={config.name || projectId}
										projectId={projectId}
										pipeline={productionPipeline}
										initialStageId={routeStageId}
										resourceCount={documentResources.length}
										selectedAssetCount={projectCatalogAssets.length}
										shotCount={config.overview.production?.shotCount ?? 0}
										savingStageId={savingStageId}
										onStateChange={updateStageState}
										onCompletionChange={updateStageCompletion}
										executionStates={config.overview.production?.workbenchStates}
										onExecutionStateChange={updateWorkbenchState}
										onProductionPatch={updateProductionPatch}
										catalogAssets={projectCatalogAssets}
										context={productionContext}
										onOpenStage={(stage) => openWorkspace("workflow", stage)}
										onOpenWorkspace={(workspace) => openWorkspace(workspace)}
									/>
								) : null}
								{activeWorkspace === "reference" ? (
									<ReferenceTransferModule projectId={projectId} />
								) : null}
								{activeWorkspace === "assets" ? (
									<WorkspaceSectionHeader
										description="这里是项目资产总账：参考图、Visual DNA、生成图片、外部导入文件、Prompt 和镜头使用关系都从这里追溯。"
										title="资产库"
									/>
								) : null}
								{activeWorkspace === "assets" ? (
									<div className="grid gap-4">
										<div className="rounded-xl border border-border bg-card p-5">
											<DocumentResourcesSummary
												assets={projectCatalogAssets}
												error={documentResourcesError}
												isLoading={isDocumentResourcesLoading}
												resources={documentResources}
												onOpen={openDocumentResourceType}
											/>
										</div>
										<ProductionRelationMap
											graph={config.overview.production?.productionGraph}
											assets={projectCatalogAssets}
											versions={config.overview.production?.versions}
										/>
										<details className="group rounded-xl border border-border bg-card">
											<summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-foreground">
												<span>导入外部生成结果</span>
												<span className="text-xs font-normal text-muted-foreground group-open:hidden">
													需要时展开
												</span>
											</summary>
											<div className="border-t border-border p-4">
												<ExternalAssetImport
													projectId={projectId}
													onUploaded={async (assets, metadata) => {
														await archiveExternalAssets(assets, metadata);
														await mutateProjectAssets();
													}}
												/>
											</div>
										</details>
									</div>
								) : null}
								{activeWorkspace === "dashboard" ? (
									<details className="group rounded-xl border border-border bg-card">
										<summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
											<div>
												<p className="text-sm font-semibold text-foreground">用量与费用</p>
												<p className="mt-1 text-xs text-muted-foreground">
													需要时再展开，不打断日常制作。
												</p>
											</div>
											<span className="text-xs text-muted-foreground group-open:hidden">查看</span>
											<span className="hidden text-xs text-muted-foreground group-open:inline">
												收起
											</span>
										</summary>
										<div className="border-t border-border px-5 py-4">
											<ProjectUsageSummary
												data={usageSummary}
												error={usageError}
												isLoading={isUsageLoading}
											/>
										</div>
									</details>
								) : null}
								<StoryboardVideoResourcesDialog
									error={storyboardVideoResourcesError}
									generationStatuses={storyboardReelGenerationStatuses}
									group={activeStoryboardVideoGroup}
									isLoading={isStoryboardVideoResourcesLoading}
									open={Boolean(activeStoryboardVideoGroup)}
									onBatchGenerate={openStoryboardVideoGenerationBatch}
									onGenerate={openStoryboardVideoGeneration}
									onGenerateImage={openStoryboardImageGeneration}
									onPrepareWorkbench={prepareStoryboardWorkbench}
									onOpenChange={(open) => {
										if (!open) setStoryboardVideoDocumentId(null);
									}}
								/>
								<DocumentResourcesDialog
									assets={projectCatalogAssets}
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

const WorkspaceSectionHeader: React.FC<{ description: string; title: string }> = ({
	description,
	title,
}) => (
	<header className="border-b border-border pb-4">
		<p className="text-xs font-medium text-primary">项目工作区</p>
		<h1 className="mt-1 text-xl font-semibold text-foreground">{title}</h1>
		<p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
	</header>
);

const ProjectRecoveryNotice: React.FC<{
	config: ProjectConfig;
	documentCount: number;
	documentResourcesError?: unknown;
	generationTasks: GenerationTask[];
	selectedAssetCount: number;
}> = ({ config, documentCount, documentResourcesError, generationTasks, selectedAssetCount }) => {
	const notices = buildProjectRecoveryNotices({
		hasTemplate: Boolean(config.overview.production?.template),
		documentCount,
		documentResourcesError: Boolean(documentResourcesError),
		generationTasks,
		selectedAssetCount,
	});
	const fingerprint = projectRecoveryNoticeFingerprint(notices);
	const storageKey = projectRecoveryDismissalStorageKey(config.projectId);
	const readDismissedFingerprint = () => {
		if (typeof window === "undefined") return "";
		try {
			return window.localStorage.getItem(storageKey) ?? "";
		} catch {
			return "";
		}
	};
	const [dismissal, setDismissal] = useState(() => ({
		storageKey,
		fingerprint: readDismissedFingerprint(),
	}));
	const dismissedFingerprint =
		dismissal.storageKey === storageKey ? dismissal.fingerprint : readDismissedFingerprint();
	const dismiss = () => {
		try {
			window.localStorage.setItem(storageKey, fingerprint);
		} catch {
			// localStorage 不可用时仍允许在本次会话内关闭。
		}
		setDismissal({ storageKey, fingerprint });
	};
	if (notices.length === 0 || dismissedFingerprint === fingerprint) return null;
	return (
		<section
			className="rounded-xl border border-warning-border bg-warning-surface/50 p-4"
			aria-label="项目恢复提示"
		>
			<div className="flex items-start gap-2">
				<ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
				<div className="min-w-0 flex-1">
					<p className="text-sm font-semibold text-warning-foreground">项目恢复提示</p>
					<ul className="mt-2 grid gap-1 text-xs leading-5 text-warning-foreground">
						{notices.map((notice) => (
							<li key={notice}>· {notice}</li>
						))}
					</ul>
				</div>
				<button
					type="button"
					aria-label="关闭项目恢复提示"
					onClick={dismiss}
					className="rounded-md p-1 text-warning-foreground transition hover:bg-warning-foreground/10"
				>
					<X className="size-4" />
				</button>
			</div>
		</section>
	);
};

const ProjectCommandCenter: React.FC<{
	createdAtLabel: string;
	currentStage?: ReturnType<typeof buildProductionPipeline>["stages"][number];
	name: string;
	onOpenWorkspace: (
		workspace: ProjectWorkspaceView,
		stage?: ReturnType<typeof buildProductionPipeline>["stages"][number],
	) => void;
	pipeline: ReturnType<typeof buildProductionPipeline>;
	resourceCount: number;
	selectedAssetCount: number;
	shotCount: number;
	draftStoryboardCount: number;
	pendingTaskCount: number;
	failedTaskCount: number;
	generationTasks: GenerationTask[];
	productionContext: ProjectProductionContext;
	templateId?: string;
}> = ({
	createdAtLabel,
	currentStage,
	name,
	onOpenWorkspace,
	pipeline,
	resourceCount,
	selectedAssetCount,
	shotCount,
	draftStoryboardCount,
	pendingTaskCount,
	failedTaskCount,
	generationTasks,
	productionContext,
	templateId,
}) => {
	const activeStage = currentStage ?? pipeline.stages.find((stage) => stage.status === "current");
	const copy = overviewProductionCopy(templateId);
	const workModules = [
		{
			description: "拆解视觉 DNA，再换成当前项目的人物、场景与产品。",
			view: "reference",
			label: "参考图反推与迁移",
			meta: "多图 → DNA → Prompt",
		},
		{
			description: copy.assetDescription,
			view: "assets",
			label: copy.assetLabel,
			meta: `${resourceCount} 项需求资源 · ${selectedAssetCount} 个已锁定资产`,
		},
		{
			description: copy.shotDescription,
			view: "shots",
			label: copy.shotLabel,
			meta: `${shotCount} ${copy.shotUnit} · ${draftStoryboardCount} 张分镜草稿`,
		},
	] as const;

	return (
		<section className="grid gap-4">
			<div className="overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
				<div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0">
						<p className="text-xs font-medium text-primary">项目总览</p>
						<h1 className="mt-1 truncate text-xl font-semibold text-foreground sm:text-2xl">
							{name}
						</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							{createdAtLabel ? `创建于 ${createdAtLabel} · ` : ""}
							所有阶段共享同一套脚本、参考图、资产、Prompt 和版本记录。
						</p>
					</div>
					<div className="shrink-0 text-left sm:text-right">
						<p className="text-3xl font-semibold tabular-nums text-foreground">
							{pipeline.percent}%
						</p>
						<p className="text-xs text-muted-foreground">
							整体推进 · 已通过 {pipeline.completed}/{pipeline.total} 个阶段
						</p>
						{activeStage ? (
							<p className="mt-1 text-xs text-primary">
								当前第 {activeStage.order} 阶段 · 本阶段 {activeStage.completion}%
							</p>
						) : null}
					</div>
				</div>

				<div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-primary transition-[width]"
						style={{ width: `${pipeline.percent}%` }}
					/>
				</div>

				<div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
					<p className="text-xs font-medium text-primary">下一步任务</p>
					<div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
						<div>
							<p className="text-base font-semibold text-foreground">
								{activeStage
									? `${activeStage.order} / ${pipeline.total} · ${activeStage.label}`
									: "项目流程已完成"}
							</p>
							<p className="mt-1 text-sm text-muted-foreground">
								{activeStage?.gate || "可以进入最终复盘并沉淀可复用模板。"}
							</p>
						</div>
						<Button
							type="button"
							className="shrink-0"
							onClick={() => onOpenWorkspace("workflow", activeStage)}
						>
							继续制作
							<ArrowUpRight className="size-4" />
						</Button>
					</div>
				</div>
			</div>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<OverviewMetric
					label="已完成阶段"
					value={`${pipeline.completed} / ${pipeline.total}`}
					hint="只有有真实内容或确认的阶段才计入"
				/>
				<OverviewMetric
					label="已选资产"
					value={`${selectedAssetCount}`}
					hint="可供镜头调用的当前版本"
				/>
				<OverviewMetric
					label="生成任务"
					value={`${pendingTaskCount}`}
					hint={failedTaskCount > 0 ? `另有 ${failedTaskCount} 个失败待处理` : "当前没有待处理任务"}
					danger={failedTaskCount > 0}
				/>
				<OverviewMetric
					label="正式镜头"
					value={`${shotCount}`}
					hint={`${draftStoryboardCount} 张分镜草稿，确认拆解后才计入正式镜头`}
				/>
			</div>
			<div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
				<div className="flex flex-wrap items-end justify-between gap-2">
					<div>
						<h2 className="text-sm font-semibold text-foreground">制作数据摘要</h2>
						<p className="mt-1 text-xs text-muted-foreground">
							这些数字来自当前项目的文档、资产、任务、QC 和版本记录，不是装饰性统计。
						</p>
					</div>
					<p className="text-xs text-muted-foreground">
						下一步：{productionContext.production?.nextAction || "按当前阶段继续制作"}
					</p>
				</div>
				<div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
					<OverviewMetric
						label="需求资源 / 已锁定资产"
						value={`${productionContext.resourceCount} / ${productionContext.selectedAssetCount}`}
						hint="需求文档中的资源 / 可供镜头调用的资产"
					/>
					<OverviewMetric
						label="正式镜头 / 分镜草稿"
						value={`${productionContext.shotCount} / ${productionContext.draftStoryboardCount}`}
						hint="确认拆解后的正式 Shot / 尚未拆解的分镜草稿"
					/>
					<OverviewMetric
						label="QC 问题"
						value={`${productionContext.qcIssueCount}`}
						hint={`${productionContext.qcPassCount} 项 QC 已通过`}
						danger={productionContext.qcIssueCount > 0}
					/>
					<OverviewMetric
						label="版本记录"
						value={`${productionContext.versionCount}`}
						hint="资产、镜头、任务和交付版本"
					/>
					<OverviewMetric
						label="归档输出"
						value={`${productionContext.outputArchiveCount}`}
						hint={productionContext.outputDirectory ? "已复制到指定本地目录" : "尚未指定输出目录"}
					/>
				</div>
			</div>
			<ProductionTaskCenter pipeline={pipeline} tasks={generationTasks} />
			<div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
				<div className="flex items-center justify-between gap-3">
					<div>
						<h2 className="text-sm font-semibold text-foreground">工作模块</h2>
						<p className="mt-1 text-xs text-muted-foreground">
							按制作链路进入，不把助手、资料和生成入口混在一起。
						</p>
					</div>
				</div>
				<div className="mt-4 grid gap-3 md:grid-cols-3">
					{workModules.map((entry) => (
						<button
							key={entry.view}
							type="button"
							className="group flex min-h-24 items-center gap-3 rounded-xl border border-border bg-background p-3 text-left transition hover:border-primary/30 hover:bg-primary/5"
							onClick={() => onOpenWorkspace(entry.view)}
						>
							<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
								{entry.view === "reference" ? "01" : entry.view === "assets" ? "02" : "03"}
							</span>
							<span className="min-w-0 flex-1">
								<span className="flex items-center justify-between gap-3">
									<strong className="text-sm text-foreground">{entry.label}</strong>
									<span className="shrink-0 text-xs text-muted-foreground">{entry.meta}</span>
								</span>
								<span className="mt-1 block text-xs leading-5 text-muted-foreground">
									{entry.description}
								</span>
							</span>
							<ArrowUpRight className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
						</button>
					))}
				</div>
			</div>
		</section>
	);
};

const OverviewMetric: React.FC<{
	label: string;
	value: string;
	hint: string;
	danger?: boolean;
}> = ({ label, value, hint, danger }) => (
	<div
		className={cn(
			"rounded-xl border border-border bg-card p-4",
			danger && "border-warning-border bg-warning-surface/30",
		)}
	>
		<p className="text-xs text-muted-foreground">{label}</p>
		<p className="mt-2 text-xl font-semibold tabular-nums text-foreground">{value}</p>
		<p className="mt-1 text-[11px] leading-5 text-muted-foreground">{hint}</p>
	</div>
);

const generationStatusLabel = (status: string) => {
	const normalized = status.trim().toLowerCase();
	if (["completed", "success", "succeeded"].includes(normalized)) return "已完成";
	if (["failed", "error", "cancelled"].includes(normalized)) return "失败";
	if (["running", "processing", "pending", "queued", "in_progress"].includes(normalized))
		return "进行中";
	return status || "未知";
};

const ProductionTaskCenter: React.FC<{
	pipeline: ReturnType<typeof buildProductionPipeline>;
	tasks: GenerationTask[];
}> = ({ pipeline, tasks }) => {
	const [stageFilter, setStageFilter] = useState("all");
	const [kindFilter, setKindFilter] = useState<"all" | "image" | "video">("all");
	const [statusFilter, setStatusFilter] = useState("all");
	const [query, setQuery] = useState("");
	const filteredTasks = useMemo(() => {
		const sorted = [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
		const normalizedQuery = query.trim().toLowerCase();
		return sorted.filter((task) => {
			if (kindFilter !== "all" && task.kind !== kindFilter) return false;
			const normalizedStatus = task.status.trim().toLowerCase();
			if (
				statusFilter === "active" &&
				!["running", "processing", "pending", "queued", "in_progress", "submitted"].includes(
					normalizedStatus,
				)
			)
				return false;
			if (
				statusFilter === "completed" &&
				!["completed", "success", "succeeded"].includes(normalizedStatus)
			)
				return false;
			if (
				statusFilter === "failed" &&
				!["failed", "error", "cancelled"].includes(normalizedStatus) &&
				!task.error
			)
				return false;
			if (stageFilter === "unlinked" && task.documentId) return false;
			if (stageFilter !== "all" && stageFilter !== "unlinked") {
				const stage = pipeline.stages.find((item) => item.id === stageFilter);
				if (stage && task.documentId !== stage.documentId) return false;
			}
			if (normalizedQuery) {
				const haystack = [
					task.id,
					task.documentId,
					task.sectionId,
					task.assetTitle,
					task.model,
					task.provider,
					task.prompt,
					task.message,
				]
					.filter(Boolean)
					.join(" ")
					.toLowerCase();
				if (!haystack.includes(normalizedQuery)) return false;
			}
			return true;
		});
	}, [kindFilter, pipeline.stages, query, stageFilter, statusFilter, tasks]);

	return (
		<section
			className="rounded-2xl border border-border bg-card p-5 shadow-sm"
			aria-label="生成任务中心"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold text-foreground">生成任务中心</h2>
					<p className="mt-1 text-xs text-muted-foreground">
						图片、视频和失败记录都在这里，不需要回忆它们藏在哪个对话里。
					</p>
				</div>
				<div className="grid w-full gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto_auto_auto] sm:items-center">
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="搜任务、镜头、资产、Prompt"
						className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/30"
					/>
					<select
						value={kindFilter}
						onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}
						className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
					>
						<option value="all">图片 + 视频</option>
						<option value="image">只看图片</option>
						<option value="video">只看视频</option>
					</select>
					<select
						value={statusFilter}
						onChange={(event) => setStatusFilter(event.target.value)}
						className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
					>
						<option value="all">全部状态</option>
						<option value="active">进行中</option>
						<option value="completed">已完成</option>
						<option value="failed">失败待处理</option>
					</select>
					<select
						value={stageFilter}
						onChange={(event) => setStageFilter(event.target.value)}
						className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
					>
						<option value="all">全部阶段</option>
						{pipeline.stages.map((stage) => (
							<option key={stage.id} value={stage.id}>
								{String(stage.order).padStart(2, "0")} {stage.label}
							</option>
						))}
						<option value="unlinked">未绑定阶段</option>
					</select>
				</div>
			</div>
			<p className="mt-2 text-[11px] text-muted-foreground">
				当前列表已经限定为本项目 · 显示 {filteredTasks.length} / {tasks.length} 个任务
			</p>
			{filteredTasks.length === 0 ? (
				<div className="mt-4 rounded-lg border border-dashed border-border bg-background px-3 py-5 text-center text-xs text-muted-foreground">
					还没有生成任务。确认阶段后，从对应工作区提交图片或视频任务。
				</div>
			) : (
				<div className="mt-4 grid gap-2">
					{filteredTasks.slice(0, 12).map((task) => {
						const stage = pipeline.stages.find(
							(item) => item.documentId && item.documentId === task.documentId,
						);
						const label =
							task.assetTitle?.trim() ||
							task.assets[0]?.title?.trim() ||
							`${task.kind === "video" ? "视频" : "图片"}任务 ${task.id}`;
						return (
							<div
								key={task.id}
								className="grid gap-2 rounded-lg border border-border bg-background p-3 sm:grid-cols-[1fr_auto] sm:items-center"
							>
								<div className="min-w-0">
									<p className="truncate text-xs font-medium text-foreground">{label}</p>
									<p className="mt-1 truncate text-[11px] text-muted-foreground">
										{stage
											? `${stage.order.toString().padStart(2, "0")} ${stage.label}`
											: "未绑定阶段"}{" "}
										· {task.assets.length} 个结果 · {task.model || task.provider || "未记录模型"}
									</p>
									<p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
										Prompt：{task.prompt || "未记录"}
									</p>
								</div>
								<span
									className={cn(
										"shrink-0 rounded-full px-2 py-1 text-[11px]",
										["failed", "error", "cancelled"].includes(task.status.toLowerCase())
											? "bg-error-surface text-error-foreground"
											: ["completed", "success", "succeeded"].includes(task.status.toLowerCase())
												? "bg-success-surface text-success-foreground"
												: "bg-muted text-muted-foreground",
									)}
								>
									{generationStatusLabel(task.status)}
								</span>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
};

const ExternalAssetImport: React.FC<{
	projectId: string;
	onUploaded: (
		assets: ProjectAsset[],
		metadata: {
			provider?: string;
			model?: string;
			sourceTaskId?: string;
			prompt?: string;
			shotIds?: string[];
			shotIdsByAssetId?: Record<string, string[]>;
		},
	) => void | Promise<void>;
}> = ({ projectId, onUploaded }) => {
	const [uploading, setUploading] = useState(false);
	const [message, setMessage] = useState("");
	const [provider, setProvider] = useState("Codex / 网页 GPT");
	const [model, setModel] = useState("");
	const [sourceTaskId, setSourceTaskId] = useState("");
	const [prompt, setPrompt] = useState("");
	const [shotText, setShotText] = useState("");
	const [shotOverrides, setShotOverrides] = useState("");
	const handleFiles = async (files: File[]) => {
		if (files.length === 0) return;
		setUploading(true);
		setMessage("");
		try {
			const uploadedAssets: ProjectAsset[] = [];
			for (const file of files) uploadedAssets.push(await uploadProjectAsset(projectId, file));
			const shotIdsByAssetId: Record<string, string[]> = {};
			const overrideByFilename = new Map(
				shotOverrides
					.split("\n")
					.map((line) => line.split("=").map((value) => value.trim()))
					.filter(([filename, shots]) => Boolean(filename && shots))
					.map(([filename, shots]) => [filename, uniqueStrings(shots.split(/[,，\s]+/))]),
			);
			for (const [index, asset] of uploadedAssets.entries()) {
				const fileOverride = overrideByFilename.get(files[index]?.name ?? "");
				if (fileOverride?.length) shotIdsByAssetId[asset.id] = fileOverride;
			}
			setMessage(`已导入 ${files.length} 个文件，原文件和版本记录保留在项目资产库。`);
			await onUploaded(uploadedAssets, {
				provider,
				model,
				sourceTaskId,
				prompt,
				shotIds: uniqueStrings(shotText.split(/[,，\s]+/)),
				shotIdsByAssetId,
			});
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "导入失败，请重试。");
		} finally {
			setUploading(false);
		}
	};
	return (
		<section className="rounded-xl border border-dashed border-border bg-card p-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p className="text-sm font-semibold text-foreground">外部生成结果导入</p>
					<p className="mt-1 text-xs text-muted-foreground">
						网页 GPT、生图平台或视频平台生成后，拖进来就会成为项目资产；不会覆盖旧版本。
					</p>
				</div>
				<label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:border-primary/40">
					{uploading ? "正在导入…" : "上传图片 / 视频"}
					<input
						type="file"
						multiple
						accept="image/*,video/*,audio/*"
						className="sr-only"
						disabled={uploading}
						onChange={(event) => {
							void handleFiles(Array.from(event.target.files ?? []));
							event.target.value = "";
						}}
					/>
				</label>
			</div>
			<div className="mt-3 grid gap-2 md:grid-cols-2">
				<input
					className="h-9 rounded-md border border-border bg-background px-3 text-xs"
					value={provider}
					onChange={(event) => setProvider(event.target.value)}
					placeholder="来源平台 / 供应商，例如 Codex、Gemini"
				/>
				<input
					className="h-9 rounded-md border border-border bg-background px-3 text-xs"
					value={model}
					onChange={(event) => setModel(event.target.value)}
					placeholder="模型（可选），例如 nano-banana-2"
				/>
				<input
					className="h-9 rounded-md border border-border bg-background px-3 text-xs md:col-span-2"
					value={sourceTaskId}
					onChange={(event) => setSourceTaskId(event.target.value)}
					placeholder="外部任务 ID（可选）：Codex / 网页 GPT / 其他平台的任务编号"
				/>
				<input
					className="h-9 rounded-md border border-border bg-background px-3 text-xs md:col-span-2"
					value={shotText}
					onChange={(event) => setShotText(event.target.value)}
					placeholder="用途镜头（可选）：S01,S02,S05"
				/>
				<textarea
					className="min-h-16 rounded-md border border-border bg-background px-3 py-2 text-xs md:col-span-2"
					value={shotOverrides}
					onChange={(event) => setShotOverrides(event.target.value)}
					placeholder="按文件单独指定镜头（可选，每行一个）：\n林澜三视图.png=S02,S04,S06\n分镜参考.png=S01,S03"
				/>
				<textarea
					className="min-h-20 rounded-md border border-border bg-background px-3 py-2 text-xs md:col-span-2"
					value={prompt}
					onChange={(event) => setPrompt(event.target.value)}
					placeholder="原始 Prompt（可选，但建议填写；后续可追溯和复用）"
				/>
			</div>
			{message ? <p className="mt-3 text-xs text-muted-foreground">{message}</p> : null}
		</section>
	);
};

const ProductionRelationMap: React.FC<{
	graph?: ProjectProductionGraph;
	assets: SelectedGenerationAsset[];
	versions?: ProjectVersionRecord[];
}> = ({ graph, assets, versions = [] }) => {
	const lanes = [
		{ type: "reference", label: "参考图 / 证据" },
		{ type: "visual-dna", label: "Visual DNA / 风格迁移" },
		{ type: "asset", label: "项目资产 / 当前版本" },
		{ type: "shot", label: "镜头 / 分镜" },
		{ type: "frame", label: "单镜执行图 / 首尾帧" },
		{ type: "generation-task", label: "生成任务 / Prompt" },
		{ type: "video", label: "视频 / 外部导入" },
	] as const;
	const nodes = graph?.nodes ?? [];
	const nodeMap = new Map(nodes.map((node) => [node.id, node]));
	const edges = graph?.edges ?? [];
	const assetNodes = [
		...nodes.filter((node) => node.type === "asset"),
		...assets
			.filter(
				(asset) =>
					!nodes.some((node) => node.assetId === asset.id || node.id === `asset:${asset.id}`),
			)
			.map((asset) => ({
				id: `asset:${asset.id}`,
				type: "asset" as const,
				title: asset.title || asset.resourceTitle || "未命名资产",
				assetId: asset.id,
				status: "当前版本",
				metadata: {
					resourceType: asset.resourceType,
					sourceTaskId: asset.taskId,
					sourceType: asset.sourceType,
					shotIds: asset.shotIds,
					usedInShots: asset.shotIds,
				},
				createdAt: asset.createdAt || new Date().toISOString(),
			})),
	];
	return (
		<section className="rounded-xl border border-border bg-card p-5">
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="text-sm font-semibold text-foreground">资产关系树</p>
					<p className="mt-1 text-xs text-muted-foreground">
						从参考图 → Visual DNA → 资产 → 镜头 / 单镜图 →
						视频追溯来源。每次替换都新增版本，不覆盖历史。
					</p>
				</div>
				<span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
					{nodes.length} 个关系节点
				</span>
			</div>
			{assetNodes.length > 0 ? (
				<div className="mt-4 rounded-lg border border-border bg-background p-3">
					<div className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
						<GitBranch className="size-3.5 text-primary" />
						每张资产的来源、Prompt 和使用位置
					</div>
					<div className="grid gap-2">
						{assetNodes.slice(0, 24).map((assetNode) => {
							const metadata = (assetNode.metadata ?? {}) as Record<string, unknown>;
							const related = edges
								.filter((edge) => edge.from === assetNode.id || edge.to === assetNode.id)
								.map((edge) => nodeMap.get(edge.from === assetNode.id ? edge.to : edge.from))
								.filter((node): node is NonNullable<typeof node> => Boolean(node));
							const promptValue = (assetNode.metadata as Record<string, unknown> | undefined)
								?.prompt;
							const prompt = typeof promptValue === "string" ? promptValue : "";
							const metadataShotIds = Array.isArray(metadata.usedInShots)
								? metadata.usedInShots.filter((value): value is string => typeof value === "string")
								: Array.isArray(metadata.shotIds)
									? metadata.shotIds.filter((value): value is string => typeof value === "string")
									: [];
							const graphShotUses = related.filter(
								(node) => node.type === "shot" || node.type === "frame" || node.type === "video",
							);
							const shotLabels =
								metadataShotIds.length > 0
									? metadataShotIds.map((shotId) => `镜头 ${shotId}`)
									: graphShotUses.map((node) => node.title);
							const sourceType = String(metadata.sourceType ?? "").toLowerCase();
							const sourceLabel =
								sourceType === "generated" || sourceType === "generation" || metadata.sourceTaskId
									? "App 内生成"
									: sourceType === "external-import" ||
										  sourceType === "uploaded" ||
										  sourceType === "imported"
										? "外部导入"
										: "尚未记录";
							const sourceTaskId =
								typeof metadata.sourceTaskId === "string" ? metadata.sourceTaskId : "";
							const versionRecords = versions.filter(
								(version) =>
									version.entityType === "asset" && version.entityId === assetNode.assetId,
							);
							const latestVersion = versionRecords[versionRecords.length - 1];
							return (
								<details
									key={assetNode.id}
									className="rounded-md border border-border/80 bg-card px-3 py-2"
									open={assetNodes.length <= 4}
								>
									<summary className="flex cursor-pointer list-none items-center gap-2 text-xs">
										<span className="size-2 rounded-full bg-primary" />
										<span className="min-w-0 flex-1 truncate font-medium text-foreground">
											{assetNode.title}
										</span>
										<span className="shrink-0 text-muted-foreground">
											{shotLabels.length ? `${shotLabels.length} 个镜头关联` : "尚未绑定镜头"}
										</span>
									</summary>
									<div className="mt-2 grid gap-1.5 border-l border-border pl-4 text-[11px] text-muted-foreground">
										<div>
											<span className="font-medium text-foreground">来源：</span>
											{sourceLabel}
											{sourceTaskId ? ` · 任务 ${sourceTaskId}` : ""}
										</div>
										<div>
											<span className="font-medium text-foreground">模型：</span>
											{String(metadata.model ?? "未记录")}
											{metadata.provider ? ` · 供应商 ${String(metadata.provider)}` : ""}
										</div>
										<div>
											<span className="font-medium text-foreground">参与镜头：</span>
											{shotLabels.join("、") || "进入“镜头与动态”后绑定"}
										</div>
										<div>
											<span className="font-medium text-foreground">版本：</span>
											{latestVersion?.version ?? "尚未建立版本"}
										</div>
										<div>
											<span className="font-medium text-foreground">Prompt：</span>
											{prompt || "生成任务完成后自动保留；外部导入可在版本记录中补充"}
										</div>
									</div>
								</details>
							);
						})}
					</div>
				</div>
			) : null}
			<div className="mt-4 grid gap-3 lg:grid-cols-3">
				{lanes.map((lane) => {
					const laneNodes = nodes.filter((node) => node.type === lane.type);
					const fallback: Array<{
						id: string;
						title: string;
						status?: string;
						metadata?: Record<string, unknown>;
					}> =
						lane.type === "asset"
							? assets.slice(0, 8).map((asset) => ({
									id: asset.id,
									title: asset.title || "未命名资产",
									status: "当前版本",
								}))
							: [];
					const items = laneNodes.length > 0 ? laneNodes : fallback;
					return (
						<div
							key={lane.type}
							className="min-h-24 rounded-lg border border-border bg-background p-3"
						>
							<p className="text-xs font-semibold text-foreground">{lane.label}</p>
							{items.length > 0 ? (
								<div className="mt-2 grid gap-1.5">
									{items.slice(0, 8).map((node) => (
										<div
											key={node.id}
											className="rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground"
										>
											<span className="font-medium text-foreground">{node.title}</span>
											{node.status ? ` · ${node.status}` : ""}
											{node.metadata?.prompt ? (
												<span className="mt-1 block truncate">
													Prompt：{String(node.metadata.prompt)}
												</span>
											) : null}
										</div>
									))}
								</div>
							) : (
								<p className="mt-3 text-xs text-muted-foreground">完成对应阶段后自动出现</p>
							)}
						</div>
					);
				})}
			</div>
		</section>
	);
};

const overviewProductionCopy = (templateId?: string) => {
	switch (templateId) {
		case "mini-experiment":
			return {
				assetDescription: "整理参考图、输入素材和候选版本，保留每次实验依据。",
				assetLabel: "测试素材",
				shotDescription: "按测试项对比动作、运镜、首尾帧和生成结果。",
				shotLabel: "动态测试",
				shotUnit: "个测试项",
				emptyShot: "暂无测试项，请在“动态测试”阶段新增一个明确的测试镜头。",
			};
		case "social-content":
			return {
				assetDescription: "整理人物、产品、场景与图文素材，准备内容制作。",
				assetLabel: "素材准备",
				shotDescription: "检查内容镜头、字幕、转场与发布版本。",
				shotLabel: "内容制作",
				shotUnit: "个内容镜头",
				emptyShot: "暂无内容镜头，请先在“内容制作”阶段建立镜头或画面项。",
			};
		case "comic-drama":
			return {
				assetDescription: "管理角色、服装、场景、道具和表情动作的一致性。",
				assetLabel: "角色与场景",
				shotDescription: "按分镜检查对白、情绪、口型和单集连续性。",
				shotLabel: "分镜与单集",
				shotUnit: "个剧情镜头",
				emptyShot: "暂无剧情镜头，请先在“分镜制作”阶段建立对白分镜。",
			};
		default:
			return {
				assetDescription: "查看角色、场景、道具和产品，并继续生成缺失素材。",
				assetLabel: "资产制作",
				shotDescription: "按镜头检查画面、动态版本与生成状态。",
				shotLabel: "镜头制作",
				shotUnit: "个镜头",
				emptyShot: "暂无镜头，请先在对应的镜头拆解或分镜阶段建立 Shot。",
			};
	}
};

const ProductionPipelineCard: React.FC<{
	pipeline: ReturnType<typeof buildProductionPipeline>;
	savingStageId: string | null;
	onStateChange: (stageId: string, status: ProductionStageState | null) => void;
	onOpenStage: (stage: ReturnType<typeof buildProductionPipeline>["stages"][number]) => void;
}> = ({ pipeline, savingStageId, onStateChange, onOpenStage }) => {
	const currentStage = pipeline.stages.find((stage) => stage.status === "current");

	return (
		<section
			className="rounded-md border border-border bg-card p-5"
			aria-labelledby="pipeline-title"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex items-start gap-3">
					<div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
						<Sparkles className="size-4" />
					</div>
					<div>
						<h2 id="pipeline-title" className="text-sm font-semibold text-foreground">
							制作阶段
						</h2>
						<p className="mt-1 text-xs text-muted-foreground">
							从前期策划到最终复盘，按顺序完成可以减少返工。
						</p>
					</div>
				</div>
				<div className="text-right">
					<p className="text-lg font-semibold tabular-nums text-foreground">{pipeline.percent}%</p>
					<p className="text-xs text-muted-foreground">
						整体推进 · {pipeline.completed}/{pipeline.total} 阶段已通过
					</p>
					{currentStage ? (
						<p className="mt-1 text-xs text-primary">当前阶段 {currentStage.completion}%</p>
					) : null}
				</div>
			</div>

			<div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
				<div
					className="h-full rounded-full bg-primary transition-[width]"
					style={{ width: `${pipeline.percent}%` }}
				/>
			</div>

			<div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
				{pipeline.stages.map((stage, index) => (
					<div
						key={stage.id}
						className={cn(
							"flex min-h-32 flex-col gap-3 rounded-md border p-3",
							stage.status === "current"
								? "border-primary/40 bg-primary/5"
								: "border-border bg-background",
						)}
					>
						<div className="flex items-center justify-between gap-2">
							<div
								className={cn(
									"grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium",
									stage.status === "completed"
										? "bg-success-surface text-success-foreground"
										: stage.status === "current"
											? "bg-primary text-primary-foreground"
											: "bg-muted text-muted-foreground",
								)}
							>
								{stage.status === "completed" ? <Check className="size-3.5" /> : index + 1}
							</div>
							{savingStageId === stage.id ? (
								<Loader2 className="size-3.5 animate-spin text-muted-foreground" />
							) : null}
						</div>
						<div className="min-w-0">
							<button
								type="button"
								disabled={!stage.canEnter}
								onClick={() => onOpenStage(stage)}
								className={cn(
									"text-left text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground",
									stage.canEnter && "hover:text-primary hover:underline hover:underline-offset-4",
								)}
								title={stage.canEnter ? "进入这个阶段工作" : "该阶段还没有可继续工作的内容"}
							>
								{stage.label}
							</button>
							<p className="mt-1 text-[11px] font-medium text-muted-foreground">
								{stage.order}/{pipeline.total} · 当前：{productionStageStateLabels[stage.state]}
							</p>
							<p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
								{stage.gate}
							</p>
						</div>
						{!stage.canEnter ? (
							<p className="mt-auto rounded bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">
								尚无文档、资产或任务，完成上一步后解锁
							</p>
						) : null}
						<label className="mt-auto grid gap-1 text-[11px] text-muted-foreground">
							<span>阶段状态</span>
							<select
								aria-label={`${stage.label}阶段状态`}
								value={stage.manualState ?? ""}
								disabled={savingStageId !== null}
								onChange={(event) =>
									onStateChange(
										stage.id,
										event.target.value ? (event.target.value as ProductionStageState) : null,
									)
								}
								className="h-8 rounded-sm border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
							>
								<option value="">跟随自动判断</option>
								{Object.entries(productionStageStateLabels).map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
						</label>
					</div>
				))}
			</div>

			{currentStage ? (
				<div className="mt-4 grid gap-2">
					<p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
						当前停在“{currentStage.label}”：{currentStage.gate}
					</p>
					{currentStage.riskWarning ? (
						<p className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-foreground">
							⚠ {currentStage.riskWarning}
						</p>
					) : null}
				</div>
			) : null}
		</section>
	);
};

// 保留旧流程卡片定义，方便旧项目回滚与兼容；新项目工作流统一使用 ProductionWorkbench。
void ProductionPipelineCard;

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
	const storyboardCover = useMemo(
		() =>
			resourceType === "storyboard"
				? ([...assets]
						.reverse()
						.find((asset) => asset.kind === "image" && asset.resourceType === "storyboard") ?? null)
				: null,
		[assets, resourceType],
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

				{!isLoading && !error && resourceType === "storyboard" && storyboardCover ? (
					<div className="min-h-0 flex-1 overflow-y-auto p-5">
						<PhotoProvider maskOpacity={0.84}>
							<div className="mx-auto max-w-6xl overflow-hidden rounded-lg border border-border bg-card">
								<div className="relative aspect-video bg-muted">
									<PhotoView src={generationAssetSource(storyboardCover)}>
										<img
											src={generationAssetSource(storyboardCover)}
											alt={storyboardCover.title || "分镜母图"}
											className="size-full cursor-zoom-in object-contain"
										/>
									</PhotoView>
								</div>
								<div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
									<div className="min-w-0">
										<p className="truncate text-sm font-semibold text-foreground">
											{storyboardCover.title || "分镜母图"}
										</p>
										<p className="mt-1 text-xs text-muted-foreground">
											点击图片放大查看；分镜母图只保留一个当前正式封面。
										</p>
									</div>
									<Badge variant="secondary">当前版本</Badge>
								</div>
							</div>
						</PhotoProvider>
					</div>
				) : null}

				{!isLoading && !error && filteredResources.length === 0 && !storyboardCover ? (
					<div className="p-4 text-sm text-muted-foreground">
						当前没有从 {descriptor.label} 文档中解析出资源。
					</div>
				) : null}

				{!isLoading && !error && filteredResources.length > 0 && resourceType !== "storyboard" ? (
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
						已归档 {assetCount} 张
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

export const StoryboardVideoResourcesSummary: React.FC<{
	error?: unknown;
	generationStatuses: Map<string, ResourceGenerationStatus>;
	groups: WorkspaceStoryboardVideoDocumentGroup[];
	isLoading: boolean;
	onOpen: (documentId: string) => void;
	templateId?: string;
}> = ({ error, generationStatuses, groups, isLoading, onOpen, templateId }) => {
	const copy = overviewProductionCopy(templateId);
	const reels = groups.flatMap((group) =>
		group.reels.map((reel, reelIndex) => ({
			group,
			reel,
			reelIndex,
			status: generationStatuses.get(reel.id),
		})),
	);
	const finalCount = reels.filter(
		({ reel }) => reel.generatedVideoCount > 0 || reel.videos.length > 0,
	).length;

	return (
		<section className="bg-card">
			<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
				<div className="flex min-w-0 items-center gap-2">
					<Film className="size-4 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<h2 className="text-sm font-semibold text-foreground">{copy.shotLabel}</h2>
						<p className="mt-1 text-xs text-muted-foreground">
							Final {finalCount} / {reels.length} · 点击镜头进入生成、画布和粗剪
						</p>
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
			<div className="sr-only" aria-live="polite">
				{groups.map((group) => (
					<span key={group.documentId}>
						分镜组 {group.reels.length} 项 · 成片{" "}
						{group.reels.reduce((total, reel) => total + reel.videos.length, 0)} 个
					</span>
				))}
			</div>
			{reels.length > 0 ? (
				<div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{reels.map(({ group, reel, reelIndex, status }) => {
						const hasFinal = reel.generatedVideoCount > 0 || reel.videos.length > 0;
						const statusLabel = hasFinal
							? "Final"
							: status?.kind === "pending"
								? "Working"
								: status?.kind === "failed"
									? "Fix"
									: "Waiting";
						return (
							<button
								key={reel.id}
								type="button"
								aria-label={
									reelIndex === 0 ? `${group.documentTitle} 视频生成` : `${reel.title} 镜头生产`
								}
								className="group flex min-h-28 min-w-0 flex-col items-start justify-between rounded-sm border border-border bg-ide-editor px-3 py-3 text-left transition-colors hover:border-input hover:bg-ide-list-hover"
								onClick={() => onOpen(group.documentId)}
							>
								<span className="flex w-full min-w-0 items-start justify-between gap-2">
									<span className="flex min-w-0 items-center gap-2">
										<Film className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
										<span className="truncate text-sm font-medium text-foreground">
											{reel.title}
										</span>
									</span>
									<Badge
										variant="outline"
										className={cn(
											"shrink-0",
											hasFinal
												? "border-success-border bg-success-surface text-success-foreground"
												: statusLabel === "Fix"
													? "border-error-border bg-error-surface text-error-foreground"
													: statusLabel === "Working"
														? "border-info-border bg-info-surface text-info-foreground"
														: "text-muted-foreground",
										)}
									>
										{statusLabel}
									</Badge>
								</span>
								<span className="line-clamp-2 text-xs text-muted-foreground">
									{reel.plainText?.trim() || group.documentTitle}
								</span>
								<span className="text-xs text-muted-foreground">
									版本 {Math.max(reel.generatedVideoCount, reel.videos.length)} ·{" "}
									{reel.canGenerate ? "可生成" : "待补 Prompt"}
								</span>
							</button>
						);
					})}
				</div>
			) : (
				<div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
					<div className="flex min-h-24 min-w-0 flex-col items-start justify-between rounded-sm border border-border bg-ide-editor px-3 py-3 text-left">
						<span className="flex min-w-0 items-center gap-2">
							<Film className="size-4 shrink-0 text-muted-foreground" />
							<span className="truncate text-sm font-medium text-foreground">镜头卡</span>
						</span>
						<span className="text-xs leading-5 text-muted-foreground">{copy.emptyShot}</span>
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
	onGenerateImage: (
		group: WorkspaceStoryboardVideoDocumentGroup,
		reel: WorkspaceStoryboardVideoReel,
		intent: StoryboardImageIntent,
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
	onGenerateImage,
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
												onGenerateImage={(intent) => onGenerateImage(group, reel, intent)}
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
	onGenerateImage: (intent: StoryboardImageIntent) => void;
	onToggleSelected: () => void;
}> = ({ generationStatus, reel, selected, onGenerate, onGenerateImage, onToggleSelected }) => {
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
				<div className="mt-auto grid gap-2 pt-1">
					<div className="grid grid-cols-3 gap-1.5">
						{(["single-shot", "first-frame", "last-frame"] as StoryboardImageIntent[]).map(
							(intent) => (
								<Button
									key={intent}
									type="button"
									size="sm"
									variant="ghost"
									className="h-7 rounded-sm px-1 text-[11px]"
									disabled={!reel.canGenerate}
									onClick={() => onGenerateImage(intent)}
								>
									{storyboardImageIntentLabels[intent]}
								</Button>
							),
						)}
					</div>
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
	referenceContext: OverviewBatchGenerationReferenceContext,
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
				referenceContext,
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
			referenceContext,
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
	referenceContext,
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
	referenceContext: OverviewBatchGenerationReferenceContext;
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
	prompt,
	promptSupplements: settings.promptSupplements,
	promptOptimization: settings.promptOptimization,
	provider: settings.route.provider,
	...batchGenerationReferences(settings, section, prompt, kind, referenceContext),
	resourceType,
	routeId: settings.route.id,
	sectionId: section.blockId,
	versionId: settings.version.id,
});

const batchGenerationReferences = (
	settings: BatchGenerationSettings,
	section: MarkdownSectionContext,
	prompt: string,
	kind: "image" | "video",
	context: OverviewBatchGenerationReferenceContext,
): Pick<GenerationMessageRequest, "referenceAssetIds" | "referenceBindings" | "referenceUrls"> => {
	if (!settings.route.supportsReferenceUrls) {
		return { referenceAssetIds: [], referenceBindings: [], referenceUrls: [] };
	}

	const mentionReferences = batchMentionReferenceInputs(section, prompt, kind, context);
	return {
		referenceAssetIds: uniqueStrings([
			...(settings.referenceAssetIds ?? []),
			...mentionReferences.assetIds,
		]),
		referenceBindings: mentionReferences.bindings,
		referenceUrls: mentionReferences.urls,
	};
};

const batchMentionReferenceInputs = (
	section: MarkdownSectionContext,
	prompt: string,
	kind: "image" | "video",
	context: OverviewBatchGenerationReferenceContext,
) => {
	const mentionMarkdown = prompt.trim() ? `${section.markdown}\n\n${prompt}` : "";
	const mentions = parseMentionsFromMarkdown(mentionMarkdown)
		.map((reference) =>
			resolveMentionPayloadWithSelectedAssets(
				reference,
				context.allDocuments,
				context.allAssets,
				context.selectedGenerationAssets,
			),
		)
		.filter(uniqueResolvedMention);

	return buildMentionReferenceInputs(mentions, {
		includeSelectedAudios: kind === "video",
	});
};

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

const productionResourceTypes = new Set<SelectedGenerationAsset["resourceType"]>([
	"character",
	"scene",
	"storyboard",
	"prop",
]);

/** 将关系图和项目文件资产投影成资源库可直接消费的统一记录。 */
const mergeProductionCatalogAssets = (
	selectedAssets: SelectedGenerationAsset[],
	graph: ProjectProductionGraph | undefined,
	projectAssets: ProjectAsset[],
	resources: WorkspaceDocumentResource[] = [],
) => {
	const byId = new Map<string, SelectedGenerationAsset>();
	for (const asset of selectedAssets) byId.set(asset.id, asset);
	const projectAssetById = new Map(projectAssets.map((asset) => [asset.id, asset]));
	for (const node of graph?.nodes ?? []) {
		if (node.type !== "asset" || !node.assetId) continue;
		const resourceType = node.metadata?.resourceType;
		if (
			typeof resourceType !== "string" ||
			!productionResourceTypes.has(resourceType as SelectedGenerationAsset["resourceType"])
		)
			continue;
		const file = projectAssetById.get(node.assetId);
		const matchingResources = resources.filter(
			(resource) => resource.type === resourceType && resource.documentId === node.documentId,
		);
		// 旧项目只保存了 documentId，没有保存生成时的 sectionId。
		// 优先把资产归到“已生成/本轮生成结果”资源，保证角色三视图、分镜图
		// 不会在资产库统计里显示为 0 张；新任务则继续使用已有 resourceId。
		const inferredResource =
			matchingResources.find((resource) => /生成|结果|输出/i.test(resource.title)) ??
			matchingResources[0];
		const usedInShots = Array.isArray(node.metadata?.usedInShots)
			? node.metadata.usedInShots.filter((value): value is string => typeof value === "string")
			: [];
		const existing = byId.get(node.assetId);
		byId.set(node.assetId, {
			assetIndex: existing?.assetIndex ?? 0,
			base64: existing?.base64,
			createdAt: existing?.createdAt ?? node.createdAt,
			id: node.assetId,
			kind:
				existing?.kind ??
				(file?.kind === "image" || file?.kind === "video" || file?.kind === "audio"
					? file.kind
					: "image"),
			mediaAssetId: existing?.mediaAssetId ?? node.assetId,
			mimeType: existing?.mimeType ?? file?.mimeType,
			downloadPath: existing?.downloadPath ?? file?.downloadPath,
			resourceId: existing?.resourceId ?? inferredResource?.sectionId ?? node.documentId,
			resourceTitle: existing?.resourceTitle ?? node.title,
			resourceType:
				existing?.resourceType ?? (resourceType as SelectedGenerationAsset["resourceType"]),
			shotIds: uniqueStrings([...(existing?.shotIds ?? []), ...usedInShots]),
			sourceTaskId:
				existing?.sourceTaskId ??
				(typeof node.metadata?.sourceTaskId === "string" ? node.metadata.sourceTaskId : undefined),
			sourceDocumentId: existing?.sourceDocumentId ?? node.documentId,
			sourceType:
				existing?.sourceType ??
				(typeof node.metadata?.sourceType === "string" ? node.metadata.sourceType : undefined),
			title: existing?.title ?? node.title ?? file?.filename,
			updatedAt: existing?.updatedAt ?? node.createdAt,
			url: existing?.url ?? file?.url,
		});
	}
	return [...byId.values()];
};

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
