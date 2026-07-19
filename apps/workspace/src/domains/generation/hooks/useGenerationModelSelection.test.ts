import { act, renderHook, waitFor } from "@testing-library/react";
import type { KeyedMutator } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateGenerationPreferences } from "@/domains/generation/api/generation";
import type {
	GenerationModelsResponse,
	GenerationPreference,
} from "@/domains/generation/api/generation";
import type { StylePreset } from "@/domains/generation/api/prompt-presets";
import {
	emptyGenerationModelSelection,
	readGenerationModelSelection,
	readGenerationStylePresetId,
	type StoredGenerationModelSelection,
	useGenerationWorkspacePreferenceStore,
	writeGenerationModelSelection,
	writeGenerationStylePresetId,
} from "./useGenerationWorkspace.helpers";
import { useGenerationModelSelection } from "./useGenerationModelSelection";

vi.mock("@/domains/generation/api/generation", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/generation/api/generation")>();

	return {
		...actual,
		updateGenerationPreferences: vi.fn(
			async (scopeId: string, preferences: Omit<GenerationPreference, "scopeId">) => ({
				scopeId,
				...preferences,
			}),
		),
	};
});

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
			id: "version-image-alt",
			familyId: "family-image",
			label: "Image v2",
			kind: "image",
			canonicalModel: "image-model-alt",
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
			id: "route-image-openrouter",
			familyId: "family-image",
			versionId: "version-image",
			label: "Image OpenRouter Route",
			kind: "image",
			provider: "openrouter",
			model: "image-model-openrouter",
			adapter: "test.image",
			docUrl: "",
			async: false,
			supportsReferenceUrls: true,
			status: "available",
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
			id: "route-image-alt",
			familyId: "family-image",
			versionId: "version-image-alt",
			label: "Image Alt Route",
			kind: "image",
			provider: "openai",
			model: "image-model-alt",
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
		{ id: "openrouter", label: "OpenRouter", providerType: "aggregator" },
	],
};

const stylePreset: StylePreset = {
	id: "preset-1",
	name: "Preset",
	category: "style",
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
				"route-image": { size: "768x768", watermark: true, seed: 42 },
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
		expect(result.current.visibleFamilyRoutes.map((route) => route.id)).toEqual([
			"route-image",
			"route-image-dmx",
			"route-image-alt",
		]);
		expect(result.current.visibleRoutes.map((route) => route.id)).toEqual([
			"route-image",
			"route-image-dmx",
		]);

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

		act(() => {
			result.current.updateRoute("route-image");
		});

		expect(result.current.selectedParams).toEqual({ size: "768x768" });

		act(() => {
			result.current.updateRoute("route-image-dmx");
		});

		expect(result.current.selectedParams).toEqual({ size: "256x256" });

		act(() => {
			result.current.updateModelRoute("version-image-alt", "route-image-alt");
		});

		expect(result.current.selectedVersion.id).toBe("version-image-alt");
		expect(result.current.selectedRoute.id).toBe("route-image-alt");
		expect(readGenerationModelSelection().versionIds["family-image"]).toBe("version-image-alt");
		expect(readGenerationModelSelection().routeIds["version-image-alt"]).toBe("route-image-alt");
	});

	it("uses dialog initial model selection when persistence is disabled", async () => {
		const jimengCatalog: GenerationModelsResponse = {
			...catalog,
			families: [
				...catalog.families,
				{
					id: "family-jimeng-local",
					label: "即梦本地",
					kind: "image",
				},
			],
			versions: [
				...catalog.versions,
				{
					id: "version-jimeng-local",
					familyId: "family-jimeng-local",
					label: "即梦本地",
					kind: "image",
					canonicalModel: "jimeng-local",
					capabilities: {
						async: false,
						supportsReferenceUrls: true,
					},
				},
			],
			routes: [
				...catalog.routes,
				{
					id: "route-jimeng-local",
					familyId: "family-jimeng-local",
					versionId: "version-jimeng-local",
					label: "即梦本地",
					kind: "image",
					provider: "dmx",
					model: "jimeng-local",
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
			],
		};
		const projectPreference: GenerationPreference = {
			scopeId: "project-1",
			familyIds: { image: "family-image" },
			versionIds: { "family-image": "version-image" },
			routeIds: { "version-image": "route-image" },
			routeParams: { "route-image": { size: "1024x1024" } },
			stylePresetId: "",
		};
		const jimengSelection: StoredGenerationModelSelection = {
			familyIds: { image: "family-jimeng-local" },
			versionIds: { "family-jimeng-local": "version-jimeng-local" },
			routeIds: { "version-jimeng-local": "route-jimeng-local" },
			routeParams: { "route-jimeng-local": { size: "768x768" } },
		};
		const gptSelection: StoredGenerationModelSelection = {
			familyIds: { image: "family-image" },
			versionIds: { "family-image": "version-image" },
			routeIds: { "version-image": "route-image-dmx" },
			routeParams: { "route-image-dmx": { size: "512x512" } },
		};

		const { result, rerender } = renderHook(
			({
				initialModelSelection,
				initialModelSelectionKey,
			}: {
				initialModelSelection: StoredGenerationModelSelection;
				initialModelSelectionKey: string;
			}) =>
				useGenerationModelSelection({
					generationPreferences: projectPreference,
					initialKind: "image",
					initialModelSelection,
					initialModelSelectionKey,
					modelCatalog: jimengCatalog,
					mutatePreferences,
					persistSelection: false,
					preferenceScopeId: "project-1",
					stylePresets: [],
				}),
			{
				initialProps: {
					initialModelSelection: jimengSelection,
					initialModelSelectionKey: "jimeng-local",
				},
			},
		);

		expect(result.current.selectedFamily.id).toBe("family-jimeng-local");
		expect(result.current.selectedRoute.id).toBe("route-jimeng-local");
		expect(result.current.selectedParams).toEqual({ size: "768x768" });
		expect(readGenerationModelSelection()).toEqual(emptyGenerationModelSelection());

		rerender({
			initialModelSelection: gptSelection,
			initialModelSelectionKey: "gpt-dmx",
		});

		await waitFor(() => {
			expect(result.current.selectedRoute.id).toBe("route-image-dmx");
		});
		expect(result.current.selectedParams).toEqual({ size: "512x512" });
		expect(readGenerationModelSelection()).toEqual(emptyGenerationModelSelection());
		expect(updateGenerationPreferences).not.toHaveBeenCalled();
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
		await waitFor(() => {
			expect(readGenerationModelSelection().routeParams["route-image"]).toEqual({
				size: "768x768",
			});
		});

		rerender({ stylePresets: [stylePreset] });

		await waitFor(() => {
			expect(result.current.stylePresetId).toBe("");
		});
	});

	it("immediately remembers the submitted model selection for scoped preferences", async () => {
		const { result } = renderHook(() =>
			useGenerationModelSelection({
				generationPreferences: {
					scopeId: "project-1",
					familyIds: { image: "family-image" },
					versionIds: { "family-image": "version-image" },
					routeIds: { "version-image": "route-image" },
					routeParams: {},
					stylePresetId: "",
				},
				initialKind: "image",
				modelCatalog: catalog,
				mutatePreferences,
				preferenceScopeId: "project-1",
				stylePresets: [],
			}),
		);

		await waitFor(() => {
			expect(result.current.selectedRoute.id).toBe("route-image");
		});

		act(() => {
			result.current.updateModelRoute("version-image-alt", "route-image-alt");
		});
		act(() => {
			result.current.updateParam("size", "640x640");
		});
		act(() => {
			result.current.rememberSelectedModel();
		});

		expect(readGenerationModelSelection()).toEqual(
			expect.objectContaining({
				familyIds: expect.objectContaining({ image: "family-image" }),
				routeIds: expect.objectContaining({ "version-image-alt": "route-image-alt" }),
				routeParams: expect.objectContaining({
					"route-image-alt": { size: "640x640" },
				}),
				versionIds: { "family-image": "version-image-alt" },
			}),
		);
		expect(updateGenerationPreferences).toHaveBeenCalledWith(
			"project-1",
			expect.objectContaining({
				familyIds: expect.objectContaining({ image: "family-image" }),
				routeIds: expect.objectContaining({
					"version-image": "route-image",
					"version-image-alt": "route-image-alt",
				}),
				versionIds: { "family-image": "version-image-alt" },
			}),
		);
		await waitFor(() => {
			expect(mutatePreferences).toHaveBeenCalledWith(
				expect.objectContaining({
					scopeId: "project-1",
					routeIds: expect.objectContaining({
						"version-image-alt": "route-image-alt",
					}),
				}),
				false,
			);
		});
	});
});
