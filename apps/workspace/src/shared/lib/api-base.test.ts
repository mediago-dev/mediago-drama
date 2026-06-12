import { afterEach, describe, expect, it, vi } from "vitest";
import { apiBaseURL, apiOrigin, apiResourceURL, apiURL } from "./api-base";

const clearTauriRuntime = () => {
	delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
};

const enableTauriRuntime = () => {
	Object.defineProperty(window, "__TAURI_INTERNALS__", {
		value: {},
		configurable: true,
	});
};

describe("api-base", () => {
	afterEach(() => {
		clearTauriRuntime();
		vi.unstubAllEnvs();
	});

	it("keeps relative API URLs outside Tauri", () => {
		clearTauriRuntime();

		expect(apiOrigin()).toBe("");
		expect(apiBaseURL()).toBe("/api/v1");
		expect(apiURL("/projects")).toBe("/api/v1/projects");
		expect(apiURL("/api/v1/agent/events")).toBe("/api/v1/agent/events");
		expect(apiResourceURL("/api/media/assets/image-1/content")).toBe(
			"/api/v1/media-assets/image-1/content",
		);
		expect(apiResourceURL("/api/v1/media-assets/image-1/content")).toBe(
			"/api/v1/media-assets/image-1/content",
		);
		expect(apiResourceURL("/api/v1/media/assets/image-1/content")).toBe(
			"/api/v1/media-assets/image-1/content",
		);
		expect(apiResourceURL("/api/projects/project-1/assets/asset-1/content")).toBe(
			"/api/v1/projects/project-1/assets/asset-1/content",
		);
	});

	it("uses the dev server origin inside Tauri dev", () => {
		enableTauriRuntime();

		expect(apiOrigin()).toBe("http://127.0.0.1:8080");
		expect(apiBaseURL()).toBe("http://127.0.0.1:8080/api/v1");
		expect(apiURL("/projects")).toBe("http://127.0.0.1:8080/api/v1/projects");
		expect(apiURL("/api/v1/agent/events")).toBe("http://127.0.0.1:8080/api/v1/agent/events");
	});

	it("uses the packaged server origin inside Tauri production", () => {
		vi.stubEnv("DEV", false);
		enableTauriRuntime();

		expect(apiOrigin()).toBe("http://127.0.0.1:48273");
		expect(apiBaseURL()).toBe("http://127.0.0.1:48273/api/v1");
		expect(apiResourceURL("/api/media/assets/image-1/content")).toBe(
			"http://127.0.0.1:48273/api/v1/media-assets/image-1/content",
		);
		expect(apiResourceURL("/api/v1/media-assets/image-1/content")).toBe(
			"http://127.0.0.1:48273/api/v1/media-assets/image-1/content",
		);
		expect(apiResourceURL("https://example.test/image.png")).toBe("https://example.test/image.png");
		expect(apiResourceURL("data:image/png;base64,YWJj")).toBe("data:image/png;base64,YWJj");
	});

	it("uses the configured local server port inside Tauri", () => {
		vi.stubEnv("VITE_MEDIAGO_SERVER_PORT", "49152");
		enableTauriRuntime();

		expect(apiOrigin()).toBe("http://127.0.0.1:49152");
		expect(apiBaseURL()).toBe("http://127.0.0.1:49152/api/v1");
	});
});
