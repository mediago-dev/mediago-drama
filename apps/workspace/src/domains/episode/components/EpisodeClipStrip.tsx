import { Download, Loader2, Pause, Play, Sparkles } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GenerationVideoThumbnail } from "@/domains/generation/components/GenerationVideoThumbnail";
import {
	buildEpisodeVideoClipPlaybackRanges,
	episodeClipPosterUrl,
	episodeClipPlaybackDuration,
	findEpisodeClipPlaybackRangeAtTime,
	isEpisodeVideoClipPlayable,
	type EpisodeClipMediaMetadata,
} from "@/domains/episode/lib/media-assets";
import {
	formatTimelineTime,
	type Episode,
	type TimelineClip,
	type TimelineClipStatus,
} from "@/domains/episode/lib/sample";
import type { TimelineZoom } from "@/domains/episode/stores";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

interface EpisodeClipStripProps {
	clipMedia?: Record<string, EpisodeClipMediaMetadata>;
	currentTime: number;
	downloadingClipIds?: string[];
	episode: Episode;
	isPlaying: boolean;
	selectedClipId: string;
	timelineDuration?: number;
	zoom: TimelineZoom;
	onDownloadClip?: (clip: TimelineClip) => void;
	onGenerateClip: (clipId: string) => void;
	onSeek: (time: number) => void;
	onSelectClip: (clipId: string) => void;
	onTogglePlayback: () => void;
}

interface EpisodeClipCardProps {
	clip: TimelineClip;
	duration: number | null;
	index: number;
	isActive: boolean;
	isSelected: boolean;
	posterUrl?: string;
	width: number;
	onActivate: (clip: TimelineClip) => void;
	onOpenContextMenu: (clip: TimelineClip, position: ClipContextMenuPosition) => void;
	onGenerate: (clipId: string) => void;
}

interface ClipContextMenuPosition {
	x: number;
	y: number;
}

interface ClipContextMenuState extends ClipContextMenuPosition {
	clip: TimelineClip;
}

const stripHeight = 184;
const menuViewportGap = 8;

const clipCardWidth: Record<TimelineZoom, number> = {
	fit: 176,
	"50": 148,
	"100": 176,
	"150": 220,
};

export const EpisodeClipStrip: React.FC<EpisodeClipStripProps> = ({
	clipMedia,
	currentTime,
	downloadingClipIds = [],
	episode,
	isPlaying,
	selectedClipId,
	timelineDuration,
	zoom,
	onDownloadClip,
	onGenerateClip,
	onSeek,
	onSelectClip,
	onTogglePlayback,
}) => {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const [contextMenu, setContextMenu] = useState<ClipContextMenuState | null>(null);
	const clipPlaybackRanges = useMemo(
		() => buildEpisodeVideoClipPlaybackRanges(episode, clipMedia),
		[clipMedia, episode],
	);
	const videoClips = useMemo(
		() => clipPlaybackRanges.map((range) => range.clip),
		[clipPlaybackRanges],
	);
	const clipPlaybackRangeById = useMemo(
		() => new Map(clipPlaybackRanges.map((range) => [range.clip.id, range])),
		[clipPlaybackRanges],
	);
	const activeClip =
		findEpisodeClipPlaybackRangeAtTime(clipPlaybackRanges, currentTime)?.clip ??
		videoClips.find((clip) => clip.id === selectedClipId) ??
		null;
	const cardWidth = clipCardWidth[zoom];
	const downloadingClipIdSet = useMemo(() => new Set(downloadingClipIds), [downloadingClipIds]);
	const displayDuration =
		typeof timelineDuration === "number" && timelineDuration >= 0
			? timelineDuration
			: episode.duration;
	const progress =
		displayDuration > 0 ? Math.min(Math.max(currentTime / displayDuration, 0), 1) : 0;

	useEffect(() => {
		if (!isPlaying || !activeClip || !scrollRef.current) return;
		const element = scrollRef.current.querySelector<HTMLElement>(
			`[data-clip-id="${CSS.escape(activeClip.id)}"]`,
		);
		element?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" });
	}, [activeClip, isPlaying]);

	const handleProgressPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
		onSeek(ratio * displayDuration);
	};

	const handleActivateClip = (clip: TimelineClip) => {
		const range = clipPlaybackRangeById.get(clip.id);
		const seekTime = range && (range.duration > 0 || range.start > 0) ? range.start : clip.start;
		onSeek(seekTime);
		onSelectClip(clip.id);
	};
	const closeContextMenu = useCallback(() => setContextMenu(null), []);
	const handleOpenContextMenu = useCallback(
		(clip: TimelineClip, position: ClipContextMenuPosition) => {
			onSelectClip(clip.id);
			setContextMenu({ clip, ...position });
		},
		[onSelectClip],
	);

	return (
		<section
			className="shrink-0 border-t border-border bg-ide-preview px-3 py-2"
			data-testid="episode-timeline-editor"
			style={{ height: stripHeight }}
		>
			<div
				className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-ide-panel shadow-sm"
				data-testid="episode-clip-strip"
			>
				<div className="flex h-11 shrink-0 items-center gap-3 px-4">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-7 rounded-sm text-foreground"
						aria-label={isPlaying ? "暂停片段条" : "播放片段条"}
						onClick={onTogglePlayback}
					>
						{isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
					</Button>
					<div className="flex shrink-0 items-center gap-1.5 text-sm font-medium tabular-nums text-foreground">
						<span>{formatTimelineTime(currentTime)}</span>
						<span className="text-muted-foreground">/</span>
						<span className="text-muted-foreground">{formatTimelineTime(displayDuration)}</span>
					</div>
					<div
						className="relative h-1.5 min-w-24 flex-1 cursor-pointer overflow-hidden rounded-full bg-muted"
						data-testid="clip-strip-progress"
						onPointerDown={handleProgressPointerDown}
						role="slider"
						aria-label="剧集播放进度"
						aria-valuemin={0}
						aria-valuemax={displayDuration}
						aria-valuenow={currentTime}
						tabIndex={0}
					>
						<div
							className="h-full rounded-full bg-primary"
							style={{ width: `${progress * 100}%` }}
						/>
					</div>
				</div>

				<div ref={scrollRef} className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-4 pb-4">
					<div className="flex h-full min-w-max items-start gap-3">
						{videoClips.map((clip, index) => (
							<EpisodeClipCard
								key={clip.id}
								clip={clip}
								duration={
									isEpisodeVideoClipPlayable(clip)
										? (clipPlaybackRangeById.get(clip.id)?.duration ??
											episodeClipPlaybackDuration(clip, clipMedia))
										: null
								}
								index={index}
								isActive={clip.id === activeClip?.id}
								isSelected={clip.id === selectedClipId}
								posterUrl={clipMedia?.[clip.id]?.posterUrl}
								width={cardWidth}
								onActivate={handleActivateClip}
								onOpenContextMenu={handleOpenContextMenu}
								onGenerate={onGenerateClip}
							/>
						))}
					</div>
				</div>
				{contextMenu ? (
					<EpisodeClipContextMenu
						clip={contextMenu.clip}
						isDownloading={downloadingClipIdSet.has(contextMenu.clip.id)}
						onClose={closeContextMenu}
						onDownloadClip={onDownloadClip}
						position={{ x: contextMenu.x, y: contextMenu.y }}
					/>
				) : null}
			</div>
		</section>
	);
};

const EpisodeClipCard: React.FC<EpisodeClipCardProps> = ({
	clip,
	duration,
	index,
	isActive,
	isSelected,
	posterUrl,
	width,
	onActivate,
	onOpenContextMenu,
	onGenerate,
}) => {
	const previewMedia = getClipPreviewMedia(clip, posterUrl);
	const hasVideo = Boolean(previewMedia.videoUrl);
	const effectiveStatus = effectiveClipStatus(clip, hasVideo);
	const statusMeta = clipStatusMeta[effectiveStatus];
	const isGenerating = effectiveStatus === "generating";
	const durationLabel = duration !== null ? formatTimelineTime(duration) : "";

	return (
		<div
			className={cn(
				"group relative flex h-[6.25rem] shrink-0 overflow-hidden rounded-lg border bg-muted text-left shadow-sm transition-[border-color,box-shadow,transform] focus-within:border-primary focus-within:shadow-md",
				isSelected
					? "border-2 border-primary shadow-md"
					: "border-border hover:border-primary/60 hover:shadow-md",
				isActive && !isSelected && "shadow-md",
			)}
			data-clip-id={clip.id}
			data-testid={`clip-strip-card-${clip.id}`}
			onContextMenu={(event) => {
				event.preventDefault();
				onOpenContextMenu(clip, { x: event.clientX, y: event.clientY });
			}}
			style={{ width }}
			title={clip.title}
		>
			<button
				type="button"
				className="absolute inset-0 z-10 cursor-pointer rounded-lg text-left outline-none"
				onClick={() => onActivate(clip)}
				aria-label={`定位到 ${clip.title}`}
				aria-current={isActive ? "true" : undefined}
			/>
			<div className="pointer-events-none absolute inset-0">
				{previewMedia.posterUrl ? (
					<img
						src={previewMedia.posterUrl}
						alt=""
						className="size-full object-cover"
						draggable={false}
					/>
				) : previewMedia.videoUrl ? (
					<GenerationVideoThumbnail source={previewMedia.videoUrl} />
				) : (
					<div className="size-full bg-[linear-gradient(135deg,var(--accent)_0%,var(--muted)_48%,var(--ide-panel)_100%)]" />
				)}
				<div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/18 to-black/8" />
			</div>
			<div
				className={cn("pointer-events-none absolute inset-x-0 top-0 h-1", statusMeta.railClassName)}
				data-testid={`clip-strip-card-status-rail-${clip.id}`}
			/>
			<span className="pointer-events-none absolute left-2 top-2 grid size-5 place-items-center rounded-full bg-black/75 text-[11px] font-semibold text-white">
				{index + 1}
			</span>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="absolute right-2 top-2 z-20 h-7 cursor-pointer rounded-md border border-primary/40 bg-primary px-2 text-[11px] font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/80 focus-visible:ring-primary/40"
				aria-label={`生成 ${clip.title}`}
				onClick={(event) => {
					event.stopPropagation();
					onGenerate(clip.id);
				}}
			>
				{isGenerating ? (
					<Loader2 className="size-3 animate-spin" />
				) : (
					<Sparkles className="size-3" />
				)}
				<span>生成</span>
			</Button>
			{durationLabel ? (
				<span className="pointer-events-none absolute bottom-2 right-2 rounded-sm bg-black/70 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white">
					{durationLabel}
				</span>
			) : null}
		</div>
	);
};

const EpisodeClipContextMenu: React.FC<{
	clip: TimelineClip;
	isDownloading: boolean;
	onClose: () => void;
	onDownloadClip?: (clip: TimelineClip) => void;
	position: ClipContextMenuPosition;
}> = ({ clip, isDownloading, onClose, onDownloadClip, position }) => {
	const menuRef = useRef<HTMLDivElement>(null);
	const [menuPosition, setMenuPosition] = useState(position);
	const hasVideo = Boolean(clip.videoUrl?.trim());
	const canDownload = Boolean(onDownloadClip && hasVideo && !isDownloading);

	useLayoutEffect(() => {
		setMenuPosition(position);
		if (typeof window === "undefined") return;
		const menu = menuRef.current;
		if (!menu) return;

		const rect = menu.getBoundingClientRect();
		setMenuPosition({
			x: Math.max(
				menuViewportGap,
				Math.min(position.x, window.innerWidth - rect.width - menuViewportGap),
			),
			y: Math.max(
				menuViewportGap,
				Math.min(position.y, window.innerHeight - rect.height - menuViewportGap),
			),
		});
	}, [position]);

	useEffect(() => {
		const closeOnOutsidePointer = (event: PointerEvent) => {
			if (menuRef.current?.contains(event.target as Node)) return;
			onClose();
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};

		window.document.addEventListener("pointerdown", closeOnOutsidePointer);
		window.document.addEventListener("keydown", closeOnEscape);
		return () => {
			window.document.removeEventListener("pointerdown", closeOnOutsidePointer);
			window.document.removeEventListener("keydown", closeOnEscape);
		};
	}, [onClose]);

	const label = isDownloading ? "正在保存视频" : "下载当前视频";
	const menu = (
		<div
			ref={menuRef}
			role="menu"
			aria-label={`${clip.title} 分镜菜单`}
			className="fixed z-50 min-w-36 rounded-sm border border-border bg-popover p-1 text-popover-foreground shadow-lg"
			style={{ left: menuPosition.x, top: menuPosition.y }}
		>
			<button
				type="button"
				role="menuitem"
				disabled={!canDownload}
				aria-label={label}
				title={hasVideo ? label : "当前分镜还没有生成视频"}
				className={cn(
					"flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-xs transition-colors focus-visible:outline-none",
					canDownload
						? "hover:bg-ide-list-hover focus-visible:bg-ide-list-hover"
						: "cursor-not-allowed opacity-50",
				)}
				onClick={() => {
					if (!canDownload) return;
					onClose();
					onDownloadClip?.(clip);
				}}
			>
				{isDownloading ? (
					<Loader2 className="size-3.5 shrink-0 animate-spin" />
				) : (
					<Download className="size-3.5 shrink-0" />
				)}
				<span className="min-w-0 flex-1 truncate">{label}</span>
			</button>
		</div>
	);

	if (typeof document === "undefined") return menu;
	return createPortal(menu, document.body);
};

const getClipPreviewMedia = (clip: TimelineClip, posterUrl?: string) => ({
	posterUrl: stringValue(posterUrl) ?? episodeClipPosterUrl(clip),
	videoUrl: stringValue(clip.videoUrl),
});

const stringValue = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

const effectiveClipStatus = (clip: TimelineClip, hasVideo: boolean): TimelineClipStatus => {
	if (clip.status === "ready" && !hasVideo) return "draft";
	if (hasVideo && clip.status !== "generating" && clip.status !== "error") return "ready";
	return clip.status;
};

const clipStatusMeta: Record<
	TimelineClipStatus,
	{
		railClassName: string;
	}
> = {
	draft: {
		railClassName: "bg-warning-foreground",
	},
	generating: {
		railClassName: "bg-info-foreground",
	},
	ready: {
		railClassName: "bg-success-foreground",
	},
	error: {
		railClassName: "bg-error-foreground",
	},
};
