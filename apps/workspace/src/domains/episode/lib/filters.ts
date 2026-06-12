import type {
	Episode,
	TimelineClip,
	TimelineTrack,
	TimelineTrackType,
} from "@/domains/episode/lib/sample";

const hiddenEpisodeTimelineTrackTypes = new Set<TimelineTrackType>([
	"voiceover",
	"caption",
	"music",
	"asset",
]);

export const findEpisodeTrackForClip = (episode: Episode, clipId: string): TimelineTrack | null =>
	episode.tracks.find((track) => track.clips.some((clip) => clip.id === clipId)) ?? null;

export const findEpisodeClip = (episode: Episode, clipId: string): TimelineClip | null => {
	const track = findEpisodeTrackForClip(episode, clipId);
	return track?.clips.find((clip) => clip.id === clipId) ?? null;
};

export const getClipCount = (episode: Episode) =>
	episode.tracks.reduce((count, track) => count + track.clips.length, 0);

export const getVisibleEpisodeTimelineTracks = (episode: Episode) =>
	episode.tracks.filter((track) => !hiddenEpisodeTimelineTrackTypes.has(track.type));

export const getVisibleEpisodeTimelineClipCount = (episode: Episode) =>
	getVisibleEpisodeTimelineTracks(episode).reduce((count, track) => count + track.clips.length, 0);

export const getPlayableEpisodeVideoClips = (episode: Episode) => {
	const videoClips =
		episode.tracks
			.find((track) => track.type === "video")
			?.clips.slice()
			.sort((first, second) => first.start - second.start || first.end - second.end) ?? [];
	const playableClips: TimelineClip[] = [];

	for (const clip of videoClips) {
		const videoUrl = clip.videoUrl?.trim() ?? "";
		if (clip.status !== "ready" || !videoUrl) break;

		const previousClip = playableClips.at(-1);
		if (previousClip && clip.start - previousClip.end > 0.25) break;

		playableClips.push(clip);
	}

	return playableClips;
};

export const findEpisodeClipByTrackType = (
	episode: Episode,
	trackType: TimelineTrackType,
	clipId: string,
): TimelineClip | null =>
	episode.tracks
		.find((track) => track.type === trackType)
		?.clips.find((clip) => clip.id === clipId) ?? null;

export const findEpisodeVideoClip = (episode: Episode, clipId: string): TimelineClip | null =>
	findEpisodeClipByTrackType(episode, "video", clipId);
