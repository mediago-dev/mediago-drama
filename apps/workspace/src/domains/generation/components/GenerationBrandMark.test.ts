import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
	GenerationBrandMark,
	generationModelBrand,
	generationProviderBrand,
} from "@/domains/generation/components/GenerationBrandMark";

describe("generation brand marks", () => {
	afterEach(cleanup);

	it("maps providers to their real brand icon keys", () => {
		expect(generationProviderBrand("openai")).toBe("openai");
		expect(generationProviderBrand("google")).toBe("gemini");
		expect(generationProviderBrand("volcengine")).toBe("volcengine");
		expect(generationProviderBrand("aliyun")).toBe("aliyun");
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
		expect(
			generationModelBrand({
				version: { id: "wan2.7-image-pro", label: "Wan 2.7 Image Pro" },
			}),
		).toBe("aliyun");
		expect(
			generationModelBrand({
				version: { id: "happyhorse-1.1", label: "HappyHorse 1.1" },
			}),
		).toBe("aliyun");
	});

	it("uses the Bailian product icon for the Aliyun provider", () => {
		const { container } = render(createElement(GenerationBrandMark, { brand: "aliyun" }));
		const mark = container.querySelector<HTMLElement>('[data-generation-brand="aliyun"]');
		const image = mark?.querySelector<HTMLImageElement>("img");
		const source = image?.getAttribute("src") ?? "";

		expect(mark?.title).toBe("阿里云百炼");
		expect(source).toContain("BaiLian");
		expect(source).toContain("%237347FF");
		expect(source).not.toContain("AlibabaCloud");
	});
});
