import { describe, expect, it } from "vitest";
import type { SkillMeta } from "@/domains/settings/api/skills";
import { orderSkillsForPrimaryFlows } from "@/domains/settings/lib/skill-order";

describe("orderSkillsForPrimaryFlows", () => {
	it("moves automatic mention resolution to the bottom while preserving other skill order", () => {
		const skills = [
			skill("auto-mention-resolver", "自动 @ 引用解析"),
			skill("character-writer", "角色设定写作"),
			skill("novel-writer", "小说写作"),
		];

		expect(orderSkillsForPrimaryFlows(skills).map((item) => item.name)).toEqual([
			"character-writer",
			"novel-writer",
			"auto-mention-resolver",
		]);
	});

	it("does not mutate the source skill list", () => {
		const skills = [skill("auto-mention-resolver", "自动 @ 引用解析"), skill("character-writer")];

		orderSkillsForPrimaryFlows(skills);

		expect(skills.map((item) => item.name)).toEqual(["auto-mention-resolver", "character-writer"]);
	});
});

const skill = (name: string, title = name): SkillMeta => ({
	description: "",
	name,
	source: "pack",
	title,
});
