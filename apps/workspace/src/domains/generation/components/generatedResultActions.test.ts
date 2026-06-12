import { describe, expect, it } from "vitest";
import { generationAssetFile } from "./generatedResultActions";

describe("generationAssetFile", () => {
	it("creates a file from inline base64 generated assets", async () => {
		const file = await generationAssetFile(
			{
				kind: "image",
				base64: btoa("image-bytes"),
				mimeType: "image/png",
			},
			"",
			"scene",
		);

		expect(file.name).toBe("scene.png");
		expect(file.type).toBe("image/png");
		expect(await file.text()).toBe("image-bytes");
	});
});
