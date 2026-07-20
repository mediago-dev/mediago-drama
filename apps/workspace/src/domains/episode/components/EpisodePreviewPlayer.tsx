import type { MediaPlayerInstance } from "@vidstack/react";
import { Film, Play, Sparkles } from "lucide-react";
import type React from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { useEpisodeStore } from "@/domains/episode/stores";
import { apiResourceURL } from "@/shared/lib/api-base";

interface EpisodePreviewPlayerProps {
	currentTime?: number;
	isPlaying?: boolean;
	onEnded?: () => void;
	onPlayingChange?: (playing: boolean) => void;
	onPlaybackError?: (message: string) => void;
	onTimeUpdate?: (currentTime: number) => void;
	playerRef?: React.Ref<MediaPlayerInstance>;
	videoUrl?: string;
	posterUrl?: string;
	title?: string;
}

export const EpisodePreviewPlayer: React.FC<EpisodePreviewPlayerProps> = ({
	currentTime,
	isPlaying,
	onEnded,
	onPlayingChange,
	onPlaybackError,
	onTimeUpdate,
	playerRef,
	videoUrl,
	posterUrl,
	title,
}) => {
	const storeCurrentTime = useEpisodeStore((state) => state.currentTime);
	const storeIsPlaying = useEpisodeStore((state) => state.isPlaying);
	const setCurrentTime = useEpisodeStore((state) => state.setCurrentTime);
	const play = useEpisodeStore((state) => state.play);
	const pause = useEpisodeStore((state) => state.pause);
	const playbackTime = currentTime ?? storeCurrentTime;
	const playbackPlaying = isPlaying ?? storeIsPlaying;
	const handleTimeUpdate = onTimeUpdate ?? setCurrentTime;
	const handlePlayingChange =
		onPlayingChange ?? ((playing: boolean) => (playing ? play() : pause()));
	const playerVideoUrl = videoUrl ? apiResourceURL(videoUrl) : "";
	const playerPosterUrl = posterUrl ? apiResourceURL(posterUrl) : "";
	const showPosterOverlay = Boolean(
		playerVideoUrl && playerPosterUrl && !playbackPlaying && playbackTime <= 0.05,
	);

	return (
		<div className="relative aspect-video w-full max-w-4xl overflow-hidden border border-border bg-ide-panel text-ide-panel-foreground">
			{playerVideoUrl ? (
				<>
					<VideoPlayer
						className="h-full w-full bg-ide-editor object-contain"
						src={playerVideoUrl}
						poster={playerPosterUrl}
						title={title}
						currentTime={playbackTime}
						isPlaying={playbackPlaying}
						load="visible"
						onEnded={onEnded}
						onPlaybackError={onPlaybackError}
						onTimeUpdate={handleTimeUpdate}
						onPlayingChange={handlePlayingChange}
						playerRef={playerRef}
					/>
					{showPosterOverlay ? (
						<div
							className="pointer-events-none absolute inset-0 z-10 bg-black"
							data-testid="episode-preview-poster"
						>
							<img
								src={playerPosterUrl}
								alt=""
								className="size-full object-cover"
								draggable={false}
							/>
							<div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-black/10" />
							<div className="absolute inset-0 grid place-items-center">
								<span className="grid size-14 place-items-center rounded-full bg-white/95 text-foreground shadow-sm ring-1 ring-black/10">
									<Play className="ml-0.5 size-7 fill-current" />
								</span>
							</div>
						</div>
					) : null}
				</>
			) : (
				<div
					className="relative flex h-full flex-col items-center justify-center overflow-hidden px-6 text-center"
					data-testid="episode-preview-empty-state"
					style={defaultPreviewBackgroundStyle}
				>
					<div className="absolute inset-0 bg-black/25" />
					<div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/65 to-transparent" />
					<div className="relative flex max-w-xl flex-col items-center gap-3 text-white">
						<span className="grid size-14 place-items-center rounded-md border border-white/35 bg-white/15 shadow-sm backdrop-blur-sm">
							<Film className="size-7" />
						</span>
						<div className="space-y-1.5">
							<p className="w-full truncate text-sm font-semibold drop-shadow">
								{title ?? "未选择片段"}
							</p>
							<p className="text-xs font-medium text-white/90 drop-shadow">该分镜还没有生成视频</p>
							<p className="flex items-center justify-center gap-1.5 text-xs text-white/80 drop-shadow">
								<Sparkles className="size-3.5" />
								<span>点击下方卡片右上角的「生成」开始制作</span>
							</p>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

const defaultPreviewBackgroundStyle: React.CSSProperties = {
	backgroundColor: "var(--ide-panel)",
	backgroundImage:
		"linear-gradient(180deg, rgba(15, 23, 42, 0.18), rgba(15, 23, 42, 0.62)), linear-gradient(135deg, rgba(148, 163, 184, 0.75) 0%, rgba(226, 232, 240, 0.92) 42%, rgba(71, 85, 105, 0.84) 100%), repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.12) 0 1px, transparent 1px 52px)",
	backgroundSize: "cover, cover, 52px 100%",
};
