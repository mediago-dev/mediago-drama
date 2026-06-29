import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationRoute } from "@/domains/generation/api/generation";
import {
	batchGenerationConfirmButtonLabel,
	batchGenerationParamsForConfirm,
	batchGenerationPromptOptimizationForConfirm,
	batchGenerationPromptSupplementForConfirm,
} from "./BatchGenerationSettingsDialog";
import {
	batchGenerationPromptOptimizationEnabled,
	batchGenerationPromptSupplementEnabled,
	batchGenerationSettingsStorageKey,
	useBatchGenerationSettingsPreferenceStore,
} from "../stores/batch-generation-settings";

beforeEach(() => {
	localStorage.removeItem(batchGenerationSettingsStorageKey);
	useBatchGenerationSettingsPreferenceStore.setState({ settingsByKind: {} });
});

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

describe("batchGenerationPromptSupplementForConfirm", () => {
	it("builds the prompt supplement request from the selected prompt pack", () => {
		expect(
			batchGenerationPromptSupplementForConfirm({
				name: "电影感提示词",
				prompt: "  强化镜头语言、光影与构图。  ",
			}),
		).toEqual({
			referenceName: "电影感提示词",
			referencePrompt: "强化镜头语言、光影与构图。",
		});
	});

	it("skips prompt supplement when the prompt pack is missing or empty", () => {
		expect(batchGenerationPromptSupplementForConfirm(null)).toBeUndefined();
		expect(
			batchGenerationPromptSupplementForConfirm({ name: "空提示词", prompt: " " }),
		).toBeUndefined();
	});
});

describe("batchGenerationConfirmButtonLabel", () => {
	it("uses the optimize label only when prompt optimization is enabled", () => {
		expect(batchGenerationConfirmButtonLabel(true)).toBe("优化并生成");
		expect(batchGenerationConfirmButtonLabel(false)).toBe("生成");
	});
});

describe("batchGenerationPromptOptimizationEnabled", () => {
	it("defaults prompt optimization to off before the user saves a preference", () => {
		expect(batchGenerationPromptOptimizationEnabled(null)).toBe(false);
		expect(batchGenerationPromptOptimizationEnabled({})).toBe(false);
	});
});

describe("batchGenerationPromptSupplementEnabled", () => {
	it("defaults prompt supplement to off before the user saves a preference", () => {
		expect(batchGenerationPromptSupplementEnabled(null)).toBe(false);
		expect(batchGenerationPromptSupplementEnabled({})).toBe(false);
	});
});

describe("batchGeneration settings preference storage", () => {
	it("hydrates legacy raw batch dialog settings", async () => {
		localStorage.setItem(
			batchGenerationSettingsStorageKey,
			JSON.stringify({
				image: {
					promptOptimizeItemId: "legacy-pack",
					promptOptimizeRouteId: "legacy-text-route",
					promptSupplementItemId: "legacy-supplement-pack",
					routeId: "legacy-image-route",
					usePromptOptimization: true,
					usePromptSupplement: true,
				},
			}),
		);
		vi.resetModules();

		const { useBatchGenerationSettingsPreferenceStore: freshStore } =
			await import("../stores/batch-generation-settings");

		expect(freshStore.getState().settingsByKind.image).toMatchObject({
			promptOptimizeItemId: "legacy-pack",
			promptOptimizeRouteId: "legacy-text-route",
			promptSupplementItemId: "legacy-supplement-pack",
			routeId: "legacy-image-route",
			usePromptOptimization: true,
			usePromptSupplement: true,
		});
	});

	it("hydrates persisted batch dialog settings", async () => {
		localStorage.setItem(
			batchGenerationSettingsStorageKey,
			JSON.stringify({
				state: {
					settingsByKind: {
						image: {
							promptOptimizeItemId: "prompt-pack-2",
							promptOptimizeRouteId: "text-route-2",
							promptSupplementItemId: "prompt-pack-extra",
							routeId: "image-route-2",
							usePromptOptimization: true,
							usePromptSupplement: true,
						},
					},
				},
				version: 1,
			}),
		);

		await useBatchGenerationSettingsPreferenceStore.persist.rehydrate();

		expect(useBatchGenerationSettingsPreferenceStore.getState().settingsByKind.image).toMatchObject(
			{
				promptOptimizeItemId: "prompt-pack-2",
				promptOptimizeRouteId: "text-route-2",
				promptSupplementItemId: "prompt-pack-extra",
				routeId: "image-route-2",
				usePromptOptimization: true,
				usePromptSupplement: true,
			},
		);
	});

	it("persists the last batch dialog settings per generation kind", () => {
		useBatchGenerationSettingsPreferenceStore.getState().setSettings("image", {
			familyId: "seedream",
			params: { aspectRatio: "3:4", n: 2 },
			promptOptimizeItemId: "prompt-pack-1",
			promptOptimizeRouteId: "text-route-1",
			promptSupplementItemId: "prompt-pack-extra",
			routeId: "image-route-1",
			usePromptOptimization: true,
			usePromptSupplement: true,
			versionId: "image-version-1",
		});
		useBatchGenerationSettingsPreferenceStore.getState().setSettings("video", {
			params: { duration: 5 },
			routeId: "video-route-1",
			usePromptOptimization: false,
			usePromptSupplement: false,
		});

		expect(useBatchGenerationSettingsPreferenceStore.getState().settingsByKind.image).toMatchObject(
			{
				familyId: "seedream",
				params: { aspectRatio: "3:4", n: 2 },
				promptOptimizeItemId: "prompt-pack-1",
				promptOptimizeRouteId: "text-route-1",
				promptSupplementItemId: "prompt-pack-extra",
				routeId: "image-route-1",
				usePromptOptimization: true,
				usePromptSupplement: true,
				versionId: "image-version-1",
			},
		);
		expect(useBatchGenerationSettingsPreferenceStore.getState().settingsByKind.video).toMatchObject(
			{
				params: { duration: 5 },
				routeId: "video-route-1",
				usePromptOptimization: false,
				usePromptSupplement: false,
			},
		);
		expect(
			JSON.parse(localStorage.getItem(batchGenerationSettingsStorageKey) ?? "{}"),
		).toMatchObject({
			state: {
				settingsByKind: {
					image: {
						promptOptimizeItemId: "prompt-pack-1",
						promptOptimizeRouteId: "text-route-1",
						promptSupplementItemId: "prompt-pack-extra",
						routeId: "image-route-1",
						usePromptOptimization: true,
						usePromptSupplement: true,
					},
					video: {
						routeId: "video-route-1",
						usePromptOptimization: false,
						usePromptSupplement: false,
					},
				},
			},
			version: 1,
		});
	});
});

const generationRoute = (
	params: Array<{ name: string; type: "boolean" | "number" | "select" | "text" }>,
) =>
	({
		params,
	}) as Pick<GenerationRoute, "params">;
