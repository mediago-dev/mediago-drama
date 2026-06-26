import { AudioLines, Check, Loader2, Save, Sparkles } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioPlayer } from "@/components/AudioPlayer";
import { VideoPlayer } from "@/components/VideoPlayer";
import type { GenerationAsset, GenerationKind } from "@/domains/generation/api/generation";
import {
	GenerationImagePreviewSlider,
	type GenerationImagePreviewItem,
} from "@/domains/generation/components/GenerationImagePreviewSlider";
import { entryGeneratedAssets } from "@/domains/generation/components/mediaGenerationHelpers";
import {
	generationAssetPosterSource,
	generationAssetSelectionKey,
	generationAssetSource,
	type GenerationEntry,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { generatedAssetSaveKey } from "@/domains/generation/components/generatedResultActions";

export const GenerationResultGallery: React.FC<{
	emptyText: string;
	entries: GenerationEntry[];
	kind: GenerationKind;
	onSaveAsset?: (entry: GenerationEntry, asset: GenerationAsset) => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	onUseAssetAsReference?: (asset: GenerationAsset) => void;
	savedAssetKeys?: string[];
	selectedAssetKeys: string[];
	savingAssetKeys?: string[];
}> = ({
	emptyText,
	entries,
	kind,
	onSaveAsset,
	onToggleAsset,
	onUseAssetAsReference,
	savedAssetKeys = [],
	selectedAssetKeys,
	savingAssetKeys = [],
}) => {
	const [previewIndex, setPreviewIndex] = useState<number | null>(null);
	const previewImages = useMemo(
		() => generationResultPreviewImages(entries, kind),
		[entries, kind],
	);
	const openImagePreview = useCallback(
		(asset: GenerationAsset) => {
			const selectionKey = generationAssetSelectionKey(asset);
			const source = generationAssetSource(asset);
			const index = previewImages.findIndex(
				(image) =>
					image.asset === asset ||
					(Boolean(selectionKey) && generationAssetSelectionKey(image.asset) === selectionKey) ||
					(Boolean(source) && image.src === source),
			);
			if (index >= 0) setPreviewIndex(index);
		},
		[previewImages],
	);

	if (entries.length === 0) {
		return (
			<div className="flex h-full min-h-0 w-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
				{emptyText}
			</div>
		);
	}

	return (
		<>
			<div className="flex h-full min-h-0 w-full items-center justify-center gap-4 overflow-x-auto">
				{entries.map((entry) => (
					<GenerationResultEntry
						key={entry.id}
						entry={entry}
						kind={kind}
						selectedAssetKeys={selectedAssetKeys}
						onSaveAsset={onSaveAsset}
						onPreviewImage={openImagePreview}
						onToggleAsset={onToggleAsset}
						onUseAssetAsReference={onUseAssetAsReference}
						savedAssetKeys={savedAssetKeys}
						savingAssetKeys={savingAssetKeys}
					/>
				))}
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

const GenerationResultEntry: React.FC<{
	entry: GenerationEntry;
	kind: GenerationKind;
	onPreviewImage: (asset: GenerationAsset) => void;
	onSaveAsset?: (entry: GenerationEntry, asset: GenerationAsset) => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	onUseAssetAsReference?: (asset: GenerationAsset) => void;
	savedAssetKeys: string[];
	selectedAssetKeys: string[];
	savingAssetKeys: string[];
}> = ({
	entry,
	kind,
	onPreviewImage,
	onSaveAsset,
	onToggleAsset,
	onUseAssetAsReference,
	savedAssetKeys,
	selectedAssetKeys,
	savingAssetKeys,
}) => {
	const generatedAssets = entryGeneratedAssets(entry, kind);
	const loading = entry.status === "loading";

	if (generatedAssets.length === 0) {
		return (
			<article className="flex h-full min-w-0 items-center justify-center">
				<div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
					{loading ? (
						<span className="flex items-center gap-2">
							<Loader2 className="size-4 animate-spin" />
							生成中
						</span>
					) : kind === "image" ? (
						"暂无图片"
					) : kind === "audio" ? (
						"暂无音频"
					) : (
						"暂无视频"
					)}
				</div>
			</article>
		);
	}

	return (
		<>
			{generatedAssets.map((asset, index) => {
				const source = generationAssetSource(asset);
				const selectionKey = generationAssetSelectionKey(asset);
				const selected = Boolean(selectionKey && selectedAssetKeys.includes(selectionKey));

				if (asset.kind === "video") {
					return (
						<GenerationVideoResultAsset
							key={`${entry.id}:${source}:${index}`}
							asset={asset}
							entry={entry}
							selectable={Boolean(selectionKey && onToggleAsset)}
							selected={selected}
							saved={savedAssetKeys.includes(generatedAssetSaveKey(entry, asset))}
							saving={savingAssetKeys.includes(generatedAssetSaveKey(entry, asset))}
							source={source}
							onSaveAsset={onSaveAsset}
							onToggleAsset={onToggleAsset}
						/>
					);
				}

				if (asset.kind === "audio") {
					return (
						<GenerationAudioResultAsset
							key={`${entry.id}:${source}:${index}`}
							asset={asset}
							entry={entry}
							selectable={Boolean(selectionKey && onToggleAsset)}
							selected={selected}
							saved={savedAssetKeys.includes(generatedAssetSaveKey(entry, asset))}
							saving={savingAssetKeys.includes(generatedAssetSaveKey(entry, asset))}
							source={source}
							onSaveAsset={onSaveAsset}
							onToggleAsset={onToggleAsset}
						/>
					);
				}

				return (
					<GenerationImageResultAsset
						key={`${entry.id}:${source}:${index}`}
						asset={asset}
						entry={entry}
						selectable={Boolean(selectionKey && onToggleAsset)}
						selected={selected}
						saved={savedAssetKeys.includes(generatedAssetSaveKey(entry, asset))}
						saving={savingAssetKeys.includes(generatedAssetSaveKey(entry, asset))}
						source={source}
						onPreviewImage={onPreviewImage}
						onSaveAsset={onSaveAsset}
						onToggleAsset={onToggleAsset}
						onUseAssetAsReference={onUseAssetAsReference}
					/>
				);
			})}
		</>
	);
};

const selectionCheckboxInset = 8;

const GenerationVideoResultAsset: React.FC<{
	asset: GenerationAsset;
	entry: GenerationEntry;
	onSaveAsset?: (entry: GenerationEntry, asset: GenerationAsset) => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	selectable: boolean;
	selected: boolean;
	saved: boolean;
	saving: boolean;
	source: string;
}> = ({
	asset,
	entry,
	onSaveAsset,
	onToggleAsset,
	selectable,
	selected,
	saved,
	saving,
	source,
}) => (
	<article className="flex h-full min-w-0 max-w-full items-center justify-center bg-transparent">
		<div
			className={cn(
				"relative aspect-video h-full max-h-full max-w-full overflow-hidden rounded-sm border bg-ide-toolbar",
				selected ? "border-primary" : "border-border",
			)}
		>
			<VideoPlayer
				src={source}
				mimeType={asset.mimeType || "video/mp4"}
				poster={generationAssetPosterSource(asset)}
				showTitleInControls={false}
				className="h-full w-full"
			/>
			{onSaveAsset ? (
				<SaveGeneratedAssetButton
					className="absolute right-2 top-2 z-10"
					saved={saved}
					saving={saving}
					onSave={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onSaveAsset(entry, asset);
					}}
				/>
			) : null}
			{selectable && onToggleAsset ? (
				<button
					type="button"
					role="checkbox"
					aria-checked={selected}
					aria-label={selected ? "取消选入视频" : "选入视频"}
					title={selected ? "取消选入视频" : "选入视频"}
					className={cn(
						"absolute left-2 top-2 z-10 flex size-7 items-center justify-center rounded-sm border shadow-sm ring-1 ring-black/10 transition-colors",
						selected
							? "border-primary bg-primary text-primary-foreground"
							: "border-white/80 bg-background/90 text-transparent hover:bg-background",
					)}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onToggleAsset(asset, !selected);
					}}
				>
					<Check className={cn("size-4", selected ? "opacity-100" : "opacity-0")} />
				</button>
			) : null}
		</div>
	</article>
);

const GenerationAudioResultAsset: React.FC<{
	asset: GenerationAsset;
	entry: GenerationEntry;
	onSaveAsset?: (entry: GenerationEntry, asset: GenerationAsset) => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	selectable: boolean;
	selected: boolean;
	saved: boolean;
	saving: boolean;
	source: string;
}> = ({
	asset,
	entry,
	onSaveAsset,
	onToggleAsset,
	selectable,
	selected,
	saved,
	saving,
	source,
}) => (
	<article className="flex h-full min-w-0 max-w-full items-center justify-center bg-transparent">
		<div
			className={cn(
				"relative flex w-[min(34rem,78vw)] max-w-full flex-col gap-3 rounded-sm border bg-ide-panel p-4 shadow-sm",
				selected ? "border-primary" : "border-border",
			)}
		>
			<div className="flex min-w-0 items-center gap-3 pr-10">
				<span className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-border bg-ide-toolbar text-muted-foreground">
					<AudioLines className="size-4" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium text-foreground">生成音频</p>
					<p className="truncate text-xs text-muted-foreground">{asset.mimeType || "audio/mpeg"}</p>
				</div>
			</div>
			<AudioPlayer src={source} mimeType={asset.mimeType || "audio/mpeg"} title="生成音频" />
			{onSaveAsset ? (
				<SaveGeneratedAssetButton
					className="absolute right-2 top-2 z-10"
					saved={saved}
					saving={saving}
					onSave={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onSaveAsset(entry, asset);
					}}
				/>
			) : null}
			{selectable && onToggleAsset ? (
				<button
					type="button"
					role="checkbox"
					aria-checked={selected}
					aria-label={selected ? "取消选入音频" : "选入音频"}
					title={selected ? "取消选入音频" : "选入音频"}
					className={cn(
						"absolute left-2 top-2 z-10 flex size-5 items-center justify-center rounded-sm border shadow-sm transition-colors",
						selected
							? "border-primary bg-primary text-primary-foreground"
							: "border-border bg-card/90 text-transparent hover:bg-muted",
					)}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onToggleAsset(asset, !selected);
					}}
				>
					<Check className={cn("size-3", selected ? "opacity-100" : "opacity-0")} />
				</button>
			) : null}
		</div>
	</article>
);

const GenerationImageResultAsset: React.FC<{
	asset: GenerationAsset;
	entry: GenerationEntry;
	onPreviewImage: (asset: GenerationAsset) => void;
	onSaveAsset?: (entry: GenerationEntry, asset: GenerationAsset) => void;
	onToggleAsset?: (asset: GenerationAsset, selected: boolean) => void;
	onUseAssetAsReference?: (asset: GenerationAsset) => void;
	selectable: boolean;
	selected: boolean;
	saved: boolean;
	saving: boolean;
	source: string;
}> = ({
	asset,
	entry,
	onPreviewImage,
	onSaveAsset,
	onToggleAsset,
	onUseAssetAsReference,
	selectable,
	selected,
	saved,
	saving,
	source,
}) => {
	const frameRef = useRef<HTMLElement | null>(null);
	const imageRef = useRef<HTMLImageElement | null>(null);
	const [checkboxOffset, setCheckboxOffset] = useState({
		bottom: selectionCheckboxInset,
		right: selectionCheckboxInset,
		top: selectionCheckboxInset,
	});
	const canUseAssetAsReference = Boolean(onUseAssetAsReference) && source.trim().length > 0;

	const updateCheckboxOffset = useCallback(() => {
		const frame = frameRef.current;
		const image = imageRef.current;
		if (!frame || !image) return;

		const frameRect = frame.getBoundingClientRect();
		const imageRect = image.getBoundingClientRect();
		let visibleTop = imageRect.top;
		let visibleRight = imageRect.right;
		let visibleBottom = imageRect.bottom;

		if (
			image.naturalWidth > 0 &&
			image.naturalHeight > 0 &&
			imageRect.width > 0 &&
			imageRect.height > 0
		) {
			const naturalRatio = image.naturalWidth / image.naturalHeight;
			const boxRatio = imageRect.width / imageRect.height;

			if (boxRatio > naturalRatio) {
				const visibleWidth = imageRect.height * naturalRatio;
				visibleRight = imageRect.left + (imageRect.width + visibleWidth) / 2;
			} else {
				const visibleHeight = imageRect.width / naturalRatio;
				visibleTop = imageRect.top + (imageRect.height - visibleHeight) / 2;
				visibleBottom = imageRect.top + (imageRect.height + visibleHeight) / 2;
			}
		}

		const nextOffset = {
			bottom: Math.max(
				selectionCheckboxInset,
				Math.round(frameRect.bottom - visibleBottom + selectionCheckboxInset),
			),
			right: Math.max(
				selectionCheckboxInset,
				Math.round(frameRect.right - visibleRight + selectionCheckboxInset),
			),
			top: Math.max(
				selectionCheckboxInset,
				Math.round(visibleTop - frameRect.top + selectionCheckboxInset),
			),
		};

		setCheckboxOffset((current) =>
			current.bottom === nextOffset.bottom &&
			current.right === nextOffset.right &&
			current.top === nextOffset.top
				? current
				: nextOffset,
		);
	}, []);

	useEffect(() => {
		const frame = frameRef.current;
		const image = imageRef.current;
		const animationFrame = window.requestAnimationFrame(updateCheckboxOffset);
		const resizeObserver =
			typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateCheckboxOffset);

		if (frame) resizeObserver?.observe(frame);
		if (image) resizeObserver?.observe(image);
		window.addEventListener("resize", updateCheckboxOffset);

		return () => {
			window.cancelAnimationFrame(animationFrame);
			resizeObserver?.disconnect();
			window.removeEventListener("resize", updateCheckboxOffset);
		};
	}, [source, updateCheckboxOffset]);

	return (
		<article
			ref={frameRef}
			className="relative flex h-full min-w-0 max-w-full items-center justify-center bg-transparent"
		>
			<button
				type="button"
				className="flex h-full min-w-0 max-w-full cursor-zoom-in items-center justify-center rounded-sm bg-muted-foreground/10"
				aria-label="预览生成图片"
				onClick={() => onPreviewImage(asset)}
			>
				<img
					ref={imageRef}
					src={source}
					alt=""
					className="h-full w-auto max-w-full object-contain"
					onLoad={updateCheckboxOffset}
				/>
			</button>
			{onSaveAsset ? (
				<SaveGeneratedAssetButton
					className="absolute z-10"
					saved={saved}
					saving={saving}
					style={{ top: checkboxOffset.top, left: selectionCheckboxInset }}
					onSave={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onSaveAsset(entry, asset);
					}}
				/>
			) : null}
			{canUseAssetAsReference ? (
				<div
					className="absolute z-20"
					style={{ top: checkboxOffset.top, right: checkboxOffset.right }}
				>
					<Button
						type="button"
						variant="secondary"
						size="icon"
						aria-label="用作参考图"
						title="用作参考图"
						className="size-7 rounded-sm border-border bg-card/90 text-foreground shadow-sm hover:bg-card [&_svg]:size-3.5"
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							onUseAssetAsReference?.(asset);
						}}
					>
						<Sparkles />
					</Button>
				</div>
			) : null}
			{selectable && onToggleAsset ? (
				<button
					type="button"
					role="checkbox"
					aria-checked={selected}
					aria-label={selected ? "取消选入图片" : "选入图片"}
					className={cn(
						"absolute z-10 flex size-5 items-center justify-center rounded-sm border shadow-sm transition-colors",
						selected
							? "border-primary bg-primary text-primary-foreground"
							: "border-border bg-card/90 text-transparent hover:bg-muted",
					)}
					style={{ bottom: checkboxOffset.bottom, right: checkboxOffset.right }}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onToggleAsset(asset, !selected);
					}}
				>
					<Check className={cn("size-3", selected ? "opacity-100" : "opacity-0")} />
				</button>
			) : null}
		</article>
	);
};

const generationResultPreviewImages = (
	entries: GenerationEntry[],
	kind: GenerationKind,
): GenerationImagePreviewItem[] => {
	if (kind !== "image") return [];

	return entries.flatMap((entry) =>
		entryGeneratedAssets(entry, "image").flatMap((asset, index) => {
			const source = generationAssetSource(asset);
			if (!source) return [];

			return [
				{
					asset,
					key: `${entry.id}:${generationAssetSelectionKey(asset) ?? source}:${index}`,
					src: source,
				},
			];
		}),
	);
};

const SaveGeneratedAssetButton: React.FC<{
	className?: string;
	onSave: (event: React.MouseEvent<HTMLButtonElement>) => void;
	saved: boolean;
	saving: boolean;
	style?: React.CSSProperties;
}> = ({ className, onSave, saved, saving, style }) => (
	<Button
		type="button"
		variant="secondary"
		size="icon"
		disabled={saving || saved}
		aria-label={saved ? "素材已保存" : saving ? "正在保存素材" : "保存素材"}
		title={saved ? "素材已保存" : "保存素材"}
		className={cn(
			"size-7 rounded-sm border-border bg-card/90 text-foreground shadow-sm hover:bg-card disabled:opacity-100 [&_svg]:size-3.5",
			saved && "text-success-foreground",
			className,
		)}
		style={style}
		onClick={onSave}
	>
		{saving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : <Save />}
	</Button>
);
