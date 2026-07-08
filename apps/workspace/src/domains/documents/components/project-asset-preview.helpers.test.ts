import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fetchTextAsset,
	projectAssetContentURL,
	textPreviewMaxChars,
	truncateTextPreview,
} from "./project-asset-preview.helpers";

const truncationMarker = "\n\n...";

const clearDesktopRuntime = () => {
	delete window.mediagoDesktop;
};

const enableDesktopRuntime = () => {
	window.mediagoDesktop = { isElectron: true } as typeof window.mediagoDesktop;
};

describe("project asset preview helpers", () => {
	afterEach(() => {
		clearDesktopRuntime();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("resolves missing project asset URLs through the packaged server origin", () => {
		vi.stubEnv("DEV", false);
		enableDesktopRuntime();

		expect(
			projectAssetContentURL({
				id: "asset-1",
				projectId: "project-1",
				url: "",
			}),
		).toBe("http://127.0.0.1:48273/api/v1/projects/project-1/assets/asset-1/content");
	});

	it("normalizes project asset API URLs before text fetches in packaged builds", () => {
		vi.stubEnv("DEV", false);
		enableDesktopRuntime();

		expect(
			projectAssetContentURL({
				id: "asset-1",
				projectId: "project-1",
				url: "/api/v1/projects/project-1/assets/asset-1/content",
			}),
		).toBe("http://127.0.0.1:48273/api/v1/projects/project-1/assets/asset-1/content");
	});

	it("keeps text previews at or below the cap untouched", () => {
		const text = "短文本";
		expect(truncateTextPreview(text)).toBe(text);
	});

	it("truncates oversized text previews with a marker", () => {
		const preview = truncateTextPreview("a".repeat(textPreviewMaxChars + 1));
		expect(preview).toHaveLength(textPreviewMaxChars + truncationMarker.length);
		expect(preview.endsWith(truncationMarker)).toBe(true);
	});

	it("requests only the preview byte range and returns truncated text", async () => {
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response("a".repeat(textPreviewMaxChars + 1), {
					headers: { "Content-Type": "text/plain" },
				}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const text = await fetchTextAsset("/api/v1/projects/project-1/assets/asset-1/content");

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { Range: "bytes=0-524287" } });
		expect(text).toHaveLength(textPreviewMaxChars + truncationMarker.length);
		expect(text.endsWith(truncationMarker)).toBe(true);
	});

	it("retries without a byte range when the server rejects it", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
			init?.headers
				? new Response(null, { status: 416 })
				: new Response("", { headers: { "Content-Type": "text/plain" } }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(fetchTextAsset("/api/v1/projects/project-1/assets/asset-1/content")).resolves.toBe(
			"",
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][1]).toBeUndefined();
	});

	it("rejects frontend HTML fallback responses for text assets", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response("<!doctype html><html></html>", {
						headers: { "Content-Type": "text/html" },
					}),
			),
		);

		await expect(
			fetchTextAsset("/api/v1/projects/project-1/assets/asset-1/content"),
		).rejects.toThrow("素材接口返回了前端页面");
	});
});
