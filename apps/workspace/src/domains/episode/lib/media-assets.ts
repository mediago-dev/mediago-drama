import type { MediaAsset } from "@/domains/workspace/api/media";
import type { Episode, TimelineClip } from "@/domains/episode/lib/sample";

export interface EpisodeClipMediaMetadata {
	downloadPath?: string;
	duration: number;
	posterUrl?: string;
}

export interface EpisodeClipPlaybackRange {
	clip: TimelineClip;
	duration: number;
	end: number;
	index: number;
	start: number;
}

export const buildEpisodeClipMedia = (
	episode: Episode,
	mediaAssets?: MediaAsset[],
): Record<string, EpisodeClipMediaMetadata> | undefined => {
	if (!mediaAssets) return undefined;

	const videoAssets = mediaAssets.filter((asset) => asset.kind === "video");
	const media: Record<string, EpisodeClipMediaMetadata> = {};
	for (const clip of episode.tracks.find((track) => track.type === "video")?.clips ?? []) {
		const asset = findMediaAssetForClipVideo(clip.videoUrl, videoAssets);
		const metadata: EpisodeClipMediaMetadata = {
			duration:
				asset && Number.isFinite(asset.durationSeconds) && (asset.durationSeconds ?? 0) > 0
					? (asset.durationSeconds ?? 0)
					: 0,
			posterUrl: asset?.posterUrl,
		};
		if (asset?.downloadPath) metadata.downloadPath = asset.downloadPath;
		media[clip.id] = metadata;
	}
	return media;
};

export const findMediaAssetForClipVideo = (
	videoUrl: string | null | undefined,
	mediaAssets: MediaAsset[],
) => {
	const source = videoUrl?.trim();
	if (!source) return null;

	const assetId = mediaAssetIdFromContentURL(source);
	if (assetId) {
		const match = mediaAssets.find((asset) => asset.id === assetId);
		if (match) return match;
	}

	const normalizedSource = normalizeMediaSourceKey(source);
	return (
		mediaAssets.find((asset) =>
			[asset.url, asset.sourceUrl].some((value) => {
				const key = normalizeMediaSourceKey(value);
				return key && key === normalizedSource;
			}),
		) ?? null
	);
};

export const mediaAssetIdFromContentURL = (value: string) => {
	const path = normalizeMediaPath(value);
	const match = path.match(
		/\/api(?:\/v1)?\/(?:projects\/[^/]+\/)?(?:media\/assets|media-assets)\/([^/?#]+)\/content/,
	);
	if (!match?.[1]) return null;

	return decodeURIComponent(match[1]);
};

export const getEpisodeVideoClips = (episode: Episode) =>
	episode.tracks
		.find((track) => track.type === "video")
		?.clips.slice()
		.sort((first, second) => first.start - second.start || first.end - second.end) ?? [];

export const episodeClipPlaybackDuration = (
	clip: TimelineClip,
	clipMedia?: Record<string, EpisodeClipMediaMetadata>,
) => {
	if (!isEpisodeVideoClipPlayable(clip)) return 0;

	const mediaDuration = clipMedia?.[clip.id]?.duration;
	if (typeof mediaDuration === "number" && Number.isFinite(mediaDuration) && mediaDuration > 0) {
		return mediaDuration;
	}
	return Math.max(clip.end - clip.start, 0);
};

export const episodeClipPosterUrl = (
	clip: TimelineClip | null | undefined,
	media?: EpisodeClipMediaMetadata,
) =>
	stringValue(media?.posterUrl) ??
	stringValue(clip?.posterUrl) ??
	stringValue(clip?.thumbnailUrl) ??
	undefined;

export const buildEpisodeVideoClipPlaybackRanges = (
	episode: Episode,
	clipMedia?: Record<string, EpisodeClipMediaMetadata>,
): EpisodeClipPlaybackRange[] => {
	let nextStart = 0;
	return getEpisodeVideoClips(episode).map((clip, index) => {
		const duration = episodeClipPlaybackDuration(clip, clipMedia);
		const range = {
			clip,
			duration,
			end: nextStart + duration,
			index,
			start: nextStart,
		};
		nextStart = range.end;
		return range;
	});
};

export const findEpisodeClipPlaybackRange = (
	ranges: EpisodeClipPlaybackRange[],
	clipId: string | null | undefined,
) => ranges.find((range) => range.clip.id === clipId) ?? null;

export const findEpisodeClipPlaybackRangeAtTime = (
	ranges: EpisodeClipPlaybackRange[],
	time: number,
) =>
	ranges.find((range) => range.duration > 0 && time >= range.start && time < range.end) ??
	findLastPlayableRange(ranges);

export const isEpisodeVideoClipPlayable = (clip: TimelineClip | null | undefined) =>
	clip?.status === "ready" && Boolean(clip.videoUrl?.trim());

const normalizeMediaSourceKey = (value: string | null | undefined) => {
	const source = value?.trim();
	if (!source) return "";

	const path = normalizeMediaPath(source);
	if (path) return path;
	return source;
};

const normalizeMediaPath = (value: string) => {
	try {
		const parsed = new URL(value, "http://mediago.local");
		return parsed.pathname;
	} catch {
		return value.trim().split(/[?#]/, 1)[0] ?? "";
	}
};

const findLastPlayableRange = (ranges: EpisodeClipPlaybackRange[]) => {
	for (let index = ranges.length - 1; index >= 0; index -= 1) {
		const range = ranges[index];
		if (range && range.duration > 0) return range;
	}
	return null;
};

const stringValue = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
