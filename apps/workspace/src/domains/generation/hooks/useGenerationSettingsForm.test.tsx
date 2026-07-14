import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	GenerationModelsResponse,
	GenerationRoute,
} from "@/domains/generation/api/generation";
import type { PromptInsertItem } from "@/domains/generation/components/PromptSlashCommand";
import type { MediaAsset } from "@/domains/workspace/api/media";
import {
	batchGenerationSettingsStorageKey,
	useBatchGenerationSettingsPreferenceStore,
} from "@/domains/generation/stores/batch-generation-settings";
import { useGenerationSettingsForm } from "./useGenerationSettingsForm";

const workspaceMock = vi.hoisted(() => ({
	current: {} as Record<string, unknown>,
	useGenerationWorkspace: vi.fn(),
}));

vi.mock("@/domains/generation/hooks/useGenerationWorkspace", () => ({
	useGenerationWorkspace: workspaceMock.useGenerationWorkspace,
}));

const promptItems: PromptInsertItem[] = [
	{
		categoryLabel: "风格",
		id: "pack-style",
		name: "二维动画",
		prompt: "干净的二维动画线条",
	},
	{
		categoryLabel: "镜头",
		id: "pack-camera",
		name: "推进镜头",
		prompt: "缓慢推进镜头",
	},
	{
		categoryLabel: "优化",
		id: "pack-optimize",
		name: "电影感优化",
		prompt: "增强镜头语言与光影层次",
	},
];

const imageAsset: MediaAsset = {
	createdAt: "2026-07-15T00:00:00.000Z",
	filename: "reference.png",
	id: "asset-image",
	kind: "image",
	mimeType: "image/png",
	sizeBytes: 1024,
	updatedAt: "2026-07-15T00:00:00.000Z",
	url: "/api/v1/media-assets/asset-image/content",
};

describe("useGenerationSettingsForm", () => {
	afterEach(cleanup);

	beforeEach(() => {
		localStorage.removeItem(batchGenerationSettingsStorageKey);
		useBatchGenerationSettingsPreferenceStore.setState({ settingsByKind: {} });
		workspaceMock.current = workspaceValue();
		workspaceMock.useGenerationWorkspace.mockImplementation(() => workspaceMock.current);
		workspaceMock.useGenerationWorkspace.mockClear();
	});

	it("restores_last_settings_for_kind", async () => {
		useBatchGenerationSettingsPreferenceStore.getState().setSettings("image", {
			familyId: "family-image",
			params: { n: 2, ratio: "3:4", resolution: "1k", style: "anime" },
			promptOptimizeItemId: "pack-optimize",
			promptOptimizeRouteId: "route-text",
			promptSupplementItemIds: ["pack-style", "pack-camera"],
			routeId: "route-reference",
			usePromptOptimization: true,
			usePromptSupplement: true,
			versionId: "version-image",
		});

		const { result } = renderHook(() => useGenerationSettingsForm({ kind: "image" }));

		await waitFor(() => expect(result.current.isReady).toBe(true));
		expect(result.current.value).toMatchObject({
			params: { n: 2, ratio: "3:4", resolution: "1k", style: "anime" },
			promptOptimization: {
				enabled: true,
				referenceId: "pack-optimize",
				routeId: "route-text",
			},
			routeId: "route-reference",
		});
		expect(result.current.selectedPromptSupplementItems.map((item) => item.id)).toEqual([
			"pack-style",
			"pack-camera",
		]);
	});

	it("explicit_task_defaults_win_over_saved_preferences", async () => {
		useBatchGenerationSettingsPreferenceStore.getState().setSettings("image", {
			params: { style: "realistic" },
			routeId: "route-reference",
		});

		const { result } = renderHook(() =>
			useGenerationSettingsForm({
				defaultValue: {
					params: { style: "anime" },
					referenceAssetIds: ["asset-image"],
					routeId: "route-second",
				},
				kind: "image",
			}),
		);

		await waitFor(() => expect(result.current.value.routeId).toBe("route-second"));
		expect(result.current.value.params.style).toBe("anime");
		expect(result.current.value.referenceAssetIds).toEqual(["asset-image"]);
	});

	it("preserves_current_edits_after_catalog_refresh", async () => {
		const { result, rerender } = renderHook(() => useGenerationSettingsForm({ kind: "image" }));
		await waitFor(() => expect(result.current.isReady).toBe(true));

		act(() => result.current.updateParam("style", "anime"));
		expect(result.current.value.params.style).toBe("anime");

		workspaceMock.current = {
			...workspaceMock.current,
			catalog: {
				...catalog,
				routes: catalog.routes.map((route) => ({ ...route })),
			},
		};
		rerender();

		await waitFor(() => expect(result.current.value.params.style).toBe("anime"));
	});

	it("prunes_deleted_prompt_pack_ids_after_catalog_load", async () => {
		useBatchGenerationSettingsPreferenceStore.getState().setSettings("image", {
			promptSupplementItemIds: ["pack-deleted", "pack-camera"],
			routeId: "route-reference",
			usePromptSupplement: true,
		});
		const { result, rerender } = renderHook(() => useGenerationSettingsForm({ kind: "image" }));

		await waitFor(() =>
			expect(result.current.selectedPromptSupplementItems.map((item) => item.id)).toEqual([
				"pack-camera",
			]),
		);
		const customStylePack: PromptInsertItem = {
			categoryLabel: "风格",
			id: "pack-user-style",
			name: "用户新风格",
			prompt: "用户新增的风格提示词",
		};
		workspaceMock.current = {
			...workspaceMock.current,
			promptInsertItems: [...promptItems, customStylePack],
		};
		rerender();

		act(() => result.current.togglePromptSupplementItem("pack-user-style"));
		expect(result.current.value.promptSupplements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					referenceId: "pack-user-style",
					referenceName: "用户新风格",
				}),
			]),
		);
	});

	it("clears_references_for_routes_without_reference_support", async () => {
		const { result } = renderHook(() =>
			useGenerationSettingsForm({
				defaultValue: {
					referenceAssetIds: ["asset-image"],
					routeId: "route-reference",
				},
				kind: "image",
			}),
		);
		await waitFor(() => expect(result.current.value.referenceAssetIds).toEqual(["asset-image"]));

		act(() => result.current.updateModelRoute("version-image", "route-no-reference"));

		expect(result.current.supportsReferenceImages).toBe(false);
		expect(result.current.value.referenceAssetIds).toEqual([]);
	});

	it("reports_invalid_until_enabled_prompt_features_are_complete", async () => {
		const { result } = renderHook(() => useGenerationSettingsForm({ kind: "image" }));
		await waitFor(() => expect(result.current.isReady).toBe(true));
		expect(result.current.isValid).toBe(true);

		act(() => result.current.setPromptSupplementEnabled(true));
		expect(result.current.isValid).toBe(false);
		act(() => result.current.togglePromptSupplementItem("pack-style"));
		expect(result.current.isValid).toBe(true);

		act(() => result.current.setPromptOptimizationEnabled(true));
		expect(result.current.isValid).toBe(true);
		act(() => result.current.setPromptOptimizationItemId(null));
		expect(result.current.isValid).toBe(false);
		act(() => result.current.setPromptOptimizationItemId("pack-optimize"));
		expect(result.current.isValid).toBe(true);
		act(() => result.current.setPromptOptimizationRouteId(""));
		expect(result.current.isValid).toBe(false);
	});

	it("keeps inactive prompt drafts out of the submit value and restores them when re-enabled", async () => {
		useBatchGenerationSettingsPreferenceStore.getState().setSettings("image", {
			promptOptimizeItemId: "pack-optimize",
			promptOptimizeRouteId: "route-text",
			promptSupplementItemIds: ["pack-style", "pack-camera"],
			routeId: "route-reference",
			usePromptOptimization: true,
			usePromptSupplement: true,
		});
		const { result } = renderHook(() => useGenerationSettingsForm({ kind: "image" }));
		await waitFor(() => expect(result.current.isReady).toBe(true));

		act(() => {
			result.current.setPromptSupplementEnabled(false);
			result.current.setPromptOptimizationEnabled(false);
		});

		expect(result.current.value.promptSupplements).toEqual([]);
		expect(result.current.value.promptOptimization).toEqual({ enabled: false });
		expect(result.current.selectedPromptSupplementItems.map((item) => item.id)).toEqual([
			"pack-style",
			"pack-camera",
		]);
		expect(result.current.selectedPromptOptimizationItem?.id).toBe("pack-optimize");
		expect(result.current.selectedPromptOptimizationModel?.id).toBe("route-text");
		await waitFor(() =>
			expect(
				useBatchGenerationSettingsPreferenceStore.getState().settingsByKind.image,
			).toMatchObject({
				promptOptimizeItemId: "pack-optimize",
				promptOptimizeRouteId: "route-text",
				promptSupplementItemIds: ["pack-style", "pack-camera"],
				usePromptOptimization: false,
				usePromptSupplement: false,
			}),
		);

		act(() => {
			result.current.setPromptSupplementEnabled(true);
			result.current.setPromptOptimizationEnabled(true);
		});

		expect(result.current.value.promptSupplements.map((item) => item.referenceId)).toEqual([
			"pack-style",
			"pack-camera",
		]);
		expect(result.current.value.promptOptimization).toMatchObject({
			enabled: true,
			referenceId: "pack-optimize",
			routeId: "route-text",
		});
	});

	it("restores disabled stored prompt ids as visible inactive drafts", async () => {
		useBatchGenerationSettingsPreferenceStore.getState().setSettings("image", {
			promptOptimizeItemId: "pack-optimize",
			promptOptimizeRouteId: "route-text",
			promptSupplementItemIds: ["pack-style"],
			routeId: "route-reference",
			usePromptOptimization: false,
			usePromptSupplement: false,
		});

		const { result } = renderHook(() => useGenerationSettingsForm({ kind: "image" }));
		await waitFor(() => expect(result.current.isReady).toBe(true));

		expect(result.current.promptSupplementEnabled).toBe(false);
		expect(result.current.value.promptSupplements).toEqual([]);
		expect(result.current.value.promptOptimization).toEqual({ enabled: false });
		expect(result.current.selectedPromptSupplementItems.map((item) => item.id)).toEqual([
			"pack-style",
		]);
		expect(result.current.selectedPromptOptimizationItem?.id).toBe("pack-optimize");
		expect(result.current.selectedPromptOptimizationModel?.id).toBe("route-text");
	});

	it("never_requests_standalone_style_presets", async () => {
		const { result } = renderHook(() =>
			useGenerationSettingsForm({ kind: "image", projectId: "project-a" }),
		);
		await waitFor(() => expect(result.current.isReady).toBe(true));

		expect(workspaceMock.useGenerationWorkspace).toHaveBeenCalledWith(
			expect.objectContaining({
				modelPreferenceScopeId: "project-a",
				persistModelSelection: false,
				projectId: "project-a",
				projectStyleOnly: true,
				useRawPrompt: true,
			}),
		);
		expect(workspaceMock.useGenerationWorkspace.mock.calls[0]?.[0]).not.toHaveProperty(
			"stylePresets",
		);
		expect(result.current.selectedRoute.params.some((param) => param.name === "style")).toBe(true);
	});

	it("waits_for_generation_preferences_before_resolving_the_initial_route", async () => {
		workspaceMock.current = {
			...workspaceMock.current,
			generationPreferences: undefined,
			hasSettledGenerationPreferences: false,
		};
		const onValueChange = vi.fn();
		const { result, rerender } = renderHook(() =>
			useGenerationSettingsForm({ kind: "image", onValueChange, projectId: "project-a" }),
		);

		expect(result.current.isReady).toBe(false);
		expect(result.current.value.routeId).toBe("");
		expect(onValueChange).not.toHaveBeenCalled();

		workspaceMock.current = {
			...workspaceMock.current,
			generationPreferences: {
				familyIds: { image: "family-image" },
				routeIds: { "version-image": "route-second" },
				routeParams: { "route-second": { n: 2, ratio: "3:4", resolution: "1k" } },
				scopeId: "project-a",
				stylePresetId: "",
				versionIds: { "family-image": "version-image" },
			},
			hasSettledGenerationPreferences: true,
		};
		rerender();

		await waitFor(() => expect(result.current.isReady).toBe(true));
		expect(result.current.value).toMatchObject({
			params: { n: 2, ratio: "3:4", resolution: "1k" },
			routeId: "route-second",
		});
	});

	it("does_not_overwrite_saved_settings_when_no_route_is_available", async () => {
		const savedSettings = {
			params: { n: 2, ratio: "3:4" },
			promptSupplementItemIds: ["pack-style"],
			routeId: "route-reference",
			usePromptSupplement: false,
		};
		useBatchGenerationSettingsPreferenceStore.getState().setSettings("image", savedSettings);
		const unavailableCatalog = {
			...catalog,
			routes: catalog.routes.map((route) =>
				route.kind === "image"
					? { ...route, configured: false, status: "unavailable" as const }
					: route,
			),
		};
		workspaceMock.current = {
			...workspaceMock.current,
			catalog: unavailableCatalog,
			hasConfiguredRoutesForKind: false,
			selectedRoute: unavailableCatalog.routes[0],
		};

		const { result } = renderHook(() => useGenerationSettingsForm({ kind: "image" }));
		await waitFor(() => expect(result.current.isReady).toBe(true));

		expect(result.current.hasAvailableRoute).toBe(false);
		expect(useBatchGenerationSettingsPreferenceStore.getState().settingsByKind.image).toEqual(
			savedSettings,
		);
	});

	it("settles_after_prompt_pack_failures_without_pruning_inactive_saved_ids", async () => {
		const savedSettings = {
			promptOptimizeItemId: "pack-optimize",
			promptOptimizeRouteId: "route-text",
			promptSupplementItemIds: ["pack-style", "pack-camera"],
			routeId: "route-reference",
			usePromptOptimization: false,
			usePromptSupplement: false,
		};
		useBatchGenerationSettingsPreferenceStore.getState().setSettings("image", savedSettings);
		expect(useBatchGenerationSettingsPreferenceStore.getState().settingsByKind.image).toEqual(
			savedSettings,
		);
		workspaceMock.current = {
			...workspaceMock.current,
			hasLoadedPromptInsertItems: false,
			hasSettledPromptInsertItems: true,
			promptInsertItems: [],
		};

		const { result } = renderHook(() => useGenerationSettingsForm({ kind: "image" }));
		await waitFor(() => expect(result.current.isReady).toBe(true));

		expect({
			hasAvailableRoute: result.current.hasAvailableRoute,
			isValid: result.current.isValid,
			promptOptimization: result.current.value.promptOptimization,
			promptSupplementEnabled: result.current.promptSupplementEnabled,
			routeId: result.current.value.routeId,
		}).toEqual({
			hasAvailableRoute: true,
			isValid: true,
			promptOptimization: { enabled: false },
			promptSupplementEnabled: false,
			routeId: "route-reference",
		});
		expect(result.current.value.promptSupplements).toEqual([]);
		expect(result.current.value.promptOptimization).toEqual({ enabled: false });
		await waitFor(() =>
			expect(
				useBatchGenerationSettingsPreferenceStore.getState().settingsByKind.image,
			).toMatchObject(savedSettings),
		);
	});

	it("becomes_invalid_while_live_prompt_snapshots_are_being_refreshed", async () => {
		useBatchGenerationSettingsPreferenceStore.getState().setSettings("image", {
			promptSupplementItemIds: ["pack-style"],
			routeId: "route-reference",
			usePromptSupplement: true,
		});
		const validityHistory: boolean[] = [];
		const { result, rerender } = renderHook(() => {
			const controller = useGenerationSettingsForm({ kind: "image" });
			useEffect(() => {
				validityHistory.push(controller.isValid);
			}, [controller.isValid]);
			return controller;
		});
		await waitFor(() => expect(result.current.isValid).toBe(true));
		validityHistory.length = 0;

		workspaceMock.current = {
			...workspaceMock.current,
			promptInsertItems: promptItems.map((item) =>
				item.id === "pack-style" ? { ...item, prompt: "更新后的二维动画线条" } : item,
			),
		};
		rerender();

		await waitFor(() =>
			expect(result.current.value.promptSupplements[0]?.referencePrompt).toBe(
				"更新后的二维动画线条",
			),
		);
		expect(validityHistory).toContain(false);
		expect(validityHistory.at(-1)).toBe(true);
	});
});

const workspaceValue = () => ({
	catalog,
	generationPreferences: null,
	hasConfiguredRoutesForKind: true,
	hasLiveCatalog: true,
	hasLoadedPromptInsertItems: true,
	hasSettledGenerationPreferences: true,
	hasSettledPromptInsertItems: true,
	isUploadingAsset: false,
	mediaAssets: [imageAsset],
	mutateMediaAssets: vi.fn(),
	promptInsertItems: promptItems,
	selectedFamily: catalog.families[0],
	selectedParams: {},
	selectedRoute: catalog.routes[0],
	selectedVersion: catalog.versions[0],
});

const catalog: GenerationModelsResponse = {
	families: [
		{ id: "family-image", kind: "image", label: "图片模型" },
		{ id: "family-text", kind: "text", label: "文本模型" },
	],
	versions: [
		{
			canonicalModel: "image-model",
			capabilities: { async: false, supportsReferenceUrls: true },
			familyId: "family-image",
			id: "version-image",
			kind: "image",
			label: "图片 V1",
		},
		{
			canonicalModel: "text-model",
			capabilities: { async: false, supportsReferenceUrls: false },
			familyId: "family-text",
			id: "version-text",
			kind: "text",
			label: "文本 V1",
		},
	],
	routes: [
		imageRoute("route-reference", "参考图路由", true),
		imageRoute("route-second", "任务默认路由", true),
		imageRoute("route-no-reference", "无参考图路由", false),
		{
			adapter: "test.text",
			async: false,
			configured: true,
			docUrl: "",
			familyId: "family-text",
			id: "route-text",
			kind: "text",
			label: "文本优化路由",
			model: "text-model",
			params: [],
			provider: "openai",
			status: "available",
			supportsReferenceUrls: false,
			versionId: "version-text",
		},
	],
	models: [],
	providers: [{ id: "openai", label: "OpenAI", providerType: "official" }],
};

function imageRoute(id: string, label: string, supportsReferenceUrls: boolean): GenerationRoute {
	return {
		adapter: "test.image",
		async: false,
		configured: true,
		docUrl: "",
		familyId: "family-image",
		id,
		kind: "image",
		label,
		maxReferenceUrls: 2,
		model: "image-model",
		paramCombos: [
			{
				allowed: [
					["16:9", "2k"],
					["3:4", "1k"],
				],
				params: ["ratio", "resolution"],
			},
		],
		paramGroups: [
			{ id: "size", label: "画面", params: ["ratio", "resolution"] },
			{ id: "count", label: "张数", params: ["n"] },
			{ id: "other", label: "其他", params: ["style"] },
		],
		params: [
			{
				default: "16:9",
				label: "比例",
				name: "ratio",
				options: [
					{ label: "16:9", value: "16:9" },
					{ label: "3:4", value: "3:4" },
				],
				type: "select",
			},
			{
				default: "2k",
				label: "清晰度",
				name: "resolution",
				options: [
					{ label: "高清 1K", value: "1k" },
					{ label: "高清 2K", value: "2k" },
				],
				type: "select",
			},
			{ default: 1, label: "张数", max: 4, min: 1, name: "n", type: "number" },
			{
				default: "realistic",
				label: "模型风格参数",
				name: "style",
				options: [
					{ label: "写实", value: "realistic" },
					{ label: "动漫", value: "anime" },
				],
				type: "select",
			},
		],
		provider: "openai",
		status: "available",
		supportsReferenceUrls,
		versionId: "version-image",
	};
}
