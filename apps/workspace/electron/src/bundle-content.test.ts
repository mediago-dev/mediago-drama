import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashRendererTree } from "./bundle-content.js";

const tempDirs: string[] = [];

const makeTree = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "mediago-bundle-content-"));
	tempDirs.push(dir);
	mkdirSync(dir, { recursive: true });
	return dir;
};

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("renderer content hash framing", () => {
	it("distinguishes file boundaries even when content contains NUL bytes", () => {
		const oneFile = makeTree();
		writeFileSync(join(oneFile, "a"), Buffer.from("x\0b\0y"));

		const twoFiles = makeTree();
		writeFileSync(join(twoFiles, "a"), "x");
		writeFileSync(join(twoFiles, "b"), "y");

		expect(hashRendererTree(oneFile)).not.toBe(hashRendererTree(twoFiles));
	});
});
