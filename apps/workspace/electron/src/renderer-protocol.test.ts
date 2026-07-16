import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rendererContentSecurityPolicy, resolveRendererAssetPath } from "./renderer-protocol.js";

const rendererRoot = resolve("/opt/mediago/app/renderer");

describe("desktop renderer protocol", () => {
	it.each([
		["app://localhost/", "index.html"],
		["app://localhost/index.html?version=1.0.0#/", "index.html"],
		["app://localhost/assets/index.js", "assets/index.js"],
	])("maps a packaged renderer URL to its local asset", (url, relativePath) => {
		expect(resolveRendererAssetPath(url, rendererRoot)).toBe(resolve(rendererRoot, relativePath));
	});

	it.each([
		"https://localhost/index.html",
		"app://remote/index.html",
		"app://localhost:443/index.html",
		"app://user:password@localhost/index.html",
		"app://localhost/../../etc/passwd",
		"app://localhost/%2e%2e/%2e%2e/etc/passwd",
		"app://localhost/%2Fetc/passwd",
		"app://localhost/%5c..%5csecret",
		"app://localhost/%00secret",
		"app://localhost/%E0%A4%A",
		"not a URL",
		"",
	])("rejects an unsafe renderer URL %s", (url) => {
		expect(resolveRendererAssetPath(url, rendererRoot)).toBeNull();
	});

	it("does not allow inline, eval, or arbitrary remote scripts", () => {
		expect(rendererContentSecurityPolicy.split("; ")).toContain("script-src 'self'");
		expect(rendererContentSecurityPolicy).not.toContain("'unsafe-eval'");
	});
});
