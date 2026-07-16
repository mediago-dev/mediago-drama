import { describe, expect, it } from "vitest";
import type { PromptCategory } from "@/domains/generation/api/prompt-categories";
import type { PromptPreset } from "@/domains/generation/api/prompt-presets";
import { promptInsertItemsFromPresets } from "./prompt-insertions";

const presets: PromptPreset[] = [
	{
		id: "extra-video",
		category: "extra",
		name: "视频镜头",
		prompt: "推轨镜头，运动自然。",
		source: "user",
	},
	{
		id: "style-cinematic",
		category: "style",
		name: "电影感",
		prompt: "电影感柔光。",
		packId: "local.derivative",
		releaseId: "local-release",
		sourcePackageId: "com.mediago.cinematic",
		sourceReleaseId: "release-1",
		source: "pack",
	},
	{
		id: "extra-image",
		category: "extra",
		name: "角色多视图",
		prompt: "同一角色三视图。",
		source: "user",
	},
	{
		id: "empty-style",
		category: "style",
		name: "空风格",
		prompt: "",
		source: "user",
	},
];

const categories: PromptCategory[] = [
	{ id: "style", label: "风格", source: "pack", builtin: true },
	{ id: "extra", label: "通用", source: "pack", builtin: true },
];

describe("promptInsertItemsFromPresets", () => {
	it("exposes preset prompts for slash insertion without selected category state", () => {
		const items = promptInsertItemsFromPresets(presets, categories);

		expect(items.map((item) => item.id)).toEqual(["style-cinematic", "extra-image", "extra-video"]);
		expect(items[0]).toEqual(
			expect.objectContaining({
				categoryLabel: "风格",
				sourceRef: {
					packageId: "com.mediago.cinematic",
					releaseId: "release-1",
				},
				sourceLabel: "来自包",
			}),
		);
		expect(items[1]).toEqual(
			expect.objectContaining({
				categoryLabel: "通用",
				sourceLabel: "用户新增",
			}),
		);
	});
});
