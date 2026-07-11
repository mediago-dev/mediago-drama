import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationRoute } from "@/domains/generation/api/generation";
import type { MediaAsset } from "@/domains/workspace/api/media";
import { uploadMediaAsset } from "@/domains/workspace/api/media";
import { useGenerationReferences } from "./useGenerationReferences";

vi.mock("@/domains/workspace/api/media", () => ({
	uploadMediaAsset: vi.fn(),
}));

const imageRoute: GenerationRoute = {
	adapter: "test.image",
	configured: true,
	docUrl: "https://example.test/image",
	familyId: "image-family",
	id: "image-route",
	async: false,
	kind: "image",
	label: "Image Route",
	model: "image-model",
	params: [],
	provider: "openai",
	status: "available",
	supportsReferenceUrls: true,
	versionId: "image-version",
};

const videoRoute: GenerationRoute = {
	...imageRoute,
	adapter: "openrouter.video",
	docUrl: "https://example.test/video",
	familyId: "video-family",
	id: "video-route",
	kind: "video",
	model: "video-model",
	provider: "openrouter",
	versionId: "video-version",
};
const libTVVideoRoute: GenerationRoute = {
	...videoRoute,
	adapter: "libtv.cli.video",
	id: "libtv-video-route",
	provider: "libtv",
};
const unsupportedImageRoute: GenerationRoute = {
	...imageRoute,
	id: "unsupported-image-route",
	supportsReferenceUrls: false,
};

const mediaAsset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
	createdAt: "2026-06-18T00:00:00.000Z",
	filename: "reference.png",
	id: "reference-image",
	kind: "image",
	mimeType: "image/png",
	sizeBytes: 1024,
	updatedAt: "2026-06-18T00:00:00.000Z",
	url: "/api/v1/media-assets/reference-image/content",
	...overrides,
});

const uploadEvent = (file: File) =>
	({
		target: {
			files: [file],
			value: "reference",
		},
	}) as unknown as React.ChangeEvent<HTMLInputElement>;

describe("useGenerationReferences", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("selects an uploaded video when the active video route supports video references", async () => {
		const uploadedVideo = mediaAsset({
			filename: "scene.mp4",
			id: "reference-video",
			kind: "video",
			mimeType: "video/mp4",
			url: "/api/v1/media-assets/reference-video/content",
		});
		vi.mocked(uploadMediaAsset).mockResolvedValue(uploadedVideo);

		const { result } = renderHook(() =>
			useGenerationReferences({
				extraReferenceAssetIds: [],
				extraReferenceUrls: [],
				mediaAssetProjectId: "project-a",
				mediaAssets: [uploadedVideo],
				mutateMediaAssets: vi.fn(),
				prompt: "镜头推进",
				selectedRoute: videoRoute,
				setError: vi.fn(),
			}),
		);

		await act(async () => {
			await result.current.uploadReferenceAsset(
				uploadEvent(new File(["video"], "scene.mp4", { type: "video/mp4" })),
			);
		});

		expect(result.current.selectedReferenceAssetIds).toEqual(["reference-video"]);
	});

	it("allows LibTV routes to select image video and audio references", () => {
		const referenceImage = mediaAsset({ id: "reference-image", kind: "image" });
		const referenceVideo = mediaAsset({
			filename: "scene.mp4",
			id: "reference-video",
			kind: "video",
			mimeType: "video/mp4",
			url: "/api/v1/media-assets/reference-video/content",
		});
		const referenceAudio = mediaAsset({
			filename: "voice.wav",
			id: "reference-audio",
			kind: "audio",
			mimeType: "audio/wav",
			url: "/api/v1/media-assets/reference-audio/content",
		});

		const { result } = renderHook(() =>
			useGenerationReferences({
				extraReferenceAssetIds: [],
				extraReferenceUrls: [],
				mediaAssetProjectId: "project-a",
				mediaAssets: [referenceImage, referenceVideo, referenceAudio],
				mutateMediaAssets: vi.fn(),
				prompt: "多模态参考",
				selectedRoute: libTVVideoRoute,
				setError: vi.fn(),
			}),
		);

		expect(Array.from(result.current.selectableReferenceKinds).sort()).toEqual([
			"audio",
			"image",
			"video",
		]);

		act(() => {
			result.current.selectReferenceAsset(referenceImage);
			result.current.selectReferenceAsset(referenceVideo);
			result.current.selectReferenceAsset(referenceAudio);
		});

		expect(result.current.selectedReferenceAssetIds).toEqual([
			"reference-image",
			"reference-video",
			"reference-audio",
		]);
	});

	it("does not select an uploaded video for image-only reference routes", async () => {
		const uploadedVideo = mediaAsset({
			filename: "scene.mp4",
			id: "reference-video",
			kind: "video",
			mimeType: "video/mp4",
			url: "/api/v1/media-assets/reference-video/content",
		});
		vi.mocked(uploadMediaAsset).mockResolvedValue(uploadedVideo);

		const { result } = renderHook(() =>
			useGenerationReferences({
				extraReferenceAssetIds: [],
				extraReferenceUrls: [],
				mediaAssetProjectId: "project-a",
				mediaAssets: [uploadedVideo],
				mutateMediaAssets: vi.fn(),
				prompt: "生成图片",
				selectedRoute: imageRoute,
				setError: vi.fn(),
			}),
		);

		await act(async () => {
			await result.current.uploadReferenceAsset(
				uploadEvent(new File(["video"], "scene.mp4", { type: "video/mp4" })),
			);
		});

		expect(result.current.selectedReferenceAssetIds).toEqual([]);
	});

	it("drops selected references when the active route no longer supports them", async () => {
		const referenceImage = mediaAsset();
		const { result, rerender } = renderHook(
			({ selectedRoute }: { selectedRoute: GenerationRoute }) =>
				useGenerationReferences({
					extraReferenceAssetIds: [],
					extraReferenceUrls: [],
					mediaAssetProjectId: "project-a",
					mediaAssets: [referenceImage],
					mutateMediaAssets: vi.fn(),
					prompt: "生成图片",
					selectedRoute,
					setError: vi.fn(),
				}),
			{ initialProps: { selectedRoute: imageRoute } },
		);

		act(() => {
			result.current.selectReferenceAsset(referenceImage);
		});
		expect(result.current.selectedReferenceAssetIds).toEqual(["reference-image"]);

		rerender({ selectedRoute: unsupportedImageRoute });

		await waitFor(() => expect(result.current.selectedReferenceAssetIds).toEqual([]));
	});

	it("does not add references beyond the selected route limit", () => {
		const firstImage = mediaAsset({ id: "reference-a" });
		const secondImage = mediaAsset({ id: "reference-b" });
		const setError = vi.fn();
		const { result } = renderHook(() =>
			useGenerationReferences({
				extraReferenceAssetIds: [],
				extraReferenceUrls: [],
				mediaAssetProjectId: "project-a",
				mediaAssets: [firstImage, secondImage],
				mutateMediaAssets: vi.fn(),
				prompt: "生成图片",
				selectedRoute: { ...imageRoute, maxReferenceUrls: 1 },
				setError,
			}),
		);

		act(() => {
			result.current.selectReferenceAsset(firstImage);
			result.current.selectReferenceAsset(secondImage);
		});

		expect(result.current.selectedReferenceAssetIds).toEqual(["reference-a"]);
		expect(setError).toHaveBeenCalledWith("当前模型最多支持 1 个参考素材。");
	});

	it("counts extra reference URLs against the selected route limit", () => {
		const referenceImage = mediaAsset({ id: "reference-a" });
		const setError = vi.fn();
		const { result } = renderHook(() =>
			useGenerationReferences({
				extraReferenceAssetIds: [],
				extraReferenceUrls: ["https://example.test/reference.png"],
				mediaAssetProjectId: "project-a",
				mediaAssets: [referenceImage],
				mutateMediaAssets: vi.fn(),
				prompt: "生成图片",
				selectedRoute: { ...imageRoute, maxReferenceUrls: 1 },
				setError,
			}),
		);

		act(() => {
			result.current.selectReferenceAsset(referenceImage);
		});

		expect(result.current.referenceCount).toBe(1);
		expect(result.current.selectedReferenceAssetIds).toEqual([]);
		expect(setError).toHaveBeenCalledWith("当前模型最多支持 1 个参考素材。");
	});
});
