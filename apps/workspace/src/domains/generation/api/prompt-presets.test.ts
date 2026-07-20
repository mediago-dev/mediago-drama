import { beforeEach, describe, expect, it, vi } from "vitest";
import httpClient from "@/shared/lib/http";
import { getPromptPresetForUse, listPromptPresets } from "./prompt-presets";

vi.mock("@/shared/lib/http", () => ({
	default: {
		delete: vi.fn(),
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
	},
}));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("prompt preset insertion API", () => {
	it("loads protected prompt content through the explicit use endpoint", async () => {
		vi.mocked(httpClient.get).mockResolvedValue({
			code: 0,
			data: {
				id: "protected/style",
				name: "受保护风格",
				category: "style",
				prompt: "private prompt body",
				source: "pack",
			},
			message: "ok",
			success: true,
		});

		const result = await getPromptPresetForUse("protected/style");

		expect(httpClient.get).toHaveBeenCalledWith("/prompt-presets/protected%2Fstyle/use");
		expect(result.prompt).toBe("private prompt body");
	});

	it("hydrates the slash-menu index with directly insertable prompt bodies", async () => {
		vi.mocked(httpClient.get)
			.mockResolvedValueOnce({
				code: 0,
				data: {
					prompts: [
						{
							id: "protected-style",
							name: "受保护风格",
							category: "style",
							source: "pack",
						},
					],
				},
				message: "ok",
				success: true,
			})
			.mockResolvedValueOnce({
				code: 0,
				data: {
					id: "protected-style",
					name: "受保护风格",
					category: "style",
					prompt: "cinematic lighting",
					source: "pack",
				},
				message: "ok",
				success: true,
			});

		const result = await listPromptPresets();

		expect(result).toHaveLength(1);
		expect(result[0]?.prompt).toBe("cinematic lighting");
		expect(httpClient.get).toHaveBeenNthCalledWith(2, "/prompt-presets/protected-style/use");
	});
});
