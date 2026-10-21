import { describe, expect, it } from "vitest";
import { providerTypeOf } from "./generationCatalog";
import { fallbackCatalog } from "./generationFallbackCatalog";

const routeParams = (routeId: string) => {
	const route = fallbackCatalog.routes.find((item) => item.id === routeId);
	if (!route) throw new Error(`missing route ${routeId}`);
	return route.params;
};

const routeCombos = (routeId: string) => {
	const route = fallbackCatalog.routes.find((item) => item.id === routeId);
	if (!route) throw new Error(`missing route ${routeId}`);
	return route.paramCombos ?? [];
};

const routeById = (routeId: string) => {
	const route = fallbackCatalog.routes.find((item) => item.id === routeId);
	if (!route) throw new Error(`missing route ${routeId}`);
	return route;
};

const param = (routeId: string, name: string) => {
	const value = routeParams(routeId).find((item) => item.name === name);
	if (!value) throw new Error(`missing param ${routeId}.${name}`);
	return value;
};

describe("fallback generation catalog params", () => {
	it("mirrors the LibTV image routes from the backend catalog", () => {
		const expectedRoutes = [
			{
				familyId: "gpt-image",
				id: "libtv.gpt-image-2",
				maxReferenceUrls: 10,
				model: "Lib Image",
				params: [
					{
						default: "16:9",
						name: "aspectRatio",
						options: [
							"1:1",
							"9:16",
							"16:9",
							"3:4",
							"4:3",
							"3:2",
							"2:3",
							"5:4",
							"4:5",
							"21:9",
							"9:21",
						],
					},
					{ default: "2K", name: "resolution", options: ["1K", "2K", "4K"] },
					{ default: "medium", name: "quality", options: ["low", "medium", "high"] },
				],
				versionId: "gpt-image-2",
			},
			{
				familyId: "nano-banana",
				id: "libtv.gemini-3.1-flash-image-preview",
				maxReferenceUrls: 7,
				model: "Lib Navo 2",
				params: [
					{
						default: "16:9",
						name: "aspectRatio",
						options: [
							"adaptive",
							"1:1",
							"9:16",
							"16:9",
							"3:4",
							"4:3",
							"3:2",
							"2:3",
							"4:5",
							"5:4",
							"8:1",
							"1:8",
							"4:1",
							"1:4",
							"21:9",
						],
					},
					{ default: "2K", name: "resolution", options: ["1K", "2K", "4K"] },
				],
				versionId: "gemini-3.1-flash-image-preview",
			},
			{
				familyId: "seedream",
				id: "libtv.seedream-5-lite",
				maxReferenceUrls: 6,
				model: "Seedream 5.0 Lite",
				params: [
					{
						default: "16:9",
						name: "aspectRatio",
						options: ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3"],
					},
					{ default: "2K", name: "resolution", options: ["2K", "3K"] },
				],
				versionId: "seedream-5-lite",
			},
		];

		for (const expected of expectedRoutes) {
			const item = routeById(expected.id);
			expect(item).toMatchObject({
				adapter: "libtv.cli.image",
				async: false,
				familyId: expected.familyId,
				kind: "image",
				label: "LibTV",
				maxReferenceUrls: expected.maxReferenceUrls,
				model: expected.model,
				provider: "libtv",
				supportsReferenceUrls: true,
				versionId: expected.versionId,
			});
			expect(
				item.params.map((item) => ({
					default: item.default,
					name: item.name,
					options: item.options?.map((option) => option.value),
				})),
			).toEqual(expected.params);
			expect(item).not.toHaveProperty("translation");
		}

		expect(param("libtv.gpt-image-2", "quality").options).toEqual([
			{ label: "Low", value: "low" },
			{ label: "Medium", value: "medium" },
			{ label: "High", value: "high" },
		]);
		expect(param("libtv.gemini-3.1-flash-image-preview", "aspectRatio").options?.[0]).toEqual({
			label: "Adaptive",
			value: "adaptive",
		});
		expect(providerTypeOf("libtv", [])).toBe("local");
	});

	it("uses canonical image params", () => {
		const seedream = routeParams("official.seedream-5-lite");
		expect(seedream.map((item) => item.name)).toEqual([
			"aspectRatio",
			"resolution",
			"outputFormat",
			"watermark",
			"n",
		]);

		expect(param("jimeng.seedream-5.0", "resolution")).toMatchObject({
			default: "2K",
			options: [
				{ label: "2K", value: "2K" },
				{ label: "4K", value: "4K" },
			],
		});
		expect(routeParams("jimeng.seedream-5.0").map((item) => item.name)).toEqual([
			"aspectRatio",
			"resolution",
		]);

		expect(routeById("jimeng.seedream-5.0").maxReferenceUrls).toBeUndefined();

		expect(routeById("official.gemini-2.5-flash-image")).toMatchObject({
			provider: "google",
			model: "gemini-2.5-flash-image",
			adapter: "official.google.image",
			supportsReferenceUrls: true,
		});
		expect(
			param("official.gemini-2.5-flash-image", "resolution").options?.map((item) => item.value),
		).toEqual(["1K"]);
		expect(
			param("official.gemini-2.5-flash-image", "aspectRatio").options?.map((item) => item.value),
		).toEqual(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]);
		expect(routeCombos("official.gemini-2.5-flash-image")[0]?.outputs?.["1:1|1K"]).toBe(
			"1024x1024",
		);
		expect(routeCombos("official.gemini-2.5-flash-image")[0]?.outputs?.["16:9|1K"]).toBe(
			"1344x768",
		);
		expect(routeCombos("official.gemini-2.5-flash-image")[0]?.outputs?.["1:4|1K"]).toBe(undefined);
		expect(routeCombos("official.gemini-2.5-flash-image")[0]?.outputs?.["9:21|1K"]).toBe(undefined);
		expect(param("openrouter.gemini-3.1-flash-image-preview", "resolution").default).toBe("1K");
	});

	it("uses canonical video params and backend defaults", () => {
		expect(param("jimeng.seedance-2.0-fast", "resolution").default).toBe("720p");
		expect(routeParams("jimeng.seedance-2.0-fast").map((item) => item.name)).toEqual([
			"aspectRatio",
			"resolution",
			"duration",
		]);
		expect(param("jimeng.seedance-2.0-mini", "resolution").options).toEqual([
			{ label: "720p", value: "720p" },
		]);
		expect(param("libtv.seedance-2.0-mini", "resolution").options).toEqual([
			{ label: "480p", value: "480p" },
			{ label: "720p", value: "720p" },
		]);
		expect(routeParams("libtv.seedance-2.0-mini").map((item) => item.name)).toEqual([
			"aspectRatio",
			"resolution",
			"duration",
			"generateAudio",
		]);
		expect(param("jimeng.seedance-2.0-vip", "duration").default).toBe("5");
		expect(param("jimeng.seedance-2.0-vip", "resolution").options).toEqual([
			{ label: "720p", value: "720p" },
			{ label: "1080p", value: "1080p" },
		]);

		expect(
			fallbackCatalog.routes
				.filter((route) => route.id.startsWith("jimeng.seedance-2.0"))
				.map((route) => route.id),
		).toEqual([
			"jimeng.seedance-2.0-fast",
			"jimeng.seedance-2.0-mini",
			"jimeng.seedance-2.0",
			"jimeng.seedance-2.0-fast-vip",
			"jimeng.seedance-2.0-vip",
		]);
		expect(
			fallbackCatalog.routes
				.filter((route) => route.id.startsWith("libtv.seedance-2.0"))
				.map((route) => route.id),
		).toEqual(["libtv.seedance-2.0-fast", "libtv.seedance-2.0-mini", "libtv.seedance-2.0"]);
		expect(
			fallbackCatalog.routes.find((route) => route.id === "libtv.seedance-2.0-mini"),
		).toMatchObject({
			adapter: "libtv.cli.video",
			model: "Seedance 2.0 Mini",
			maxReferenceUrls: 15,
			provider: "libtv",
			supportsReferenceUrls: true,
		});
		expect(fallbackCatalog.routes.find((route) => route.id === "libtv.seedance-2.0")).toMatchObject(
			{
				adapter: "libtv.cli.video",
				model: "Seedance 2.0 VIP",
				maxReferenceUrls: 15,
				provider: "libtv",
				supportsReferenceUrls: true,
			},
		);
		expect(param("libtv.seedance-2.0-fast", "resolution").options).toEqual([
			{ label: "480p", value: "480p" },
			{ label: "720p", value: "720p" },
		]);
		expect(param("libtv.seedance-2.0", "resolution").options).toEqual([
			{ label: "480p", value: "480p" },
			{ label: "720p", value: "720p" },
			{ label: "1080p", value: "1080p" },
			{ label: "4K", value: "4k" },
		]);

		expect(
			fallbackCatalog.routes
				.filter((route) => route.id.startsWith("official.seedance-2.0"))
				.map((route) => route.id),
		).toEqual([
			"official.seedance-2.0-fast",
			"official.seedance-2.0-mini",
			"official.seedance-2.0",
		]);
		expect(
			fallbackCatalog.routes.find((route) => route.id === "official.seedance-2.0-mini"),
		).toMatchObject({
			adapter: "official.volcengine.video",
			model: "doubao-seedance-2-0-mini-260615",
			provider: "volcengine",
		});
		expect(
			fallbackCatalog.routes.find((route) => route.id === "official.seedance-2.0"),
		).toMatchObject({
			adapter: "official.volcengine.video",
			model: "doubao-seedance-2-0-260128",
			provider: "volcengine",
		});
		expect(routeParams("official.seedance-2.0-mini").map((item) => item.name)).toEqual([
			"aspectRatio",
			"resolution",
			"duration",
			"generateAudio",
			"seed",
			"watermark",
			"returnLastFrame",
			"executionExpiresAfter",
			"negativePrompt",
		]);
		expect(param("openrouter.seedance-2.0-fast", "duration")).toMatchObject({
			default: "3",
			type: "select",
		});
		expect(param("openrouter.seedance-2.0-fast", "generateAudio").default).toBe(false);
	});
});

it("never falls back to removed providers or leaves orphan versions", () => {
	const removed = new Set(["mediago", "dmx", "xiaoyunque", "pippit"]);
	expect(fallbackCatalog.providers.every((provider) => !removed.has(provider.id))).toBe(true);
	expect(fallbackCatalog.routes.every((route) => !removed.has(route.provider))).toBe(true);
	expect(
		fallbackCatalog.versions.every((version) =>
			fallbackCatalog.routes.some((route) => route.versionId === version.id),
		),
	).toBe(true);
});
