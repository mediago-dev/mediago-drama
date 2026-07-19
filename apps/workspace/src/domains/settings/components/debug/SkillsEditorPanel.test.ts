import { describe, expect, it } from "vitest";
import type { PromptPack } from "@/domains/settings/api/packs";
import type { SkillMeta } from "@/domains/settings/api/skills";
import {
	orderSkillsByPackTag,
	orderSkillsForPrimaryFlows,
} from "@/domains/settings/lib/skill-order";

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

describe("orderSkillsByPackTag", () => {
	it("groups matching pack tags and places imported packs at the bottom", () => {
		const packs: PromptPack[] = [
			pack("marketplace.123", "123", "imported"),
			pack("local.test-export", "测试导出", "local"),
			pack("builtin", "MediaGo 默认技能包", "default"),
		];
		const skills = [
			{ ...skill("unnamed", "未命名 Skill"), packId: "marketplace.123" },
			{ ...skill("character", "角色设定写作"), packId: "local.test-export" },
			{ ...skill("builtin-image", "图片生成"), packId: "builtin" },
			{ ...skill("screenplay", "剧本写作"), packId: "local.test-export" },
		];

		expect(orderSkillsByPackTag(skills, packs).map((item) => item.name)).toEqual([
			"builtin-image",
			"character",
			"screenplay",
			"unnamed",
		]);
	});

	it("does not mutate the source skill list", () => {
		const packs = [pack("marketplace.123", "123", "imported")];
		const skills = [skill("first"), skill("second")];

		orderSkillsByPackTag(skills, packs);

		expect(skills.map((item) => item.name)).toEqual(["first", "second"]);
	});
});

const skill = (name: string, title = name): SkillMeta => ({
	description: "",
	name,
	source: "pack",
	title,
});

const pack = (id: string, name: string, source: PromptPack["source"]): PromptPack => ({
	enabled: true,
	id,
	name,
	source,
	version: "1.0.0",
});
