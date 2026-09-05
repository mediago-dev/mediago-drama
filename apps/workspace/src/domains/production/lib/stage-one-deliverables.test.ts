import { describe, expect, it } from "vitest";
import {
	buildStoryboardPlanningRequest,
	isStageOneScriptLocked,
	isStageOneStoryboardLocked,
	stageOneScriptApproval,
	stageOneStoryboardApproval,
} from "./stage-one-deliverables";

describe("stage one deliverables", () => {
	it("locks and unlocks only the stage one script marker", () => {
		expect(stageOneScriptApproval(["reference-approved"], true)).toEqual([
			"reference-approved",
			"stage-one:script",
		]);
		expect(isStageOneScriptLocked(["stage-one:script"])).toBe(true);
		expect(stageOneScriptApproval(["reference-approved", "stage-one:script"], false)).toEqual([
			"reference-approved",
		]);
	});

	it("locks the storyboard independently from the script", () => {
		const locked = stageOneStoryboardApproval(["stage-one:script"], true);
		expect(locked).toEqual(["stage-one:script", "stage-one:storyboard-master"]);
		expect(isStageOneStoryboardLocked(locked)).toBe(true);
		expect(stageOneStoryboardApproval(locked, false)).toEqual(["stage-one:script"]);
	});

	it("requests a semantic 20-panel plan instead of mechanically splitting lines", () => {
		const prompt = buildStoryboardPlanningRequest("锁定剧本", "蓝金中秋调性");
		expect(prompt).toContain("导演拆解成 20 格专业分镜");
		expect(prompt).toContain("4列×5行");
		expect(prompt).toContain("不得机械平均");
		expect(prompt).toContain("蓝金中秋调性");
		expect(prompt).toContain("锁定剧本");
		expect(prompt).toContain("逐格执行表");
		expect(prompt).toContain("动作起点与结果");
		expect(prompt).not.toContain("P01｜00-03秒｜大全景");
	});
});
