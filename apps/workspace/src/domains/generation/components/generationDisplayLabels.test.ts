import { describe, expect, it } from "vitest";
import {
	compactGenerationLabel,
	displayGenerationLabelWithoutAlias,
} from "./generationDisplayLabels";

describe("generation display labels", () => {
	it("compacts internal whitespace", () => {
		expect(compactGenerationLabel("  Seedance   2.0  Fast  ")).toBe("Seedance 2.0 Fast");
	});

	it("shows the label after a slash-delimited alias", () => {
		expect(displayGenerationLabelWithoutAlias("即梦 / Seedance")).toBe("Seedance");
		expect(displayGenerationLabelWithoutAlias("Nano Banana Pro / Gemini 3 Pro Image")).toBe(
			"Gemini 3 Pro Image",
		);
	});
});
