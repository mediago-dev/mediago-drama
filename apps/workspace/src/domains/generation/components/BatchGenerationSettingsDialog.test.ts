import { describe, expect, it } from "vitest";
import type { GenerationRoute } from "@/domains/generation/api/generation";
import {
	batchGenerationParamsForConfirm,
	batchGenerationPromptOptimizationForConfirm,
} from "./BatchGenerationSettingsDialog";

describe("batchGenerationParamsForConfirm", () => {
	it("uses the visible count value when confirming supported count params", () => {
		const route = generationRoute([
			{ name: "n", type: "number" },
			{ name: "ratio", type: "select" },
		]);

		expect(
			batchGenerationParamsForConfirm(route, { n: 3, ratio: "16:9", stale: true }, "n", 1),
		).toEqual({
			n: 1,
			ratio: "16:9",
		});
	});

	it("drops stale count params when the selected route has no count control", () => {
		const route = generationRoute([{ name: "duration", type: "number" }]);

		expect(batchGenerationParamsForConfirm(route, { duration: 5, n: 3 })).toEqual({
			duration: 5,
		});
	});
});

describe("batchGenerationPromptOptimizationForConfirm", () => {
	it("builds the optimization request from the selected prompt pack and text model", () => {
		expect(
			batchGenerationPromptOptimizationForConfirm(
				{
					name: "电影感提示词",
					prompt: "  强化镜头语言、光影与构图。  ",
				},
				{
					route: {
						id: "text-route",
						model: "text-model",
					},
				},
			),
		).toEqual({
			model: "text-model",
			referenceName: "电影感提示词",
			referencePrompt: "强化镜头语言、光影与构图。",
			routeId: "text-route",
		});
	});

	it("skips optimization when the prompt pack or text model is missing", () => {
		expect(batchGenerationPromptOptimizationForConfirm(null, null)).toBeUndefined();
		expect(
			batchGenerationPromptOptimizationForConfirm({ name: "空提示词", prompt: " " }, null),
		).toBeUndefined();
	});
});

const generationRoute = (
	params: Array<{ name: string; type: "boolean" | "number" | "select" | "text" }>,
) =>
	({
		params,
	}) as Pick<GenerationRoute, "params">;
