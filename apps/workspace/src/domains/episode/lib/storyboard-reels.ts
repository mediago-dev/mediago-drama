import type { Episode, TimelineClip } from "@/domains/episode/lib/sample";
import {
	findMarkdownSectionEndLine,
	findMarkdownSectionHeadingLine,
	type MarkdownSectionIdentityLike,
} from "@/domains/documents/lib/sections";

export interface StoryboardReelEditResult {
	changed: boolean;
	markdown: string;
}

export const appendStoryboardReelMarkdown = (markdown: string, reelIndex: number) => {
	const reelNumber = String(Math.max(reelIndex, 1)).padStart(2, "0");
	const block = [
		`## 第 ${reelNumber} 组 总时长：00:10`,
		"",
		"### 分镜 01",
		"",
		"**景别**：中景",
		"",
		"**视角**：平视",
		"",
		"**运镜**：固定",
		"",
		"**动作**：待填写新的分镜动作。",
		"",
		"**台词**：无",
	].join("\n");

	return `${markdown.trimEnd()}\n\n${block}\n`;
};

export const mergeEpisodeGeneratedMedia = (
	nextEpisode: Episode,
	currentEpisode: Episode,
): Episode => {
	const currentClips = currentEpisode.tracks.flatMap((track) =>
		track.clips.map((clip) => [`${track.type}:${clip.id}`, clip] as const),
	);
	const currentClipById = new Map(currentClips);
	const currentClipByTitle = new Map(
		currentEpisode.tracks.flatMap((track) =>
			track.clips.map((clip) => [`${track.type}:${clip.title}`, clip] as const),
		),
	);

	return {
		...nextEpisode,
		tracks: nextEpisode.tracks.map((track) => ({
			...track,
			clips: track.clips.map((clip) => {
				const previous =
					currentClipById.get(`${track.type}:${clip.id}`) ??
					currentClipByTitle.get(`${track.type}:${clip.title}`);
				if (!previous) return clip;

				return mergeClipGeneratedMedia(clip, previous);
			}),
		})),
	};
};

export const removeStoryboardReelMarkdown = (
	markdown: string,
	section: MarkdownSectionIdentityLike,
): StoryboardReelEditResult => {
	const lines = markdown.split("\n");
	const start = findMarkdownSectionHeadingLine(lines, section);
	if (start < 0) return { changed: false, markdown };

	const end = findMarkdownSectionEndLine(lines, start, section.headingLevel);
	const nextLines = [...lines.slice(0, start), ...lines.slice(end)];

	return {
		changed: true,
		markdown: normalizeMarkdownAfterReelRemoval(nextLines.join("\n")),
	};
};

const mergeClipGeneratedMedia = (clip: TimelineClip, previous: TimelineClip): TimelineClip => {
	const hasGeneratedMedia = Boolean(
		previous.videoUrl || previous.posterUrl || previous.thumbnailUrl,
	);
	if (!hasGeneratedMedia && previous.status === "draft") return clip;

	return {
		...clip,
		posterUrl: previous.posterUrl ?? clip.posterUrl,
		status: hasGeneratedMedia ? previous.status : clip.status,
		thumbnailUrl: previous.thumbnailUrl ?? clip.thumbnailUrl,
		videoUrl: previous.videoUrl ?? clip.videoUrl,
	};
};

const normalizeMarkdownAfterReelRemoval = (markdown: string) =>
	`${markdown.replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
