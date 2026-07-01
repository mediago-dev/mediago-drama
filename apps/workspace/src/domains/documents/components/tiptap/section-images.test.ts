import { describe, expect, it } from "vitest";
import { isSectionImagePlaceholderElement } from "./section-images";

const imageWithAlt = (alt: string, src = "") => {
	const image = document.createElement("img");
	image.alt = alt;
	if (src) image.src = src;
	return image;
};

describe("isSectionImagePlaceholderElement", () => {
	it("detects legacy placeholder images by their alt prefix", () => {
		expect(
			isSectionImagePlaceholderElement(
				imageWithAlt("mediago-drama-section-image-pending:block-1:ph-1"),
			),
		).toBe(true);
		expect(
			isSectionImagePlaceholderElement(
				imageWithAlt("media-cli-section-image-pending:block-1:ph-1"),
			),
		).toBe(true);
	});

	it("treats a normal image as a real image", () => {
		expect(
			isSectionImagePlaceholderElement(imageWithAlt("章节图片", "https://example.com/a.png")),
		).toBe(false);
	});
});
