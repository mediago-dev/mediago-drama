import { describe, expect, it } from "vitest";
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
		expect(param("openrouter.gemini-3.1-flash-image-preview", "resolution").default).toBe("1K");
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
			fallbackCatalog.routes.find((route) => route.id === "libtv.seedance-2.0-mini"),
		).toMatchObject({
			adapter: "libtv.cli.video",
			model: "Seedance 2.0 Mini",
			provider: "libtv",
			supportsReferenceUrls: false,
		});
		expect(
			fallbackCatalog.routes.find((route) => route.id === "xiaoyunque.seedance-2.0-mini-lite"),
		).toMatchObject({
			adapter: "pippit.cli.video",
			model: "Seedance_2.0_mini_lite",
			provider: "xiaoyunque",
		});
		expect(param("openrouter.seedance-2.0-fast", "duration")).toMatchObject({
			default: "3",
			type: "select",
		});
		expect(param("openrouter.seedance-2.0-fast", "generateAudio").default).toBe(false);
	});
});
