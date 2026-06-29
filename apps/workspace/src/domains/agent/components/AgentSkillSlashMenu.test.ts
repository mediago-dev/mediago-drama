import { describe, expect, it } from "vitest";
import {
	filterAgentSkillSlashItems,
	type AgentSkillSlashItem,
} from "@/domains/agent/components/AgentSkillSlashMenu";

describe("filterAgentSkillSlashItems", () => {
	it("moves automatic mention resolution to the bottom for the default skill menu", () => {
		const skills = [
			skill("auto-mention-resolver", "自动 @ 引用解析"),
			skill("character-writer", "角色设定写作"),
			skill("novel-writer", "小说写作"),
		];

		expect(filterAgentSkillSlashItems(skills, "").map((item) => item.name)).toEqual([
			"character-writer",
			"novel-writer",
			"auto-mention-resolver",
		]);
	});

	it("keeps automatic mention resolution last among matching skill results", () => {
		const skills = [
			skill("auto-mention-resolver", "自动 @ 引用解析", "用于辅助写作自动解析。"),
			skill("character-writer", "角色设定写作", "使用角色资料写作。"),
			skill("novel-writer", "小说写作", "使用资料写作。"),
		];

		expect(filterAgentSkillSlashItems(skills, "写作").map((item) => item.name)).toEqual([
			"character-writer",
			"novel-writer",
			"auto-mention-resolver",
		]);
	});
});

const skill = (
	name: string,
	title = name,
	description = "用于主要写作流程。",
): AgentSkillSlashItem => ({
	description,
	name,
	source: "pack",
	title,
});
