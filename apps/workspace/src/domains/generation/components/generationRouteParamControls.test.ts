import { describe, expect, it } from "vitest";
import type { GenerationRoute } from "@/domains/generation/api/generation";
import { resolveGenerationRouteParamControls } from "./generationRouteParamControls";

describe("resolveGenerationRouteParamControls", () => {
	it("maps every route-schema param to the same batch and Agent control groups", () => {
		const controls = resolveGenerationRouteParamControls(route(), {
			aspectRatio: "16:9",
			resolution: "2K",
			n: 2,
			duration: "10",
			style: "anime",
			enhance: true,
			steps: 24,
			negativePrompt: "watermark",
		});

		expect(controls.imageSpec?.selectedRatio?.value).toBe("16:9");
		expect(controls.imageSpec?.selectedResolution?.value).toBe("2K");
		expect(controls.generationCountParam?.name).toBe("n");
		expect(controls.primaryParamGroups.map((group) => group.id)).toEqual(["duration"]);
		expect(controls.secondaryRouteParams.map((param) => param.name)).toEqual([
			"style",
			"enhance",
			"steps",
			"negativePrompt",
		]);
	});
});

const route = (): GenerationRoute =>
	({
		id: "test.route",
		familyId: "test-family",
		versionId: "test-version",
		kind: "image",
		label: "Test",
		provider: "test",
		model: "test-model",
		status: "available",
		configured: true,
		params: [
			{
				name: "aspectRatio",
				label: "比例",
				type: "select",
				default: "1:1",
				options: [
					{ label: "1:1", value: "1:1" },
					{ label: "16:9", value: "16:9" },
				],
			},
			{
				name: "resolution",
				label: "分辨率",
				type: "select",
				default: "1K",
				options: [
					{ label: "1K", value: "1K" },
					{ label: "2K", value: "2K" },
				],
			},
			{ name: "n", label: "数量", type: "number", default: 1, min: 1, max: 4 },
			{
				name: "duration",
				label: "时长",
				type: "select",
				default: "5",
				options: [
					{ label: "5 秒", value: "5" },
					{ label: "10 秒", value: "10" },
				],
			},
			{
				name: "style",
				label: "风格",
				type: "select",
				default: "realistic",
				options: [
					{ label: "写实", value: "realistic" },
					{ label: "动漫", value: "anime" },
				],
			},
			{ name: "enhance", label: "增强", type: "boolean", default: false },
			{ name: "steps", label: "步数", type: "number", default: 20, min: 1, max: 50 },
			{ name: "negativePrompt", label: "负面提示词", type: "text", default: "" },
		],
		paramGroups: [
			{ id: "size", label: "大小", params: ["aspectRatio", "resolution"] },
			{ id: "count", label: "数量", params: ["n"] },
			{ id: "duration", label: "时长", params: ["duration"] },
			{ id: "other", label: "其他", params: ["style"] },
		],
	}) as GenerationRoute;
