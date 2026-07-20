import { describe, expect, it } from "vitest";
import type {
	GenerationModelsResponse,
	GenerationPreference,
} from "@/domains/generation/api/generation";
import type { PromptInsertItem } from "@/domains/generation/components/PromptSlashCommand";
import type { BatchGenerationStoredSettings } from "@/domains/generation/stores/batch-generation-settings";
import {
	batchGenerationStoredSettingsFromValue,
	formatGenerationSettingsValue,
	generationSettingsValueForSubmit,
	generationSettingsValueFromStoredSettings,
	normalizeGenerationSettingsValue,
	resolveGenerationSettingsValue,
} from "./generationSettingsValue";

const promptItems: PromptInsertItem[] = [
	{
		id: "pack-style",
		categoryLabel: "风格",
		name: "二维动画",
		prompt: "干净的二维动画线条",
	},
	{
		id: "pack-camera",
		categoryLabel: "镜头",
		name: "推进镜头",
		prompt: "缓慢推进镜头",
	},
	{
		id: "pack-optimize",
		categoryLabel: "优化",
		name: "电影感优化",
		prompt: "增强镜头语言与光影层次",
	},
];

const catalog: GenerationModelsResponse = {
	families: [
		{ id: "family-image", kind: "image", label: "图片模型" },
		{ id: "family-video", kind: "video", label: "视频模型" },
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
			canonicalModel: "video-model",
			capabilities: { async: true, supportsReferenceUrls: true },
			familyId: "family-video",
			id: "version-video",
			kind: "video",
			label: "视频 V1",
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
		imageRoute("route-image", "默认图片路由"),
		imageRoute("route-context", "上下文图片路由"),
		imageRoute("route-stored", "批量偏好图片路由"),
		{
			...imageRoute("route-unavailable", "不可用图片路由"),
			configured: false,
		},
		{
			adapter: "test.video",
			async: true,
			configured: true,
			docUrl: "",
			familyId: "family-video",
			id: "route-video",
			kind: "video",
			label: "视频路由",
			model: "video-model",
			params: [],
			provider: "openai",
			status: "available",
			supportsReferenceUrls: true,
			versionId: "version-video",
		},
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

describe("normalizeGenerationSettingsValue", () => {
	it("keeps declared style params, applies schema defaults, and normalizes count and size combos", () => {
		const value = normalizeGenerationSettingsValue(
			catalog,
			"image",
			{
				kind: "video",
				label: "伪造标签",
				params: {
					n: 2.6,
					ratio: "3:4",
					resolution: "2k",
					stale: true,
					style: "anime",
				},
				promptOptimization: {
					enabled: true,
					referenceId: "pack-optimize",
					referenceName: "旧名称",
					referencePrompt: "旧内容",
					routeId: "route-text",
				},
				promptSupplements: [
					{
						referenceId: "pack-style",
						referenceName: "旧名称",
						referencePrompt: "旧内容",
					},
					{
						referenceName: "重复内容",
						referencePrompt: "干净的二维动画线条",
					},
					{
						referenceId: "pack-camera",
						referenceName: "推进镜头",
						referencePrompt: "缓慢推进镜头",
					},
				],
				referenceAssetIds: [" asset-a ", "", "asset-a", "asset-b", "asset-c"],
				routeId: "route-image",
			},
			promptItems,
		);

		expect(value).toEqual({
			kind: "image",
			label: "默认图片路由",
			params: {
				n: 3,
				ratio: "3:4",
				resolution: "1k",
				style: "anime",
			},
			promptOptimization: {
				enabled: true,
				label: "文本优化路由",
				referenceId: "pack-optimize",
				referenceName: "电影感优化",
				referencePrompt: "增强镜头语言与光影层次",
				routeId: "route-text",
			},
			promptSupplements: [
				{
					referenceId: "pack-style",
					referenceName: "二维动画",
					referencePrompt: "干净的二维动画线条",
				},
				{
					referenceId: "pack-camera",
					referenceName: "推进镜头",
					referencePrompt: "缓慢推进镜头",
				},
			],
			referenceAssetIds: ["asset-a", "asset-b"],
			routeId: "route-image",
		});
	});

	it("distinguishes prompt packs that are loading from an authoritative empty list", () => {
		const rawValue = {
			promptOptimization: {
				enabled: true,
				referenceId: "pack-optimize",
				referenceName: "优化快照",
				referencePrompt: "优化内容快照",
				routeId: "route-text",
			},
			promptSupplements: [
				{
					referenceId: "pack-style",
					referenceName: "风格快照",
					referencePrompt: "风格内容快照",
				},
			],
			routeId: "route-image",
		};

		const whileLoading = normalizeGenerationSettingsValue(catalog, "image", rawValue, undefined);
		expect(whileLoading.promptSupplements).toHaveLength(1);
		expect(whileLoading.promptOptimization.enabled).toBe(true);

		const afterLoadedEmpty = normalizeGenerationSettingsValue(catalog, "image", rawValue, []);
		expect(afterLoadedEmpty.promptSupplements).toEqual([]);
		expect(afterLoadedEmpty.promptOptimization).toEqual({ enabled: false });
	});

	it("normalizes a disabled optimization to the minimal value", () => {
		const value = normalizeGenerationSettingsValue(catalog, "image", {
			promptOptimization: {
				enabled: false,
				referenceId: "pack-optimize",
				referenceName: "不应保留",
				referencePrompt: "不应保留",
				routeId: "route-text",
			},
			routeId: "route-image",
		});

		expect(value.promptOptimization).toEqual({ enabled: false });
	});

	it("normalizes a reference-incompatible 4K selection to the route default", () => {
		const withoutReference = normalizeGenerationSettingsValue(catalog, "image", {
			params: { ratio: "16:9", resolution: "4k" },
			referenceAssetIds: [],
			routeId: "route-image",
		});
		const withReference = normalizeGenerationSettingsValue(catalog, "image", {
			params: { ratio: "16:9", resolution: "4k" },
			referenceAssetIds: ["asset-a"],
			routeId: "route-image",
		});

		expect(withoutReference.params.resolution).toBe("4k");
		expect(withReference.params.resolution).toBe("2k");
	});
});

describe("resolveGenerationSettingsValue", () => {
	it("uses only non-empty valid current values before context, stored and scoped preferences", () => {
		const storedSettings: BatchGenerationStoredSettings = {
			params: { ratio: "1:1", resolution: "1k", style: "realistic" },
			routeId: "route-stored",
		};
		const generationPreference: GenerationPreference = {
			familyIds: { image: "family-image" },
			routeIds: { "version-image": "route-image" },
			routeParams: {
				"route-image": { ratio: "16:9", resolution: "2k", style: "realistic" },
			},
			scopeId: "project-1",
			stylePresetId: "",
			versionIds: { "family-image": "version-image" },
		};

		const fromContext = resolveGenerationSettingsValue({
			catalog,
			contextValue: {
				params: { ratio: "3:4", resolution: "1k", style: "anime" },
				referenceAssetIds: ["context-reference"],
				routeId: "route-context",
			},
			currentValue: { params: {} },
			generationPreference,
			kind: "image",
			promptItems,
			storedSettings,
		});
		expect(fromContext.routeId).toBe("route-context");
		expect(fromContext.params.style).toBe("anime");
		expect(fromContext.referenceAssetIds).toEqual(["context-reference"]);

		const fromCurrent = resolveGenerationSettingsValue({
			catalog,
			contextValue: fromContext,
			currentValue: {
				params: { style: "realistic" },
				referenceAssetIds: [],
				routeId: "route-image",
			},
			generationPreference,
			kind: "image",
			promptItems,
			storedSettings,
		});
		expect(fromCurrent.routeId).toBe("route-image");
		expect(fromCurrent.params.style).toBe("realistic");
		expect(fromCurrent.referenceAssetIds).toEqual([]);

		const fromStored = resolveGenerationSettingsValue({
			catalog,
			currentValue: { routeId: "route-unavailable" },
			generationPreference,
			kind: "image",
			promptItems,
			storedSettings,
		});
		expect(fromStored.routeId).toBe("route-stored");

		const fromPreference = resolveGenerationSettingsValue({
			catalog,
			generationPreference,
			kind: "image",
			promptItems,
			storedSettings: { routeId: "missing-route" },
		});
		expect(fromPreference.routeId).toBe("route-image");
		expect(fromPreference.params.ratio).toBe("16:9");

		const fromCatalog = resolveGenerationSettingsValue({
			catalog,
			kind: "image",
			promptItems,
		});
		expect(fromCatalog.routeId).toBe("route-image");
	});
});

describe("generation settings persistence adapters", () => {
	it("stores only route params, prompt pack ids and toggles, never references or snapshots", () => {
		const value = normalizeGenerationSettingsValue(
			catalog,
			"image",
			{
				promptOptimization: {
					enabled: true,
					referenceId: "pack-optimize",
					routeId: "route-text",
				},
				promptSupplements: [
					{ referenceId: "pack-style", referenceName: "", referencePrompt: "" },
					{ referenceId: "pack-camera", referenceName: "", referencePrompt: "" },
				],
				referenceAssetIds: ["asset-a"],
				routeId: "route-context",
			},
			promptItems,
		);

		const stored = batchGenerationStoredSettingsFromValue(catalog, value);
		expect(stored).toEqual({
			familyId: "family-image",
			params: value.params,
			promptOptimizeItemId: "pack-optimize",
			promptOptimizeRouteId: "route-text",
			promptSupplementItemIds: ["pack-style", "pack-camera"],
			routeId: "route-context",
			usePromptOptimization: true,
			usePromptSupplement: true,
			versionId: "version-image",
		});
		expect(stored).not.toHaveProperty("referenceAssetIds");
		expect(JSON.stringify(stored)).not.toContain("干净的二维动画线条");

		const restored = generationSettingsValueFromStoredSettings(
			catalog,
			"image",
			stored,
			promptItems,
		);
		expect(restored.referenceAssetIds).toEqual([]);
		expect(restored.promptSupplements.map((item) => item.referencePrompt)).toEqual([
			"干净的二维动画线条",
			"缓慢推进镜头",
		]);
	});
});

describe("generationSettingsValueForSubmit", () => {
	it("accepts Codex prompt optimization without a configured text route", () => {
		const catalogWithoutText = {
			...catalog,
			routes: catalog.routes.filter((route) => route.kind !== "text"),
		};
		const ready = generationSettingsValueForSubmit(
			catalogWithoutText,
			{
				kind: "image",
				promptOptimization: {
					enabled: true,
					executor: "codex",
					referenceId: "pack-optimize",
				},
				routeId: "route-image",
			},
			promptItems,
		);

		expect(ready?.promptOptimization).toMatchObject({
			enabled: true,
			executor: "codex",
			referenceId: "pack-optimize",
		});
	});

	it("accepts protected prompt references without browser-visible prompt bodies", () => {
		const protectedItems: PromptInsertItem[] = [
			{
				id: "protected-prompt",
				categoryLabel: "风格",
				name: "受保护风格",
				prompt: "",
			},
		];
		const ready = generationSettingsValueForSubmit(
			catalog,
			{
				kind: "image",
				promptOptimization: {
					enabled: true,
					referenceId: "protected-prompt",
					routeId: "route-text",
				},
				promptSupplements: [
					{ referenceId: "protected-prompt", referenceName: "受保护风格", referencePrompt: "" },
				],
				routeId: "route-image",
			},
			protectedItems,
		);

		expect(ready?.promptSupplements).toEqual([
			expect.objectContaining({ referenceId: "protected-prompt", referencePrompt: "" }),
		]);
		expect(ready?.promptOptimization).toEqual(
			expect.objectContaining({ enabled: true, referenceId: "protected-prompt" }),
		);
	});

	it("returns current prompt snapshots and rejects an enabled incomplete optimization", () => {
		const ready = generationSettingsValueForSubmit(
			catalog,
			normalizeGenerationSettingsValue(
				catalog,
				"image",
				{
					promptOptimization: {
						enabled: true,
						referenceId: "pack-optimize",
						routeId: "route-text",
					},
					routeId: "route-image",
				},
				promptItems,
			),
			promptItems,
		);
		expect(ready?.promptOptimization).toMatchObject({
			enabled: true,
			referenceName: "电影感优化",
			referencePrompt: "增强镜头语言与光影层次",
		});

		const referenceOnly = generationSettingsValueForSubmit(
			catalog,
			normalizeGenerationSettingsValue(catalog, "image", {
				promptOptimization: {
					enabled: true,
					referenceId: "pack-optimize",
					referenceName: "",
					referencePrompt: "",
					routeId: "route-text",
				},
				routeId: "route-image",
			}),
		);
		expect(referenceOnly?.promptOptimization).toEqual(
			expect.objectContaining({ enabled: true, referenceId: "pack-optimize" }),
		);

		const incomplete = generationSettingsValueForSubmit(catalog, {
			kind: "image",
			promptOptimization: { enabled: true, routeId: "route-text" },
			routeId: "route-image",
		});
		expect(incomplete).toBeNull();
	});
});

describe("formatGenerationSettingsValue", () => {
	it("formats the route and enabled optional sections into a compact summary", () => {
		const value = normalizeGenerationSettingsValue(
			catalog,
			"image",
			{
				params: { n: 2, ratio: "16:9", resolution: "2k", style: "anime" },
				promptOptimization: {
					enabled: true,
					referenceId: "pack-optimize",
					routeId: "route-text",
				},
				promptSupplements: [{ referenceId: "pack-style", referenceName: "", referencePrompt: "" }],
				referenceAssetIds: ["asset-a"],
				routeId: "route-image",
			},
			promptItems,
		);

		expect(formatGenerationSettingsValue(value)).toBe(
			"默认图片路由 · 16:9 · 2k · 2 · anime · 1 张参考图 · 1 项附加提示词 · 已开启提示词优化",
		);
	});
});

function imageRoute(id: string, label: string) {
	return {
		adapter: "test.image",
		async: false,
		configured: true,
		docUrl: "",
		familyId: "family-image",
		id,
		kind: "image" as const,
		label,
		maxReferenceUrls: 2,
		model: "image-model",
		paramCombos: [
			{
				allowed: [
					["16:9", "2k"],
					["16:9", "4k"],
					["3:4", "1k"],
					["1:1", "1k"],
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
					{ label: "1:1", value: "1:1" },
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
					{ label: "超清 4K", value: "4k", requiresNoReferenceUrls: true },
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
		status: "available" as const,
		supportsReferenceUrls: true,
		versionId: "version-image",
	};
}
