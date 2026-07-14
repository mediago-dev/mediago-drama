import { beforeEach, describe, expect, it, vi } from "vitest";
import { batchGenerationConfirmButtonLabel } from "./BatchGenerationSettingsDialog";
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

		const image = freshStore.getState().settingsByKind.image;
		expect(image).toMatchObject({
			promptOptimizeItemId: "legacy-pack",
			promptOptimizeRouteId: "legacy-text-route",
			promptSupplementItemIds: ["legacy-supplement-pack"],
			routeId: "legacy-image-route",
			usePromptOptimization: true,
			usePromptSupplement: true,
		});
		expect(image).not.toHaveProperty("promptSupplementItemId");
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
				promptSupplementItemIds: ["prompt-pack-extra"],
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
			promptSupplementItemIds: ["prompt-pack-extra", "prompt-pack-camera"],
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
				promptSupplementItemIds: ["prompt-pack-extra", "prompt-pack-camera"],
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
						promptSupplementItemIds: ["prompt-pack-extra", "prompt-pack-camera"],
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
