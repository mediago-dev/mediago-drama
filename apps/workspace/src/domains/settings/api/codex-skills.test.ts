import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	codexSkillKey,
	codexSkillsKey,
	getCodexSkill,
	listCodexSkills,
	type CodexSkillDetail,
	type CodexSkillsResponse,
} from "@/domains/settings/api/codex-skills";
import httpClient from "@/shared/lib/http";
import type { ApiResponse } from "@/types/api";

vi.mock("@/shared/lib/http", () => ({
	default: {
		get: vi.fn(),
	},
}));

describe("Codex Skills API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fetches the global inventory from its own resource key", async () => {
		const payload: CodexSkillsResponse = {
			generatedAt: "2026-07-14T12:00:00Z",
			issues: [],
			roots: [],
			skills: [],
			summary: { mediaGoAvailable: 0, needsAttention: 0, total: 0, unknown: 0 },
		};
		vi.mocked(httpClient.get).mockResolvedValue(apiResponse(payload));

		await expect(listCodexSkills()).resolves.toEqual(payload);

		expect(codexSkillsKey).toBe("/codex-skills");
		expect(httpClient.get).toHaveBeenCalledWith("/codex-skills");
	});

	it("encodes a stable skill id in the detail request", async () => {
		const detail = {
			id: "user/shared release+check",
			rawContent: "---\nname: release-check\n---",
		} as CodexSkillDetail;
		vi.mocked(httpClient.get).mockResolvedValue(apiResponse(detail));

		await expect(getCodexSkill(detail.id)).resolves.toEqual(detail);

		expect(codexSkillKey(detail.id)).toBe("/codex-skills/user%2Fshared%20release%2Bcheck");
		expect(httpClient.get).toHaveBeenCalledWith("/codex-skills/user%2Fshared%20release%2Bcheck");
	});
});

const apiResponse = <T>(data: T): ApiResponse<T> => ({
	code: 0,
	data,
	message: "ok",
	success: true,
});
