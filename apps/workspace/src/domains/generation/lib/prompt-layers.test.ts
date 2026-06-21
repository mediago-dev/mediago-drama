import { describe, expect, it } from "vitest";
import { promptLayerLabels, taskTypeForCategory } from "./prompt-layers";

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

describe("promptLayerLabels", () => {
	it("keeps prompt preset groups readable in slash insertion", () => {
		expect(promptLayerLabels.style).toBe("风格");
		expect(promptLayerLabels.extra).toBe("其他");
	});
});
