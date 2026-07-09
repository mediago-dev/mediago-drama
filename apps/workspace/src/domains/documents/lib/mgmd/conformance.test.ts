import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { createMarkdownParsingExtensions } from "@/domains/documents/components/MarkdownHybridEditor";
import { DocumentMention } from "@/domains/documents/components/extensions/document-mention";

/**
 * mgmd conformance runner (frontend). Reads the shared corpus in
 * docs/mgmd-conformance/fixtures/ and asserts the properties documented there,
 * using the exact production markdown-parsing extension set.
 */

const findFixturesDir = (): string => {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let depth = 0; depth < 12; depth += 1) {
		const candidate = join(dir, "docs", "mgmd-conformance", "fixtures");
		if (existsSync(candidate)) return candidate;
		dir = resolve(dir, "..");
	}
	throw new Error("mgmd conformance fixtures not found (docs/mgmd-conformance/fixtures)");
};

const roundtrip = (markdown: string): string => {
	const editor = new Editor({
		extensions: createMarkdownParsingExtensions([DocumentMention]),
		content: markdown,
		contentType: "markdown",
	});
	const output = editor.getMarkdown();
	editor.destroy();
	return output;
};

const count = (markdown: string, pattern: RegExp): number => (markdown.match(pattern) ?? []).length;

const fixturesDir = findFixturesDir();
const fixtures = readdirSync(fixturesDir)
	.filter((name) => name.endsWith(".md"))
	.sort();

const readFixture = (name: string) => readFileSync(join(fixturesDir, name), "utf8");

describe("mgmd conformance corpus", () => {
	it("discovers fixtures", () => {
		expect(fixtures.length).toBeGreaterThan(0);
	});

	// Property 1: re-serializing an already-serialized document must not change it.
	// This is what guarantees "re-saving does not churn the file".
	it.each(fixtures)("round-trip is stable (idempotent): %s", (name) => {
		const once = roundtrip(readFixture(name));
		const twice = roundtrip(once);
		expect(twice).toBe(once);
	});

	// Property 2: mgmd constructs must survive a round-trip (no silent drops).
	it.each(fixtures)("preserves mgmd constructs: %s", (name) => {
		const input = readFixture(name);
		const output = roundtrip(input);

		expect(count(output, /<!--\s*section-id:/g)).toBe(count(input, /<!--\s*section-id:/g));
		expect(count(output, /mention:\/\//g)).toBe(count(input, /mention:\/\//g));
		expect(count(output, /asset:\/\//g)).toBe(count(input, /asset:\/\//g));
		expect(count(output, /章节音频：|章节视频：/g)).toBe(count(input, /章节音频：|章节视频：/g));
	});

	// Property 3: GFM structure (tables, lists) survives — a dropped table would be
	// "stable but lost", so idempotency alone does not cover this.
	it.each(fixtures)("preserves table & list structure: %s", (name) => {
		const input = readFixture(name);
		const output = roundtrip(input);

		expect(count(output, /^\s*\|/gm)).toBe(count(input, /^\s*\|/gm)); // table rows
		expect(count(output, /^\s*\d+\.\s/gm)).toBe(count(input, /^\s*\d+\.\s/gm)); // ordered items
		expect(count(output, /^\s*-\s/gm)).toBe(count(input, /^\s*-\s/gm)); // bullet items
	});
});
