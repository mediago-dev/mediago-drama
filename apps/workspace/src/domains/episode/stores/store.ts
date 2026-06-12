import { sampleEpisode } from "@/domains/episode/lib/sample";
import { createStore } from "@/shared/lib/utils";
import { createEpisodeActions } from "./actions";
import type { EpisodeState } from "./types";

const firstClipId = sampleEpisode.tracks[0]?.clips[0]?.id ?? "";

export const useEpisodeStore = createStore<EpisodeState>(
	(set, get) => ({
		episode: sampleEpisode,
		currentTime: 0,
		isPlaying: false,
		selectedClipId: firstClipId,
		zoom: "fit",
		...createEpisodeActions(set, get),
	}),
	"episodeStore",
);

export { findEpisodeClip, getClipCount } from "@/domains/episode/lib/filters";
