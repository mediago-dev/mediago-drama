import { describe, expect, it } from "vitest";
import { defaultFamilyIds, fallbackCatalog, preferredRoute } from "./generationCatalog";

describe("generation catalog defaults", () => {
	it("defaults image generation to the configured Nano Banana 2 route", () => {
		expect(defaultFamilyIds.image).toBe("whereslow-image");

		const routes = fallbackCatalog.routes
			.filter((route) => route.kind === "image")
			.map((route) => ({
				...route,
				configured: true,
				status: "available" as const,
			}));

		expect(preferredRoute(routes)?.id).toBe("whereslow-image.nano-banana-2");
	});
});
