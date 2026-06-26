import { Check, FileText, Film, Loader2, Palette, ReceiptText, Wand2 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import useSWR from "swr";
import type { GenerationAsset } from "@/domains/generation/api/generation";
import {
	type SelectedGenerationAsset,
	getSelectedGenerationAssets,
	selectedGenerationAssetsQueryKey,
} from "@/domains/generation/api/generation";
import { GenerationModalShell } from "@/domains/documents/components/GenerationModalShell";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { sectionAssetKeysFromDocuments } from "@/domains/documents/components/section-generation-asset-keys";
import { useDocumentsStore } from "@/domains/documents/stores";
import {
	generationAssetSelectionKey,
	generationAssetSource,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import {
	selectedGenerationResourceDescriptorMap,
	selectedGenerationResourceDescriptors,
} from "@/domains/generation/lib/selected-resources";
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
import { ImageGenerationDialog } from "@/shared/components/generation-dialogs/ImageGenerationDialog";
import { VideoGenerationDialog } from "@/shared/components/generation-dialogs/VideoGenerationDialog";
import { apiResourceURL } from "@/shared/lib/api-base";
import { cn } from "@/shared/lib/utils";

const numberFormatter = new Intl.NumberFormat("zh-CN");
const moneyFormatter = new Intl.NumberFormat("zh-CN", {
	maximumFractionDigits: 6,
	minimumFractionDigits: 0,
});

export const ProjectOverview: React.FC = () => {
	const location = useLocation();
	const projectId = getRouteProjectId(location.search);
	const activeProjectId = useProjectStore((state) => state.activeProjectId);
	const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);
	const [documentResourceDialogType, setDocumentResourceDialogType] =
		useState<AgentResourceType | null>(null);
	const [imageGenerationSection, setImageGenerationSection] =
		useState<MarkdownSectionContext | null>(null);
	const [videoGenerationSection, setVideoGenerationSection] =
		useState<MarkdownSectionContext | null>(null);
	const [imageGenerationQueue, setImageGenerationQueue] = useState<MarkdownSectionContext[]>([]);
	const [videoGenerationQueue, setVideoGenerationQueue] = useState<MarkdownSectionContext[]>([]);
	const [storyboardVideoDocumentId, setStoryboardVideoDocumentId] = useState<string | null>(null);
	const storeDocuments = useDocumentsStore((state) => state.documents);
	const documentsProjectId = useDocumentsStore((state) => state.projectId);
	const hydrateWorkspaceDocuments = useDocumentsStore((state) => state.hydrateWorkspaceDocuments);
	const toggleStoredSectionImage = useDocumentsStore((state) => state.toggleSectionImage);
	const toggleStoredSectionMedia = useDocumentsStore((state) => state.toggleSectionMedia);
	const usageParams = useMemo(
		() => (projectId ? { groupBy: "capability", projectId } : null),
		[projectId],
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
	const { data: selectedResources } = useSWR(
		projectId ? selectedGenerationAssetsQueryKey(projectId) : null,
		() => getSelectedGenerationAssets(projectId ?? ""),
	);
	const {
		data: storyboardVideoResources,
		error: storyboardVideoResourcesError,
		isLoading: isStoryboardVideoResourcesLoading,
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
		setImageGenerationSection(null);
		setVideoGenerationSection(null);
		setImageGenerationQueue([]);
		setVideoGenerationQueue([]);
		setStoryboardVideoDocumentId(null);
	}, [projectId]);

	const documents = useMemo(
		() =>
			documentsProjectId === projectId ? storeDocuments : (workspaceDocuments?.documents ?? []),
		[documentsProjectId, projectId, storeDocuments, workspaceDocuments?.documents],
	);
	const documentResources = workspaceDocumentResources?.resources ?? [];
	const storyboardVideoGroups = storyboardVideoResources?.groups ?? [];
	const activeStoryboardVideoGroup = useMemo(
		() =>
			storyboardVideoGroups.find((group) => group.documentId === storyboardVideoDocumentId) ?? null,
		[storyboardVideoDocumentId, storyboardVideoGroups],
	);

	const createdAtLabel = useMemo(() => {
		if (!config?.createdAt) return "";
		const date = new Date(config.createdAt);
		if (Number.isNaN(date.getTime())) return config.createdAt;
		return date.toLocaleString();
	}, [config?.createdAt]);

	const openDocumentResourceType = useCallback((resourceType: AgentResourceType) => {
		setDocumentResourceDialogType(resourceType);
	}, []);
	const openImageGeneration = useCallback((resource: WorkspaceDocumentResource) => {
		setImageGenerationQueue([]);
		setImageGenerationSection(documentResourceToSectionContext(resource));
	}, []);
	const openImageGenerationBatch = useCallback((resources: WorkspaceDocumentResource[]) => {
		const sections = resources.map(documentResourceToSectionContext);
		const [firstSection, ...remainingSections] = sections;
		if (!firstSection) return;

		setImageGenerationQueue(remainingSections);
		setImageGenerationSection(firstSection);
	}, []);
	const closeImageGeneration = useCallback(
		(open: boolean) => {
			if (open) return;

			const [nextSection, ...remainingSections] = imageGenerationQueue;
			setImageGenerationQueue(remainingSections);
			setImageGenerationSection(nextSection ?? null);
		},
		[imageGenerationQueue],
	);
	const openStoryboardVideoGeneration = useCallback(
		(group: WorkspaceStoryboardVideoDocumentGroup, reel: WorkspaceStoryboardVideoReel) => {
			setVideoGenerationQueue([]);
			setVideoGenerationSection(storyboardReelToSectionContext(group, reel));
		},
		[],
	);
	const openStoryboardVideoGenerationBatch = useCallback(
		(group: WorkspaceStoryboardVideoDocumentGroup, reels: WorkspaceStoryboardVideoReel[]) => {
			const sections = reels.map((reel) => storyboardReelToSectionContext(group, reel));
			const [firstSection, ...remainingSections] = sections;
			if (!firstSection) return;

			setVideoGenerationQueue(remainingSections);
			setVideoGenerationSection(firstSection);
		},
		[],
	);
	const closeVideoGeneration = useCallback(
		(open: boolean) => {
			if (open) return;

			const [nextSection, ...remainingSections] = videoGenerationQueue;
			setVideoGenerationQueue(remainingSections);
			setVideoGenerationSection(nextSection ?? null);
		},
		[videoGenerationQueue],
	);
	const selectedImageAssetKeys = useCallback(
		(section: MarkdownSectionContext) => sectionAssetKeysFromDocuments(documents, section, "image"),
		[documents],
	);
	const selectedVideoAssetKeys = useCallback(
		(section: MarkdownSectionContext) => sectionAssetKeysFromDocuments(documents, section, "video"),
		[documents],
	);
	const toggleSectionImage = useCallback(
		(section: MarkdownSectionContext, asset: GenerationAsset, selected: boolean) => {
			const source = generationAssetSource(asset);
			if (!source || !generationAssetSelectionKey(asset)) return;

			toggleStoredSectionImage(
				section,
				{
					src: source,
					title: section.headingText,
				},
				selected,
			);
		},
		[toggleStoredSectionImage],
	);
	const toggleSectionVideo = useCallback(
		(asset: GenerationAsset, selected: boolean) => {
			if (!videoGenerationSection || asset.kind !== "video") return;

			const source = generationAssetSource(asset);
			if (!source || !generationAssetSelectionKey(asset)) return;

			toggleStoredSectionMedia(
				videoGenerationSection,
				{
					kind: "video",
					src: source,
					title: videoGenerationSection.headingText,
				},
				selected,
			);
		},
		[toggleStoredSectionMedia, videoGenerationSection],
	);
	const ignoreSectionGeneration = useCallback(() => undefined, []);

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
							<div className="border border-error-border bg-error-surface p-4 text-sm text-error-foreground">
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
									assets={selectedResources?.assets ?? []}
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
									group={activeStoryboardVideoGroup}
									isLoading={isStoryboardVideoResourcesLoading}
									open={Boolean(activeStoryboardVideoGroup)}
									onBatchGenerate={openStoryboardVideoGenerationBatch}
									onGenerate={openStoryboardVideoGeneration}
									onOpenChange={(open) => {
										if (!open) setStoryboardVideoDocumentId(null);
									}}
								/>
								<DocumentResourcesDialog
									assets={selectedResources?.assets ?? []}
									error={documentResourcesError}
									isLoading={isDocumentResourcesLoading}
									open={Boolean(documentResourceDialogType)}
									resourceType={documentResourceDialogType}
									resources={documentResources}
									onBatchGenerate={openImageGenerationBatch}
									onGenerate={openImageGeneration}
									onOpenChange={(open) => {
										if (!open) setDocumentResourceDialogType(null);
									}}
								/>
								<ImageGenerationDialog
									open={Boolean(imageGenerationSection)}
									projectId={projectId}
									section={imageGenerationSection}
									selectedAssetKeys={selectedImageAssetKeys}
									onGenerationComplete={ignoreSectionGeneration}
									onGenerationError={ignoreSectionGeneration}
									onGenerationStart={ignoreSectionGeneration}
									onOpenChange={closeImageGeneration}
									onOpenReferenceGeneration={setImageGenerationSection}
									onToggleImage={toggleSectionImage}
								/>
								<VideoGenerationDialog
									open={Boolean(videoGenerationSection)}
									projectId={projectId}
									resolveLatestSection={false}
									section={videoGenerationSection}
									selectedAssetKeys={
										videoGenerationSection ? selectedVideoAssetKeys(videoGenerationSection) : []
									}
									onOpenChange={closeVideoGeneration}
									onOpenReferenceGeneration={setImageGenerationSection}
									onToggleAsset={toggleSectionVideo}
								/>
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
	isLoading: boolean;
	open: boolean;
	resourceType: AgentResourceType | null;
	resources: WorkspaceDocumentResource[];
	onBatchGenerate: (resources: WorkspaceDocumentResource[]) => void;
	onGenerate: (resource: WorkspaceDocumentResource) => void;
	onOpenChange: (open: boolean) => void;
}> = ({
	assets,
	error,
	isLoading,
	open,
	resourceType,
	resources,
	onBatchGenerate,
	onGenerate,
	onOpenChange,
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
	const selectedCount = selectedAssetCountForResourceType(assets, descriptor.key);

	return (
		<GenerationModalShell
			open={open}
			title={
				<span className="flex min-w-0 items-center gap-2">
					<Icon className="size-4 shrink-0 text-muted-foreground" />
					<span className="truncate">{descriptor.label} · 文档资源</span>
				</span>
			}
			titleAside={
				<Badge variant="secondary" className="shrink-0">
					文档 {filteredResources.length} 项 · 已选 {selectedCount} 张
				</Badge>
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
							<span>正在解析文档资源</span>
						</div>
					</div>
				) : null}

				{!isLoading && error ? (
					<div className="m-4 border border-error-border bg-error-surface p-4 text-sm text-error-foreground">
						文档资源加载失败。
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
							onGenerate={() => onBatchGenerate(selectedResources)}
							onSelectAll={selectAllResources}
						/>
						<div className="min-h-0 flex-1 overflow-y-auto p-4">
							<div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
								{filteredResources.map((resource) => (
									<DocumentResourceCard
										key={resource.id}
										selectedImages={resourceSelectedImages(resource, assets)}
										resource={resource}
										selected={selectedResourceIdSet.has(resource.id)}
										onGenerate={onGenerate}
										onToggleSelected={() => toggleSelectedResource(resource)}
									/>
								))}
							</div>
						</div>
					</>
				) : null}
			</div>
		</GenerationModalShell>
	);
};

const DocumentResourceCard: React.FC<{
	resource: WorkspaceDocumentResource;
	selectedImages: DocumentResourceSelectedImage[];
	selected: boolean;
	onGenerate: (resource: WorkspaceDocumentResource) => void;
	onToggleSelected: () => void;
}> = ({ resource, selectedImages, selected, onGenerate, onToggleSelected }) => {
	const preview = selectedImages[0];
	const assetCount = selectedImages.length;

	return (
		<article
			className={cn(
				"flex h-full min-w-0 flex-col overflow-hidden rounded-sm border bg-card transition-colors",
				selected ? "border-primary" : "border-border",
			)}
		>
			<div className="relative aspect-square bg-ide-toolbar">
				{preview ? (
					<img
						src={preview.src}
						alt={preview.title || resource.title}
						className="size-full object-contain"
					/>
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
				{assetCount > 0 ? (
					<div className="absolute right-2 top-2 rounded-sm border border-border bg-card/95 px-2 py-1 text-xs font-medium text-foreground shadow-sm">
						已选择 {assetCount} 张
					</div>
				) : null}
				{assetCount > 1 ? (
					<div className="absolute bottom-2 right-2 flex max-w-[70%] gap-1">
						{selectedImages.slice(1, 4).map((image) => (
							<img
								key={image.src}
								src={image.src}
								alt=""
								className="size-10 rounded-sm border border-border bg-card object-cover shadow-sm"
							/>
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
						已选择 {assetCount} 张
					</Badge>
				</div>
				<div className="mt-auto pt-1">
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="h-8 w-full rounded-sm"
						disabled={!resource.canGenerate}
						onClick={() => onGenerate(resource)}
					>
						<Wand2 className="size-4" />
						<span>生成图片</span>
					</Button>
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
				<Wand2 className="size-4" />
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
						<h2 className="text-sm font-semibold text-foreground">文档资源</h2>
						<p className="text-xs text-muted-foreground">
							从角色、场景、道具和分镜文档结构中解析出的可生成资源。
						</p>
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
				<div className="mt-3 border border-error-border bg-error-surface px-3 py-2 text-xs text-error-foreground">
					文档资源加载失败。
				</div>
			) : null}
			<div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
				{selectedGenerationResourceDescriptors.map(({ key, label, icon: Icon }) => (
					<button
						key={key}
						type="button"
						aria-label={`${label} 文档资源`}
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
				))}
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
						<h2 className="text-sm font-semibold text-foreground">成片资源</h2>
						<p className="text-xs text-muted-foreground">
							按分镜文档汇总当前项目中已生成的视频片段。
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
				<div className="mt-3 border border-error-border bg-error-surface px-3 py-2 text-xs text-error-foreground">
					成片资源加载失败。
				</div>
			) : null}
			{groups.length > 0 ? (
				<div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
					{groups.map((group) => (
						<button
							key={group.documentId}
							type="button"
							aria-label={`${group.documentTitle} 成片资源`}
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
}> = ({ error, group, isLoading, open, onBatchGenerate, onGenerate, onOpenChange }) => {
	const videoCount = group ? storyboardDocumentGroupVideoCount(group) : 0;
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

	const toggleSelectedReel = useCallback((reel: WorkspaceStoryboardVideoReel) => {
		if (!reel.canGenerate) return;
		setSelectedReelIds((current) =>
			current.includes(reel.id) ? current.filter((id) => id !== reel.id) : [...current, reel.id],
		);
	}, []);

	if (!group) return null;

	return (
		<GenerationModalShell
			open={open}
			title={
				<span className="flex min-w-0 items-center gap-2">
					<Film className="size-4 shrink-0 text-muted-foreground" />
					<span className="truncate">成片资源 · {group.documentTitle}</span>
				</span>
			}
			titleAside={
				<Badge variant="secondary" className="shrink-0">
					分镜组 {group.reels.length} 项 · 成片 {videoCount} 个
				</Badge>
			}
			titleId="storyboard-video-resources-title"
			contentClassName="h-[min(86vh,780px)]"
			onOpenChange={onOpenChange}
		>
			<div className="flex h-full min-h-0 flex-col bg-ide-editor">
				{isLoading ? (
					<div className="grid min-h-56 flex-1 place-items-center">
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							<span>正在加载成片资源</span>
						</div>
					</div>
				) : null}

				{!isLoading && error ? (
					<div className="m-4 border border-error-border bg-error-surface p-4 text-sm text-error-foreground">
						成片资源加载失败。
					</div>
				) : null}

				{!isLoading && !error && group.reels.length === 0 ? (
					<div className="p-4 text-sm text-muted-foreground">当前分镜文档还没有解析出分镜组。</div>
				) : null}

				{!isLoading && !error && group.reels.length > 0 ? (
					<>
						<BatchSelectionToolbar
							allSelected={allSelectableReelsSelected}
							generateLabel="批量生成视频"
							selectedCount={selectedReels.length}
							totalCount={selectableReels.length}
							onClear={clearSelectedReels}
							onGenerate={() => onBatchGenerate(group, selectedReels)}
							onSelectAll={selectAllReels}
						/>
						<div className="min-h-0 flex-1 overflow-y-auto p-4">
							<div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
								{group.reels.map((reel) => (
									<StoryboardReelVideoCard
										key={reel.id}
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
			</div>
		</GenerationModalShell>
	);
};

const StoryboardReelVideoCard: React.FC<{
	reel: WorkspaceStoryboardVideoReel;
	selected: boolean;
	onGenerate: () => void;
	onToggleSelected: () => void;
}> = ({ reel, selected, onGenerate, onToggleSelected }) => {
	const preview = reel.videos[0];
	const videoCount = reel.videos.length;
	const coverSource = preview?.posterUrl ? apiResourceURL(preview.posterUrl) : "";

	return (
		<article
			className={cn(
				"flex h-full min-w-0 flex-col overflow-hidden rounded-sm border bg-card transition-colors",
				selected ? "border-primary" : "border-border",
			)}
		>
			<div className="relative aspect-video bg-ide-toolbar">
				{coverSource ? (
					<img
						src={coverSource}
						alt={preview?.title || reel.title}
						className="size-full object-cover"
						draggable={false}
					/>
				) : (
					<div className="grid size-full place-items-center px-3 text-center text-xs text-muted-foreground">
						<div className="grid gap-2 justify-items-center">
							<Film className="size-5" />
							<span>{preview ? "已有成片" : "暂无成片"}</span>
						</div>
					</div>
				)}
				<ResourceCardSelectionButton
					disabled={!reel.canGenerate}
					label={reel.title}
					selected={selected}
					onToggle={onToggleSelected}
				/>
				{videoCount > 0 ? (
					<div className="absolute right-2 top-2 rounded-sm border border-border bg-card/95 px-2 py-1 text-xs font-medium text-foreground shadow-sm">
						成片 {videoCount} 个
					</div>
				) : null}
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<h3 className="min-w-0 max-w-full truncate text-sm font-semibold text-foreground">
						{reel.title}
					</h3>
					<Badge variant="secondary" className="shrink-0">
						成片 {videoCount} 个
					</Badge>
				</div>
				{preview ? (
					<p className="truncate text-xs text-muted-foreground" title={preview.title}>
						{preview.title}
					</p>
				) : null}
				<div className="mt-auto pt-1">
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="h-8 w-full rounded-sm"
						disabled={!reel.canGenerate}
						onClick={onGenerate}
					>
						<Wand2 className="size-4" />
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
	const rows = data?.rows.slice(0, 4) ?? [];

	return (
		<section className="bg-card">
			<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
				<div className="flex min-w-0 items-center gap-2">
					<ReceiptText className="size-4 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<h2 className="text-sm font-semibold text-foreground">项目消耗</h2>
						<p className="text-xs text-muted-foreground">当前项目累计用量与估算花费。</p>
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
				<div className="mt-3 border border-error-border bg-error-surface px-3 py-2 text-xs text-error-foreground">
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
			{rows.length > 0 ? (
				<div className="mt-3 overflow-hidden rounded-sm border border-border">
					{rows.map((row) => (
						<div
							key={row.key}
							className="grid gap-2 border-t border-border bg-ide-editor px-3 py-2 text-xs first:border-t-0 md:grid-cols-[minmax(0,1fr)_auto_auto]"
						>
							<div className="min-w-0">
								<p className="truncate font-medium text-foreground">{row.label || row.key}</p>
								<p className="truncate text-muted-foreground">{row.key}</p>
							</div>
							<span className="text-muted-foreground">{formatNumber(row.totalTokens)} Token</span>
							<span className="text-foreground">{formatCosts(row.costs, currencies)}</span>
						</div>
					))}
				</div>
			) : null}
		</section>
	);
};

const UsageMetric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
	<div className="border border-border bg-ide-editor px-3 py-2">
		<p className="text-xs text-muted-foreground">{label}</p>
		<p className="mt-1 truncate text-base font-semibold text-foreground">{value}</p>
	</div>
);

interface DocumentResourceSelectedImage {
	src: string;
	title?: string;
}

const storyboardDocumentGroupVideoCount = (group: WorkspaceStoryboardVideoDocumentGroup) =>
	group.reels.reduce((total, reel) => total + reel.videos.length, 0);

const resourceAssetCount = (
	resource: WorkspaceDocumentResource,
	assets: SelectedGenerationAsset[],
) => resourceSelectedImages(resource, assets).length;

const resourceSelectedImages = (
	resource: WorkspaceDocumentResource,
	assets: SelectedGenerationAsset[],
) =>
	uniqueSelectedImages([
		...selectedImagesFromResource(resource),
		...selectedImagesFromAssets(resource, assets),
	]);

const selectedImagesFromResource = (
	resource: WorkspaceDocumentResource,
): DocumentResourceSelectedImage[] =>
	(resource.selectedImages ?? []).flatMap((image) => {
		const src = apiResourceURL(image.src);
		return src
			? [
					{
						src,
						title: image.title?.trim() || resource.title,
					},
				]
			: [];
	});

const selectedImagesFromAssets = (
	resource: WorkspaceDocumentResource,
	assets: SelectedGenerationAsset[],
): DocumentResourceSelectedImage[] =>
	assets.flatMap((asset) => {
		if (
			asset.resourceType !== resource.type ||
			asset.resourceId !== resource.sectionId ||
			(asset.sourceDocumentId && asset.sourceDocumentId !== resource.documentId)
		) {
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

const selectedAssetCountForResourceType = (
	assets: SelectedGenerationAsset[],
	resourceType: AgentResourceType,
) => assets.filter((asset) => asset.resourceType === resourceType).length;

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
