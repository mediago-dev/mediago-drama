import { describe, expect, it } from "vitest";
import { normalizeExternalURL } from "./navigation-security.js";

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
});
