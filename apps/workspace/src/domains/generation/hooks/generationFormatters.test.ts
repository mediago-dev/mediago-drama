import { describe, expect, it } from "vitest";
import { generationCreatedAtDetail, providerLabel } from "./generationFormatters";

describe("generationCreatedAtDetail", () => {
	it("formats valid generation timestamps", () => {
		expect(generationCreatedAtDetail("2026-05-30T10:00:00.000Z")).toEqual({
			label: "生成时间",
			value: expect.any(String),
		});
	});

	it("omits invalid generation timestamps", () => {
		expect(generationCreatedAtDetail("")).toBeNull();
		expect(generationCreatedAtDetail("invalid")).toBeNull();
	});

	it("localizes local CLI provider labels", () => {
		expect(providerLabel("libtv")).toBe("LibTV");
		expect(providerLabel("xiaoyunque")).toBe("小云雀");
		expect(providerLabel("pippit")).toBe("小云雀");
	});
});
