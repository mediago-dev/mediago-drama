import { afterEach, describe, expect, it, vi } from "vitest";
import httpClient from "@/shared/lib/http";
import {
	exportPromptPack,
	forkPromptPack,
	promptPackExportFileName,
	savePromptPackDraft,
} from "./packs";

vi.mock("@/shared/lib/http", () => ({
	default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

afterEach(() => vi.unstubAllGlobals());

describe("promptPackExportFileName", () => {
	it("uses the readable pack name and version", () => {
		expect(
			promptPackExportFileName({
				id: "local.e73c61d0-e311-438d-a939-2d0bc0609cf8",
				name: "测试风格",
				version: "1.0.0",
			}),
		).toBe("测试风格-v1.0.0.mgpack");
	});

	it("removes path characters from the suggested name", () => {
		expect(
			promptPackExportFileName({
				id: "local.test",
				name: "角色/场景:套装",
				version: "v2.1.0",
			}),
		).toBe("角色-场景-套装-v2.1.0.mgpack");
	});

	it("removes path characters from the version", () => {
		expect(
			promptPackExportFileName({
				id: "local.test",
				name: "风格包",
				version: "v2/1:0",
			}),
		).toBe("风格包-v2-1-0.mgpack");
	});

	it("falls back when the server returns a malformed UTF-8 filename", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response("pack", {
					headers: { "content-disposition": "attachment; filename*=UTF-8''%E0%A4%A" },
					status: 200,
				}),
			),
		);

		await expect(exportPromptPack("local.test")).resolves.toMatchObject({ fileName: "" });
	});
});

describe("forkPromptPack", () => {
	it("posts fork metadata to the source pack endpoint", async () => {
		const forked = {
			enabled: true,
			id: "local.forked",
			name: "默认技能包副本",
			source: "local" as const,
			version: "1.0.0",
		};
		vi.mocked(httpClient.post).mockResolvedValueOnce({
			code: 0,
			data: forked,
			message: "",
			success: true,
		});

		await expect(
			forkPromptPack("builtin", {
				description: "本地副本",
				name: "默认技能包副本",
				version: "1.0.0",
			}),
		).resolves.toEqual(forked);
		expect(httpClient.post).toHaveBeenCalledWith("/packs/builtin/fork", {
			description: "本地副本",
			name: "默认技能包副本",
			version: "1.0.0",
		});
	});
});

describe("savePromptPackDraft", () => {
	it("puts one complete revisioned desired-state request", async () => {
		const saved = {
			categories: [],
			entries: [],
			pack: {
				enabled: true,
				id: "local.test",
				name: "Test",
				source: "local" as const,
				version: "1.0.0",
			},
			revision: "next",
		};
		vi.mocked(httpClient.put).mockResolvedValueOnce({
			code: 0,
			data: saved,
			message: "",
			success: true,
		});
		const input = { baseRevision: "base", categories: [], entries: [] };
		await expect(savePromptPackDraft("local.test", input)).resolves.toEqual(saved);
		expect(httpClient.put).toHaveBeenCalledWith("/packs/local.test/contents", input);
	});
});
