import {
	MediaPlayer,
	MediaProvider,
	type MediaPlayerInstance,
	type PlayerSrc,
	type VideoMimeType,
} from "@vidstack/react";
import { DefaultVideoLayout, defaultLayoutIcons } from "@vidstack/react/player/layouts/default";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { cn } from "@/shared/lib/utils";

type VideoPlayerLoadStrategy = "eager" | "idle" | "visible" | "custom" | "play";

export interface VideoPlayerProps {
	className?: string;
	currentTime?: number;
	isPlaying?: boolean;
	load?: VideoPlayerLoadStrategy;
	mimeType?: string;
	onEnded?: () => void;
	onPlayingChange?: (isPlaying: boolean) => void;
	onPlaybackError?: (message: string) => void;
	onTimeUpdate?: (currentTime: number) => void;
	playerRef?: React.Ref<MediaPlayerInstance>;
	poster?: string;
	showTitleInControls?: boolean;
	src: string;
	title?: string;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
	className,
	currentTime,
	isPlaying,
	load,
	mimeType = "video/mp4",
	onEnded,
	onPlayingChange,
	onPlaybackError,
	onTimeUpdate,
	playerRef,
	poster,
	showTitleInControls = true,
	src,
	title,
}) => {
	const internalRef = useRef<MediaPlayerInstance | null>(null);
	const playerSrc = useMemo<PlayerSrc>(
		() => ({ src, type: normalizeVideoMimeType(mimeType) }),
		[mimeType, src],
	);
	const setPlayerRef = useCallback(
		(player: MediaPlayerInstance | null) => {
			internalRef.current = player;
			if (!playerRef) return;
			if (typeof playerRef === "function") {
				playerRef(player);
				return;
			}
			playerRef.current = player;
		},
		[playerRef],
	);

	useEffect(() => {
		if (isPlaying !== false) return;

		internalRef.current?.remoteControl.pause();
	}, [isPlaying, src]);

	useEffect(() => {
		const player = internalRef.current;
		if (!player || typeof currentTime !== "number") return;

		if (Math.abs(player.currentTime - currentTime) > 0.3) {
			player.currentTime = currentTime;
		}
	}, [currentTime, src]);

	return (
		<MediaPlayer
			ref={setPlayerRef}
			src={playerSrc}
			poster={poster}
			title={title}
			load={load}
			playsInline
			preload="metadata"
			className={cn(
				"block aspect-video h-full w-full overflow-hidden bg-background text-foreground [&_.vds-chapter-title]:min-w-0 [&_.vds-chapter-title]:max-w-full [&_.vds-chapter-title]:truncate [&_.vds-controls-group]:min-w-0",
				className,
			)}
			onEnded={onEnded}
			onError={(detail) => onPlaybackError?.(mediaPlaybackErrorMessage(detail))}
			onPause={() => onPlayingChange?.(false)}
			onPlaying={() => onPlayingChange?.(true)}
			onPlayFail={(error) => onPlaybackError?.(mediaPlaybackErrorMessage(error))}
			onTimeUpdate={(detail) => onTimeUpdate?.(detail.currentTime)}
		>
			<MediaProvider />
			<DefaultVideoLayout
				icons={defaultLayoutIcons}
				slots={showTitleInControls ? undefined : { chapterTitle: null }}
			/>
		</MediaPlayer>
	);
};

const videoMimeTypes = new Set<string>([
	"video/mp4",
	"video/webm",
	"video/3gp",
	"video/ogg",
	"video/avi",
	"video/mpeg",
	"video/object",
]);

const normalizeVideoMimeType = (mimeType: string): VideoMimeType => {
	const normalized = mimeType.trim().toLowerCase();
	return (videoMimeTypes.has(normalized) ? normalized : "video/mp4") as VideoMimeType;
};

const mediaPlaybackErrorMessage = (detail: unknown) => {
	if (detail instanceof Error && detail.message.trim()) return detail.message;
	if (
		typeof detail === "object" &&
		detail !== null &&
		"message" in detail &&
		typeof detail.message === "string" &&
		detail.message.trim()
	) {
		return detail.message;
	}
	return "视频暂时无法播放";
};
