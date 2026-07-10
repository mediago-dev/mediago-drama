import { describe, expect, it } from "vitest";
import type { BlockRange } from "./types";
import { supportsBlockMediaActions } from "./block-action-menu-visibility";

const blockRange = (nodeType: string, headingLevel?: number): BlockRange => ({
	from: 0,
	headingLevel,
	index: 0,
	nodeType,
	text: "测试块",
	to: 4,
});

describe("supportsBlockMediaActions", () => {
	it("only enables media actions for h2 blocks", () => {
		expect(supportsBlockMediaActions(blockRange("heading", 2))).toBe(true);
		expect(supportsBlockMediaActions(blockRange("heading", 1))).toBe(false);
		expect(supportsBlockMediaActions(blockRange("heading", 3))).toBe(false);
		expect(supportsBlockMediaActions(blockRange("paragraph"))).toBe(false);
	});
});
