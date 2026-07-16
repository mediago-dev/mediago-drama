import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isTrustedRendererURL, normalizeDevelopmentRendererURL } from "./ipc-security.js";

const developmentRendererRoot = resolve("/opt/mediago/renderer");

describe("desktop IPC security", () => {
	it.each([
		["http://127.0.0.1:31420", "http://127.0.0.1:31420/"],
		["https://localhost:31420/app", "https://localhost:31420/app"],
	])("allows a loopback development renderer", (value, expected) => {
		expect(normalizeDevelopmentRendererURL(value)).toBe(expected);
	});

	it.each([
		"https://example.com/app",
		"http://user:password@127.0.0.1:31420",
		"file:///tmp/index.html",
		"not a URL",
	])("rejects an unsafe development renderer %s", (value) => {
		expect(normalizeDevelopmentRendererURL(value)).toBeUndefined();
	});

	it("only trusts the packaged application origin", () => {
		const options = { developmentRendererRoot, packaged: true };
		expect(isTrustedRendererURL("app://localhost/index.html#/settings", options)).toBe(true);
		expect(isTrustedRendererURL("app://remote/index.html", options)).toBe(false);
		expect(isTrustedRendererURL("https://localhost/index.html", options)).toBe(false);
	});

	it("trusts only the configured development origin", () => {
		const options = {
			developmentRendererRoot,
			developmentRendererURL: "http://127.0.0.1:31420",
			packaged: false,
		};
		expect(isTrustedRendererURL("http://127.0.0.1:31420/settings", options)).toBe(true);
		expect(isTrustedRendererURL("http://127.0.0.1:31421/settings", options)).toBe(false);
	});

	it("constrains the development file fallback to the renderer root", () => {
		const options = { developmentRendererRoot, packaged: false };
		expect(
			isTrustedRendererURL(
				pathToFileURL(resolve(developmentRendererRoot, "index.html")).toString(),
				options,
			),
		).toBe(true);
		expect(isTrustedRendererURL("file:///etc/passwd", options)).toBe(false);
	});
});
