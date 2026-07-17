import { describe, expect, it } from "vitest";
import { normalizeExternalURL, resolveRendererNavigation } from "./navigation-security.js";

describe("desktop external navigation", () => {
	it.each([
		["https://mediago.example/prompt-packs/demo", "https://mediago.example/prompt-packs/demo"],
		["http://127.0.0.1:4321/prompt-packs/demo", "http://127.0.0.1:4321/prompt-packs/demo"],
	])("allows browser URLs", (input, expected) => {
		expect(normalizeExternalURL(input)).toBe(expected);
	});

	it.each([
		"javascript:alert(1)",
		"file:///etc/passwd",
		"data:text/html,hello",
		"mediago://unexpected",
		"http://example.com/insecure",
		"https://user:password@example.com/secret",
		"not a URL",
		"",
	])("rejects unsafe external URL %s", (input) => {
		expect(normalizeExternalURL(input)).toBeNull();
	});

	it.each([
		["http://127.0.0.1:31420/", false],
		["http://127.0.0.1:31420/projects/demo", false],
		["http://localhost:31420/projects/demo", true],
		["http://127.0.0.1:8080/projects/demo", true],
		["https://mediago.example/projects/demo", true],
	])("classifies development navigation %s", (url, opensExternally) => {
		expect(
			resolveRendererNavigation(url, {
				developmentRendererRoot: "/opt/mediago/renderer",
				developmentRendererURL: "http://127.0.0.1:31420",
				packaged: false,
			}),
		).toEqual(
			opensExternally
				? { action: "open-external", url: new URL(url).toString() }
				: { action: "allow" },
		);
	});

	it("allows packaged app routes without sending them to the browser", () => {
		expect(
			resolveRendererNavigation("app://localhost/index.html#/settings", {
				developmentRendererRoot: "/opt/mediago/renderer",
				packaged: true,
			}),
		).toEqual({ action: "allow" });
	});

	it("denies unsupported renderer navigation", () => {
		expect(
			resolveRendererNavigation("file:///etc/passwd", {
				developmentRendererRoot: "/opt/mediago/renderer",
				developmentRendererURL: "http://127.0.0.1:31420",
				packaged: false,
			}),
		).toEqual({ action: "deny" });
	});
});
