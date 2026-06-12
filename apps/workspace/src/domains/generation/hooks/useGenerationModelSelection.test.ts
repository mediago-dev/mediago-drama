import { act, renderHook, waitFor } from "@testing-library/react";
import type { KeyedMutator } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	GenerationModelsResponse,
	GenerationPreference,
} from "@/domains/generation/api/generation";
import type { StylePreset } from "@/domains/generation/api/prompt-presets";
import {
	emptyGenerationModelSelection,
	readGenerationModelSelection,
	readGenerationStylePresetId,
	useGenerationWorkspacePreferenceStore,
	writeGenerationModelSelection,
	writeGenerationStylePresetId,
} from "./useGenerationWorkspace.helpers";
import { useGenerationModelSelection } from "./useGenerationModelSelection";

const mutatePreferences = vi.fn() as unknown as KeyedMutator<GenerationPreference>;

const catalog: GenerationModelsResponse = {
	families: [
		{
			id: "family-image",
			label: "Image Family",
			kind: "image",
		},
		{
			id: "family-text",
			label: "Text Family",
			kind: "text",
		},
	],
	versions: [
		{
			id: "version-image",
			familyId: "family-image",
			label: "Image v1",
			kind: "image",
			canonicalModel: "image-model",
			capabilities: {
				async: false,
				supportsReferenceUrls: true,
			},
		},
		{
			id: "version-text",
			familyId: "family-text",
			label: "Text v1",
			kind: "text",
			canonicalModel: "text-model",
			capabilities: {
				async: false,
				supportsReferenceUrls: false,
			},
		},
	],
	routes: [
		{
			id: "route-image",
			familyId: "family-image",
			versionId: "version-image",
			label: "Image Route",
			kind: "image",
			provider: "openai",
			model: "image-model",
			adapter: "test.image",
			docUrl: "",
			async: false,
			supportsReferenceUrls: true,
			status: "available",
			configured: true,
			params: [
				{
					name: "size",
					label: "Size",
					type: "string",
					default: "1024x1024",
				},
			],
		},
		{
			id: "route-image-dmx",
			familyId: "family-image",
			versionId: "version-image",
			label: "Image DMX Route",
			kind: "image",
			provider: "dmx",
			model: "image-model-dmx",
			adapter: "test.image",
			docUrl: "",
			async: false,
			supportsReferenceUrls: true,
			status: "available",
			configured: true,
			params: [
				{
					name: "size",
					label: "Size",
					type: "string",
					default: "1024x1024",
				},
			],
		},
		{
			id: "route-text",
			familyId: "family-text",
			versionId: "version-text",
			label: "Text Route",
			kind: "text",
			provider: "openai",
			model: "text-model",
			adapter: "test.text",
			docUrl: "",
			async: false,
			supportsReferenceUrls: false,
			status: "available",
			configured: true,
			params: [],
		},
	],
	models: [],
	providers: [
		{ id: "openai", label: "OpenAI", providerType: "official" },
		{ id: "dmx", label: "DMX", providerType: "aggregator" },
	],
};

const stylePreset: StylePreset = {
	id: "preset-1",
	name: "Preset",
	layer: "style",
	prompt: "high contrast",
	source: "user",
};

describe("useGenerationModelSelection", () => {
	afterEach(() => {
		useGenerationWorkspacePreferenceStore.setState({
			modelSelection: emptyGenerationModelSelection(),
			stylePresetId: "",
		});
		localStorage.clear();
		vi.clearAllMocks();
	});

	it("hydrates stored local selection and applies route param updates", () => {
		writeGenerationModelSelection({
			familyIds: { image: "family-image" },
			versionIds: { "family-image": "version-image" },
			routeIds: { "version-image": "route-image" },
			routeParams: {
				"route-image": { size: "768x768" },
				"route-image-dmx": { size: "512x512" },
			},
		});
		writeGenerationStylePresetId(stylePreset.id);

		const { result } = renderHook(() =>
			useGenerationModelSelection({
				initialKind: "image",
				modelCatalog: catalog,
				mutatePreferences,
				preferenceScopeId: "",
				stylePresets: [stylePreset],
			}),
		);

		expect(result.current.selectedFamily.id).toBe("family-image");
		expect(result.current.selectedVersion.id).toBe("version-image");
		expect(result.current.selectedRoute.id).toBe("route-image");
		expect(result.current.selectedStylePreset?.id).toBe(stylePreset.id);
		expect(result.current.selectedParams).toEqual({ size: "768x768" });

		act(() => {
			result.current.updateRoute("route-image-dmx");
		});

		expect(result.current.selectedRoute.id).toBe("route-image-dmx");
		expect(result.current.selectedParams).toEqual({ size: "512x512" });

		act(() => {
			result.current.updateParam("size", "256x256");
		});

		expect(result.current.selectedParams).toEqual({ size: "256x256" });
		expect(readGenerationModelSelection().familyIds.image).toBe("family-image");
		expect(readGenerationModelSelection().routeIds["version-image"]).toBe("route-image-dmx");
		expect(readGenerationModelSelection().routeParams["route-image-dmx"]).toEqual({
			size: "256x256",
		});
		expect(readGenerationStylePresetId()).toBe(stylePreset.id);
	});

	it("syncs scoped preferences and clears stale style preset IDs", async () => {
		const { result, rerender } = renderHook(
			({ stylePresets }: { stylePresets: StylePreset[] }) =>
				useGenerationModelSelection({
					generationPreferences: {
						scopeId: "project-1",
						familyIds: { image: "family-image" },
						versionIds: { "family-image": "version-image" },
						routeIds: { "version-image": "route-image" },
						routeParams: { "route-image": { size: "768x768" } },
						stylePresetId: "missing-preset",
					},
					initialKind: "image",
					modelCatalog: catalog,
					mutatePreferences,
					preferenceScopeId: "project-1",
					stylePresets,
				}),
			{
				initialProps: { stylePresets: [] as StylePreset[] },
			},
		);

		await waitFor(() => {
			expect(result.current.selectedParams).toEqual({ size: "768x768" });
		});

		rerender({ stylePresets: [stylePreset] });

		await waitFor(() => {
			expect(result.current.stylePresetId).toBe("");
		});
	});
});
