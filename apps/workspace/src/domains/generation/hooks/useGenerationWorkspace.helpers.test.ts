import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@/domains/workspace/api/media";
import type { GenerationParam, GenerationTask } from "@/domains/generation/api/generation";
import {
	filterMediaAssets,
	filterGenerationTasksForScope,
	formatBytes,
	generatedAssetsIncludeMediaAssets,
	generationAssetSelectionKey,
	generationAssetSource,
	generationParamsWithRequestDetails,
	generationRequestDetailsParamKey,
	generationStatusLabel,
	normalizeGenerationPreference,
	routeParamValues,
	uniqueStrings,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";

const mediaAsset = (overrides: Partial<MediaAsset>): MediaAsset => ({
	id: "asset-1",
	filename: "hero.png",
	kind: "image",
	mimeType: "image/png",
	sizeBytes: 1536,
	url: "file:///hero.png",
	createdAt: "2026-05-30T00:00:00.000Z",
	updatedAt: "2026-05-30T00:00:00.000Z",
	...overrides,
});

describe("generation workspace helpers", () => {
	afterEach(() => {
		delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
		vi.unstubAllEnvs();
	});

	it("builds asset source and selection keys from inline data", () => {
		const asset = {
			kind: "image" as const,
			base64: "YWJj",
			mimeType: "image/jpeg",
		};

		expect(generationAssetSource(asset)).toBe("data:image/jpeg;base64,YWJj");
		expect(generationAssetSelectionKey(asset)).toBe("image:data:image/jpeg;base64,YWJj");
	});

	it("builds selection keys for generated videos", () => {
		const asset = {
			kind: "video" as const,
			url: "https://example.test/scene.mp4",
			mimeType: "video/mp4",
		};

		expect(generationAssetSource(asset)).toBe("https://example.test/scene.mp4");
		expect(generationAssetSelectionKey(asset)).toBe("video:https://example.test/scene.mp4");
	});

	it("resolves local API asset URLs for packaged Tauri previews", () => {
		vi.stubEnv("DEV", false);
		Object.defineProperty(window, "__TAURI_INTERNALS__", {
			value: {},
			configurable: true,
		});

		const asset = {
			kind: "image" as const,
			url: "/api/media/assets/generated/content",
		};

		expect(generationAssetSource(asset)).toBe(
			"http://127.0.0.1:48273/api/v1/media-assets/generated/content",
		);
		expect(generationAssetSelectionKey(asset)).toBe(
			"image:http://127.0.0.1:48273/api/v1/media-assets/generated/content",
		);
	});

	it("keeps remote asset URLs unchanged", () => {
		expect(
			generationAssetSource({
				kind: "image",
				url: "https://example.test/generated.png",
			}),
		).toBe("https://example.test/generated.png");
	});

	it("detects generated assets cached into the media asset library", () => {
		expect(
			generatedAssetsIncludeMediaAssets([
				{
					kind: "image",
					url: "http://127.0.0.1:48273/api/v1/media-assets/generated/content",
				},
			]),
		).toBe(true);
		expect(
			generatedAssetsIncludeMediaAssets([
				{ kind: "image", url: "/api/media/assets/legacy-generated/content" },
			]),
		).toBe(true);
		expect(
			generatedAssetsIncludeMediaAssets([
				{ kind: "image", url: "https://example.test/generated.png" },
			]),
		).toBe(false);
	});

	it("filters media assets by kind and searchable metadata", () => {
		const assets = [
			mediaAsset({ id: "image-1", filename: "Hero Poster.png", kind: "image" }),
			mediaAsset({
				id: "video-1",
				filename: "scene.mov",
				kind: "video",
				mimeType: "video/quicktime",
				sourceUrl: "https://example.test/teaser",
			}),
		];

		expect(filterMediaAssets(assets, "image", "hero")).toHaveLength(1);
		expect(filterMediaAssets(assets, "all", "teaser").map((asset) => asset.id)).toEqual([
			"video-1",
		]);
	});

	it("filters generation tasks by project, document, and section fields", () => {
		const matchingTask = {
			id: "task-current",
			projectId: "project-a",
			documentId: "doc-a",
			sectionId: "section-a",
		};
		const otherDocumentTask = {
			id: "task-other-doc",
			projectId: "project-a",
			documentId: "doc-b",
			sectionId: "section-a",
		};
		const oldCompositeSectionTask = {
			id: "task-old-composite",
			projectId: "project-a",
			sectionId: "doc-a:section-a",
		};
		const tasks = [
			matchingTask,
			otherDocumentTask,
			oldCompositeSectionTask,
		] as unknown as GenerationTask[];

		expect(
			filterGenerationTasksForScope(tasks, {
				projectId: "project-a",
				documentId: "doc-a",
				sectionId: "section-a",
			}).map((task) => task.id),
		).toEqual(["task-current"]);
	});

	it("formats status labels and byte sizes for display", () => {
		expect(generationStatusLabel("submitted")).toBe("已提交");
		expect(formatBytes(1536)).toBe("1.5 KB");
	});

	it("normalizes stored generation preferences", () => {
		expect(
			normalizeGenerationPreference({
				scopeId: "project:1",
				familyIds: { image: "gpt-image", video: "", text: "text", bad: "ignored" } as never,
				routeIds: { "": "missing", route: "seedream" },
				versionIds: { version: "v1" },
				routeParams: { route: { size: "1024x1024" }, empty: null as never },
				stylePresetId: 123 as never,
			}),
		).toMatchObject({
			scopeId: "project:1",
			familyIds: { image: "gpt-image", text: "text" },
			routeIds: { route: "seedream" },
			versionIds: { version: "v1" },
			routeParams: { route: { size: "1024x1024" } },
			stylePresetId: "",
		});
	});

	it("deduplicates request inputs and preserves valid request details", () => {
		expect(uniqueStrings(["a", "", "b", "a"])).toEqual(["a", "b"]);
		expect(
			generationParamsWithRequestDetails({ size: "1024x1024" }, [
				{ label: "来源", value: "参考图" },
				{ label: "", value: "ignored" },
			]),
		).toEqual({
			size: "1024x1024",
			[generationRequestDetailsParamKey]: [{ label: "来源", value: "参考图" }],
		});
	});

	it("normalizes selected route params against current param specs", () => {
		const params: GenerationParam[] = [
			{
				name: "duration",
				label: "时长",
				type: "select",
				default: "5",
				options: [
					{ label: "自动", value: "-1" },
					{ label: "4 秒", value: "4" },
					{ label: "5 秒", value: "5" },
					{ label: "10 秒", value: "10" },
				],
			},
			{ name: "seed", label: "种子", type: "number", min: -1, max: 100 },
			{ name: "generateAudio", label: "生成音频", type: "boolean", default: true },
		];

		expect(
			routeParamValues(params, {
				duration: 2,
				seed: "42",
				generateAudio: "false",
			}),
		).toEqual({
			duration: "5",
			seed: 42,
			generateAudio: false,
		});
		expect(routeParamValues(params, { duration: 10 })).toMatchObject({
			duration: "10",
		});
	});
});
