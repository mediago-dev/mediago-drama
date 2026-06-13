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

const param = (routeId: string, name: string) => {
	const value = routeParams(routeId).find((item) => item.name === name);
	if (!value) throw new Error(`missing param ${routeId}.${name}`);
	return value;
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
				{ label: "16:9", value: "16:9" },
				{ label: "9:16", value: "9:16" },
			],
		});
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
		expect(param("dmx.seedance-2.0-fast", "generateAudio").default).toBe(false);
		expect(param("jimeng.seedance-2.0-fast", "resolution").default).toBe("720p");
		expect(routeParams("jimeng.seedance-2.0-fast").map((item) => item.name)).toEqual([
			"aspectRatio",
			"resolution",
			"duration",
		]);
		expect(param("jimeng.seedance-2.0-vip", "duration").default).toBe("5");
		expect(
			fallbackCatalog.routes
				.filter((route) => route.id.startsWith("jimeng.seedance-2.0"))
				.map((route) => route.id),
		).toEqual([
			"jimeng.seedance-2.0-fast",
			"jimeng.seedance-2.0",
			"jimeng.seedance-2.0-fast-vip",
			"jimeng.seedance-2.0-vip",
		]);
		expect(param("openrouter.seedance-2.0-fast", "duration")).toMatchObject({
			default: "3",
			type: "select",
		});
		expect(param("openrouter.seedance-2.0-fast", "generateAudio").default).toBe(false);
	});
});
