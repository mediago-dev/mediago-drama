import { findEpisodeClip } from "@/domains/episode/lib/filters";
import type { Episode } from "@/domains/episode/lib/sample";
import type { StateCreator } from "zustand";
import type { EpisodeState } from "./types";

type EpisodeStateKey = "episode" | "currentTime" | "isPlaying" | "selectedClipId" | "zoom";

type EpisodeActions = Omit<EpisodeState, EpisodeStateKey>;
type EpisodeSet = Parameters<StateCreator<EpisodeState>>[0];
type EpisodeGet = Parameters<StateCreator<EpisodeState>>[1];

export const createEpisodeActions = (set: EpisodeSet, get: EpisodeGet): EpisodeActions => ({
	pause: () => set({ isPlaying: false }),
	play: () => set({ isPlaying: true }),
	selectClip: (selectedClipId) => {
		const clip = findEpisodeClip(get().episode, selectedClipId);

		set({
			selectedClipId,
			currentTime: clip?.start ?? get().currentTime,
		});
	},
	setCurrentTime: (time) => {
		const { episode } = get();
		const currentTime = Math.min(Math.max(time, 0), episode.duration);
		set({
			currentTime,
			isPlaying: currentTime >= episode.duration ? false : get().isPlaying,
		});
	},
	setEpisode: (episode) => {
		const state = get();
		const selectedClip = findEpisodeClip(episode, state.selectedClipId);
		const fallbackClipId = episode.tracks[0]?.clips[0]?.id ?? "";
		const currentTime = Math.min(state.currentTime, episode.duration);

		set({
			episode,
			currentTime,
			selectedClipId: selectedClip ? state.selectedClipId : fallbackClipId,
			isPlaying: currentTime >= episode.duration ? false : state.isPlaying,
		});
	},
	setVideoClipStatus: (clipId, status) => {
		let nextEpisode: Episode | null = null;

		set((state) => {
			let changed = false;
			const tracks = state.episode.tracks.map((track) => {
				if (track.type !== "video") return track;

				let trackChanged = false;
				const clips = track.clips.map((clip) => {
					if (clip.id !== clipId || clip.status === status) return clip;

					changed = true;
					trackChanged = true;
					return {
						...clip,
						status,
					};
				});

				return trackChanged ? { ...track, clips } : track;
			});

			if (!changed) return {};

			const episode = { ...state.episode, tracks };
			nextEpisode = episode;
			return { episode };
		});

		return nextEpisode;
	},
	setVideoClipVideoUrl: (clipId, videoUrl) => {
		let nextEpisode: Episode | null = null;
		const cleanVideoUrl = videoUrl?.trim() ?? "";

		set((state) => {
			let changed = false;
			const tracks = state.episode.tracks.map((track) => {
				if (track.type !== "video") return track;

				let trackChanged = false;
				const clips = track.clips.map((clip) => {
					if (clip.id !== clipId) return clip;

					if (cleanVideoUrl) {
						if (clip.videoUrl === cleanVideoUrl && clip.status === "ready") return clip;

						changed = true;
						trackChanged = true;
						return {
							...clip,
							status: "ready" as const,
							videoUrl: cleanVideoUrl,
						};
					}

					if (!clip.videoUrl && !clip.posterUrl && !clip.thumbnailUrl && clip.status === "draft") {
						return clip;
					}

					const {
						posterUrl: _posterUrl,
						thumbnailUrl: _thumbnailUrl,
						videoUrl: _videoUrl,
						...clipWithoutMedia
					} = clip;
					changed = true;
					trackChanged = true;
					return {
						...clipWithoutMedia,
						status: "draft" as const,
					};
				});

				return trackChanged ? { ...track, clips } : track;
			});

			if (!changed) return {};

			const episode = { ...state.episode, tracks };
			nextEpisode = episode;
			return { episode };
		});

		return nextEpisode;
	},
	setZoom: (zoom) => set({ zoom }),
	togglePlayback: () => set((state) => ({ isPlaying: !state.isPlaying })),
});
