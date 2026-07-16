import { describe, expect, it } from "vitest";
import { parsePromptPackSaveRequest } from "./prompt-pack-save.js";

describe("prompt pack save request", () => {
	it("accepts bytes and strips directory components from the suggested filename", () => {
		const data = new Uint8Array([0x4d, 0x47, 0x50, 0x4b]);

		expect(
			parsePromptPackSaveRequest({
				data,
				filename: "../../draft.mgpack",
			}),
		).toEqual({ data, filename: "draft.mgpack" });
	});

	it.each([
		["missing bytes", { filename: "draft.mgpack" }],
		["empty bytes", { data: new Uint8Array(), filename: "draft.mgpack" }],
		["wrong extension", { data: new Uint8Array([1]), filename: "draft.txt" }],
	])("rejects %s", (_label, request) => {
		expect(() => parsePromptPackSaveRequest(request)).toThrow();
	});
});
