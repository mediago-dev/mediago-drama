import type React from "react";
import { EpisodeClipStrip } from "@/domains/episode/components/EpisodeClipStrip";
import type { EpisodeClipMediaMetadata } from "@/domains/episode/lib/media-assets";
import type { Episode, TimelineClip } from "@/domains/episode/lib/sample";
import type { TimelineCompanionTrackType, TimelineZoom } from "@/domains/episode/stores";

interface EpisodeTimelineEditorProps {
	downloadingClipIds?: string[];
	episode: Episode;
	clipMedia?: Record<string, EpisodeClipMediaMetadata>;
	currentTime: number;
	isPlaying: boolean;
	selectedClipId: string;
	timelineDuration?: number;
	zoom: TimelineZoom;
	onRequestCompanionGeneration: (
		videoClipId: string,
		trackType: TimelineCompanionTrackType,
	) => void;
	onDownloadClip?: (clip: TimelineClip) => void;
	onGenerateClip: (clipId: string) => void;
	onPlayClip: (clipId: string) => void;
	onSeek: (time: number) => void;
	onSelectClip: (clipId: string) => void;
	onTogglePlayback: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export const EpisodeTimelineEditor: React.FC<EpisodeTimelineEditorProps> = (props) => (
	<EpisodeClipStrip
		currentTime={props.currentTime}
		clipMedia={props.clipMedia}
		downloadingClipIds={props.downloadingClipIds}
		episode={props.episode}
		isPlaying={props.isPlaying}
		selectedClipId={props.selectedClipId}
		timelineDuration={props.timelineDuration}
		zoom={props.zoom}
		onDownloadClip={props.onDownloadClip}
		onGenerateClip={props.onGenerateClip}
		onPlayClip={props.onPlayClip}
		onSeek={props.onSeek}
		onSelectClip={props.onSelectClip}
		onTogglePlayback={props.onTogglePlayback}
	/>
);
