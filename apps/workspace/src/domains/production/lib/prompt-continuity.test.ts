import { describe, expect, it } from "vitest";
import {
	buildContinuityRule,
	promptFromAssistantReply,
	promptWithContinuityRules,
	rulesForShot,
	storyboardGridCrop,
} from "./prompt-continuity";

describe("prompt continuity", () => {
	it("builds a directional inheritance rule", () => {
		expect(buildContinuityRule("S01", "S02", ["人物身份", "镜头方向"], "只改变表情")).toBe(
			"S02 继承 S01：保持人物身份、镜头方向一致；只改变表情。",
		);
	});

	it("only applies a rule to its target shot", () => {
		const rules = ["S02 继承 S01：保持人物身份一致；只改变表情。"];
		expect(rulesForShot(rules, "S01")).toEqual([]);
		expect(promptWithContinuityRules("基础 Prompt", "S02", rules)).toContain("必须执行");
	});

	it("prefers the explicit revised prompt block", () => {
		expect(promptFromAssistantReply("说明\n【修改后 Prompt】\n主体固定，光线变化")).toBe(
			"主体固定，光线变化",
		);
	});

	it("maps a storyboard id onto the 5 by 4 master grid", () => {
		expect(storyboardGridCrop("P01")).toMatchObject({ column: 0, row: 0, valid: true });
		expect(storyboardGridCrop("S20")).toMatchObject({ column: 4, row: 3, valid: true });
	});
});
