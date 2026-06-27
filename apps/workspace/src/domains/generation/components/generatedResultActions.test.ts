import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationAsset } from "@/domains/generation/api/generation";
import type { GenerationEntry } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";

const downloadMocks = vi.hoisted(() => ({
	downloadLocalFileWithDirectoryPicker: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
	error: vi.fn(),
	success: vi.fn(),
	warning: vi.fn(),
	copySuccess: vi.fn(),
}));

vi.mock("@/domains/workspace/lib/downloads", async () => {
	const actual = await vi.importActual<typeof import("@/domains/workspace/lib/downloads")>(
		"@/domains/workspace/lib/downloads",
	);
	return {
		...actual,
		downloadLocalFileWithDirectoryPicker: downloadMocks.downloadLocalFileWithDirectoryPicker,
	};
});

vi.mock("@/hooks/useToast", () => ({
	useToast: () => toastMocks,
}));

import {
	generatedAssetSaveKey,
	generationAssetFile,
	useGeneratedResultActions,
} from "./generatedResultActions";

beforeEach(() => {
	vi.clearAllMocks();
});

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

describe("useGeneratedResultActions", () => {
	it("does not keep generated asset downloads in the saved state after completion", async () => {
		const asset = {
			downloadPath: "/tmp/source.png",
			kind: "image",
			mimeType: "image/png",
			title: "角色图",
			url: "/api/v1/media-assets/asset-1/content",
		} satisfies GenerationAsset;
		const entry = {
			assets: [asset],
			content: "",
			id: "entry-1",
			kind: "image",
			prompt: "角色图",
		} satisfies GenerationEntry;
		downloadMocks.downloadLocalFileWithDirectoryPicker.mockResolvedValue({
			filename: "角色图.png",
			path: "/tmp/export/角色图.png",
		});

		const { result } = renderHook(() => useGeneratedResultActions());

		await act(async () => {
			await result.current.saveAsset(entry, asset);
		});

		expect(result.current.savingKeys).not.toContain(generatedAssetSaveKey(entry, asset));
		expect(result.current.savedKeys).not.toContain(generatedAssetSaveKey(entry, asset));
		expect(toastMocks.success).toHaveBeenCalledWith("文件已保存", {
			description: "/tmp/export/角色图.png",
		});
	});
});
