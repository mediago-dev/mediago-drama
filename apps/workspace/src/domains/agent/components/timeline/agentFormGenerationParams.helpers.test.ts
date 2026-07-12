import { describe, expect, it } from "vitest";
import type {
	GenerationModelsResponse,
	GenerationRoute,
} from "@/domains/generation/api/generation";
import {
	formatGenerationParamsValue,
	normalizeGenerationParamsValue,
	resolveGenerationRoute,
} from "./agentFormGenerationParams.helpers";

describe("resolveGenerationRoute", () => {
	it("resolves the requested route with validated params", () => {
		const resolved = resolveGenerationRoute(catalog(), imageRoutes(), {
			routeId: "mediago.gpt-image-2",
			params: { aspectRatio: "16:9", resolution: "4K", n: 2 },
		});

		expect(resolved?.route.id).toBe("mediago.gpt-image-2");
		expect(resolved?.family.id).toBe("gpt-image");
		expect(resolved?.value).toEqual({
			routeId: "mediago.gpt-image-2",
			label: "MediaGo · GPT Image 2",
			params: { aspectRatio: "16:9", resolution: "4K", n: 2 },
		});
		expect(resolved?.families.map((family) => family.id)).toEqual(["seedream", "gpt-image"]);
	});

	it("falls back to the first configured route when the requested route is unknown", () => {
		const resolved = resolveGenerationRoute(catalog(), imageRoutes(), {
			routeId: "dmx.gpt-image-2",
			params: {},
		});

		expect(resolved?.route.id).toBe("jimeng.seedream-5.0");
	});

	it("returns null when no image route is configured", () => {
		expect(resolveGenerationRoute(catalog(), [], { routeId: "" })).toBeNull();
	});

	it("resolves a video route and keeps duration/audio while hiding the count", () => {
		const resolved = resolveGenerationRoute(catalog(), videoRoutes(), {
			routeId: "jimeng.seedance-2.0",
			params: { aspectRatio: "16:9", resolution: "720p", duration: "10", generateAudio: true },
		});

		expect(resolved?.route.id).toBe("jimeng.seedance-2.0");
		expect(resolved?.family.id).toBe("seedance");
		// Video routes have no `n` param, so the 张数 control is absent.
		expect(resolved?.count).toBeNull();
		expect(resolved?.value.params).toEqual({
			aspectRatio: "16:9",
			resolution: "720p",
			duration: "10",
			generateAudio: true,
		});
	});
});

describe("normalizeGenerationParamsValue", () => {
	it("corrects a ratio/resolution pair that violates the route combos", () => {
		const value = normalizeGenerationParamsValue(catalog(), gptImageRoute(), {
			aspectRatio: "1:1",
			resolution: "4K",
			n: 4,
		});

		// 1:1 only allows 1K/2K on GPT Image 2; resolution snaps to the first
		// allowed option instead of surfacing an invalid combination.
		expect(value.params.aspectRatio).toBe("1:1");
		expect(value.params.resolution).toBe("1K");
		expect(value.params.n).toBe(4);
	});

	it("drops params the route does not support and clamps the count", () => {
		const value = normalizeGenerationParamsValue(catalog(), gptImageRoute(), {
			quality: "high",
			n: 99,
		});

		expect(value.params.quality).toBeUndefined();
		expect(value.params.n).toBe(10);
		expect(value.label).toBe("MediaGo · GPT Image 2");
	});
});

describe("formatGenerationParamsValue", () => {
	it("renders the label with the surfaced params", () => {
		expect(
			formatGenerationParamsValue({
				routeId: "mediago.gpt-image-2",
				label: "MediaGo · GPT Image 2",
				params: { aspectRatio: "16:9", resolution: "4K", n: 4 },
			}),
		).toBe("MediaGo · GPT Image 2（16:9 · 4K · 4张）");
	});

	it("falls back to the route id when no label is present", () => {
		expect(formatGenerationParamsValue({ routeId: "jimeng.seedream-5.0" })).toBe(
			"jimeng.seedream-5.0",
		);
	});
});

const gptImageRoute = (): GenerationRoute =>
	imageRoutes().find((route) => route.id === "mediago.gpt-image-2") as GenerationRoute;

const imageRoutes = (): GenerationRoute[] =>
	catalog().routes.filter((route) => route.kind === "image" && route.configured === true);

const videoRoutes = (): GenerationRoute[] =>
	catalog().routes.filter((route) => route.kind === "video" && route.configured === true);

const catalog = (): GenerationModelsResponse =>
	({
		families: [
			{ id: "seedream", label: "Seedream", kinds: ["image"] },
			{ id: "gpt-image", label: "GPT Image", kinds: ["image"] },
			{ id: "seedance", label: "Seedance", kinds: ["video"] },
		],
		versions: [
			{ id: "seedream-5", familyId: "seedream", label: "Seedream 5.0", kind: "image" },
			{ id: "gpt-image-2", familyId: "gpt-image", label: "GPT Image 2", kind: "image" },
			{ id: "seedance-2", familyId: "seedance", label: "Seedance 2.0", kind: "video" },
		],
		routes: [
			{
				id: "jimeng.seedream-5.0",
				familyId: "seedream",
				versionId: "seedream-5",
				kind: "image",
				label: "即梦",
				provider: "jimeng",
				model: "5.0",
				status: "available",
				configured: true,
				params: [
					{
						name: "aspectRatio",
						label: "比例",
						type: "select",
						default: "1:1",
						options: [
							{ value: "1:1", label: "1:1" },
							{ value: "16:9", label: "16:9" },
						],
					},
					{
						name: "resolution",
						label: "分辨率",
						type: "select",
						default: "2K",
						options: [
							{ value: "2K", label: "2K" },
							{ value: "4K", label: "4K" },
						],
					},
					{ name: "n", label: "张数", type: "number", default: 1, min: 1, max: 4 },
				],
			},
			{
				id: "mediago.gpt-image-2",
				familyId: "gpt-image",
				versionId: "gpt-image-2",
				kind: "image",
				label: "MediaGo",
				provider: "mediago",
				model: "gpt-image-2",
				status: "available",
				configured: true,
				params: [
					{
						name: "aspectRatio",
						label: "比例",
						type: "select",
						default: "1:1",
						options: [
							{ value: "1:1", label: "1:1" },
							{ value: "16:9", label: "16:9" },
							{ value: "9:16", label: "9:16" },
						],
					},
					{
						name: "resolution",
						label: "分辨率",
						type: "select",
						default: "1K",
						options: [
							{ value: "1K", label: "1K" },
							{ value: "2K", label: "2K" },
							{ value: "4K", label: "4K" },
						],
					},
					{
						name: "quality",
						label: "画质",
						type: "select",
						default: "auto",
						options: [{ value: "auto", label: "Auto" }],
					},
					{ name: "n", label: "张数", type: "number", default: 1, min: 1, max: 10 },
				],
				paramCombos: [
					{
						params: ["aspectRatio", "resolution"],
						allowed: [
							["1:1", "1K"],
							["1:1", "2K"],
							["16:9", "2K"],
							["16:9", "4K"],
							["9:16", "4K"],
						],
					},
				],
			},
			{
				id: "dmx.gpt-image-2",
				familyId: "gpt-image",
				versionId: "gpt-image-2",
				kind: "image",
				label: "DMX",
				provider: "dmx",
				model: "gpt-image-2-ssvip",
				status: "available",
				params: [],
			},
			{
				id: "jimeng.seedance-2.0",
				familyId: "seedance",
				versionId: "seedance-2",
				kind: "video",
				label: "即梦",
				provider: "jimeng",
				model: "seedance-2.0",
				status: "available",
				configured: true,
				params: [
					{
						name: "aspectRatio",
						label: "比例",
						type: "select",
						default: "16:9",
						options: [
							{ value: "16:9", label: "16:9" },
							{ value: "9:16", label: "9:16" },
						],
					},
					{
						name: "resolution",
						label: "分辨率",
						type: "select",
						default: "720p",
						options: [
							{ value: "480p", label: "480p" },
							{ value: "720p", label: "720p" },
							{ value: "1080p", label: "1080p" },
						],
					},
					{
						name: "duration",
						label: "时长",
						type: "select",
						default: "5",
						options: [
							{ value: "5", label: "5s" },
							{ value: "10", label: "10s" },
						],
					},
					{ name: "generateAudio", label: "生成音频", type: "boolean", default: false },
				],
			},
		],
		models: [],
		providers: [],
	}) as unknown as GenerationModelsResponse;
