import { FileText, Loader2, Palette, ReceiptText, Wand2 } from "lucide-react";
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
	workspaceDocumentResourcesKey,
	workspaceDocumentsKey,
	type WorkspaceDocumentResource,
} from "@/domains/workspace/api/workspace";
import { ProjectWorkspaceShell } from "@/domains/workspace/components/ProjectWorkspaceShell";
import { getRouteProjectId, type AgentResourceType } from "@/domains/workspace/lib/workbench-route";
import { useProjectStore } from "@/domains/projects/stores";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ImageGenerationDialog } from "@/shared/components/generation-dialogs/ImageGenerationDialog";
import { apiResourceURL } from "@/shared/lib/api-base";

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
	const storeDocuments = useDocumentsStore((state) => state.documents);
	const documentsProjectId = useDocumentsStore((state) => state.projectId);
	const hydrateWorkspaceDocuments = useDocumentsStore((state) => state.hydrateWorkspaceDocuments);
	const toggleStoredSectionImage = useDocumentsStore((state) => state.toggleSectionImage);
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
	}, [projectId]);

	const documents = useMemo(
		() =>
			documentsProjectId === projectId ? storeDocuments : (workspaceDocuments?.documents ?? []),
		[documentsProjectId, projectId, storeDocuments, workspaceDocuments?.documents],
	);
	const documentResources = workspaceDocumentResources?.resources ?? [];

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
		setImageGenerationSection(documentResourceToSectionContext(resource));
	}, []);
	const closeImageGeneration = useCallback((open: boolean) => {
		if (!open) setImageGenerationSection(null);
	}, []);
	const selectedImageAssetKeys = useCallback(
		(section: MarkdownSectionContext) => sectionAssetKeysFromDocuments(documents, section, "image"),
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
								<DocumentResourcesDialog
									assets={selectedResources?.assets ?? []}
									error={documentResourcesError}
									isLoading={isDocumentResourcesLoading}
									open={Boolean(documentResourceDialogType)}
									resourceType={documentResourceDialogType}
									resources={documentResources}
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
	onGenerate: (resource: WorkspaceDocumentResource) => void;
	onOpenChange: (open: boolean) => void;
}> = ({ assets, error, isLoading, open, resourceType, resources, onGenerate, onOpenChange }) => {
	const descriptor = resourceType ? selectedGenerationResourceDescriptorMap[resourceType] : null;
	const filteredResources = useMemo(
		() => (resourceType ? resources.filter((resource) => resource.type === resourceType) : []),
		[resources, resourceType],
	);

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
					<div className="min-h-0 flex-1 overflow-y-auto p-4">
						<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
							{filteredResources.map((resource) => (
								<DocumentResourceCard
									key={resource.id}
									selectedImages={resourceSelectedImages(resource, assets)}
									resource={resource}
									onGenerate={onGenerate}
								/>
							))}
						</div>
					</div>
				) : null}
			</div>
		</GenerationModalShell>
	);
};

const DocumentResourceCard: React.FC<{
	resource: WorkspaceDocumentResource;
	selectedImages: DocumentResourceSelectedImage[];
	onGenerate: (resource: WorkspaceDocumentResource) => void;
}> = ({ resource, selectedImages, onGenerate }) => {
	const preview = selectedImages[0];
	const assetCount = selectedImages.length;

	return (
		<article className="flex min-w-0 flex-col overflow-hidden rounded-sm border border-border bg-card">
			<div className="relative aspect-[4/3] bg-ide-toolbar">
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
				{assetCount > 0 ? (
					<div className="absolute left-2 top-2 rounded-sm border border-border bg-card/95 px-2 py-1 text-xs font-medium text-foreground shadow-sm">
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
					<h3 className="truncate text-sm font-semibold text-foreground">{resource.title}</h3>
					<Badge variant="outline" className="max-w-full truncate font-mono text-[11px]">
						{resource.sectionId}
					</Badge>
				</div>
				<p className="mt-1 truncate text-xs text-muted-foreground">
					来源：{resource.documentTitle || resource.documentId}
				</p>
				{resource.summary ? (
					<p className="mt-2 max-h-10 overflow-hidden text-xs leading-5 text-muted-foreground">
						{resource.summary}
					</p>
				) : null}
				<div className="mt-2 flex flex-wrap items-center gap-1.5">
					<Badge variant="secondary">已选择 {assetCount} 张</Badge>
					<Badge variant="secondary">H{resource.headingLevel}</Badge>
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
