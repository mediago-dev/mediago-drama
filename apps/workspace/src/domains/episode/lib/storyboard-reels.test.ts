import { describe, expect, it } from "vitest";
import type { Episode } from "@/domains/episode/lib/sample";
import {
	appendStoryboardReelMarkdown,
	mergeEpisodeGeneratedMedia,
	removeStoryboardReelMarkdown,
} from "@/domains/episode/lib/storyboard-reels";

const makeEpisode = (overrides: Partial<Episode> = {}): Episode => ({
	aspectRatio: "16:9",
	duration: 10,
	id: "episode-1",
	sections: [],
	title: "测试剧集",
	tracks: [
		{
			clips: [
				{
					content: "动作一",
					end: 10,
					id: "clip-1",
					start: 0,
					status: "draft",
					title: "第 01 组",
				},
			],
			id: "track-video",
			label: "视频",
			type: "video",
		},
	],
	...overrides,
});

describe("appendStoryboardReelMarkdown", () => {
	it("appends a numbered reel block after existing markdown", () => {
		const next = appendStoryboardReelMarkdown("# 分镜脚本\n\n## 第 01 组\n\n已有内容\n", 2);

		expect(next).toContain("已有内容\n\n## 第 02 组 总时长：00:10");
		expect(next).not.toContain("### 分镜");
		expect(next).toContain("**动作**：待填写新的分镜动作。");
		expect(next.endsWith("\n")).toBe(true);
	});

	it("uses the first reel number for invalid indexes", () => {
		expect(appendStoryboardReelMarkdown("", 0)).toContain("## 第 01 组 总时长：00:10");
	});
});

describe("mergeEpisodeGeneratedMedia", () => {
	it("keeps generated media when rebuilt clips keep the same id", () => {
		const currentEpisode = makeEpisode({
			tracks: [
				{
					clips: [
						{
							content: "旧动作",
							end: 10,
							id: "clip-1",
							posterUrl: "/poster.jpg",
							start: 0,
							status: "ready",
							thumbnailUrl: "/thumb.jpg",
							title: "第 01 组",
							videoUrl: "/video.mp4",
						},
					],
					id: "track-video",
					label: "视频",
					type: "video",
				},
			],
		});
		const nextEpisode = makeEpisode();

		const merged = mergeEpisodeGeneratedMedia(nextEpisode, currentEpisode);
		const clip = merged.tracks[0]?.clips[0];

		expect(clip).toEqual(
			expect.objectContaining({
				content: "动作一",
				posterUrl: "/poster.jpg",
				status: "ready",
				thumbnailUrl: "/thumb.jpg",
				videoUrl: "/video.mp4",
			}),
		);
	});

	it("matches generated media by track and title after markdown ids change", () => {
		const currentEpisode = makeEpisode({
			tracks: [
				{
					clips: [
						{
							content: "旧动作",
							end: 10,
							id: "old-id",
							start: 0,
							status: "ready",
							title: "第 01 组",
							videoUrl: "/video.mp4",
						},
					],
					id: "track-video",
					label: "视频",
					type: "video",
				},
				{
					clips: [
						{
							content: "字幕",
							end: 5,
							id: "caption-old",
							start: 0,
							status: "ready",
							title: "第 01 组",
							videoUrl: "/caption-should-not-apply.mp4",
						},
					],
					id: "track-caption",
					label: "字幕",
					type: "caption",
				},
			],
		});
		const nextEpisode = makeEpisode({
			tracks: [
				{
					clips: [
						{
							content: "新动作",
							end: 10,
							id: "new-id",
							start: 0,
							status: "draft",
							title: "第 01 组",
						},
					],
					id: "track-video",
					label: "视频",
					type: "video",
				},
			],
		});

		const merged = mergeEpisodeGeneratedMedia(nextEpisode, currentEpisode);

		expect(merged.tracks[0]?.clips[0]).toEqual(
			expect.objectContaining({
				id: "new-id",
				status: "ready",
				videoUrl: "/video.mp4",
			}),
		);
	});
});

describe("removeStoryboardReelMarkdown", () => {
	it("removes the targeted reel section and keeps sibling reels", () => {
		const markdown = [
			"# 分镜脚本",
			"",
			"## 第 01 组 总时长：00:07",
			"",
			"动作一",
			"",
			"## 第 02 组 总时长：00:05",
			"",
			"动作二",
		].join("\n");

		const result = removeStoryboardReelMarkdown(markdown, {
			blockId: "lane-1",
			headingLevel: 2,
			headingOccurrence: 1,
			headingText: "第 01 组 总时长：00:07",
		});

		expect(result.changed).toBe(true);
		expect(result.markdown).not.toContain("动作一");
		expect(result.markdown).toContain("## 第 02 组 总时长：00:05");
		expect(result.markdown.endsWith("\n")).toBe(true);
	});

	it("returns unchanged markdown when the reel section cannot be found", () => {
		const markdown = "# 分镜脚本\n";

		expect(
			removeStoryboardReelMarkdown(markdown, {
				blockId: "missing",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "第 01 组",
			}),
		).toEqual({ changed: false, markdown });
	});
});
