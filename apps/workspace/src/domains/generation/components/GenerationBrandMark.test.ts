import { describe, expect, it } from "vitest";
import {
	generationModelBrand,
	generationProviderBrand,
} from "@/domains/generation/components/GenerationBrandMark";

describe("generation brand marks", () => {
	it("maps providers to their real brand icon keys", () => {
		expect(generationProviderBrand("openai")).toBe("openai");
		expect(generationProviderBrand("google")).toBe("gemini");
		expect(generationProviderBrand("volcengine")).toBe("volcengine");
		expect(generationProviderBrand("jimeng")).toBe("jimeng");
		expect(generationProviderBrand("libtv")).toBe("libtv");
		expect(generationProviderBrand("xiaoyunque")).toBe("xiaoyunque");
		expect(generationProviderBrand("pippit")).toBe("xiaoyunque");
		expect(generationProviderBrand("dmx")).toBe("dmx");
		expect(generationProviderBrand("openrouter")).toBe("openrouter");
	});

	it("maps model families and versions to model brand icon keys", () => {
		expect(
			generationModelBrand({
				version: { id: "gpt-image-2", label: "GPT Image 2" },
			}),
		).toBe("gpt");
		expect(
			generationModelBrand({
				version: { id: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash Image" },
			}),
		).toBe("gemini");
		expect(
			generationModelBrand({
				version: { id: "seedance-2.0-vip", label: "Seedance 2.0 VIP" },
			}),
		).toBe("doubao");
	});
});
