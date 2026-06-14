import { describe, expect, it } from "vitest";
import { createDOMTextAnchorResolver } from "./text-anchor-dom";

describe("DOM text anchor resolver", () => {
	it("resolves anchor rectangles from one DOM text index", () => {
		const root = document.createElement("div");
		root.append("Alpha ");
		const middle = document.createElement("span");
		middle.textContent = "Beta";
		root.append(middle, " and Gamma");

		const resolver = createDOMTextAnchorResolver(root);

		expect(
			resolver.findRect({
				quote: "Beta",
				contextBefore: "Alpha ",
				contextAfter: " and",
			}),
		).toBeInstanceOf(DOMRect);
		expect(resolver.findRect("Gamma missing", { fallbackToToken: true })).toBeInstanceOf(DOMRect);
	});
});
