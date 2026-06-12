import {
	formatTimelineTime,
	sampleEpisode,
	type Episode,
	type EpisodeSection,
	type TimelineClip,
} from "@/domains/episode/lib/sample";
import { parseTimeline, type TimelineSegment } from "@/lib/markdown/video";
import type { MarkdownDocument } from "@/domains/documents/stores";

const fallbackSegmentSeconds = 12;
const storyboardShotSeconds = 12;
const storyboardGroupSeconds = 15;

export const createEpisodeFromMarkdownDocument = (document: MarkdownDocument | null): Episode => {
	if (!document) return sampleEpisode;

	const segments = parseTimeline(document.content);
	if (segments.length > 0) return createEpisodeFromSegments(document, segments);
	if (document.category === "storyboard") return createEpisodeFromStoryboard(document);

	return createEpisodeFromHeadings(document);
};

const createEpisodeFromSegments = (
	document: MarkdownDocument,
	segments: TimelineSegment[],
): Episode => {
	const segmentDuration = Math.max(...segments.map((segment) => segment.end), 1);
	const duration = Math.max(readDuration(document.content) ?? segmentDuration, segmentDuration);
	const sections = segments.map(
		(segment): EpisodeSection => ({
			id: `section-${segment.id}`,
			title: segment.title,
			start: segment.start,
			end: segment.end,
			summary: segment.visual || segment.audio || "来自 Markdown 源文档的场景块。",
		}),
	);

	return {
		id: `episode-${document.id}`,
		title: document.title || readTitle(document.content) || "未命名剧集",
		duration,
		aspectRatio: "16:9",
		sections,
		tracks: [
			{
				id: "track-video",
				type: "video",
				label: "视频",
				clips: segments.map(
					(segment): TimelineClip => ({
						id: `video-${segment.id}`,
						title: segment.title,
						start: segment.start,
						end: segment.end,
						content: segment.visual || "来自 Markdown 源文档的视觉节拍。",
						status: "draft",
						prompt: segment.visual,
						source: "Markdown 视频块",
					}),
				),
			},
			{
				id: "track-voiceover",
				type: "voiceover",
				label: "旁白",
				clips: segments
					.filter((segment) => segment.audio.trim() !== "")
					.map(
						(segment): TimelineClip => ({
							id: `voiceover-${segment.id}`,
							title: `${segment.title} 旁白`,
							start: segment.start,
							end: segment.end,
							content: segment.audio,
							status: "draft",
							source: "Markdown 音频字段",
						}),
					),
			},
			{
				id: "track-caption",
				type: "caption",
				label: "字幕",
				clips: segments.map(
					(segment): TimelineClip => ({
						id: `caption-${segment.id}`,
						title: segment.title,
						start: segment.start,
						end: Math.min(
							segment.start + Math.max((segment.end - segment.start) / 2, 3),
							segment.end,
						),
						content: captionFromSegment(segment),
						status: "draft",
						source: "Markdown 章节标题",
					}),
				),
			},
			createMusicTrack(duration),
			createAssetTrack(duration),
		],
	};
};

export const createEpisodeFromStoryboard = (document: MarkdownDocument): Episode => {
	const groups = readStoryboardGroups(document.content);
	if (groups.length > 0) return createEpisodeFromStoryboardGroups(document, groups);

	return createEpisodeFromStoryboardShots(document);
};

const createEpisodeFromStoryboardGroups = (
	document: MarkdownDocument,
	groups: StoryboardGroup[],
): Episode => {
	const durationFromGroups = Math.max(groups.length * storyboardGroupSeconds, 1);
	const duration = Math.max(
		readDuration(document.content) ?? durationFromGroups,
		durationFromGroups,
	);
	const sections = groups.map(
		(group): EpisodeSection => ({
			id: `section-${group.id}`,
			title: group.title,
			start: group.start,
			end: group.end,
			summary: group.video || group.voiceover || group.caption || "待填写的分镜组。",
		}),
	);

	return {
		id: `episode-${document.id}`,
		title: document.title || readTitle(document.content) || "未命名分镜",
		duration,
		aspectRatio: "16:9",
		sections,
		tracks: [
			{
				id: "track-video",
				type: "video",
				label: "视频",
				clips: groups.map(
					(group): TimelineClip => ({
						id: `video-${group.id}`,
						title: group.title,
						start: group.start,
						end: group.end,
						content: group.video || "（占位：待填写）",
						status: "draft",
						prompt: group.video,
						source: "分镜组提示词",
					}),
				),
			},
			{
				id: "track-voiceover",
				type: "voiceover",
				label: "旁白",
				clips: groups
					.filter((group) => group.voiceover.trim() !== "")
					.map(
						(group): TimelineClip => ({
							id: `voiceover-${group.id}`,
							title: `${group.title} 旁白`,
							start: group.start,
							end: group.end,
							content: group.voiceover,
							status: "draft",
							source: "分镜组台词",
						}),
					),
			},
			{
				id: "track-caption",
				type: "caption",
				label: "字幕",
				clips: groups
					.filter((group) => group.caption.trim() !== "")
					.map(
						(group): TimelineClip => ({
							id: `caption-${group.id}`,
							title: `${group.title} 字幕`,
							start: group.start,
							end: group.end,
							content: group.caption,
							status: "draft",
							source: "分镜组对白",
						}),
					),
			},
			createMusicTrack(duration),
			createAssetTrack(duration),
		],
	};
};

const createEpisodeFromStoryboardShots = (document: MarkdownDocument): Episode => {
	const shots = readStoryboardSections(document.content);
	const durationFromShots = Math.max(shots.length * storyboardShotSeconds, 1);
	const duration = Math.max(readDuration(document.content) ?? durationFromShots, durationFromShots);
	const sections = shots.map(
		(shot): EpisodeSection => ({
			id: `section-${shot.id}`,
			title: shot.title,
			start: shot.start,
			end: shot.end,
			summary: shot.video || shot.voiceover || shot.caption || "待填写的分镜镜头。",
		}),
	);

	return {
		id: `episode-${document.id}`,
		title: document.title || readTitle(document.content) || "未命名分镜",
		duration,
		aspectRatio: "16:9",
		sections,
		tracks: [
			{
				id: "track-video",
				type: "video",
				label: "视频",
				clips: shots.map(
					(shot): TimelineClip => ({
						id: `video-${shot.id}`,
						title: shot.title,
						start: shot.start,
						end: shot.end,
						content: shot.video || "（占位：待填写）",
						status: "draft",
						prompt: shot.video,
						source: "分镜视觉段落",
					}),
				),
			},
			{
				id: "track-voiceover",
				type: "voiceover",
				label: "旁白",
				clips: shots
					.filter((shot) => shot.voiceover.trim() !== "")
					.map(
						(shot): TimelineClip => ({
							id: `voiceover-${shot.id}`,
							title: `${shot.title} 旁白`,
							start: shot.start,
							end: shot.end,
							content: shot.voiceover,
							status: "draft",
							source: "分镜旁白行",
						}),
					),
			},
			{
				id: "track-caption",
				type: "caption",
				label: "字幕",
				clips: shots
					.filter((shot) => shot.caption.trim() !== "")
					.map(
						(shot): TimelineClip => ({
							id: `caption-${shot.id}`,
							title: `${shot.title} 字幕`,
							start: shot.start,
							end: shot.end,
							content: shot.caption,
							status: "draft",
							source: "分镜对白行",
						}),
					),
			},
			createMusicTrack(duration),
			createAssetTrack(duration),
		],
	};
};

const createEpisodeFromHeadings = (document: MarkdownDocument): Episode => {
	const parsedSections = readMarkdownSections(document.content);
	const sections =
		parsedSections.length > 0
			? parsedSections
			: [
					{
						title: document.title || "未命名",
						content: document.content.trim() || "剧集草稿备注。",
					},
				];

	const clips = sections.map((section, index): TimelineClip => {
		const start = index * fallbackSegmentSeconds;
		const end = start + fallbackSegmentSeconds;

		return {
			id: `video-${index}-${slugify(section.title)}`,
			title: section.title,
			start,
			end,
			content: section.content || "来自 Markdown 备注的草稿场景。",
			status: "draft",
			prompt: section.content,
			source: "Markdown 标题",
		};
	});

	const clipDuration = Math.max(clips.at(-1)?.end ?? fallbackSegmentSeconds, 1);
	const duration = Math.max(readDuration(document.content) ?? clipDuration, clipDuration);
	const episodeSections = clips.map(
		(clip): EpisodeSection => ({
			id: `section-${clip.id}`,
			title: clip.title,
			start: clip.start,
			end: clip.end,
			summary: clip.content,
		}),
	);

	return {
		id: `episode-${document.id}`,
		title: document.title || readTitle(document.content) || "未命名剧集",
		duration,
		aspectRatio: "16:9",
		sections: episodeSections,
		tracks: [
			{
				id: "track-video",
				type: "video",
				label: "视频",
				clips,
			},
			{
				id: "track-voiceover",
				type: "voiceover",
				label: "旁白",
				clips: clips.map(
					(clip): TimelineClip => ({
						...clip,
						id: clip.id.replace("video-", "voiceover-"),
						title: `${clip.title} 旁白`,
						content: clip.content,
						source: "Markdown 段落",
					}),
				),
			},
			{
				id: "track-caption",
				type: "caption",
				label: "字幕",
				clips: clips.map(
					(clip): TimelineClip => ({
						...clip,
						id: clip.id.replace("video-", "caption-"),
						end: Math.min(clip.start + 6, clip.end),
						content: clip.title,
						source: "Markdown 标题",
					}),
				),
			},
			createMusicTrack(duration),
			createAssetTrack(duration),
		],
	};
};

const createMusicTrack = (duration: number) => ({
	id: "track-music",
	type: "music" as const,
	label: "音乐",
	clips: [
		{
			id: "music-bed",
			title: "剧集铺底音乐",
			start: 0,
			end: duration,
			content: "与整集对齐的背景音乐铺底。",
			status: "draft" as const,
			source: "计划混音",
		},
	],
});

const createAssetTrack = (duration: number) => ({
	id: "track-assets",
	type: "asset" as const,
	label: "素材",
	clips: [
		{
			id: "asset-opening",
			title: "开场画面",
			start: 0,
			end: Math.min(5, duration),
			content: "剧集开场视觉锚点。",
			status: "draft" as const,
			source: "计划素材",
		},
		{
			id: "asset-export",
			title: "导出标记",
			start: Math.max(duration - 6, 0),
			end: duration,
			content: `最终交接点位于 ${formatTimelineTime(duration)}。`,
			status: "draft" as const,
			source: "计划导出",
		},
	],
});

const readDuration = (markdown: string) => {
	const match = markdown.match(/^duration:\s*(\d+)/m);
	if (!match?.[1]) return null;

	return Number(match[1]);
};

const readTitle = (markdown: string) => {
	const frontmatterTitle = markdown.match(/^title:\s*(.+)$/m)?.[1]?.trim();
	if (frontmatterTitle) return frontmatterTitle;

	return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
};

interface MarkdownSection {
	title: string;
	content: string;
}

interface StoryboardShot {
	id: string;
	title: string;
	start: number;
	end: number;
	video: string;
	voiceover: string;
	caption: string;
}

interface StoryboardGroup {
	id: string;
	title: string;
	start: number;
	end: number;
	video: string;
	voiceover: string;
	caption: string;
}

const readMarkdownSections = (markdown: string): MarkdownSection[] => {
	const sections: MarkdownSection[] = [];
	let current: MarkdownSection | null = null;

	for (const line of stripFrontmatter(markdown).split("\n")) {
		const heading = line.match(/^(#{1,3})\s+(.+)$/);
		if (heading?.[2]) {
			if (current) sections.push(normalizeSection(current));
			current = {
				title: heading[2].trim(),
				content: "",
			};
			continue;
		}

		if (current) current.content += `${line}\n`;
	}

	if (current) sections.push(normalizeSection(current));

	return sections.filter((section) => section.title || section.content);
};

const readStoryboardSections = (markdown: string): StoryboardShot[] => {
	const sections: MarkdownSection[] = [];
	let current: MarkdownSection | null = null;

	for (const line of stripFrontmatter(markdown).split("\n")) {
		const heading = line.match(/^(#{1,6})\s+(.+)$/);
		if (heading?.[1] && heading[2]) {
			const level = heading[1].length;
			const title = heading[2].trim();
			if ((level === 2 || level === 3) && isStoryboardShotTitle(title)) {
				if (current) sections.push(normalizeSection(current));
				current = {
					title,
					content: "",
				};
				continue;
			}
			if (level <= 2 && current) {
				sections.push(normalizeSection(current));
				current = null;
				continue;
			}
		}

		if (current) current.content += `${line}\n`;
	}

	if (current) sections.push(normalizeSection(current));

	return sections
		.filter((section) => isStoryboardShotTitle(section.title))
		.map((section, index) => {
			const parsed = parseStoryboardShotContent(section.content);
			const start = index * storyboardShotSeconds;
			const end = start + storyboardShotSeconds;
			return {
				id: `${index}-${slugify(section.title)}`,
				title: section.title,
				start,
				end,
				...parsed,
			};
		});
};

const parseStoryboardShotContent = (content: string) => {
	const video: string[] = [];
	const voiceover: string[] = [];
	const caption: string[] = [];

	for (const rawLine of content.split("\n")) {
		const line = cleanStoryboardLine(rawLine);
		if (!line) continue;
		if (isHorizontalRule(line) || isHtmlComment(line)) continue;

		if (isDialogueLine(line)) {
			caption.push(line);
			continue;
		}
		if (isVoiceoverLine(line)) {
			voiceover.push(line);
			continue;
		}

		video.push(line);
	}

	return {
		video: video.join("\n").trim(),
		voiceover: voiceover.join("\n").trim(),
		caption: caption.join("\n").trim(),
	};
};

const readStoryboardGroups = (markdown: string): StoryboardGroup[] => {
	const rawGroups: MarkdownSection[] = [];
	let current: MarkdownSection | null = null;

	for (const line of stripFrontmatter(markdown).split("\n")) {
		const heading = line.match(/^#{1,6}\s+(.+)$/);
		if (heading?.[1] && isStoryboardGroupTitle(heading[1].trim())) {
			if (current) rawGroups.push(current);
			current = { title: heading[1].trim(), content: "" };
			continue;
		}

		if (current) current.content += `${line}\n`;
	}

	if (current) rawGroups.push(current);

	return rawGroups.map((group, index) => {
		const parsed = parseStoryboardGroupContent(group.content);
		const start = index * storyboardGroupSeconds;
		const end = start + storyboardGroupSeconds;
		return {
			id: `${index}-${slugify(group.title)}`,
			title: group.title,
			start,
			end,
			...parsed,
		};
	});
};

const parseStoryboardGroupContent = (content: string) => {
	const video: string[] = [];
	const voiceover: string[] = [];
	const caption: string[] = [];

	for (const rawLine of content.split("\n")) {
		const line = cleanStoryboardLine(rawLine);
		if (!line) continue;
		if (isHorizontalRule(line) || isHtmlComment(line)) continue;

		// 视频提示词保留组内全部字段，等于可直接复制到 Seedance 的完整提示词。
		video.push(line);

		// 台词 / 旁白 / 对白额外抽取到对应轨道，方便剪辑台审阅。
		const dialogue = parseDialogueField(line);
		if (dialogue && dialogue.value && dialogue.value !== "无") {
			if (dialogue.kind === "caption") caption.push(dialogue.value);
			else voiceover.push(dialogue.value);
		}
	}

	return {
		video: video.join("\n").trim(),
		voiceover: voiceover.join("\n").trim(),
		caption: caption.join("\n").trim(),
	};
};

const normalizeSection = (section: MarkdownSection): MarkdownSection => ({
	title: section.title,
	content: section.content
		.replace(/```[\s\S]*?```/g, "")
		.replace(/^- /gm, "")
		.trim(),
});

const stripFrontmatter = (markdown: string) => markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");

const cleanStoryboardLine = (line: string) =>
	line
		.replace(/^\s*[-*]\s+/, "")
		.replace(/^#{1,6}\s+/, "")
		.replace(/\*\*/g, "")
		.trim();

const isStoryboardGroupTitle = (title: string) => /^第\s*\S+\s*组/u.test(title.trim());

const isStoryboardShotTitle = (title: string) => /^(分镜|镜头)\s*\S*/u.test(title.trim());

const parseDialogueField = (
	line: string,
): { kind: "voiceover" | "caption"; value: string } | null => {
	const lines = line.match(/^台词[:：]\s*(.*)$/u);
	if (lines) return { kind: "voiceover", value: lines[1]?.trim() ?? "" };

	const voiceover = line.match(/^旁白（[^）]+）[:：]\s*(.*)$/u);
	if (voiceover) return { kind: "voiceover", value: voiceover[1]?.trim() ?? "" };

	const dialogue = line.match(/^对白（[^）]+）[:：]\s*(.*)$/u);
	if (dialogue) return { kind: "caption", value: dialogue[1]?.trim() ?? "" };

	return null;
};

const isDialogueLine = (line: string) => /^对白（[^）]+）[:：]/u.test(line);

const isVoiceoverLine = (line: string) => /^旁白（[^）]+）[:：]/u.test(line);

const isHorizontalRule = (line: string) => /^-{3,}$/.test(line);

const isHtmlComment = (line: string) => /^<!--[\s\S]*-->$/.test(line);

const captionFromSegment = (segment: TimelineSegment) => {
	const audio = segment.audio.trim();
	if (!audio) return segment.title;

	const firstSentence = audio.split(/[.!?。！？]/)[0]?.trim();
	return firstSentence || segment.title;
};

const slugify = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "") || "section";
