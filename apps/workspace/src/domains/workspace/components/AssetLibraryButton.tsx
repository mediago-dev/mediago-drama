import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
	AudioLines,
	Download,
	File,
	FileText,
	Film,
	Image as ImageIcon,
	Images,
	LibraryBig,
	Loader2,
	MoreHorizontal,
	Search,
	Trash2,
	UploadCloud,
	X,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate as mutateSWR } from "swr";
import {
	getSelectedGenerationAssets,
	selectedGenerationAssetsQueryKey,
	updateGenerationTaskAsset,
	type SelectedGenerationAsset,
} from "@/domains/generation/api/generation";
import { getProjects, projectsKey } from "@/domains/projects/api/projects";
import { generationAssetSource } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { selectedGenerationResourceDescriptorMap } from "@/domains/generation/lib/selected-resources";
import {
	fetchTextAsset,
	projectAssetContentURL,
	truncateTextPreview,
} from "@/domains/documents/components/project-asset-preview.helpers";
import { useDocumentsStore } from "@/domains/documents/stores";
import {
	deleteMediaAsset,
	getMediaAssets,
	mediaAssetsKey,
	updateMediaAsset,
	uploadMediaAsset,
} from "@/domains/workspace/api/media";
import {
	deleteProjectAsset,
	updateProjectAsset,
	uploadProjectAsset,
} from "@/domains/workspace/api/project-assets";
import { getWorkspaceDocuments, workspaceDocumentsKey } from "@/domains/workspace/api/workspace";
import {
	type AssetLibraryItem,
	type AssetLibraryKind,
	type AssetLibraryKindFilter,
	type AssetLibraryResourceFilter,
	type AssetLibrarySort,
	type AssetLibrarySource,
	type AssetLibrarySourceFilter,
	buildAssetLibraryItems,
	filterAssetLibraryItems,
} from "@/domains/workspace/lib/asset-library";
import { getRouteProjectId, type AgentResourceType } from "@/domains/workspace/lib/workbench-route";
import { useToast } from "@/hooks/useToast";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { dialogContentMotion } from "@/shared/components/ui/dialog-motion";
import { Input } from "@/shared/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import { apiResourceURL } from "@/shared/lib/api-base";
import { cn } from "@/shared/lib/utils";

const kindOptions: Array<{ label: string; value: AssetLibraryKindFilter }> = [
	{ label: "全部类型", value: "all" },
	{ label: "图片", value: "image" },
	{ label: "视频", value: "video" },
	{ label: "音频", value: "audio" },
	{ label: "文本", value: "text" },
	{ label: "文件", value: "binary" },
];

const projectSourceOptions: Array<{ label: string; value: AssetLibrarySourceFilter }> = [
	{ label: "全部来源", value: "all" },
	{ label: "项目文件", value: "project" },
	{ label: "媒体素材", value: "media" },
	{ label: "已选资源", value: "selected" },
];

const globalSourceOptions: Array<{ label: string; value: AssetLibrarySourceFilter }> = [
	{ label: "全部来源", value: "all" },
	{ label: "媒体素材", value: "media" },
];

const resourceOptions: Array<{ label: string; value: AssetLibraryResourceFilter }> = [
	{ label: "全部资源标签", value: "all" },
	{ label: "角色", value: "character" },
	{ label: "场景", value: "scene" },
	{ label: "分镜", value: "storyboard" },
	{ label: "道具", value: "prop" },
];

const sortOptions: Array<{ label: string; value: AssetLibrarySort }> = [
	{ label: "最近更新", value: "updatedDesc" },
	{ label: "最近创建", value: "createdDesc" },
	{ label: "名称 A-Z", value: "nameAsc" },
	{ label: "文件大小", value: "sizeDesc" },
];

const globalProjectValue = "__global__";

export const AssetLibraryButton: React.FC = () => {
	const [open, setOpen] = useState(false);
	const projectId = getRouteProjectId(browserLocationSearch());

	return (
		<div className="relative shrink-0">
			<TooltipProvider delayDuration={180}>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label={open ? "关闭素材库" : "打开素材库"}
							aria-expanded={open}
							className={cn(
								"flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
								open && "bg-ide-list-active text-ide-list-active-foreground",
							)}
							onClick={() => setOpen((current) => !current)}
						>
							<LibraryBig className="size-4" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="top">素材库</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<AssetLibraryDialog open={open} projectId={projectId} onOpenChange={setOpen} />
		</div>
	);
};

const browserLocationSearch = () => (typeof window === "undefined" ? "" : window.location.search);

const AssetLibraryDialog: React.FC<{
	onOpenChange: (open: boolean) => void;
	open: boolean;
	projectId: string | null;
}> = ({ onOpenChange, open, projectId }) => {
	const toast = useToast();
	const projectUploadRef = useRef<HTMLInputElement | null>(null);
	const mediaUploadRef = useRef<HTMLInputElement | null>(null);
	const [activeKey, setActiveKey] = useState("");
	const [busyKey, setBusyKey] = useState("");
	const [kindFilter, setKindFilter] = useState<AssetLibraryKindFilter>("all");
	const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
	const [query, setQuery] = useState("");
	const [resourceFilter, setResourceFilter] = useState<AssetLibraryResourceFilter>("all");
	const [sort, setSort] = useState<AssetLibrarySort>("updatedDesc");
	const [sourceFilter, setSourceFilter] = useState<AssetLibrarySourceFilter>("all");
	const [uploadOpen, setUploadOpen] = useState(false);
	const [uploading, setUploading] = useState<"media" | "project" | null>(null);
	const projectMode = Boolean(selectedProjectId);
	const mediaProjectId = selectedProjectId;
	const { data: projectsData, isLoading: isProjectsLoading } = useSWR(
		open ? projectsKey : null,
		() => getProjects(),
	);
	const mediaQueryKey = open ? [mediaAssetsKey, mediaProjectId] : null;
	const workspaceQueryKey =
		open && selectedProjectId ? workspaceDocumentsKey(selectedProjectId) : null;
	const selectedQueryKey =
		open && selectedProjectId ? selectedGenerationAssetsQueryKey(selectedProjectId) : null;
	const {
		data: mediaData,
		error: mediaError,
		isLoading: isMediaLoading,
		mutate: mutateMediaAssets,
	} = useSWR(mediaQueryKey, () => getMediaAssets({ projectId: selectedProjectId || undefined }));
	const {
		data: workspaceData,
		error: workspaceError,
		isLoading: isWorkspaceLoading,
		mutate: mutateWorkspace,
	} = useSWR(workspaceQueryKey, () => getWorkspaceDocuments(selectedProjectId));
	const {
		data: selectedData,
		error: selectedError,
		isLoading: isSelectedLoading,
		mutate: mutateSelectedAssets,
	} = useSWR(selectedQueryKey, () => getSelectedGenerationAssets(selectedProjectId));
	const projects = useMemo(() => projectsData?.projects ?? [], [projectsData?.projects]);
	const selectedProject = useMemo(
		() => projects.find((project) => project.id === selectedProjectId) ?? null,
		[projects, selectedProjectId],
	);
	const projectOptions = useMemo(
		() => [
			{ label: "全局素材", value: globalProjectValue },
			...projects.map((project) => ({
				label: project.name || project.id,
				value: project.id,
			})),
		],
		[projects],
	);
	const items = useMemo(
		() =>
			buildAssetLibraryItems({
				mediaAssets: mediaData?.assets ?? [],
				projectAssets: projectMode ? (workspaceData?.assets ?? []) : [],
				selectedAssets: projectMode ? (selectedData?.assets ?? []) : [],
			}),
		[mediaData?.assets, projectMode, selectedData?.assets, workspaceData?.assets],
	);
	const filteredItems = useMemo(
		() =>
			filterAssetLibraryItems(items, {
				kind: kindFilter,
				query,
				resourceType: projectMode ? resourceFilter : "all",
				sort,
				source: projectMode ? sourceFilter : sourceFilter === "project" ? "all" : sourceFilter,
			}),
		[items, kindFilter, projectMode, query, resourceFilter, sort, sourceFilter],
	);
	const activeItem = useMemo(
		() => filteredItems.find((item) => item.key === activeKey) ?? filteredItems[0] ?? null,
		[activeKey, filteredItems],
	);
	const isLoading = isMediaLoading || (projectMode && (isWorkspaceLoading || isSelectedLoading));
	const error = mediaError ?? workspaceError ?? selectedError;

	useEffect(() => {
		if (!open) return;
		setSelectedProjectId(projectId ?? "");
	}, [open, projectId]);

	useEffect(() => {
		if (!open) return;
		setSourceFilter("all");
		setResourceFilter("all");
		setActiveKey("");
	}, [open, selectedProjectId]);

	useEffect(() => {
		if (!activeItem) {
			setActiveKey("");
			return;
		}
		if (activeItem.key !== activeKey) setActiveKey(activeItem.key);
	}, [activeItem, activeKey]);

	const refreshWorkspace = async () => {
		if (!selectedProjectId) return null;
		const state = await getWorkspaceDocuments(selectedProjectId);
		useDocumentsStore.getState().hydrateWorkspaceDocuments(state);
		await mutateWorkspace(state, false);
		await mutateSWR(workspaceDocumentsKey(selectedProjectId), state, false);
		return state;
	};

	const uploadProjectFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.currentTarget.files?.[0] ?? null;
		event.currentTarget.value = "";
		if (!file || !selectedProjectId || uploading) return;

		setUploading("project");
		try {
			const asset = await uploadProjectAsset(selectedProjectId, file);
			await refreshWorkspace();
			setActiveKey(`project:${asset.id}`);
			toast.success("项目文件已上传", { description: asset.filename || file.name });
		} catch (err) {
			toast.error("上传失败", { description: errorMessage(err, "项目文件上传失败。") });
		} finally {
			setUploading(null);
		}
	};

	const uploadMediaFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.currentTarget.files?.[0] ?? null;
		event.currentTarget.value = "";
		if (!file || uploading) return;

		setUploading("media");
		try {
			const asset = await uploadMediaAsset(file, selectedProjectId || null);
			await mutateMediaAssets();
			setActiveKey(`media:${asset.id}`);
			toast.success(projectMode ? "媒体素材已上传" : "素材已上传", {
				description: asset.filename || file.name,
			});
		} catch (err) {
			toast.error("上传失败", { description: errorMessage(err, "媒体素材上传失败。") });
		} finally {
			setUploading(null);
		}
	};

	const renameItem = async (item: AssetLibraryItem) => {
		const filename = window.prompt("重命名素材", item.title)?.trim();
		if (!filename || filename === item.title || busyKey) return;

		setBusyKey(item.key);
		try {
			if (item.sourceType === "media" && item.mediaAsset) {
				await updateMediaAsset(item.mediaAsset.id, filename, selectedProjectId || null);
				await mutateMediaAssets();
			} else if (item.sourceType === "project" && item.projectAsset && selectedProjectId) {
				await updateProjectAsset(selectedProjectId, item.projectAsset.id, { filename });
				await refreshWorkspace();
			}
			toast.success("素材已重命名", { description: filename });
		} catch (err) {
			toast.error("重命名失败", { description: errorMessage(err, "素材重命名失败。") });
		} finally {
			setBusyKey("");
		}
	};

	const deleteItem = async (item: AssetLibraryItem) => {
		if (busyKey) return;
		const confirmed = await confirmDialog({
			confirmIcon: <Trash2 className="size-4" />,
			confirmLabel: item.sourceType === "selected" ? "取消选入" : "删除",
			description:
				item.sourceType === "selected"
					? "会从已选生成资源中移除，不会删除原始生成记录。"
					: `将删除“${item.title}”，此操作不可撤销。`,
			title: item.sourceType === "selected" ? "取消选入该资源？" : "删除该素材？",
			variant: "destructive",
		});
		if (!confirmed) return;

		setBusyKey(item.key);
		try {
			if (item.sourceType === "media" && item.mediaAsset) {
				const nextAssets = await deleteMediaAsset(
					item.mediaAsset.id,
					selectedProjectId || undefined,
				);
				await mutateMediaAssets(nextAssets, false);
			} else if (item.sourceType === "project" && item.projectAsset && selectedProjectId) {
				await deleteProjectAsset(selectedProjectId, item.projectAsset.id);
				await refreshWorkspace();
			} else {
				await unselectGenerationAssets(item.selectedAssets);
			}
			toast.success(item.sourceType === "selected" ? "已取消选入" : "素材已删除", {
				description: item.title,
			});
		} catch (err) {
			toast.error(item.sourceType === "selected" ? "取消选入失败" : "删除失败", {
				description: errorMessage(err, "素材操作失败。"),
			});
		} finally {
			setBusyKey("");
		}
	};

	const cancelSelectedAssets = async (item: AssetLibraryItem) => {
		if (busyKey || item.selectedAssets.length === 0) return;
		setBusyKey(item.key);
		try {
			await unselectGenerationAssets(item.selectedAssets);
			toast.success("已取消选入", { description: item.title });
		} catch (err) {
			toast.error("取消选入失败", { description: errorMessage(err, "已选资源更新失败。") });
		} finally {
			setBusyKey("");
		}
	};

	const unselectGenerationAssets = async (assets: SelectedGenerationAsset[]) => {
		await Promise.all(
			assets.map((asset) =>
				updateGenerationTaskAsset(asset.taskId, asset.assetIndex, { selected: false }),
			),
		);
		await mutateSelectedAssets();
	};

	return (
		<>
			<input
				ref={projectUploadRef}
				type="file"
				className="sr-only"
				disabled={!selectedProjectId || Boolean(uploading)}
				onChange={(event) => void uploadProjectFile(event)}
			/>
			<input
				ref={mediaUploadRef}
				type="file"
				accept="image/*,video/*,audio/*"
				className="sr-only"
				disabled={Boolean(uploading)}
				onChange={(event) => void uploadMediaFile(event)}
			/>
			<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 p-4 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200" />
					<DialogPrimitive.Content
						aria-describedby="asset-library-description"
						className={cn(
							"fixed left-1/2 top-1/2 z-50 flex h-[min(46rem,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-7xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl outline-none",
							dialogContentMotion,
						)}
					>
						<header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
							<div className="min-w-0">
								<DialogPrimitive.Title className="truncate text-sm font-semibold text-foreground">
									{projectMode ? "项目素材库" : "全局素材库"}
								</DialogPrimitive.Title>
								<DialogPrimitive.Description
									id="asset-library-description"
									className="mt-1 truncate text-xs text-muted-foreground"
								>
									{projectMode
										? `管理${selectedProject?.name || "当前项目"}的文件、生成媒体和已选生成资源。`
										: "管理可在工具箱中复用的全局媒体素材。"}
								</DialogPrimitive.Description>
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<Badge variant="secondary" className="hidden sm:inline-flex">
									{filteredItems.length} / {items.length}
								</Badge>
								<DialogPrimitive.Close asChild>
									<Button type="button" variant="ghost" size="icon" aria-label="关闭素材库">
										<X className="size-4" />
									</Button>
								</DialogPrimitive.Close>
							</div>
						</header>

						<div className="grid shrink-0 gap-2 border-b border-border bg-card px-4 py-3 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,14rem)_auto_auto_auto_auto]">
							<div className="relative min-w-0">
								<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
								<Input
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder="搜索素材"
									className="h-8 rounded-md pl-8 text-xs text-foreground"
								/>
							</div>
							<AssetLibrarySelect
								label="项目"
								value={selectedProjectId || globalProjectValue}
								options={projectOptions}
								loading={isProjectsLoading}
								onValueChange={(value) =>
									setSelectedProjectId(value === globalProjectValue ? "" : value)
								}
							/>
							<AssetLibrarySelect
								label="类型"
								value={kindFilter}
								options={kindOptions}
								onValueChange={(value) => setKindFilter(value as AssetLibraryKindFilter)}
							/>
							<AssetLibrarySelect
								label="来源"
								value={sourceFilter}
								options={projectMode ? projectSourceOptions : globalSourceOptions}
								onValueChange={(value) => setSourceFilter(value as AssetLibrarySourceFilter)}
							/>
							{projectMode ? (
								<AssetLibrarySelect
									label="资源标签"
									value={resourceFilter}
									options={resourceOptions}
									onValueChange={(value) => setResourceFilter(value as AssetLibraryResourceFilter)}
								/>
							) : null}
							<div className="flex items-center gap-2">
								<AssetLibrarySelect
									label="排序"
									value={sort}
									options={sortOptions}
									onValueChange={(value) => setSort(value as AssetLibrarySort)}
								/>
								<Popover open={uploadOpen} onOpenChange={setUploadOpen}>
									<PopoverTrigger asChild>
										<Button
											type="button"
											size="sm"
											className="h-8 shrink-0 rounded-md px-2.5 text-xs"
											disabled={Boolean(uploading)}
										>
											{uploading ? (
												<Loader2 className="size-3.5 animate-spin" />
											) : (
												<UploadCloud className="size-3.5" />
											)}
											<span>上传</span>
										</Button>
									</PopoverTrigger>
									<PopoverContent align="end" className="w-48 p-1.5">
										{projectMode ? (
											<UploadMenuButton
												disabled={Boolean(uploading)}
												label="上传项目文件"
												onClick={() => {
													setUploadOpen(false);
													projectUploadRef.current?.click();
												}}
											/>
										) : null}
										<UploadMenuButton
											disabled={Boolean(uploading)}
											label={projectMode ? "上传媒体素材" : "上传素材"}
											onClick={() => {
												setUploadOpen(false);
												mediaUploadRef.current?.click();
											}}
										/>
									</PopoverContent>
								</Popover>
							</div>
						</div>

						{error ? (
							<div className="shrink-0 border-b border-error-border bg-error-surface px-4 py-2 text-xs text-error-foreground">
								素材库加载失败：{errorMessage(error, "请稍后重试。")}
							</div>
						) : null}

						<div className="grid min-h-0 flex-1 bg-ide-editor lg:grid-cols-[minmax(0,1fr)_22rem]">
							<div className="min-h-0 overflow-y-auto p-4">
								{isLoading ? (
									<div className="grid min-h-56 place-items-center border border-border bg-card">
										<div className="flex items-center gap-2 text-sm text-muted-foreground">
											<Loader2 className="size-4 animate-spin" />
											<span>正在加载素材</span>
										</div>
									</div>
								) : filteredItems.length === 0 ? (
									<AssetLibraryEmpty projectMode={projectMode} />
								) : (
									<section className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-3">
										{filteredItems.map((item) => (
											<AssetLibraryCard
												key={item.key}
												active={item.key === activeItem?.key}
												busy={busyKey === item.key}
												item={item}
												projectId={selectedProjectId}
												onCancelSelected={() => void cancelSelectedAssets(item)}
												onDelete={() => void deleteItem(item)}
												onPreview={() => setActiveKey(item.key)}
												onRename={() => void renameItem(item)}
											/>
										))}
									</section>
								)}
							</div>
							<AssetLibraryPreview item={activeItem} projectId={selectedProjectId} />
						</div>
					</DialogPrimitive.Content>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>
		</>
	);
};

const AssetLibraryCard: React.FC<{
	active: boolean;
	busy: boolean;
	item: AssetLibraryItem;
	onCancelSelected: () => void;
	onDelete: () => void;
	onPreview: () => void;
	onRename: () => void;
	projectId: string | null;
}> = ({ active, busy, item, onCancelSelected, onDelete, onPreview, onRename, projectId }) => {
	const source = assetLibraryItemSource(item, projectId);
	const Icon = iconForKind(item.kind);
	const canRename = item.sourceType === "media" || item.sourceType === "project";
	const canCancelSelected = item.selectedAssets.length > 0;

	return (
		<article
			className={cn(
				"min-w-0 overflow-hidden rounded-sm border bg-card transition-colors",
				active ? "border-primary ring-1 ring-primary" : "border-border hover:border-input",
			)}
		>
			<button
				type="button"
				className="block w-full min-w-0 text-left"
				onClick={onPreview}
				aria-label={`预览 ${item.title}`}
			>
				<div className="relative aspect-[4/3] bg-ide-toolbar">
					{item.kind === "image" && source ? (
						<img src={source} alt="" className="size-full object-contain" />
					) : (
						<div className="grid size-full place-items-center">
							<Icon className="size-8 text-muted-foreground" />
						</div>
					)}
					<SourceBadge source={item.sourceType} />
				</div>
				<div className="grid gap-1 px-3 py-2">
					<p className="truncate text-xs font-semibold text-foreground" title={item.title}>
						{item.title}
					</p>
					<p className="truncate text-2xs text-muted-foreground">
						{kindLabel(item.kind)} · {formatBytes(item.sizeBytes)}
					</p>
					{item.mediaAsset?.relativePath ? (
						<p
							className="truncate text-2xs text-muted-foreground"
							title={item.mediaAsset.relativePath}
						>
							{item.mediaAsset.relativePath}
						</p>
					) : null}
					{item.selectedResourceTypes.length > 0 ? (
						<div className="flex flex-wrap gap-1">
							{item.selectedResourceTypes.map((type) => (
								<Badge key={type} variant="outline" className="px-1 py-0 text-2xs">
									{resourceTypeLabel(type)}
								</Badge>
							))}
						</div>
					) : null}
				</div>
			</button>
			<div className="flex items-center justify-between gap-1 border-t border-border px-2 py-1.5">
				<Button asChild type="button" size="sm" variant="ghost" className="h-7 px-2">
					<a href={source || item.url} download={item.title} aria-label={`下载 ${item.title}`}>
						<Download className="size-3.5" />
					</a>
				</Button>
				<div className="flex items-center gap-1">
					{canCancelSelected ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="h-7 px-2 text-2xs"
							disabled={busy}
							onClick={onCancelSelected}
						>
							取消选入
						</Button>
					) : null}
					{canRename ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="h-7 px-2"
							disabled={busy}
							onClick={onRename}
							aria-label={`重命名 ${item.title}`}
						>
							<MoreHorizontal className="size-3.5" />
						</Button>
					) : null}
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-7 px-2 text-muted-foreground hover:text-error-foreground"
						disabled={busy}
						onClick={onDelete}
						aria-label={
							item.sourceType === "selected" ? `取消选入 ${item.title}` : `删除 ${item.title}`
						}
					>
						{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
					</Button>
				</div>
			</div>
		</article>
	);
};

const AssetLibraryPreview: React.FC<{
	item: AssetLibraryItem | null;
	projectId: string | null;
}> = ({ item, projectId }) => {
	const source = item ? assetLibraryItemSource(item, projectId) : "";
	const textKey = item?.kind === "text" && source ? source : null;
	const {
		data: text,
		error,
		isLoading,
	} = useSWR(textKey, fetchTextAsset, { revalidateOnFocus: false });

	if (!item) {
		return (
			<aside className="hidden min-h-0 border-l border-border bg-card p-4 lg:grid lg:place-items-center">
				<div className="grid justify-items-center gap-2 text-center">
					<Images className="size-6 text-muted-foreground" />
					<p className="text-sm text-foreground">选择素材查看预览</p>
				</div>
			</aside>
		);
	}

	return (
		<aside className="min-h-0 overflow-y-auto border-t border-border bg-card p-4 lg:border-l lg:border-t-0">
			<div className="grid gap-3">
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold text-foreground" title={item.title}>
						{item.title}
					</p>
					<p className="mt-1 truncate text-xs text-muted-foreground">
						{kindLabel(item.kind)} · {sourceTypeLabel(item.sourceType)} ·{" "}
						{formatBytes(item.sizeBytes)}
					</p>
				</div>
				<div className="overflow-hidden rounded-sm border border-border bg-ide-editor">
					<AssetPreviewMedia
						error={error}
						isTextLoading={isLoading}
						item={item}
						source={source}
						text={text}
					/>
				</div>
				<div className="grid gap-1 text-xs text-muted-foreground">
					<p>更新：{formatDateTime(item.updatedAt)}</p>
					<p>创建：{formatDateTime(item.createdAt)}</p>
					{item.mimeType ? <p className="break-all">MIME：{item.mimeType}</p> : null}
					{item.mediaAsset?.source ? (
						<p>来源：{mediaAssetSourceLabel(item.mediaAsset.source)}</p>
					) : null}
					{item.mediaAsset?.relativePath ? (
						<p className="break-all">路径：{item.mediaAsset.relativePath}</p>
					) : null}
				</div>
				{item.selectedResourceTypes.length > 0 ? (
					<div className="flex flex-wrap gap-1.5">
						{item.selectedResourceTypes.map((type) => (
							<Badge key={type} variant="secondary">
								{resourceTypeLabel(type)}
							</Badge>
						))}
					</div>
				) : null}
			</div>
		</aside>
	);
};

const AssetPreviewMedia: React.FC<{
	error: unknown;
	isTextLoading: boolean;
	item: AssetLibraryItem;
	source: string;
	text?: string;
}> = ({ error, isTextLoading, item, source, text }) => {
	if (item.kind === "image" && source) {
		return <img src={source} alt={item.title} className="max-h-[24rem] w-full object-contain" />;
	}
	if (item.kind === "video" && source) {
		return <video src={source} controls className="aspect-video w-full bg-background" />;
	}
	if (item.kind === "audio" && source) {
		return (
			<div className="grid min-h-40 place-items-center p-4">
				<AudioLines className="mb-3 size-8 text-muted-foreground" />
				<audio src={source} controls className="w-full" />
			</div>
		);
	}
	if (item.kind === "text") {
		if (isTextLoading) {
			return (
				<div className="grid min-h-64 place-items-center text-sm text-muted-foreground">
					<Loader2 className="mb-2 size-4 animate-spin" />
					<span>正在读取文本</span>
				</div>
			);
		}
		if (error) {
			return (
				<div className="p-4 text-sm text-error-foreground">
					{errorMessage(error, "文本读取失败。")}
				</div>
			);
		}
		return (
			<pre className="max-h-[24rem] overflow-auto p-4 text-xs leading-5 text-foreground">
				{truncateTextPreview(text ?? "")}
			</pre>
		);
	}

	const Icon = iconForKind(item.kind);
	return (
		<div className="grid min-h-64 place-items-center p-6 text-center">
			<div className="grid justify-items-center gap-2">
				<Icon className="size-8 text-muted-foreground" />
				<p className="text-sm font-medium text-foreground">无法内联预览此文件</p>
				<p className="text-xs text-muted-foreground">可下载后用本地应用打开。</p>
			</div>
		</div>
	);
};

const AssetLibrarySelect: React.FC<{
	label: string;
	loading?: boolean;
	onValueChange: (value: string) => void;
	options: Array<{ label: string; value: string }>;
	value: string;
}> = ({ label, loading, onValueChange, options, value }) => (
	<Select value={value} onValueChange={onValueChange}>
		<SelectTrigger className="h-8 min-w-32 rounded-md text-xs text-foreground" aria-label={label}>
			<SelectValue placeholder={loading ? "加载中..." : undefined} />
		</SelectTrigger>
		<SelectContent align="start">
			{options.map((option) => (
				<SelectItem key={option.value} value={option.value}>
					{option.label}
				</SelectItem>
			))}
		</SelectContent>
	</Select>
);

const UploadMenuButton: React.FC<{
	disabled?: boolean;
	label: string;
	onClick: () => void;
}> = ({ disabled, label, onClick }) => (
	<button
		type="button"
		className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-xs text-popover-foreground hover:bg-ide-list-hover disabled:pointer-events-none disabled:opacity-50"
		disabled={disabled}
		onClick={onClick}
	>
		<UploadCloud className="size-3.5 text-muted-foreground" />
		<span className="min-w-0 flex-1 truncate">{label}</span>
	</button>
);

const AssetLibraryEmpty: React.FC<{ projectMode: boolean }> = ({ projectMode }) => (
	<div className="grid min-h-56 place-items-center border border-dashed border-border bg-card p-6 text-center">
		<div className="grid justify-items-center gap-2">
			<Images className="size-6 text-muted-foreground" />
			<p className="text-sm font-medium text-foreground">暂无匹配素材</p>
			<p className="max-w-sm text-xs leading-5 text-muted-foreground">
				{projectMode
					? "可上传项目文件、上传媒体素材，或从生成结果中选入资源。"
					: "可上传图片、视频或音频素材，供工具箱生成时复用。"}
			</p>
		</div>
	</div>
);

const SourceBadge: React.FC<{ source: AssetLibrarySource }> = ({ source }) => (
	<span className="absolute left-2 top-2 rounded-sm border border-border bg-card/90 px-1.5 py-0.5 text-2xs font-medium text-foreground shadow-sm">
		{sourceTypeLabel(source)}
	</span>
);

const assetLibraryItemSource = (item: AssetLibraryItem, projectId: string | null) => {
	if (item.sourceType === "project" && item.projectAsset) {
		return projectAssetContentURL(item.projectAsset, projectId);
	}
	if (item.sourceType === "media" && item.mediaAsset) {
		return apiResourceURL(item.mediaAsset.url);
	}
	if (item.sourceType === "selected") {
		const asset = item.selectedAssets[0];
		if (asset) return generationAssetSource(asset);
	}
	return apiResourceURL(item.url);
};

const iconForKind = (kind: AssetLibraryKind) => {
	if (kind === "image") return ImageIcon;
	if (kind === "video") return Film;
	if (kind === "audio") return AudioLines;
	if (kind === "text") return FileText;
	return File;
};

const resourceTypeLabel = (type: AgentResourceType) =>
	selectedGenerationResourceDescriptorMap[type]?.label ?? type;

const kindLabel = (kind: AssetLibraryKind) => {
	if (kind === "image") return "图片";
	if (kind === "video") return "视频";
	if (kind === "audio") return "音频";
	if (kind === "text") return "文本";
	return "文件";
};

const sourceTypeLabel = (source: AssetLibrarySource) => {
	if (source === "project") return "项目文件";
	if (source === "selected") return "已选资源";
	return "媒体素材";
};

const mediaAssetSourceLabel = (source: string) => {
	if (source === "upload") return "上传";
	if (source === "toolbox") return "工具箱生成";
	if (source === "generation") return "项目生成";
	if (source === "preview") return "预览";
	return source;
};

const formatBytes = (bytes: number) => {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let index = 0;
	while (value >= 1024 && index < units.length - 1) {
		value /= 1024;
		index += 1;
	}
	const precision = index === 0 ? 0 : value >= 10 ? 1 : 2;
	return `${value.toFixed(precision)} ${units[index]}`;
};

const formatDateTime = (value: string) => {
	if (!value) return "未知";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
};

const errorMessage = (error: unknown, fallback: string) => {
	if (error instanceof Error && error.message.trim()) return error.message;
	if (error && typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return fallback;
};
