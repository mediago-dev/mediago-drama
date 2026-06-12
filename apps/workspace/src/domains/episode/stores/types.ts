import type { Episode, TimelineTrackType } from "@/domains/episode/lib/sample";

export type TimelineZoom = "fit" | "50" | "100" | "150";
export type TimelineCompanionTrackType = Extract<TimelineTrackType, "voiceover" | "caption">;

export interface EpisodeState {
	episode: Episode;
	currentTime: number;
	isPlaying: boolean;
	selectedClipId: string;
	zoom: TimelineZoom;
	addCompanionTextClip: (
		videoClipId: string,
		trackType: TimelineCompanionTrackType,
		content: string,
	) => Episode | null;
	pause: () => void;
	play: () => void;
	selectClip: (clipId: string) => void;
	setCurrentTime: (time: number) => void;
	setEpisode: (episode: Episode) => void;
	setVideoClipVideoUrl: (clipId: string, videoUrl: string | null) => Episode | null;
	setZoom: (zoom: TimelineZoom) => void;
	togglePlayback: () => void;
}
