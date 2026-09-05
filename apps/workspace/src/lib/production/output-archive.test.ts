import { describe, expect, it } from "vitest";
import type { ProjectOutputArchiveRecord } from "@/domains/projects/api/projects";
import {
	buildOutputFilename,
	ensureUniqueOutputFilename,
	mergeOutputArchives,
	outputArchiveKey,
} from "./output-archive";

const record = (
	overrides: Partial<ProjectOutputArchiveRecord> = {},
): ProjectOutputArchiveRecord => ({
	id: "archive-1",
	taskId: "task-1",
	assetId: "asset-1",
	shotId: "P01",
	version: "V01",
	outputDirectory: "/tmp/output",
	outputPath: "/tmp/output/hero.png",
	filename: "hero.png",
	kind: "image",
	createdAt: "2026-08-21T00:00:00Z",
	...overrides,
});

describe("output archive index", () => {
	it("uses task, asset and directory as a stable dedupe key", () => {
		expect(outputArchiveKey(record())).toBe("task-1:asset-1:/tmp/output");
		expect(outputArchiveKey(record({ outputDirectory: "/tmp/other" }))).not.toBe(
			outputArchiveKey(record()),
		);
	});

	it("does not duplicate the same result but keeps different directories", () => {
		const merged = mergeOutputArchives(
			[record()],
			[record({ id: "duplicate" }), record({ id: "other-dir", outputDirectory: "/tmp/other" })],
		);
		expect(merged).toHaveLength(2);
		expect(merged[1]?.outputDirectory).toBe("/tmp/other");
	});

	it("always produces a safe filename with an extension", () => {
		expect(
			buildOutputFilename({
				requestedName: "P01:首帧?V02",
				sourceName: "source.jpg",
				fallbackBase: "task-1-1",
				fallbackExtension: "png",
			}),
		).toBe("P01_首帧_V02.png");
	});

	it("keeps shot, asset and version semantics in exported filenames", () => {
		expect(
			buildOutputFilename({
				fallbackBase: "首帧",
				fallbackExtension: "png",
				shotId: "P01",
				assetLabel: "角色立绘",
				version: "V02",
			}),
		).toBe("P01_角色立绘_V02_首帧.png");
	});

	it("never reuses a filename already present in the output directory", () => {
		expect(ensureUniqueOutputFilename("P01_首帧_V01.png", ["P01_首帧_V01.png"])).toBe(
			"P01_首帧_V01_R02.png",
		);
	});
});
