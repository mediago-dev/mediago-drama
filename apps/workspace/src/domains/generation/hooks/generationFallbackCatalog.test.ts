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

const routeGroups = (routeId: string) => {
	const route = fallbackCatalog.routes.find((item) => item.id === routeId);
	if (!route) throw new Error(`missing route ${routeId}`);
	return route.paramGroups ?? [];
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

const gptImageComboOutputs = {
	"adaptive|1K": "auto",
	"1:1|1K": "1024x1024",
	"1:1|2K": "2048x2048",
	"3:2|1K": "1536x1024",
	"2:3|1K": "1024x1536",
	"16:9|2K": "2048x1152",
	"16:9|4K": "3840x2160",
	"9:16|4K": "2160x3840",
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
		const seedream = routeParams("dmx.seedream-5-lite");
		expect(seedream.map((item) => item.name)).toEqual([
			"aspectRatio",
			"resolution",
			"outputFormat",
			"watermark",
			"n",
		]);
		expect(param("dmx.seedream-5-lite", "aspectRatio")).toMatchObject({
			default: "adaptive",
			options: [
				{ label: "自适应", value: "adaptive" },
				{ label: "1:1", value: "1:1" },
				{ label: "3:4", value: "3:4" },
				{ label: "16:9", value: "16:9" },
				{ label: "9:16", value: "9:16" },
			],
		});
		expect(routeCombos("dmx.seedream-5-lite")).toEqual([
			{
				params: ["aspectRatio", "resolution"],
				allowed: [
					["adaptive", "2K"],
					["adaptive", "3K"],
					["1:1", "2K"],
					["1:1", "3K"],
					["3:4", "2K"],
					["3:4", "3K"],
					["16:9", "2K"],
					["16:9", "3K"],
					["9:16", "2K"],
					["9:16", "3K"],
				],
			},
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
		expect(routeParams("dmx.gpt-image-2").map((item) => item.name)).toEqual([
			"aspectRatio",
			"resolution",
			"quality",
			"outputFormat",
			"moderation",
			"outputCompression",
			"n",
		]);
		expect(param("dmx.gpt-image-2", "aspectRatio").default).toBe("1:1");
		expect(param("dmx.gpt-image-2", "resolution").default).toBe("1K");
		expect(routeById("dmx.gpt-image-2").maxReferenceUrls).toBe(4);
		expect(param("dmx.gpt-image-2", "quality").group).toBe("other");
		expect(param("dmx.gpt-image-2", "quality").menu).toBe("secondary");
		expect(routeGroups("dmx.gpt-image-2")).toEqual([
			{ id: "size", label: "大小", params: ["aspectRatio", "resolution"] },
			{ id: "count", label: "数量", params: ["n"] },
			{
				id: "other",
				label: "其他",
				params: ["quality", "outputFormat", "moderation", "outputCompression"],
			},
		]);
		expect(routeCombos("dmx.gpt-image-2")).toEqual([
			{
				params: ["aspectRatio", "resolution"],
				allowed: [
					["adaptive", "1K"],
					["1:1", "1K"],
					["1:1", "2K"],
					["3:2", "1K"],
					["2:3", "1K"],
					["16:9", "2K"],
					["16:9", "4K"],
					["9:16", "4K"],
				],
				outputs: gptImageComboOutputs,
			},
		]);
		expect(routeParams("mediago.gpt-image-2").map((item) => item.name)).toEqual([
			"aspectRatio",
			"resolution",
			"quality",
			"outputFormat",
			"moderation",
			"outputCompression",
			"n",
			"background",
		]);
		expect(routeById("mediago.gpt-image-2")).toMatchObject({
			supportsReferenceUrls: true,
			maxReferenceUrls: 4,
		});
		expect(routeById("jimeng.seedream-5.0").maxReferenceUrls).toBeUndefined();
		expect(routeCombos("mediago.gpt-image-2")).toEqual([
			{
				params: ["aspectRatio", "resolution"],
				allowed: [
					["adaptive", "1K"],
					["1:1", "1K"],
					["1:1", "2K"],
					["3:2", "1K"],
					["2:3", "1K"],
					["16:9", "2K"],
					["16:9", "4K"],
					["9:16", "4K"],
				],
				outputs: gptImageComboOutputs,
			},
		]);
		expect(param("dmx.gemini-3.1-flash-image-preview", "resolution").default).toBe("1K");
		expect(
			param("dmx.gemini-3.1-flash-image-preview", "resolution").options?.map((item) => item.value),
		).toEqual(["512px", "1K", "2K", "4K"]);
		expect(routeCombos("dmx.gemini-3.1-flash-image-preview")[0]?.outputs?.["1:1|512px"]).toBe(
			"512x512",
		);
		expect(routeCombos("dmx.gemini-3.1-flash-image-preview")[0]?.outputs?.["16:9|1K"]).toBe(
			"1376x768",
		);
		expect(routeCombos("dmx.gemini-3.1-flash-image-preview")[0]?.outputs?.["9:21|1K"]).toBe(
			"672x1584",
		);
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
		expect(routeById("mediago.gemini-3.1-flash-image")).toMatchObject({
			status: "available",
			adapter: "openrouter.chat.image",
			model: "gemini-3.1-flash-image",
		});
		expect(
			param("mediago.gemini-3.1-flash-image", "aspectRatio").options?.map((item) => item.value),
		).toEqual([
			"1:1",
			"1:4",
			"1:8",
			"2:3",
			"3:2",
			"3:4",
			"4:1",
			"4:3",
			"4:5",
			"5:4",
			"8:1",
			"9:16",
			"16:9",
			"21:9",
		]);
		expect(routeParams("mediago.gemini-3.1-flash-image").map((item) => item.name)).toEqual([
			"aspectRatio",
			"resolution",
			"n",
		]);
		expect(
			param("mediago.gemini-3.1-flash-image", "resolution").options?.map((item) => item.value),
		).toEqual(["1K", "2K", "4K"]);
		expect(routeCombos("mediago.gemini-3.1-flash-image")[0]?.outputs?.["16:9|1K"]).toBe("1376x768");
		expect(routeCombos("mediago.gemini-3.1-flash-image")[0]?.outputs?.["4:3|2K"]).toBe("2400x1792");
		expect(routeCombos("mediago.gemini-3.1-flash-image")[0]?.outputs?.["9:21|1K"]).toBe(undefined);
		expect(routeById("mediago.gemini-3-pro-image")).toMatchObject({
			status: "available",
			adapter: "openrouter.chat.image",
			model: "gemini-3-pro-image",
		});
		expect(routeParams("mediago.gemini-3-pro-image").map((item) => item.name)).toEqual([
			"aspectRatio",
			"resolution",
			"n",
		]);
		expect(
			param("mediago.gemini-3-pro-image", "aspectRatio").options?.map((item) => item.value),
		).toEqual(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]);
		expect(
			param("mediago.gemini-3-pro-image", "resolution").options?.map((item) => item.value),
		).toEqual(["1K", "2K", "4K"]);
		expect(routeCombos("mediago.gemini-3-pro-image")[0]?.outputs?.["16:9|4K"]).toBe("5504x3072");
		expect(routeCombos("mediago.gemini-3-pro-image")[0]?.outputs?.["1:4|1K"]).toBe(undefined);
		expect(routeCombos("mediago.gemini-3-pro-image")[0]?.outputs?.["9:21|1K"]).toBe(undefined);
		expect(routeParams("mediago.gemini-2.5-flash-image").map((item) => item.name)).toEqual([
			"aspectRatio",
			"resolution",
			"n",
		]);
		expect(
			param("mediago.gemini-2.5-flash-image", "resolution").options?.map((item) => item.value),
		).toEqual(["1K"]);
		expect(routeCombos("mediago.gemini-2.5-flash-image")[0]?.outputs?.["16:9|1K"]).toBe("1344x768");
	});

	it("uses canonical video params and backend defaults", () => {
		expect(routeParams("dmx.seedance-2.0-fast").map((item) => item.name)).toEqual([
			"aspectRatio",
			"resolution",
			"duration",
			"generateAudio",
			"seed",
			"watermark",
			"returnLastFrame",
			"executionExpiresAfter",
		]);
		expect(param("dmx.seedance-2.0-fast", "resolution").default).toBe("480p");
		expect(param("dmx.seedance-2.0-fast", "duration").default).toBe("4");
		expect(param("dmx.seedance-2.0-fast", "duration").group).toBe("duration");
		expect(param("dmx.seedance-2.0-fast", "duration").menu).toBe("primary");
		expect(routeGroups("dmx.seedance-2.0-fast")).toEqual([
			{ id: "size", label: "大小", params: ["aspectRatio", "resolution"] },
			{ id: "duration", label: "秒数", params: ["duration"] },
			{
				id: "other",
				label: "其他",
				params: ["generateAudio", "seed", "watermark", "returnLastFrame", "executionExpiresAfter"],
			},
		]);
		expect(param("dmx.seedance-2.0-fast", "generateAudio").default).toBe(false);
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
		expect(param("xiaoyunque.seedance-2.0-mini-lite", "resolution").options).toEqual([
			{ label: "720p", value: "720p" },
		]);
		expect(routeParams("xiaoyunque.seedance-2.0-mini-lite").map((item) => item.name)).toEqual([
			"aspectRatio",
			"resolution",
			"duration",
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
				.filter((route) => route.id.startsWith("xiaoyunque.seedance-2.0"))
				.map((route) => route.id),
		).toEqual([
			"xiaoyunque.seedance-2.0-fast",
			"xiaoyunque.seedance-2.0-mini",
			"xiaoyunque.seedance-2.0",
			"xiaoyunque.seedance-2.0-mini-lite",
		]);
		expect(
			fallbackCatalog.routes.find((route) => route.id === "xiaoyunque.seedance-2.0-mini-lite"),
		).toMatchObject({
			adapter: "pippit.cli.video",
			model: "Seedance_2.0_mini_lite",
			provider: "xiaoyunque",
		});
		expect(
			fallbackCatalog.routes.find((route) => route.id === "xiaoyunque.seedance-2.0-fast"),
		).toMatchObject({
			adapter: "pippit.cli.video",
			model: "seedance2.0_fast_vision",
			provider: "xiaoyunque",
		});
		expect(
			fallbackCatalog.routes.find((route) => route.id === "xiaoyunque.seedance-2.0-mini"),
		).toMatchObject({
			adapter: "pippit.cli.video",
			model: "Seedance_2.0_mini",
			provider: "xiaoyunque",
		});
		expect(
			fallbackCatalog.routes.find((route) => route.id === "xiaoyunque.seedance-2.0"),
		).toMatchObject({
			adapter: "pippit.cli.video",
			model: "seedance2.0_vision",
			provider: "xiaoyunque",
		});
		expect(param("xiaoyunque.seedance-2.0", "resolution").options).toEqual([
			{ label: "720p", value: "720p" },
			{ label: "1080p", value: "1080p" },
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
