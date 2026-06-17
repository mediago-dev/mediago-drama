import { describe, expect, it } from "vitest";
import { generationAssetFile, saveGeneratedAssetToTarget } from "./generatedResultActions";

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

	it("saves a generated asset into a provided browser directory target", async () => {
		const written: Blob[] = [];
		let requestedFilename = "";
		const directory = {
			getFileHandle: async (name: string, options?: { create?: boolean }) => {
				requestedFilename = name;
				if (!options?.create) throw new DOMException("missing", "NotFoundError");

				return {
					createWritable: async () => ({
						write: async (data: Blob) => {
							written.push(data);
						},
						close: async () => {},
					}),
				};
			},
		};

		const saved = await saveGeneratedAssetToTarget(
			{
				kind: "image",
				base64: btoa("image-bytes"),
				mimeType: "image/png",
			},
			"",
			"scene",
			{ kind: "browser", directory },
		);

		expect(saved).toBe("scene.png");
		expect(requestedFilename).toBe("scene.png");
		expect(await written[0]?.text()).toBe("image-bytes");
	});
});
