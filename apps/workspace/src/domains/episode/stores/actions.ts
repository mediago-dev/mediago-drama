import { findEpisodeClip } from "@/domains/episode/lib/filters";
import type { Episode, TimelineClip } from "@/domains/episode/lib/sample";
import type { StateCreator } from "zustand";
import type { EpisodeState, TimelineCompanionTrackType } from "./types";

type EpisodeStateKey = "episode" | "currentTime" | "isPlaying" | "selectedClipId" | "zoom";

type EpisodeActions = Omit<EpisodeState, EpisodeStateKey>;
type EpisodeSet = Parameters<StateCreator<EpisodeState>>[0];
type EpisodeGet = Parameters<StateCreator<EpisodeState>>[1];

export const createEpisodeActions = (set: EpisodeSet, get: EpisodeGet): EpisodeActions => ({
	addCompanionTextClip: (videoClipId, trackType, content) => {
		let nextEpisode: Episode | null = null;
		set((state) => {
			const videoClip = state.episode.tracks
				.find((track) => track.type === "video")
				?.clips.find((clip) => clip.id === videoClipId);
			if (!videoClip) return {};

			const existingIds = new Set(
				state.episode.tracks.flatMap((track) => track.clips.map((clip) => clip.id)),
			);
			let createdClipId: string | null = null;
			const tracks = state.episode.tracks.map((track) => {
				if (track.type !== trackType) return track;
				if (track.clips.some((clip) => timelineClipsOverlap(clip, videoClip))) return track;

				const companionClip = createCompanionTextClip(track.type, videoClip, content, existingIds);
				existingIds.add(companionClip.id);
				createdClipId = companionClip.id;

				return {
					...track,
					clips: [...track.clips, companionClip].sort(compareTimelineClips),
				};
			});

			if (!createdClipId) return {};

			const episode = { ...state.episode, tracks };
			nextEpisode = episode;

			return {
				episode,
				currentTime: videoClip.start,
				isPlaying: false,
				selectedClipId: createdClipId,
			};
		});
		return nextEpisode;
	},
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

const timelineClipsOverlap = (clip: TimelineClip, targetClip: TimelineClip) =>
	Math.min(clip.end, targetClip.end) - Math.max(clip.start, targetClip.start) > 0.25;

const compareTimelineClips = (first: TimelineClip, second: TimelineClip) =>
	first.start - second.start || first.end - second.end || first.id.localeCompare(second.id);

const createCompanionTextClip = (
	trackType: TimelineCompanionTrackType,
	videoClip: TimelineClip,
	content: string,
	existingIds: Set<string>,
): TimelineClip => {
	const suffix = trackType === "voiceover" ? "旁白" : "字幕";
	const baseId = `${trackType}-${videoClip.id}`;
	let id = baseId;
	let index = 2;

	while (existingIds.has(id)) {
		id = `${baseId}-${index}`;
		index += 1;
	}

	return {
		id,
		title: `${videoClip.title} ${suffix}`,
		start: videoClip.start,
		end: videoClip.end,
		content,
		status: "draft",
		source: "AI 文案生成",
	};
};
