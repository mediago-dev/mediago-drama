import { describe, expect, it } from "vitest";
import {
	parseStoryboardShots,
	readStoryboardLaneSources,
} from "@/domains/episode/lib/storyboard-shots";
import { createSectionBlockId } from "@/domains/documents/lib/sections";

describe("parseStoryboardShots", () => {
	it("keeps body text for shots without structured fields", () => {
		const shots = parseStoryboardShots(
			["### 分镜 01", "", "陈远推开门。", "林书彤回头。"].join("\n"),
		);

		expect(shots).toEqual([
			{
				prompt: "陈远推开门。\n林书彤回头。",
				text: "陈远推开门。\n林书彤回头。",
				title: "分镜 01",
			},
		]);
	});

	it("parses range and single-value durations", () => {
		const shots = parseStoryboardShots(
			[
				"### 分镜 01",
				"",
				"**时长**：4.00-7.50秒",
				"",
				"**动作**：陈远靠近。",
				"",
				"### 分镜 02",
				"",
				"**时间**：3秒",
				"",
				"**画面**：林书彤后退。",
			].join("\n"),
		);

		expect(shots[0]).toEqual(
			expect.objectContaining({
				durationLabel: "4.00-7.50秒",
				durationSeconds: 3.5,
				text: "陈远靠近。",
			}),
		);
		expect(shots[1]).toEqual(
			expect.objectContaining({
				durationLabel: "3秒",
				durationSeconds: 3,
				text: "林书彤后退。",
			}),
		);
	});
});

describe("readStoryboardLaneSources", () => {
	it("returns a group lane with fallback shot text when the group has no shot headings", () => {
		const lanes = readStoryboardLaneSources(
			["# 分镜脚本", "", "## 开场落水", "", "陈远站在校门口。"].join("\n"),
			{ documentId: "story-doc" },
		);

		expect(lanes).toHaveLength(1);
		expect(lanes[0]).toEqual(
			expect.objectContaining({
				blockId: createSectionBlockId("story-doc", 2, 1, "开场落水"),
				headingLevel: 2,
				headingOccurrence: 1,
				title: "开场落水",
			}),
		);
		expect(lanes[0]?.shots).toEqual([
			{
				prompt: "开场落水\n陈远站在校门口。",
				text: "开场落水\n陈远站在校门口。",
				title: "文字分镜",
			},
		]);
	});

	it("prefers explicit section ids before storyboard lane headings", () => {
		const lanes = readStoryboardLaneSources(
			[
				"# 分镜脚本",
				"",
				"<!-- section-id: section_reel_01 -->",
				"## 开场落水",
				"",
				"陈远站在校门口。",
			].join("\n"),
			{ documentId: "story-doc" },
		);

		expect(lanes[0]?.blockId).toBe("section_reel_01");
	});
});
