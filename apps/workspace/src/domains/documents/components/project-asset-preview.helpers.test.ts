import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTextAsset, projectAssetContentURL } from "./project-asset-preview.helpers";

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
