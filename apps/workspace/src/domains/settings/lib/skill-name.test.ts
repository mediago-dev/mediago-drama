import { describe, expect, it } from "vitest";
import { sanitizeSkillName } from "./skill-name";

describe("sanitizeSkillName", () => {
	it("preserves Chinese skill names", () => {
		expect(sanitizeSkillName("产品图")).toBe("产品图");
	});

	it("normalizes unsafe file name characters without removing Chinese text", () => {
		expect(sanitizeSkillName("  /产品 图.skill.md  ")).toBe("产品-图");
	});

	it("rejects names without letters or numbers", () => {
		expect(sanitizeSkillName("../🔥")).toBe("");
	});
});
