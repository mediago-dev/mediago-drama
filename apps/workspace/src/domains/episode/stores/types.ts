import type { Episode, TimelineClipStatus } from "@/domains/episode/lib/sample";

export type TimelineZoom = "fit" | "50" | "100" | "150";

export interface EpisodeState {
	episode: Episode;
	currentTime: number;
	isPlaying: boolean;
	selectedClipId: string;
	zoom: TimelineZoom;
	pause: () => void;
	play: () => void;
	selectClip: (clipId: string) => void;
	setCurrentTime: (time: number) => void;
	setEpisode: (episode: Episode) => void;
	setVideoClipStatus: (clipId: string, status: TimelineClipStatus) => Episode | null;
	setVideoClipVideoUrl: (clipId: string, videoUrl: string | null) => Episode | null;
	setZoom: (zoom: TimelineZoom) => void;
	togglePlayback: () => void;
}
