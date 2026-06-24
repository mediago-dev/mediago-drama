import {
	AudioLines,
	Check,
	Clipboard,
	Download,
	Eye,
	FileText,
	Image as ImageIcon,
	Loader2,
	Pencil,
	Trash2,
	WandSparkles,
	X,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useState } from "react";
import type React from "react";
import { AudioPlayer } from "@/components/AudioPlayer";
import { VideoPlayer } from "@/components/VideoPlayer";
import type { GenerationAsset, GenerationKind } from "@/domains/generation/api/generation";
import {
	GenerationImagePreviewSlider,
	type GenerationImagePreviewItem,
} from "@/domains/generation/components/GenerationImagePreviewSlider";
import { GenerationVideoThumbnail } from "@/domains/generation/components/GenerationVideoThumbnail";
import { generatedAssetSaveKey } from "@/domains/generation/components/generatedResultActions";
import {
	entryGeneratedAssets,
	entryPromptText,
	entrySelectionState,
	historySelectionText,
	isFailedGenerationStatus,
	isPendingGenerationStatus,
} from "@/domains/generation/components/mediaGenerationHelpers";
import { Button } from "@/shared/components/ui/button";
import { confirmDialog } from "@/shared/components/callable/ConfirmDialog";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import {
	generationAssetSelectionKey,
	generationAssetSource,
	generationStatusLabel,
	type GenerationEntry,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { dialogContentMotion } from "@/shared/components/ui/dialog-motion";
import { cn } from "@/shared/lib/utils";

export const HistoryGenerationList: React.FC<{
	activeEntryId: string | null;
	deletedAssetPlaceholderCounts?: Record<string, number>;
	deletingEntryIds: string[];
	defaultSourceLabel?: string;
	deletingAssetKeys?: string[];
	entries: GenerationEntry[];
	kind: GenerationKind;
	onCopyPrompt?: (entry: GenerationEntry) => void;
	onDeleteAsset?: (entry: GenerationEntry, asset: GenerationAsset, assetIndex: number) => void;
	onDeleteEntry: (entry: GenerationEntry) => void;
	onDeletePlaceholder?: (entry: GenerationEntry, assetIndex: number) => void;
	onEditAsset?: (entry: GenerationEntry, asset: GenerationAsset) => void;
	onSaveAsset?: (entry: GenerationEntry, asset: GenerationAsset) => void;
	onSelectEntry: (entry: GenerationEntry) => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	onUseAssetAsReference?: (asset: GenerationAsset) => void;
	onUsePrompt?: (entry: GenerationEntry) => void;
	savedAssetKeys?: string[];
	selectedAssetKeys: string[];
	savingAssetKeys?: string[];
	variant?: "compact" | "list";
}> = ({
	activeEntryId,
	deletedAssetPlaceholderCounts = {},
	deletingEntryIds,
	deletingAssetKeys = [],
	defaultSourceLabel,
	entries,
	kind,
	onCopyPrompt,
	onDeleteAsset,
	onDeleteEntry,
	onDeletePlaceholder,
	onEditAsset,
	onSaveAsset,
	onSelectEntry,
	onToggleAsset,
	onUseAssetAsReference,
	onUsePrompt,
	savedAssetKeys = [],
	selectedAssetKeys,
	savingAssetKeys = [],
	variant = "compact",
}) => {
	if (entries.length === 0) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
				暂无生成历史。
			</div>
		);
	}

	if (variant === "list" && (kind === "image" || kind === "audio" || kind === "video")) {
		return (
			<HistoryImageGrid
				deletingAssetKeys={deletingAssetKeys}
				deletedAssetPlaceholderCounts={deletedAssetPlaceholderCounts}
				deletingEntryIds={deletingEntryIds}
				entries={entries}
				kind={kind}
				onDeleteAsset={onDeleteAsset}
				onDeleteEntry={onDeleteEntry}
				onDeletePlaceholder={onDeletePlaceholder}
				onEditAsset={onEditAsset}
				onSaveAsset={onSaveAsset}
				onToggleAsset={onToggleAsset}
				onUseAssetAsReference={onUseAssetAsReference}
				onUsePrompt={onUsePrompt}
				savedAssetKeys={savedAssetKeys}
				selectedAssetKeys={selectedAssetKeys}
				savingAssetKeys={savingAssetKeys}
			/>
		);
	}

	return (
		<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
			<div className="grid gap-2.5">
				{entries.map((entry) => (
					<HistoryGenerationItem
						key={entry.id}
						entry={entry}
						defaultSourceLabel={defaultSourceLabel}
						isDeleting={deletingEntryIds.includes(entry.id)}
						kind={kind}
						selected={entry.id === activeEntryId}
						selectedAssetKeys={selectedAssetKeys}
						onCopyPrompt={onCopyPrompt ? () => onCopyPrompt(entry) : undefined}
						onDelete={() => onDeleteEntry(entry)}
						onSelect={() => onSelectEntry(entry)}
						onToggleAsset={onToggleAsset}
						onUsePrompt={onUsePrompt ? () => onUsePrompt(entry) : undefined}
						variant={variant}
					/>
				))}
			</div>
		</div>
	);
};

type HistoryImageRecord = HistoryImageAssetRecord | HistoryImagePlaceholderRecord;

interface HistoryImageAssetRecord {
	asset: GenerationAsset;
	assetIndex: number;
	displayIndex: number;
	entry: GenerationEntry;
	kind: "asset";
	key: string;
	source: string;
}

interface HistoryImagePlaceholderRecord {
	assetIndex: number;
	displayIndex: number;
	entry: GenerationEntry;
	kind: "failed" | "pending";
	key: string;
	source: "";
}

const HistoryImageGrid: React.FC<{
	deletedAssetPlaceholderCounts: Record<string, number>;
	deletingAssetKeys: string[];
	deletingEntryIds: string[];
	entries: GenerationEntry[];
	kind: GenerationKind;
	onDeleteAsset?: (entry: GenerationEntry, asset: GenerationAsset, assetIndex: number) => void;
	onDeleteEntry: (entry: GenerationEntry) => void;
	onDeletePlaceholder?: (entry: GenerationEntry, assetIndex: number) => void;
	onEditAsset?: (entry: GenerationEntry, asset: GenerationAsset) => void;
	onSaveAsset?: (entry: GenerationEntry, asset: GenerationAsset) => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	onUseAssetAsReference?: (asset: GenerationAsset) => void;
	onUsePrompt?: (entry: GenerationEntry) => void;
	savedAssetKeys: string[];
	selectedAssetKeys: string[];
	savingAssetKeys: string[];
}> = ({
	deletedAssetPlaceholderCounts,
	deletingAssetKeys,
	deletingEntryIds,
	entries,
	kind,
	onDeleteAsset,
	onDeleteEntry,
	onDeletePlaceholder,
	onEditAsset,
	onSaveAsset,
	onToggleAsset,
	onUseAssetAsReference,
	onUsePrompt,
	savedAssetKeys,
	selectedAssetKeys,
	savingAssetKeys,
}) => {
	const records = imageRecordsFromEntries(entries, kind, deletedAssetPlaceholderCounts);
	const [previewIndex, setPreviewIndex] = useState<number | null>(null);
	const previewImages = historyPreviewImagesFromRecords(records);
	const openImagePreview = (record: HistoryImageAssetRecord) => {
		const index = previewImages.findIndex((image) => image.key === record.key);
		if (index >= 0) setPreviewIndex(index);
	};

	if (records.length === 0) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
				{kind === "image"
					? "暂无生成图片。"
					: kind === "audio"
						? "暂无生成音频。"
						: "暂无生成视频。"}
			</div>
		);
	}

	return (
		<>
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
				<div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
					{records.map((record) => (
						<HistoryImageCard
							key={record.key}
							record={record}
							deleting={isDeletingHistoryImage(record, deletingAssetKeys, deletingEntryIds)}
							onDeleteAsset={onDeleteAsset}
							onDeleteEntry={onDeleteEntry}
							onDeletePlaceholder={onDeletePlaceholder}
							onEditAsset={onEditAsset}
							onPreviewImage={openImagePreview}
							onSaveAsset={onSaveAsset}
							onToggleAsset={onToggleAsset}
							onUseAssetAsReference={onUseAssetAsReference}
							onUsePrompt={onUsePrompt}
							savedAssetKeys={savedAssetKeys}
							selectedAssetKeys={selectedAssetKeys}
							savingAssetKeys={savingAssetKeys}
						/>
					))}
				</div>
			</div>
			<GenerationImagePreviewSlider
				images={previewImages}
				index={previewIndex}
				selectedAssetKeys={selectedAssetKeys}
				onClose={() => setPreviewIndex(null)}
				onIndexChange={setPreviewIndex}
				onToggleAsset={onToggleAsset}
			/>
		</>
	);
};

const HistoryImageCard: React.FC<{
	deleting: boolean;
	onDeleteAsset?: (entry: GenerationEntry, asset: GenerationAsset, assetIndex: number) => void;
	onDeleteEntry: (entry: GenerationEntry) => void;
	onDeletePlaceholder?: (entry: GenerationEntry, assetIndex: number) => void;
	onEditAsset?: (entry: GenerationEntry, asset: GenerationAsset) => void;
	onPreviewImage: (record: HistoryImageAssetRecord) => void;
	onSaveAsset?: (entry: GenerationEntry, asset: GenerationAsset) => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	onUseAssetAsReference?: (asset: GenerationAsset) => void;
	onUsePrompt?: (entry: GenerationEntry) => void;
	record: HistoryImageRecord;
	savedAssetKeys: string[];
	selectedAssetKeys: string[];
	savingAssetKeys: string[];
}> = ({
	deleting,
	onDeleteAsset,
	onDeleteEntry,
	onDeletePlaceholder,
	onEditAsset,
	onPreviewImage,
	onSaveAsset,
	onToggleAsset,
	onUseAssetAsReference,
	onUsePrompt,
	record,
	savedAssetKeys,
	selectedAssetKeys,
	savingAssetKeys,
}) => {
	const { assetIndex, entry, source } = record;
	const isAssetRecord = record.kind === "asset";
	const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
	if (!isAssetRecord) {
		const mediaLabel = historyAssetMediaLabel(entry.kind);
		const deleteTitle = historyAssetDeleteTitle(entry.kind);
		const showDeriveAction = entry.kind === "image";
		const confirmPlaceholderDelete = () => {
			void confirmDialog({
				title: deleteTitle,
				description: `删除后会从这条生成记录中移除这个${mediaLabel}位置。`,
				confirmLabel: "删除",
				onConfirm: () => onDeletePlaceholder?.(entry, assetIndex),
			});
		};

		return (
			<>
				<ContextMenu>
					<ContextMenuTrigger asChild>
						<article
							className={cn(
								"relative min-w-0 overflow-hidden rounded-sm border border-border bg-muted-foreground/10",
								historyAssetCardAspectClassName(record.entry.kind),
							)}
						>
							<HistoryImagePlaceholder record={record} />
						</article>
					</ContextMenuTrigger>
					<ContextMenuContent>
						<ContextMenuItem disabled>
							<Eye className="size-4" />
							<span>预览</span>
						</ContextMenuItem>
						<ContextMenuItem disabled>
							<Download className="size-4" />
							<span>下载</span>
						</ContextMenuItem>
						{showDeriveAction ? (
							<ContextMenuItem disabled>
								<WandSparkles className="size-4" />
								<span>派生</span>
							</ContextMenuItem>
						) : null}
						<ContextMenuItem disabled={!onUsePrompt} onSelect={() => onUsePrompt?.(entry)}>
							<FileText className="size-4" />
							<span>使用此提示词</span>
						</ContextMenuItem>
						<ContextMenuItem
							className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
							disabled={deleting || !onDeletePlaceholder}
							onSelect={confirmPlaceholderDelete}
						>
							{deleting ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Trash2 className="size-4" />
							)}
							<span>{deleting ? "正在删除" : "删除"}</span>
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
			</>
		);
	}

	const canDerive = Boolean(onUseAssetAsReference || onToggleAsset);
	const saveKey = generatedAssetSaveKey(entry, record.asset);
	const saving = Boolean(saveKey && savingAssetKeys.includes(saveKey));
	const saved = Boolean(saveKey && savedAssetKeys.includes(saveKey));
	const selectionKey = generationAssetSelectionKey(record.asset);
	const selectable = Boolean(selectionKey && onToggleAsset);
	const selected = Boolean(selectionKey && selectedAssetKeys.includes(selectionKey));
	const mediaKind = record.asset.kind;
	const isAudio = mediaKind === "audio";
	const isVideo = mediaKind === "video";
	const isImage = mediaKind === "image";
	const mediaLabel = historyAssetMediaLabel(mediaKind);
	const deleteTitle = historyAssetDeleteTitle(mediaKind);
	const showDeriveAction = isImage;
	const showEditAction = isImage && Boolean(onEditAsset);
	const showPreviewAction = !isAudio;
	const saveAsset = () => onSaveAsset?.(entry, record.asset);
	const editAsset = () => onEditAsset?.(entry, record.asset);
	const previewAsset = () => {
		if (!isVideo || !source) return;
		setPreviewDialogOpen(true);
	};
	const previewImage = () => {
		if (!isImage) return;
		onPreviewImage(record);
	};
	const deriveAsset = () => {
		if (onUseAssetAsReference) {
			onUseAssetAsReference(record.asset);
			return;
		}
		onToggleAsset?.(record.asset, true);
	};
	const usePrompt = () => onUsePrompt?.(entry);
	const confirmDelete = () => {
		if (onDeleteAsset) {
			onDeleteAsset(entry, record.asset, assetIndex);
			return;
		}
		onDeleteEntry(entry);
	};
	const openDeleteDialog = () => {
		void confirmDialog({
			title: deleteTitle,
			description: "删除后会从这条生成记录中移除，无法在历史记录中恢复。",
			confirmLabel: "删除",
			onConfirm: confirmDelete,
		});
	};
	const actionButtons = (
		<>
			{showPreviewAction ? (
				isVideo ? (
					<HistoryImageActionButton ariaLabel="预览视频" tooltip="预览" onClick={previewAsset}>
						<Eye className="size-4" />
					</HistoryImageActionButton>
				) : (
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								aria-label="预览图片"
								className={historyImageActionButtonClassName}
								onClick={(event) => {
									event.preventDefault();
									event.stopPropagation();
									previewImage();
								}}
							>
								<Eye className="size-4" />
							</button>
						</TooltipTrigger>
						<TooltipContent>预览</TooltipContent>
					</Tooltip>
				)
			) : null}
			{showEditAction ? (
				<HistoryImageActionButton ariaLabel="编辑图片" tooltip="编辑" onClick={editAsset}>
					<Pencil className="size-4" />
				</HistoryImageActionButton>
			) : null}
			<HistoryImageActionButton
				ariaLabel={
					saved ? `${mediaLabel}已下载` : saving ? `正在下载${mediaLabel}` : `下载${mediaLabel}`
				}
				disabled={!onSaveAsset || saving || saved}
				tooltip={saved ? "已下载" : saving ? "正在下载" : "下载"}
				onClick={saveAsset}
			>
				{saving ? (
					<Loader2 className="size-4 animate-spin" />
				) : saved ? (
					<Check className="size-4" />
				) : (
					<Download className="size-4" />
				)}
			</HistoryImageActionButton>
			{showDeriveAction ? (
				<HistoryImageActionButton
					ariaLabel="派生图片"
					disabled={!canDerive}
					tooltip="派生"
					onClick={deriveAsset}
				>
					<WandSparkles className="size-4" />
				</HistoryImageActionButton>
			) : null}
			<HistoryImageActionButton
				ariaLabel="使用此提示词"
				disabled={!onUsePrompt}
				tooltip="使用此提示词"
				onClick={usePrompt}
			>
				<FileText className="size-4" />
			</HistoryImageActionButton>
			<HistoryImageActionButton
				ariaLabel={`删除${mediaLabel}`}
				disabled={deleting}
				tooltip={deleting ? "正在删除" : "删除"}
				onClick={openDeleteDialog}
			>
				{deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
			</HistoryImageActionButton>
		</>
	);

	return (
		<TooltipProvider delayDuration={180}>
			<>
				<ContextMenu>
					<ContextMenuTrigger asChild>
						<article
							className={cn(
								"group/history-image relative min-w-0 overflow-hidden rounded-sm border bg-muted-foreground/10",
								historyAssetCardAspectClassName(mediaKind),
								selected ? "border-primary" : "border-border",
							)}
						>
							{isVideo ? (
								<GenerationVideoThumbnail source={source} />
							) : isAudio ? (
								<HistoryAudioCardBody asset={record.asset} source={source} />
							) : (
								<img src={source} alt="" className="size-full object-contain" />
							)}
							{isAudio ? (
								<div className="pointer-events-none absolute right-2 top-2 z-20 opacity-0 transition-opacity group-hover/history-image:opacity-100 group-focus-within/history-image:opacity-100">
									<div className="pointer-events-auto flex flex-wrap justify-end gap-1.5">
										{actionButtons}
									</div>
								</div>
							) : (
								<div className="absolute inset-0 flex items-center justify-center bg-foreground/55 opacity-0 transition-opacity group-hover/history-image:opacity-100 group-focus-within/history-image:opacity-100">
									<div className="flex max-w-[calc(100%-2rem)] flex-wrap items-center justify-center gap-2">
										{actionButtons}
									</div>
								</div>
							)}
							{selectable && onToggleAsset ? (
								<HistoryImageSelectionButton
									selected={selected}
									onToggle={() => onToggleAsset(record.asset, !selected)}
								/>
							) : null}
						</article>
					</ContextMenuTrigger>
					<ContextMenuContent>
						{isVideo ? (
							<ContextMenuItem onSelect={previewAsset}>
								<Eye className="size-4" />
								<span>预览</span>
							</ContextMenuItem>
						) : isImage ? (
							<ContextMenuItem onSelect={previewImage}>
								<Eye className="size-4" />
								<span>预览</span>
							</ContextMenuItem>
						) : null}
						{showEditAction ? (
							<ContextMenuItem onSelect={editAsset}>
								<Pencil className="size-4" />
								<span>编辑</span>
							</ContextMenuItem>
						) : null}
						<ContextMenuItem disabled={!onSaveAsset || saving || saved} onSelect={saveAsset}>
							{saving ? (
								<Loader2 className="size-4 animate-spin" />
							) : saved ? (
								<Check className="size-4" />
							) : (
								<Download className="size-4" />
							)}
							<span>{saved ? "已下载" : saving ? "正在下载" : "下载"}</span>
						</ContextMenuItem>
						{showDeriveAction ? (
							<ContextMenuItem disabled={!canDerive} onSelect={deriveAsset}>
								<WandSparkles className="size-4" />
								<span>派生</span>
							</ContextMenuItem>
						) : null}
						<ContextMenuItem disabled={!onUsePrompt} onSelect={usePrompt}>
							<FileText className="size-4" />
							<span>使用此提示词</span>
						</ContextMenuItem>
						<ContextMenuItem
							className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
							disabled={deleting}
							onSelect={openDeleteDialog}
						>
							{deleting ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Trash2 className="size-4" />
							)}
							<span>{deleting ? "正在删除" : "删除"}</span>
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
				{isVideo ? (
					<HistoryVideoPreviewDialog
						mimeType={record.asset.mimeType}
						open={previewDialogOpen}
						source={source}
						onOpenChange={setPreviewDialogOpen}
					/>
				) : null}
			</>
		</TooltipProvider>
	);
};

const HistoryVideoPreviewDialog: React.FC<{
	mimeType?: string;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	source: string;
}> = ({ mimeType, onOpenChange, open, source }) => (
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
						预览视频
					</DialogPrimitive.Title>
					<DialogPrimitive.Close asChild>
						<Button type="button" variant="ghost" size="icon" aria-label="关闭预览">
							<X className="size-4" />
						</Button>
					</DialogPrimitive.Close>
				</div>
				<div className="bg-black">
					<VideoPlayer
						src={source}
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

const HistoryAudioCardBody: React.FC<{
	asset: GenerationAsset;
	source: string;
}> = ({ asset, source }) => (
	<div className="flex size-full flex-col justify-between gap-3 bg-ide-toolbar p-3 text-foreground">
		<div className="flex min-w-0 items-center gap-2">
			<span className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground">
				<AudioLines className="size-4" />
			</span>
			<div className="min-w-0 flex-1">
				<p className="truncate text-xs font-semibold text-foreground">生成音频</p>
				<p className="truncate text-2xs text-muted-foreground">{asset.mimeType || "audio/mpeg"}</p>
			</div>
		</div>
		<AudioPlayer
			src={source}
			mimeType={asset.mimeType || "audio/mpeg"}
			title="生成音频"
			className="h-[52px] shrink-0"
		/>
	</div>
);

const HistoryImageSelectionButton: React.FC<{
	onToggle: () => void;
	selected: boolean;
}> = ({ onToggle, selected }) => (
	<Tooltip>
		<TooltipTrigger asChild>
			<button
				type="button"
				role="checkbox"
				aria-checked={selected}
				aria-label={selected ? "取消选入结果" : "选入结果"}
				className={cn(
					"absolute left-3 top-3 z-20 flex size-7 items-center justify-center rounded-sm border shadow-sm ring-1 ring-black/10 transition-colors",
					selected
						? "border-primary bg-primary text-primary-foreground"
						: "border-white/80 bg-background/90 text-transparent hover:bg-background",
				)}
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					onToggle();
				}}
			>
				<Check className={cn("size-4", selected ? "opacity-100" : "opacity-0")} />
			</button>
		</TooltipTrigger>
		<TooltipContent>{selected ? "取消选入结果" : "选入结果"}</TooltipContent>
	</Tooltip>
);

const HistoryImagePlaceholder: React.FC<{ record: HistoryImagePlaceholderRecord }> = ({
	record,
}) => {
	const failed = record.kind === "failed";
	const unit = historyAssetUnit(record.entry.kind);
	const label = `第 ${record.displayIndex + 1} ${unit}${failed ? "生成失败" : "生成中"}`;
	const errorMessage = failed ? entryErrorText(record.entry) : "";
	const Icon = record.entry.kind === "audio" ? AudioLines : ImageIcon;

	return (
		<div
			role="img"
			aria-label={label}
			title={errorMessage || label}
			className={cn(
				"flex size-full flex-col items-center justify-center gap-2 border border-dashed bg-muted/70 text-xs",
				failed
					? "border-error-border text-error-foreground"
					: "border-border text-muted-foreground",
			)}
		>
			{failed ? <Icon className="size-5" /> : <Loader2 className="size-5 animate-spin" />}
			<span>{failed ? "生成失败" : "生成中"}</span>
		</div>
	);
};

const historyAssetCardAspectClassName = (kind: GenerationKind) =>
	kind === "video" ? "aspect-video" : "aspect-[4/3]";

const historyAssetMediaLabel = (kind: GenerationKind) =>
	kind === "image" ? "图片" : kind === "audio" ? "音频" : kind === "video" ? "视频" : "文本";

const historyAssetDeleteTitle = (kind: GenerationKind) =>
	kind === "image"
		? "删除这张图片？"
		: kind === "audio"
			? "删除这个音频？"
			: kind === "video"
				? "删除这个视频？"
				: "删除这个结果？";

const historyImageActionButtonClassName = cn(
	"flex size-9 items-center justify-center rounded-full border border-white/25 bg-background text-foreground shadow-lg transition-colors",
	"hover:bg-background/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60",
);

const HistoryImageActionButton: React.FC<{
	ariaLabel: string;
	children: React.ReactNode;
	disabled?: boolean;
	onClick?: () => void;
	tooltip: string;
}> = ({ ariaLabel, children, disabled, onClick, tooltip }) => (
	<Tooltip>
		<TooltipTrigger asChild>
			<button
				type="button"
				aria-label={ariaLabel}
				className={historyImageActionButtonClassName}
				disabled={disabled}
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					onClick?.();
				}}
			>
				{children}
			</button>
		</TooltipTrigger>
		<TooltipContent>{tooltip}</TooltipContent>
	</Tooltip>
);

const imageRecordsFromEntries = (
	entries: GenerationEntry[],
	kind: GenerationKind,
	deletedAssetPlaceholderCounts: Record<string, number>,
): HistoryImageRecord[] =>
	entries.flatMap((entry) => {
		const imageRecords = (entry.assets ?? []).flatMap<HistoryImageAssetRecord>(
			(asset, assetIndex) => {
				const source = generationAssetSource(asset);
				if (asset.kind !== kind || !source) return [];
				const slotIndex = generationAssetSlotIndex(asset, assetIndex);

				return [
					{
						asset,
						assetIndex: slotIndex,
						displayIndex: slotIndex,
						entry,
						kind: "asset",
						key: `${entry.id}:${slotIndex}:${source}`,
						source,
					},
				];
			},
		);
		const loading = isPendingGenerationStatus(entry.status);
		const failed = isFailedGenerationStatus(entry.status);
		const placeholderKind = failed ? "failed" : loading ? "pending" : null;
		if (!placeholderKind) return imageRecords;

		const targetCount = Math.max(
			...imageRecords.map((record) => record.displayIndex + 1),
			kind === "image" ? requestGenerationCount(entry.requestDetails ?? []) : 1,
		);
		const occupiedSlots = new Set(imageRecords.map((record) => record.displayIndex));
		const deletedSlots = generationDeletedAssetSlotSet(entry.deletedAssetSlots);
		let legacyDeletedPlaceholderCount = Math.max(0, deletedAssetPlaceholderCounts[entry.id] ?? 0);
		const placeholders: HistoryImagePlaceholderRecord[] = [];
		for (let displayIndex = 0; displayIndex < targetCount; displayIndex++) {
			if (occupiedSlots.has(displayIndex) || deletedSlots.has(displayIndex)) continue;
			if (legacyDeletedPlaceholderCount > 0) {
				legacyDeletedPlaceholderCount -= 1;
				continue;
			}
			placeholders.push({
				assetIndex: displayIndex,
				displayIndex,
				entry,
				kind: placeholderKind,
				key: `${entry.id}:${placeholderKind}:${displayIndex}`,
				source: "",
			});
		}

		return [...imageRecords, ...placeholders];
	});

const historyPreviewImagesFromRecords = (
	records: HistoryImageRecord[],
): GenerationImagePreviewItem[] =>
	records.flatMap((record) => {
		if (record.kind !== "asset" || record.asset.kind !== "image") return [];

		return [
			{
				asset: record.asset,
				key: record.key,
				src: record.source,
			},
		];
	});

const generationAssetSlotIndex = (asset: GenerationAsset, fallback: number) => {
	const slotIndex = asset.slotIndex;
	return typeof slotIndex === "number" && Number.isInteger(slotIndex) && slotIndex >= 0
		? slotIndex
		: fallback;
};

const generationDeletedAssetSlotSet = (slots: number[] | undefined) => {
	const set = new Set<number>();
	for (const slot of slots ?? []) {
		if (Number.isInteger(slot) && slot >= 0) set.add(slot);
	}
	return set;
};

const isDeletingHistoryImage = (
	record: HistoryImageRecord,
	deletingAssetKeys: string[],
	deletingEntryIds: string[],
) =>
	deletingAssetKeys.includes(`${record.entry.id}:${record.assetIndex}`) ||
	deletingEntryIds.includes(record.entry.id);

const HistoryGenerationItem: React.FC<{
	defaultSourceLabel?: string;
	entry: GenerationEntry;
	isDeleting: boolean;
	kind: GenerationKind;
	onCopyPrompt?: () => void;
	onDelete: () => void;
	onSelect: () => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	onUsePrompt?: () => void;
	selected: boolean;
	selectedAssetKeys: string[];
	variant: "compact" | "list";
}> = ({
	defaultSourceLabel,
	entry,
	isDeleting,
	kind,
	onCopyPrompt,
	onDelete,
	onSelect,
	onToggleAsset,
	onUsePrompt,
	selected,
	selectedAssetKeys,
	variant,
}) => {
	const generatedAssets = entryGeneratedAssets(entry, kind);
	const loading = isPendingGenerationStatus(entry.status);
	const failed = isFailedGenerationStatus(entry.status);
	const errorMessage = failed ? entryErrorText(entry) : "";
	const selection = entrySelectionState(generatedAssets, selectedAssetKeys);
	const sourceBadge = generationSourceBadge(defaultSourceLabel);
	const timeSummary = generationTimeSummary(entry, loading);
	const pendingAssetCount = pendingGenerationAssetCount(entry, kind, loading);

	if (variant === "list") {
		return (
			<article
				className={cn(
					"group/history-item relative min-w-0 max-w-full rounded-sm border bg-card p-3",
					failed ? "border-error-border" : "border-border",
				)}
			>
				<div className="flex w-full min-w-0 items-start justify-between gap-3 pr-28 text-left">
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
							<span className="inline-flex min-w-0 items-center gap-2">
								<span
									className={cn(
										"truncate text-xs font-medium text-foreground",
										failed && "text-error-foreground",
									)}
									title={errorMessage || undefined}
								>
									{entry.status ? generationStatusLabel(entry.status) : "生成结果"}
								</span>
							</span>
							{timeSummary ? (
								<span className="shrink-0 whitespace-nowrap text-2xs leading-4 text-muted-foreground">
									{timeSummary}
								</span>
							) : null}
						</div>
						<p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
							{entryPromptText(entry) || "无提示词"}
						</p>
					</div>
				</div>
				<HistoryAssetStrip
					assets={generatedAssets}
					kind={kind}
					loading={loading}
					pendingAssetCount={pendingAssetCount}
					selectedAssetKeys={selectedAssetKeys}
					onToggleAsset={onToggleAsset}
				/>
				{onCopyPrompt ? (
					<HistoryIconButton
						ariaLabel="复制这条提示词"
						className="absolute right-[4.25rem] top-3"
						title="复制提示词"
						onClick={onCopyPrompt}
					>
						<Clipboard className="size-3.5" />
					</HistoryIconButton>
				) : null}
				{onUsePrompt ? (
					<HistoryIconButton
						ariaLabel="用此提示词编辑"
						className="absolute right-10 top-3"
						title="用此提示词编辑"
						onClick={onUsePrompt}
					>
						<FileText className="size-3.5" />
					</HistoryIconButton>
				) : null}
				<DeleteEntryButton
					className="absolute right-3 top-3"
					isDeleting={isDeleting}
					onDelete={onDelete}
				/>
				{errorMessage ? <HistoryErrorTooltip message={errorMessage} /> : null}
			</article>
		);
	}

	const thumbnail = generatedAssets[0];
	const source = thumbnail ? generationAssetSource(thumbnail) : "";
	const displayAssetCount = loading
		? Math.max(generatedAssets.length, pendingAssetCount)
		: generatedAssets.length;

	return (
		<article
			className={cn(
				"group/history-item relative min-h-20 min-w-0 max-w-full rounded-sm border bg-card transition-colors",
				selected ? "border-primary" : "border-border hover:border-input",
				failed && !selected && "border-error-border hover:border-error-border",
			)}
		>
			<button
				type="button"
				className="flex w-full min-w-0 items-stretch gap-2 p-2 pr-10 text-left"
				onClick={onSelect}
			>
				<div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-muted-foreground/10">
					{source && thumbnail?.kind === "video" ? (
						<GenerationVideoThumbnail source={source} />
					) : source && thumbnail?.kind === "audio" ? (
						<AudioLines className="size-5 text-muted-foreground" />
					) : source ? (
						<img src={source} alt="" className="size-full object-contain" />
					) : loading ? (
						<Loader2 className="size-4 animate-spin text-muted-foreground" />
					) : (
						<ImageIcon className="size-4 text-muted-foreground" />
					)}
				</div>
				<div className="min-w-0 flex-1 py-0.5">
					<div className="flex min-w-0 items-center gap-2">
						<span className="inline-flex min-w-0 items-center gap-2">
							<span
								className={cn(
									"truncate text-xs font-medium text-foreground",
									failed && "text-error-foreground",
								)}
								title={errorMessage || undefined}
							>
								{entry.status ? generationStatusLabel(entry.status) : "生成结果"}
							</span>
							<span
								className={cn(
									"shrink-0 text-xs text-muted-foreground",
									failed && "text-error-foreground",
								)}
							>
								{displayAssetCount} {historyAssetUnit(kind)}
							</span>
						</span>
						{selection.selectedCount > 0 ? (
							<span className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-primary">
								<Check className="size-3" />
								{historySelectionText(selection)}
							</span>
						) : null}
					</div>
					<p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
						{entryPromptText(entry) || "无提示词"}
					</p>
					{sourceBadge || timeSummary ? (
						<div className="mt-1 flex min-w-0 items-center gap-2">
							{sourceBadge ? (
								<HistorySourceBadge badge={sourceBadge} className="min-w-0 flex-1" />
							) : null}
							{timeSummary ? (
								<span className="ml-auto shrink-0 whitespace-nowrap text-2xs leading-4 text-muted-foreground">
									{timeSummary}
								</span>
							) : null}
						</div>
					) : null}
				</div>
			</button>
			{onCopyPrompt ? (
				<HistoryIconButton
					ariaLabel="复制这条提示词"
					className="absolute right-10 top-2"
					title="复制提示词"
					onClick={onCopyPrompt}
				>
					<Clipboard className="size-3.5" />
				</HistoryIconButton>
			) : null}
			<DeleteEntryButton
				className="absolute right-2 top-2"
				isDeleting={isDeleting}
				onDelete={onDelete}
			/>
			{errorMessage ? <HistoryErrorTooltip message={errorMessage} /> : null}
		</article>
	);
};

const HistoryAssetStrip: React.FC<{
	assets: GenerationAsset[];
	kind: GenerationKind;
	loading: boolean;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	pendingAssetCount: number;
	selectedAssetKeys: string[];
}> = ({ assets, kind, loading, onToggleAsset, pendingAssetCount, selectedAssetKeys }) => {
	const pendingPlaceholderCount = loading ? Math.max(0, pendingAssetCount - assets.length) : 0;

	if (assets.length === 0 && pendingPlaceholderCount === 0) {
		return (
			<div className="mt-3 flex h-24 items-center justify-center rounded-sm border border-dashed border-border bg-muted/50 text-xs text-muted-foreground">
				{kind === "image" ? "暂无图片" : kind === "audio" ? "暂无音频" : "暂无视频"}
			</div>
		);
	}

	return (
		<div className="mt-3 flex gap-2 overflow-x-auto pb-1">
			{assets.map((asset, index) => {
				const source = generationAssetSource(asset);
				const selectionKey = generationAssetSelectionKey(asset);
				const selected = Boolean(selectionKey && selectedAssetKeys.includes(selectionKey));

				return (
					<HistoryAssetThumb
						key={`${asset.kind}:${source}:${index}`}
						asset={asset}
						index={index}
						selectable={Boolean(selectionKey && onToggleAsset)}
						selected={selected}
						source={source}
						onToggleAsset={onToggleAsset}
					/>
				);
			})}
			{Array.from({ length: pendingPlaceholderCount }, (_, index) => (
				<HistoryPendingAssetThumb
					key={`pending:${assets.length + index}`}
					index={assets.length + index}
					kind={kind}
				/>
			))}
		</div>
	);
};

const HistoryPendingAssetThumb: React.FC<{
	index: number;
	kind: GenerationKind;
}> = ({ index, kind }) => (
	<div
		role="img"
		aria-label={`第 ${index + 1} ${historyAssetUnit(kind)}生成中`}
		className="flex h-24 w-32 shrink-0 flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-border bg-muted/50 text-2xs text-muted-foreground"
	>
		<Loader2 className="size-4 animate-spin" />
		<span>生成中</span>
	</div>
);

const HistoryAssetThumb: React.FC<{
	asset: GenerationAsset;
	index: number;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	selectable: boolean;
	selected: boolean;
	source: string;
}> = ({ asset, index, onToggleAsset, selectable, selected, source }) => (
	<button
		type="button"
		role={selectable ? "checkbox" : undefined}
		aria-checked={selectable ? selected : undefined}
		aria-label={selectable ? (selected ? "取消选入结果" : "选入结果") : `历史结果 ${index + 1}`}
		title={selectable ? (selected ? "取消选入结果" : "选入结果") : `历史结果 ${index + 1}`}
		className={cn(
			"relative h-24 w-32 shrink-0 overflow-hidden rounded-sm border bg-muted-foreground/10 transition-colors",
			selected ? "border-primary" : "border-border hover:border-input",
			!selectable && "cursor-default",
		)}
		onClick={(event) => {
			event.stopPropagation();
			if (!selectable || !onToggleAsset) return;
			onToggleAsset(asset, !selected);
		}}
	>
		{asset.kind === "video" ? (
			<GenerationVideoThumbnail source={source} />
		) : asset.kind === "audio" ? (
			<div className="flex size-full flex-col items-center justify-center gap-2 bg-ide-toolbar text-2xs text-muted-foreground">
				<AudioLines className="size-5" />
				<span>音频</span>
			</div>
		) : (
			<img src={source} alt="" className="size-full object-contain" />
		)}
		{selectable ? (
			<span
				className={cn(
					"absolute left-2 top-2 flex size-6 items-center justify-center rounded-sm border shadow-sm ring-1 ring-black/10 transition-colors",
					selected
						? "border-primary bg-primary text-primary-foreground"
						: "border-white/80 bg-background/90 text-transparent hover:bg-background",
				)}
			>
				<Check className={cn("size-3.5", selected ? "opacity-100" : "opacity-0")} />
			</span>
		) : null}
	</button>
);

const HistoryErrorTooltip: React.FC<{ message: string }> = ({ message }) => (
	<span
		role="tooltip"
		className="pointer-events-none absolute left-2 right-2 top-[calc(100%-0.25rem)] z-40 hidden rounded-sm border border-error-border bg-popover px-2.5 py-2 text-left text-xs leading-5 text-error-foreground shadow-lg group-hover/history-item:block group-focus-within/history-item:block"
	>
		<span className="line-clamp-6 whitespace-pre-wrap">{message}</span>
	</span>
);

const entryErrorText = (entry: GenerationEntry) =>
	entry.error?.trim() || entry.content.trim() || "生成失败，暂无错误详情。";

interface GenerationSourceBadge {
	label: string;
}

const HistorySourceBadge: React.FC<{ badge: GenerationSourceBadge; className?: string }> = ({
	badge,
	className,
}) => {
	return (
		<span
			className={cn(
				"inline-flex max-w-full items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium",
				"border-border bg-ide-toolbar text-muted-foreground",
				className,
			)}
			title={badge.label}
		>
			<FileText className="size-3 shrink-0" />
			<span className="truncate">{badge.label}</span>
		</span>
	);
};

const generationSourceBadge = (defaultSourceLabel?: string): GenerationSourceBadge | null => {
	if (defaultSourceLabel) return { label: defaultSourceLabel };

	return null;
};

const generationTimeSummary = (entry: GenerationEntry, running: boolean) => {
	const timeText = formatGenerationTime(entry.createdAt);
	if (!timeText) return "";

	const durationMs = generationDurationMs(entry, running);
	if (durationMs === null) return `生成 ${timeText}`;

	return `生成 ${timeText} · ${running ? "已用" : "用时"} ${formatGenerationDuration(durationMs)}`;
};

const generationDurationMs = (entry: GenerationEntry, running: boolean) => {
	if (typeof entry.durationMs === "number" && entry.durationMs >= 0) return entry.durationMs;
	if (!running || !entry.createdAt) return null;

	const startedAt = Date.parse(entry.createdAt);
	if (Number.isNaN(startedAt)) return null;

	return Math.max(0, Date.now() - startedAt);
};

const pendingAssetCountMax = 10;

const pendingGenerationAssetCount = (
	entry: GenerationEntry,
	kind: GenerationKind,
	loading: boolean,
) => {
	if (!loading) return 0;
	if (kind !== "image") return 1;

	return requestGenerationCount(entry.requestDetails ?? []);
};

const historyAssetUnit = (kind: GenerationKind) =>
	kind === "image" ? "张" : kind === "audio" ? "段" : "个";

const requestGenerationCount = (details: Array<{ label: string; value: string }>) => {
	const countDetail = details.find((detail) => isCountDetailLabel(detail.label));
	const count = countFromDetailValue(countDetail?.value);

	return count ?? 1;
};

const isCountDetailLabel = (label: string) => {
	const normalizedLabel = label.trim().toLowerCase();

	return (
		normalizedLabel === "n" ||
		normalizedLabel === "images" ||
		normalizedLabel === "图像数量" ||
		normalizedLabel === "图片数量" ||
		normalizedLabel === "生成数量" ||
		normalizedLabel === "数量"
	);
};

const countFromDetailValue = (value?: string) => {
	const match = value?.match(/\d+(?:\.\d+)?/u);
	if (!match?.[0]) return null;

	const count = Number(match[0]);
	if (!Number.isFinite(count)) return null;

	return Math.max(1, Math.min(pendingAssetCountMax, Math.round(count)));
};

const formatGenerationTime = (value?: string) => {
	if (!value) return "";

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";

	const now = new Date();
	const sameDate =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	const options: Intl.DateTimeFormatOptions = sameDate
		? { hour: "2-digit", minute: "2-digit", hour12: false }
		: {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
			};

	return new Intl.DateTimeFormat("zh-CN", options).format(date);
};

const formatGenerationDuration = (valueMs: number) => {
	if (!Number.isFinite(valueMs) || valueMs < 1000) return "1 秒";

	const totalSeconds = Math.round(valueMs / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `${seconds} 秒`;

	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	if (hours === 0) return `${minutes} 分 ${seconds} 秒`;

	return `${hours} 小时 ${remainingMinutes} 分`;
};

const DeleteEntryButton: React.FC<{
	className?: string;
	isDeleting: boolean;
	onDelete: () => void;
}> = ({ className, isDeleting, onDelete }) => (
	<HistoryIconButton
		ariaLabel="删除这条生成记录"
		className={className}
		disabled={isDeleting}
		title="删除生成记录"
		onClick={onDelete}
	>
		{isDeleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
	</HistoryIconButton>
);

const HistoryIconButton: React.FC<{
	ariaLabel: string;
	children: React.ReactNode;
	className?: string;
	disabled?: boolean;
	onClick: () => void;
	title: string;
}> = ({ ariaLabel, children, className, disabled, onClick, title }) => (
	<Button
		type="button"
		variant="ghost"
		size="icon"
		disabled={disabled}
		className={cn(
			"size-7 rounded-sm border border-input bg-card/90 text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground",
			className,
		)}
		aria-label={ariaLabel}
		title={title}
		onClick={(event) => {
			event.stopPropagation();
			onClick();
		}}
	>
		{children}
	</Button>
);
