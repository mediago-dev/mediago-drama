import { describe, expect, it } from "vitest";
import type { PromptPreset } from "@/domains/generation/api/prompt-presets";
import { promptInsertItemsFromPresets } from "./prompt-insertions";

const presets: PromptPreset[] = [
	{
		id: "extra-video",
		kind: "video",
		layer: "extra",
		name: "视频镜头",
		prompt: "推轨镜头，运动自然。",
		source: "user",
	},
	{
		id: "style-cinematic",
		layer: "style",
		name: "电影感",
		prompt: "电影感柔光。",
		source: "builtin",
	},
	{
		id: "extra-image",
		kind: "image",
		layer: "extra",
		name: "角色多视图",
		prompt: "同一角色三视图。",
		source: "user",
	},
	{
		id: "empty-style",
		layer: "style",
		name: "空风格",
		prompt: "",
		source: "user",
	},
];

describe("promptInsertItemsFromPresets", () => {
	it("exposes preset prompts for slash insertion without selected layer state", () => {
		const items = promptInsertItemsFromPresets(presets, "image");

		expect(items.map((item) => item.id)).toEqual(["style-cinematic", "extra-image"]);
		expect(items[0]).toEqual(
			expect.objectContaining({
				layerLabel: "风格",
				sourceLabel: "内置",
			}),
		);
		expect(items[1]).toEqual(
			expect.objectContaining({
				layerLabel: "其他",
				sourceLabel: "用户",
			}),
		);
	});
});
