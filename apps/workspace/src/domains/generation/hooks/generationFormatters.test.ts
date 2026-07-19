import { describe, expect, it } from "vitest";
import type { GenerationRoute, GenerationTask } from "@/domains/generation/api/generation";
import {
	generationCreatedAtDetail,
	providerLabel,
	userRequestDetails,
	userTaskDetails,
} from "./generationFormatters";

describe("generationCreatedAtDetail", () => {
	it("formats valid generation timestamps", () => {
		expect(generationCreatedAtDetail("2026-05-30T10:00:00.000Z")).toEqual({
			label: "生成时间",
			value: expect.any(String),
		});
	});

	it("omits invalid generation timestamps", () => {
		expect(generationCreatedAtDetail("")).toBeNull();
		expect(generationCreatedAtDetail("invalid")).toBeNull();
	});

	it("localizes provider labels", () => {
		expect(providerLabel("aliyun")).toBe("阿里云百炼");
		expect(providerLabel("libtv")).toBe("LibTV");
		expect(providerLabel("xiaoyunque")).toBe("小云雀");
		expect(providerLabel("pippit")).toBe("小云雀");
	});

	it("hides task params that are no longer declared by the route", () => {
		const route = {
			id: "official.wan2.7-image-pro",
			model: "wan2.7-image-pro",
			provider: "aliyun",
			params: [{ name: "resolution", label: "Resolution", type: "select" }],
		} as GenerationRoute;
		const task = {
			routeId: route.id,
			model: route.model,
			params: { resolution: "4K", watermark: true, seed: 42 },
		} as unknown as GenerationTask;

		expect(
			userTaskDetails(task, {
				providers: [{ id: "aliyun", label: "阿里云百炼", providerType: "official" }],
				routes: [route],
			}),
		).toEqual([
			{ label: "供应商", value: "阿里云百炼 · 官方 · wan2.7-image-pro" },
			{ label: "分辨率", value: "4K" },
		]);
	});

	it("shows the HappyHorse R2V model when a MediaGo request has references", () => {
		const route = {
			id: "mediago.happyhorse-1.1",
			model: "happyhorse-1.1-t2v",
			provider: "mediago",
			params: [],
		} as unknown as GenerationRoute;

		expect(userRequestDetails(route, {}, 1)).toEqual([
			{ label: "供应商", value: "MediaGo · 统一接口 · happyhorse-1.1-r2v" },
		]);

		const task = {
			routeId: route.id,
			model: "happyhorse-1.1-r2v",
			params: {},
		} as unknown as GenerationTask;
		expect(userTaskDetails(task, { routes: [route] })).toEqual([
			{ label: "供应商", value: "MediaGo · 统一接口 · happyhorse-1.1-r2v" },
		]);
	});
});
