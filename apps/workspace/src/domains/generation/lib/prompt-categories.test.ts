import { describe, expect, it } from "vitest";
import { promptCategoryLabel, taskTypeForCategory } from "./prompt-categories";

describe("taskTypeForCategory", () => {
	it("maps document categories to task types", () => {
		expect(taskTypeForCategory("character")).toBe("character");
		expect(taskTypeForCategory("scene")).toBe("scene");
		expect(taskTypeForCategory("storyboard")).toBe("storyboard");
		expect(taskTypeForCategory("prop")).toBe("prop");
	});

	it("falls back to studio for other/missing categories", () => {
		expect(taskTypeForCategory("screenplay")).toBe("studio");
		expect(taskTypeForCategory(null)).toBe("studio");
		expect(taskTypeForCategory(undefined)).toBe("studio");
	});
});

describe("promptCategoryLabel", () => {
	it("keeps prompt preset groups readable in slash insertion", () => {
		expect(promptCategoryLabel("style")).toBe("风格");
		expect(promptCategoryLabel("extra")).toBe("其他");
		expect(promptCategoryLabel("镜头")).toBe("镜头");
		expect(
			promptCategoryLabel("extra", [{ id: "extra", label: "通用", source: "pack", builtin: true }]),
		).toBe("通用");
	});
});
