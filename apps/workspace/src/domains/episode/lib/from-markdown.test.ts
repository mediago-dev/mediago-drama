import { describe, expect, it } from "vitest";
import {
	createEpisodeFromMarkdownDocument,
	createEpisodeFromStoryboard,
} from "@/domains/episode/lib/from-markdown";
import type { MarkdownDocument } from "@/domains/documents/stores";

const createMarkdownDocument = (
	content: string,
	overrides: Partial<MarkdownDocument> = {},
): MarkdownDocument => ({
	id: "doc-1",
	title: "测试剧集",
	content,
	category: undefined,
	parentId: null,
	sortOrder: 0,
	version: 1,
	updatedAt: "2026-05-30T00:00:00.000Z",
	isDirty: false,
	comments: [],
	workbenchDraft: null,
	...overrides,
});

describe("createEpisodeFromMarkdownDocument", () => {
	it("creates timeline clips from markdown headings", () => {
		const episode = createEpisodeFromMarkdownDocument(
			createMarkdownDocument("duration: 36\n# 第一幕\n\n开场动作\n\n## 第二幕\n\n转场动作"),
		);

		expect(episode.id).toBe("episode-doc-1");
		expect(episode.duration).toBe(36);
		expect(episode.sections.map((section) => section.title)).toEqual(["第一幕", "第二幕"]);
		expect(episode.tracks.find((track) => track.id === "track-caption")?.clips[0]?.content).toBe(
			"第一幕",
		);
	});
});

describe("createEpisodeFromStoryboard", () => {
	it("extracts storyboard video, voiceover, and caption tracks", () => {
		const episode = createEpisodeFromStoryboard(
			createMarkdownDocument(
				"## 分镜 1\n\n- 推近主角\n- 旁白（女）：命运开始转动。\n- 对白（男）：开始吧。\n\n## 镜头 2\n\n远景切换",
				{ category: "storyboard" },
			),
		);

		expect(episode.sections).toHaveLength(2);
		expect(episode.sections[0]?.summary).toBe("推近主角");
		expect(episode.tracks.find((track) => track.id === "track-voiceover")?.clips[0]?.content).toBe(
			"旁白（女）：命运开始转动。",
		);
		expect(episode.tracks.find((track) => track.id === "track-caption")?.clips[0]?.content).toBe(
			"对白（男）：开始吧。",
		);
	});

	it("groups shots under each group heading into one section per group", () => {
		const episode = createEpisodeFromStoryboard(
			createMarkdownDocument(
				[
					"# 分镜脚本",
					"",
					"## 第 01 组 总时长：00:07",
					"",
					"### 分镜 01",
					"",
					"下沉动作",
					"",
					"#### 镜头备注",
					"",
					"水面远景",
					"",
					"### 分镜 02",
					"",
					"漂离动作",
					"",
					"## 第 02 组 总时长：00:04",
					"",
					"### 分镜 01",
					"",
					"醒来动作",
				].join("\n"),
				{ category: "storyboard" },
			),
		);

		expect(episode.sections.map((section) => section.title)).toEqual([
			"第 01 组 总时长：00:07",
			"第 02 组 总时长：00:04",
		]);
		// 组内多个分镜被拼进同一个组的提示词。
		expect(episode.sections[0]?.summary).toBe(
			"分镜 01\n下沉动作\n镜头备注\n水面远景\n分镜 02\n漂离动作",
		);
		expect(episode.sections[1]?.summary).toBe("分镜 01\n醒来动作");
		// 一组 = 一个视频片段。
		expect(episode.tracks.find((track) => track.id === "track-video")?.clips).toHaveLength(2);
	});

	it("builds one group clip with concatenated Seedance prompt and dialogue track", () => {
		const episode = createEpisodeFromStoryboard(
			createMarkdownDocument(
				[
					"# 第一章 抽到天级反派模板！–分镜脚本",
					"",
					"## 第 01 组 总时长：00:13.50",
					"",
					"### 分镜 01",
					"",
					"**时间**：0.00-3.00秒",
					"",
					"**动作**：沈阁从黑暗水面坠入湖中。",
					"",
					"**台词**：无",
					"",
					"### 分镜 02",
					"",
					"**时间**：3.00-7.00秒",
					"",
					"**动作**：他猛然睁眼。",
					"",
					"**台词**：沈阁：“我还活着。”（音色：低沉）",
				].join("\n"),
				{ category: "storyboard" },
			),
		);

		const videoClips = episode.tracks.find((track) => track.id === "track-video")?.clips ?? [];
		expect(videoClips).toHaveLength(1);
		expect(videoClips[0]?.title).toBe("第 01 组 总时长：00:13.50");
		// 提示词去掉 ** 加粗标记，并拼接组内全部分镜字段。
		expect(videoClips[0]?.prompt).toContain("动作：沈阁从黑暗水面坠入湖中。");
		expect(videoClips[0]?.prompt).toContain("动作：他猛然睁眼。");
		expect(videoClips[0]?.prompt).not.toContain("**");
		// 台词抽取到旁白轨，"无" 被忽略。
		const voiceover = episode.tracks.find((track) => track.id === "track-voiceover")?.clips[0];
		expect(voiceover?.content).toBe("沈阁：“我还活着。”（音色：低沉）");
	});
});
