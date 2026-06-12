import { describe, expect, it } from "vitest";

import {
	codeBlockAttrs,
	headingBlockAttrs,
	linkMarkAttrs,
	listBlockAttrs,
	mentionAttrs,
} from "./attrs";

describe("document attrs", () => {
	it("reads typed block attrs from generic wire attrs", () => {
		expect(codeBlockAttrs({ language: " go " })).toEqual({ language: "go" });
		expect(listBlockAttrs({ ordered: "true" })).toEqual({ ordered: true });
		expect(headingBlockAttrs({ level: 3.8 })).toEqual({ level: 3 });
	});

	it("reads typed inline attrs from generic wire attrs", () => {
		expect(linkMarkAttrs({ href: " https://example.test " })).toEqual({
			href: "https://example.test",
		});
		expect(mentionAttrs({ id: " doc-1 ", label: " Scene " })).toEqual({
			id: "doc-1",
			label: "Scene",
		});
	});
});
