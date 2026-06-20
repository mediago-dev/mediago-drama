import {
	MediaPlayer,
	MediaProvider,
	type AudioMimeType,
	type MediaPlayerInstance,
	type PlayerSrc,
} from "@vidstack/react";
import { DefaultAudioLayout, defaultLayoutIcons } from "@vidstack/react/player/layouts/default";
import type React from "react";
import { useMemo } from "react";
import { cn } from "@/shared/lib/utils";

export interface AudioPlayerProps {
	className?: string;
	mimeType?: string;
	onPlaybackError?: (message: string) => void;
	playerRef?: React.Ref<MediaPlayerInstance>;
	src: string;
	title?: string;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
	className,
	mimeType = "audio/mpeg",
	onPlaybackError,
	playerRef,
	src,
	title,
}) => {
	const playerSrc = useMemo<PlayerSrc>(
		() => ({ src, type: normalizeAudioMimeType(mimeType) }),
		[mimeType, src],
	);

	return (
		<MediaPlayer
			ref={playerRef}
			src={playerSrc}
			title={title}
			viewType="audio"
			preload="metadata"
			className={cn(
				"block h-[60px] min-w-0 w-full overflow-hidden rounded-sm bg-transparent text-foreground [&_.vds-audio-layout]:w-full [&_.vds-controls-group]:min-w-0",
				className,
			)}
			style={audioPlayerStyle}
			onError={(detail) => onPlaybackError?.(mediaPlaybackErrorMessage(detail))}
			onPlayFail={(error) => onPlaybackError?.(mediaPlaybackErrorMessage(error))}
		>
			<MediaProvider />
			<DefaultAudioLayout icons={defaultLayoutIcons} slots={{ downloadButton: null }} />
		</MediaPlayer>
	);
};

const audioPlayerStyle: React.CSSProperties & Record<`--${string}`, string> = {
	"--audio-bg": "var(--ide-toolbar)",
	"--audio-border": "1px solid var(--border)",
	"--audio-border-radius": "var(--radius-scale-sm)",
	"--audio-button-size": "2.25rem",
	"--audio-controls-color": "var(--foreground)",
	"--audio-filter": "none",
	"--audio-focus-ring-color": "var(--ring)",
	"--audio-slider-progress-bg": "color-mix(in srgb, var(--muted-foreground) 22%, transparent)",
	"--audio-slider-track-bg": "color-mix(in srgb, var(--muted-foreground) 18%, transparent)",
	"--audio-brand": "var(--primary)",
};

const audioMimeTypes = new Set<string>([
	"audio/mpeg",
	"audio/ogg",
	"audio/3gp",
	"audio/mp3",
	"audio/webm",
	"audio/flac",
	"audio/object",
]);

const normalizeAudioMimeType = (mimeType: string): AudioMimeType => {
	const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
	if (audioMimeTypes.has(normalized)) return normalized as AudioMimeType;

	// Vidstack needs an audio provider hint for extensionless API URLs.
	return "audio/mpeg";
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
	return "音频暂时无法播放";
};
