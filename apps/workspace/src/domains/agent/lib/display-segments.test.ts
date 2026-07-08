import { describe, expect, it } from "vitest";
import {
	displaySegmentsFromMetadata,
	displaySegmentsToText,
	hasRichDisplaySegment,
	normalizeDisplaySegments,
} from "./display-segments";

describe("display segments", () => {
	it("merges adjacent text runs and trims the outer whitespace", () => {
		expect(
			normalizeDisplaySegments([
				{ type: "text", text: "  " },
				{ type: "mention", title: "角色档案" },
				{ type: "text", text: " 整理" },
				{ type: "text", text: "人物 " },
			]),
		).toEqual([
			{ type: "mention", title: "角色档案" },
			{ type: "text", text: " 整理人物" },
		]);
	});

	it("detects chips among plain text", () => {
		expect(hasRichDisplaySegment([{ type: "text", text: "你好" }])).toBe(false);
		expect(
			hasRichDisplaySegment([
				{ type: "text", text: "你好" },
				{ type: "skill", name: "screenplay-writer" },
			]),
		).toBe(true);
	});

	it("shape-checks untyped metadata from transcript snapshots", () => {
		const segments = displaySegmentsFromMetadata({
			displaySegments: [
				{ type: "skill", name: "screenplay-writer", title: "剧本写作" },
				{ type: "mention", title: "角色档案", category: "character" },
				{ type: "text", text: " 整理人物" },
				{ type: "mention" }, // missing title → dropped
				{ type: "unknown", text: "?" }, // unknown type → dropped
				"not-an-object",
			] as never,
		});

		expect(segments).toEqual([
			{ type: "skill", name: "screenplay-writer", title: "剧本写作" },
			{ type: "mention", title: "角色档案", category: "character" },
			{ type: "text", text: " 整理人物" },
		]);
	});

	it("returns no segments when metadata is missing or malformed", () => {
		expect(displaySegmentsFromMetadata(undefined)).toEqual([]);
		expect(displaySegmentsFromMetadata({ displaySegments: "oops" as never })).toEqual([]);
	});

	it("renders segments back to the plain-text prompt form", () => {
		expect(
			displaySegmentsToText([
				{ type: "mention", title: "完美世界.txt", kind: "asset" },
				{ type: "text", text: " 这个文档转换成 utf8 编码吗？" },
			]),
		).toBe("@完美世界.txt 这个文档转换成 utf8 编码吗？");
		expect(
			displaySegmentsToText([
				{ type: "skill", name: "character-writer", title: "角色小传" },
				{ type: "text", text: "\n整理人物" },
			]),
		).toBe("角色小传\n整理人物");
		expect(displaySegmentsToText([{ type: "skill", name: "character-writer" }])).toBe(
			"character-writer",
		);
	});
});
