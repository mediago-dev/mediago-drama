import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
	AudioLines,
	Download,
	File,
	FileText,
	Film,
	FolderOpen,
	Image as ImageIcon,
	Images,
	LibraryBig,
	Loader2,
	Search,
	Trash2,
	UploadCloud,
	X,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { AudioPlayer } from "@/components/AudioPlayer";
import { VideoPlayer } from "@/components/VideoPlayer";
import {
	deleteSelectedGenerationAsset,
	getSelectedGenerationAssets,
	selectedGenerationAssetsQueryKey,
	type SelectedGenerationAsset,
} from "@/domains/generation/api/generation";
import { getProjects, projectsKey } from "@/domains/projects/api/projects";
import { generationAssetSource } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { selectedGenerationResourceDescriptorMap } from "@/domains/generation/lib/selected-resources";
import {
	fetchTextAsset,
	truncateTextPreview,
} from "@/domains/documents/components/project-asset-preview.helpers";
import {
	deleteMediaAsset,
	getMediaAssets,
	mediaAssetsKey,
	uploadMediaAsset,
} from "@/domains/workspace/api/media";
import {
	type AssetLibraryItem,
	type AssetLibraryKind,
	type AssetLibraryKindFilter,
	type AssetLibraryResourceFilter,
	type AssetLibraryResourceType,
	type AssetLibrarySource,
	type AssetLibrarySourceFilter,
	buildAssetLibraryItems,
	filterAssetLibraryItems,
} from "@/domains/workspace/lib/asset-library";
import { downloadLocalFileWithDirectoryPicker } from "@/domains/workspace/lib/downloads";
import { revealNativePath } from "@/shared/desktop/actions";
import { isElectronRuntime } from "@/shared/desktop/runtime";
import { getWorkspaceDocuments, workspaceDocumentsKey } from "@/domains/workspace/api/workspace";
import { getRouteProjectId } from "@/domains/workspace/lib/workbench-route";
import { useToast } from "@/hooks/useToast";
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
	{ label: "全部", value: "all" },
	{ label: "图片", value: "image" },
	{ label: "视频", value: "video" },
	{ label: "音频", value: "audio" },
	{ label: "文本", value: "text" },
	{ label: "文件", value: "binary" },
];

const projectSourceOptions: Array<{ label: string; value: AssetLibrarySourceFilter }> = [
	{ label: "全部", value: "all" },
	{ label: "媒体素材", value: "media" },
	{ label: "已选资源", value: "selected" },
];

const resourceOptions: Array<{ label: string; value: AssetLibraryResourceFilter }> = [
	{ label: "全部", value: "all" },
	{ label: "剧本", value: "screenplay" },
	{ label: "角色", value: "character" },
	{ label: "场景", value: "scene" },
	{ label: "分镜", value: "storyboard" },
	{ label: "道具", value: "prop" },
	{ label: "资料", value: "reference" },
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
	const mediaUploadRef = useRef<HTMLInputElement | null>(null);
	const gridRef = useRef<HTMLElement | null>(null);
	const [activeKey, setActiveKey] = useState("");
	const [busyKey, setBusyKey] = useState("");
	const [kindFilter, setKindFilter] = useState<AssetLibraryKindFilter>("all");
	const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
	const [query, setQuery] = useState("");
	const [resourceFilter, setResourceFilter] = useState<AssetLibraryResourceFilter>("all");
	const [sourceFilter, setSourceFilter] = useState<AssetLibrarySourceFilter>("all");
	const [uploadOpen, setUploadOpen] = useState(false);
	const [uploading, setUploading] = useState<"media" | null>(null);
	const projectMode = Boolean(selectedProjectId);
	const mediaProjectId = selectedProjectId;
	const { data: projectsData, isLoading: isProjectsLoading } = useSWR(
		open ? projectsKey : null,
		() => getProjects(),
	);
	const mediaQueryKey = open ? [mediaAssetsKey, mediaProjectId] : null;
	const documentsQueryKey =
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
		data: selectedData,
		error: selectedError,
		isLoading: isSelectedLoading,
		mutate: mutateSelectedAssets,
	} = useSWR(selectedQueryKey, () => getSelectedGenerationAssets(selectedProjectId));
	const {
		data: documentsData,
		error: documentsError,
		isLoading: isDocumentsLoading,
	} = useSWR(documentsQueryKey, () => getWorkspaceDocuments(selectedProjectId));
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
				documents: projectMode ? (documentsData?.documents ?? []) : [],
				mediaAssets: mediaData?.assets ?? [],
				selectedAssets: projectMode ? (selectedData?.assets ?? []) : [],
			}),
		[documentsData?.documents, mediaData?.assets, projectMode, selectedData?.assets],
	);
	const filteredItems = useMemo(
		() =>
			filterAssetLibraryItems(items, {
				kind: kindFilter,
				query,
				resourceType: projectMode ? resourceFilter : "all",
				source: projectMode ? sourceFilter : "all",
			}),
		[items, kindFilter, projectMode, query, resourceFilter, sourceFilter],
	);
	const activeItem = useMemo(
		() => filteredItems.find((item) => item.key === activeKey) ?? filteredItems[0] ?? null,
		[activeKey, filteredItems],
	);
	const isLoading = isMediaLoading || (projectMode && (isSelectedLoading || isDocumentsLoading));
	const error = mediaError ?? selectedError ?? documentsError;

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

	const downloadItem = async (item: AssetLibraryItem) => {
		if (busyKey) return;
		setBusyKey(item.key);
		try {
			const saved = await downloadLocalFileWithDirectoryPicker({
				fallback: item.title,
				kind: item.kind,
				mimeType: item.mimeType,
				sourcePath: item.downloadPath,
				title: item.title,
			});
			if (!saved) return;
			toast.success("文件已下载", { description: saved.path });
		} catch (err) {
			toast.error("下载失败", {
				description: errorMessage(err, "文件复制到下载位置失败。"),
			});
		} finally {
			setBusyKey("");
		}
	};

	const unselectGenerationAssets = async (assets: SelectedGenerationAsset[]) => {
		if (!selectedProjectId) return;
		await Promise.all(
			assets.map((asset) => deleteSelectedGenerationAsset(selectedProjectId, asset.id)),
		);
		await mutateSelectedAssets();
	};

	const moveActiveItem = (offset: number) => {
		if (filteredItems.length === 0) return;
		const currentIndex = activeItem
			? filteredItems.findIndex((entry) => entry.key === activeItem.key)
			: -1;
		const nextIndex =
			currentIndex < 0 ? 0 : Math.min(Math.max(currentIndex + offset, 0), filteredItems.length - 1);
		const next = filteredItems[nextIndex];
		if (!next || next.key === activeItem?.key) return;
		setActiveKey(next.key);
		scrollAssetCardIntoView(gridRef.current, next.key);
	};

	const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.defaultPrevented) return;
		const target = event.target as HTMLElement | null;
		if (
			target?.closest(
				"input, textarea, [contenteditable='true'], [role='combobox'], [role='listbox']",
			)
		) {
			return;
		}
		if (event.key === "Delete" || event.key === "Backspace") {
			if (!activeItem || busyKey) return;
			event.preventDefault();
			void deleteItem(activeItem);
			return;
		}
		const offset = arrowKeyOffset(event.key, gridColumnCount(gridRef.current));
		if (offset === 0) return;
		event.preventDefault();
		moveActiveItem(offset);
	};

	return (
		<>
			<input
				ref={mediaUploadRef}
				type="file"
				accept="image/*,video/*,audio/*,text/*,.txt,.md,.json"
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
						onKeyDown={handleDialogKeyDown}
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
										? `管理${selectedProject?.name || "当前项目"}的生成素材、上传素材和已选生成资源。`
										: "管理可在生成历史中复用的全局素材。"}
								</DialogPrimitive.Description>
							</div>
							<DialogPrimitive.Close asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="shrink-0"
									aria-label="关闭素材库"
								>
									<X className="size-4" />
								</Button>
							</DialogPrimitive.Close>
						</header>

						<div
							className={cn(
								"grid shrink-0 gap-2 border-b border-border bg-card px-4 py-3",
								projectMode
									? "lg:grid-cols-[minmax(16rem,18rem)_minmax(10rem,14rem)_auto_auto_auto_auto]"
									: "lg:grid-cols-[minmax(16rem,18rem)_minmax(10rem,14rem)_auto_auto]",
							)}
						>
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
							{projectMode ? (
								<>
									<AssetLibrarySelect
										label="来源"
										value={sourceFilter}
										options={projectSourceOptions}
										onValueChange={(value) => setSourceFilter(value as AssetLibrarySourceFilter)}
									/>
									<AssetLibrarySelect
										label="标签"
										value={resourceFilter}
										options={resourceOptions}
										onValueChange={(value) =>
											setResourceFilter(value as AssetLibraryResourceFilter)
										}
									/>
								</>
							) : null}
							<div className="flex items-center gap-2">
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
										<UploadMenuButton
											disabled={Boolean(uploading)}
											label="上传素材"
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
									<section
										ref={gridRef}
										className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-3"
									>
										{filteredItems.map((item) => (
											<AssetLibraryCard
												key={item.key}
												active={item.key === activeItem?.key}
												busy={busyKey === item.key}
												item={item}
												onDelete={() => void deleteItem(item)}
												onDownload={() => void downloadItem(item)}
												onPreview={() => setActiveKey(item.key)}
											/>
										))}
									</section>
								)}
							</div>
							<AssetLibraryPreview
								busy={Boolean(activeItem && busyKey === activeItem.key)}
								item={activeItem}
								onDelete={() => {
									if (activeItem) void deleteItem(activeItem);
								}}
								onDownload={() => {
									if (activeItem) void downloadItem(activeItem);
								}}
							/>
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
	onDelete: () => void;
	onDownload: () => void;
	onPreview: () => void;
}> = ({ active, busy, item, onDelete, onDownload, onPreview }) => {
	const thumbnailSource = assetLibraryItemThumbnailSource(item);
	const kindTag = assetLibraryKindTag(item);
	const resourceTags = assetLibraryResourceTags(item);
	const Icon = iconForKind(item.kind);

	return (
		<article
			data-asset-key={item.key}
			className={cn(
				"min-w-0 overflow-hidden rounded-sm border bg-card transition-colors",
				active ? "border-primary" : "border-border hover:border-input",
			)}
		>
			<button
				type="button"
				className="block w-full min-w-0 text-left"
				onClick={onPreview}
				aria-label={`预览 ${item.title}`}
			>
				<div className="relative aspect-[4/3] bg-ide-toolbar">
					{thumbnailSource ? (
						<img src={thumbnailSource} alt="" className="size-full object-contain" />
					) : (
						<div className="grid size-full place-items-center">
							<Icon className="size-8 text-muted-foreground" />
						</div>
					)}
					<AssetCornerTags tags={resourceTags} />
				</div>
				<div className="grid gap-1 px-3 py-2">
					<MiddleTruncatedText
						className="text-xs font-semibold text-foreground"
						text={item.title}
					/>
					<div className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground">
						<AssetTagBadge tag={kindTag} className="px-1 py-0 text-2xs shadow-none" />
						<span aria-hidden="true">·</span>
						<span className="truncate">{formatBytes(item.sizeBytes)}</span>
					</div>
				</div>
			</button>
			<div className="flex items-center justify-between gap-1 border-t border-border px-2 py-1.5">
				<Button
					type="button"
					size="sm"
					variant="ghost"
					className="h-7 px-2"
					disabled={busy}
					onClick={onDownload}
					aria-label={`下载 ${item.title}`}
				>
					<Download className="size-3.5" />
				</Button>
				<div className="flex items-center gap-1">
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
	busy: boolean;
	item: AssetLibraryItem | null;
	onDelete: () => void;
	onDownload: () => void;
}> = ({ busy, item, onDelete, onDownload }) => {
	const toast = useToast();
	const source = item ? assetLibraryItemSource(item) : "";
	const posterSource = item ? assetLibraryItemPosterSource(item) : "";
	const tags = item ? assetLibraryResourceTags(item) : [];
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

	const localPath = item.downloadPath?.trim() ?? "";
	const displayPath = item.mediaAsset?.relativePath?.trim() || localPath;
	const canReveal = Boolean(localPath) && isElectronRuntime();

	const revealInFolder = async () => {
		if (!localPath) return;
		try {
			await revealNativePath(localPath);
		} catch (err) {
			toast.error("无法在文件夹中显示", {
				description: errorMessage(err, "打开所在文件夹失败。"),
			});
		}
	};

	return (
		<aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-t border-border bg-card p-4 lg:border-l lg:border-t-0">
			<div className="min-w-0 shrink-0">
				<MiddleTruncatedText className="text-sm font-semibold text-foreground" text={item.title} />
				<p className="mt-1 truncate text-xs text-muted-foreground">
					{kindLabel(item.kind)} · {sourceTypeLabel(item.sourceType)} ·{" "}
					{formatBytes(item.sizeBytes)}
				</p>
			</div>
			<div className="flex min-h-64 min-w-0 flex-1 flex-col overflow-hidden rounded-sm border border-border bg-ide-editor lg:min-h-32">
				<AssetPreviewMedia
					error={error}
					isTextLoading={isLoading}
					item={item}
					posterSource={posterSource}
					source={source}
					text={text}
				/>
			</div>
			<div className="flex shrink-0 flex-wrap items-center gap-1.5">
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="h-7 rounded-sm px-2 text-xs"
					disabled={busy}
					onClick={onDownload}
				>
					<Download className="size-3.5" />
					<span>下载</span>
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="ml-auto h-7 rounded-sm px-2 text-xs text-muted-foreground hover:text-error-foreground"
					disabled={busy}
					onClick={onDelete}
				>
					<Trash2 className="size-3.5" />
					<span>{item.sourceType === "selected" ? "取消选入" : "删除"}</span>
				</Button>
			</div>
			<div className="grid shrink-0 gap-1 text-xs text-muted-foreground">
				<p>更新：{formatDateTime(item.updatedAt)}</p>
				<p>创建：{formatDateTime(item.createdAt)}</p>
				{item.mimeType ? <p className="break-all">MIME：{item.mimeType}</p> : null}
				{item.mediaAsset?.source ? (
					<p>来源：{mediaAssetSourceLabel(item.mediaAsset.source)}</p>
				) : null}
				{displayPath ? (
					<div className="flex min-w-0 items-center gap-1">
						<span className="shrink-0">路径：</span>
						<MiddleTruncatedText className="min-w-0 flex-1" text={displayPath} />
						{canReveal ? (
							<Button
								type="button"
								size="sm"
								variant="ghost"
								className="h-6 w-6 shrink-0 p-0"
								aria-label="在文件夹中显示"
								title="在文件夹中显示"
								onClick={() => void revealInFolder()}
							>
								<FolderOpen className="size-3" />
							</Button>
						) : null}
					</div>
				) : null}
			</div>
			<AssetTagList tags={tags} className="shrink-0 gap-1.5" />
		</aside>
	);
};

const AssetPreviewMedia: React.FC<{
	error: unknown;
	isTextLoading: boolean;
	item: AssetLibraryItem;
	posterSource: string;
	source: string;
	text?: string;
}> = ({ error, isTextLoading, item, posterSource, source, text }) => {
	if (item.kind === "image" && source) {
		return (
			<img src={source} alt={item.title} className="m-auto max-h-full max-w-full object-contain" />
		);
	}
	if (item.kind === "video" && source) {
		return (
			<VideoPlayer
				src={source}
				poster={posterSource || undefined}
				mimeType={item.mimeType || "video/mp4"}
				title={item.title}
				showTitleInControls={false}
				className="min-h-0 w-full flex-1"
			/>
		);
	}
	if (item.kind === "audio" && source) {
		return (
			<div className="my-auto grid w-full content-center gap-3 p-4">
				<div className="flex items-center gap-2 text-sm font-medium text-foreground">
					<span className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar text-muted-foreground">
						<AudioLines className="size-4" />
					</span>
					<span className="min-w-0 truncate">{item.title}</span>
				</div>
				<AudioPlayer src={source} mimeType={item.mimeType || "audio/mpeg"} title={item.title} />
			</div>
		);
	}
	if (item.kind === "text") {
		if (isTextLoading) {
			return (
				<div className="grid flex-1 place-items-center text-sm text-muted-foreground">
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
			<pre className="min-h-0 flex-1 overflow-auto p-4 text-xs leading-5 text-foreground">
				{truncateTextPreview(text ?? "")}
			</pre>
		);
	}

	const Icon = iconForKind(item.kind);
	return (
		<div className="grid flex-1 place-items-center p-6 text-center">
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
			<span className="flex min-w-0 items-center gap-1">
				<span className="shrink-0 text-muted-foreground">{label}:</span>
				<span className="min-w-0 truncate">
					<SelectValue placeholder={loading ? "加载中..." : undefined} />
				</span>
			</span>
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
					? "可上传素材，或从生成结果中选入资源。"
					: "可上传图片、视频、音频或文本素材，供生成历史复用。"}
			</p>
		</div>
	</div>
);

type AssetLibraryTag = {
	className: string;
	key: string;
	label: string;
};

const AssetCornerTags: React.FC<{ tags: AssetLibraryTag[] }> = ({ tags }) => {
	if (tags.length === 0) return null;
	return (
		<div className="absolute left-2 right-2 top-2 flex flex-wrap gap-1">
			{tags.map((tag) => (
				<AssetTagBadge key={tag.key} tag={tag} />
			))}
		</div>
	);
};

const AssetTagList: React.FC<{
	className?: string;
	tagClassName?: string;
	tags: AssetLibraryTag[];
}> = ({ className, tagClassName, tags }) => {
	if (tags.length === 0) return null;
	return (
		<div className={cn("flex flex-wrap", className)}>
			{tags.map((tag) => (
				<AssetTagBadge key={tag.key} tag={tag} className={tagClassName} />
			))}
		</div>
	);
};

const AssetTagBadge: React.FC<{ className?: string; tag: AssetLibraryTag }> = ({
	className,
	tag,
}) => (
	<span
		className={cn(
			"inline-flex max-w-[9rem] items-center rounded-sm border px-1.5 py-0.5 text-2xs font-medium shadow-sm",
			tag.className,
			className,
		)}
		title={tag.label}
	>
		<span className="min-w-0 truncate">{tag.label}</span>
	</span>
);

const MiddleTruncatedText: React.FC<{ className?: string; text: string }> = ({
	className,
	text,
}) => {
	const { head, tail } = splitTextForMiddleTruncation(text);
	if (!tail) {
		return (
			<span className={cn("block min-w-0 truncate", className)} title={text}>
				{text}
			</span>
		);
	}
	return (
		<span className={cn("flex min-w-0", className)} title={text}>
			<span className="min-w-0 truncate">{head}</span>
			<span className="shrink-0 whitespace-pre">{tail}</span>
		</span>
	);
};

// 生成类文件名多为「相同前缀 + 尾部序号/版本」，溢出时省略中段、保住尾部才能区分同批素材。
const splitTextForMiddleTruncation = (text: string) => {
	if (textDisplayWidthUnits(text) <= 20) return { head: text, tail: "" };
	const extension = text.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? "";
	const stem = extension ? text.slice(0, -extension.length) : text;
	const tail = stem.slice(-4) + extension;
	if (tail.length >= text.length - 2) return { head: text, tail: "" };
	return { head: text.slice(0, text.length - tail.length), tail };
};

// 粗略估算显示宽度：CJK 等全角字符按 2 个单位计。
const textDisplayWidthUnits = (text: string) => {
	let units = 0;
	for (const char of text) units += (char.codePointAt(0) ?? 0) > 0x2e7f ? 2 : 1;
	return units;
};

const arrowKeyOffset = (key: string, columns: number) => {
	if (key === "ArrowLeft") return -1;
	if (key === "ArrowRight") return 1;
	if (key === "ArrowUp") return -columns;
	if (key === "ArrowDown") return columns;
	return 0;
};

const gridColumnCount = (grid: HTMLElement | null) => {
	if (!grid || typeof window === "undefined") return 1;
	const template = window.getComputedStyle(grid).gridTemplateColumns;
	const count = template.split(" ").filter((track) => track && track !== "0px").length;
	return Math.max(1, count);
};

const scrollAssetCardIntoView = (grid: HTMLElement | null, key: string) => {
	if (!grid) return;
	for (const card of grid.querySelectorAll<HTMLElement>("[data-asset-key]")) {
		if (card.dataset.assetKey !== key) continue;
		card.scrollIntoView({ block: "nearest" });
		return;
	}
};

const assetLibraryItemSource = (item: AssetLibraryItem) => {
	if (item.sourceType === "media" && item.mediaAsset) {
		return apiResourceURL(item.mediaAsset.url);
	}
	if (item.sourceType === "selected") {
		const asset = item.selectedAssets[0];
		if (asset) return generationAssetSource(asset);
	}
	return apiResourceURL(item.url);
};

const assetLibraryItemThumbnailSource = (item: AssetLibraryItem) => {
	if (item.kind === "image") return assetLibraryItemSource(item);
	return assetLibraryItemPosterSource(item);
};

const assetLibraryItemPosterSource = (item: AssetLibraryItem) => {
	if (item.kind !== "video") return "";
	const posterURL = item.mediaAsset?.posterUrl?.trim();
	return posterURL ? apiResourceURL(posterURL) : "";
};

const assetLibraryResourceTags = (item: AssetLibraryItem): AssetLibraryTag[] =>
	item.selectedResourceTypes.map((type) => ({
		className: resourceTypeBadgeClassName(type),
		key: `resource-${type}`,
		label: resourceTypeLabel(type),
	}));

const assetLibraryKindTag = (item: AssetLibraryItem): AssetLibraryTag => ({
	className: kindBadgeClassName(item.kind),
	key: `kind-${item.kind}`,
	label: kindLabel(item.kind),
});

const resourceTypeBadgeClassName = (type: AssetLibraryResourceType) => {
	const className = resourceTypeBadgeClassNames[type];
	return className ?? fallbackBadgeClassName;
};

const kindBadgeClassName = (kind: AssetLibraryKind) => {
	const className = kindBadgeClassNames[kind];
	return className ?? fallbackBadgeClassName;
};

const resourceTypeBadgeClassNames: Record<AssetLibraryResourceType, string> = {
	character: "border-fuchsia-200 bg-fuchsia-50/95 text-fuchsia-800 shadow-fuchsia-900/5",
	prop: "border-amber-200 bg-amber-50/95 text-amber-800 shadow-amber-900/5",
	scene: "border-emerald-200 bg-emerald-50/95 text-emerald-800 shadow-emerald-900/5",
	screenplay: "border-sky-200 bg-sky-50/95 text-sky-800 shadow-sky-900/5",
	reference: "border-stone-200 bg-stone-50/95 text-stone-800 shadow-stone-900/5",
	storyboard: "border-indigo-200 bg-indigo-50/95 text-indigo-800 shadow-indigo-900/5",
};

const kindBadgeClassNames: Record<AssetLibraryKind, string> = {
	audio: "border-rose-200 bg-rose-50/95 text-rose-800 shadow-rose-900/5",
	binary: "border-zinc-200 bg-zinc-50/95 text-zinc-700 shadow-zinc-900/5",
	image: "border-cyan-200 bg-cyan-50/95 text-cyan-800 shadow-cyan-900/5",
	text: "border-slate-200 bg-slate-50/95 text-slate-700 shadow-slate-900/5",
	video: "border-violet-200 bg-violet-50/95 text-violet-800 shadow-violet-900/5",
};

const fallbackBadgeClassName = "border-border bg-card/90 text-foreground";

const iconForKind = (kind: AssetLibraryKind) => {
	if (kind === "image") return ImageIcon;
	if (kind === "video") return Film;
	if (kind === "audio") return AudioLines;
	if (kind === "text") return FileText;
	return File;
};

const resourceTypeLabel = (type: AssetLibraryResourceType) => {
	if (type === "screenplay") return "剧本";
	if (type === "reference") return "资料";
	return selectedGenerationResourceDescriptorMap[type]?.label ?? type;
};

const kindLabel = (kind: AssetLibraryKind) => {
	if (kind === "image") return "图片";
	if (kind === "video") return "视频";
	if (kind === "audio") return "音频";
	if (kind === "text") return "文本";
	return "文件";
};

const sourceTypeLabel = (source: AssetLibrarySource) => {
	if (source === "selected") return "已选资源";
	return "媒体素材";
};

const mediaAssetSourceLabel = (source: string) => {
	if (source === "upload") return "上传";
	if (source === "toolbox") return "生成历史";
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
