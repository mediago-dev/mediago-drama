import { describe, expect, it } from "vitest";
import { composeLayerStyle, taskTypeForCategory, taskTypeLayers } from "./prompt-layers";

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

describe("taskTypeLayers", () => {
	it("returns the fixed layer stack per task type", () => {
		expect(taskTypeLayers("character")).toEqual(["style", "extra"]);
		expect(taskTypeLayers("scene")).toEqual(["style", "extra"]);
		expect(taskTypeLayers("storyboard")).toEqual(["style", "extra"]);
		expect(taskTypeLayers("prop")).toEqual(["style", "extra"]);
		expect(taskTypeLayers("studio")).toEqual(["style", "extra"]);
	});
});

describe("composeLayerStyle", () => {
	it("joins non-empty layer texts in order and drops blanks", () => {
		expect(composeLayerStyle(["超写实", "", "  冷调  ", undefined, null])).toBe("超写实\n冷调");
		expect(composeLayerStyle([])).toBe("");
	});
});
