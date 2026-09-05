import { describe, expect, it } from "vitest";
import { defaultFamilyIds, fallbackCatalog, preferredRoute } from "./generationCatalog";

describe("generation catalog defaults", () => {
	it("defaults image generation to MediaGo Nano Banana 2", () => {
		expect(defaultFamilyIds.image).toBe("nano-banana");

		const routes = fallbackCatalog.routes
			.filter((route) => route.versionId === "gemini-3.1-flash-image-preview")
			.map((route) => ({ ...route, configured: true, status: "available" as const }));

		expect(preferredRoute(routes)?.id).toBe("mediago.gemini-3.1-flash-image");
	});
});
