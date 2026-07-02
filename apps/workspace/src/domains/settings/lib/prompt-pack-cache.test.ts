import { describe, expect, it } from "vitest";
import {
	isPromptLibraryCacheKey,
	isPromptPackContentCacheKey,
	isSkillCacheKey,
} from "./prompt-pack-cache";

describe("prompt pack cache key matchers", () => {
	it("matches skill list and detail keys", () => {
		expect(isSkillCacheKey("/skills")).toBe(true);
		expect(isSkillCacheKey("/skills/character-writer")).toBe(true);
		expect(isSkillCacheKey("/skill")).toBe(false);
	});

	it("matches prompt library list, filtered, and category keys", () => {
		expect(isPromptLibraryCacheKey("/prompt-presets")).toBe(true);
		expect(isPromptLibraryCacheKey("/prompt-presets?category=style")).toBe(true);
		expect(isPromptLibraryCacheKey("/prompt-categories")).toBe(true);
		expect(isPromptLibraryCacheKey("/prompts")).toBe(false);
	});

	it("combines skill and prompt library keys for prompt pack refreshes", () => {
		expect(isPromptPackContentCacheKey("/skills/storyboard-writer")).toBe(true);
		expect(isPromptPackContentCacheKey("/prompt-presets?category=extra")).toBe(true);
		expect(isPromptPackContentCacheKey("/packs")).toBe(false);
	});
});
