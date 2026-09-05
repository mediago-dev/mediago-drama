import { describe, expect, it } from "vitest";
import type { ProjectShotRecord } from "@/domains/projects/api/projects";
import { buildCreatorWorkspaceView } from "./creator-workspace-adapter";

const shot = (id: string, sequence: number): ProjectShotRecord => ({
	id,
	sequence,
	shotCode: `S${sequence.toString().padStart(2, "0")}`,
	title: id,
	status: "NOT_STARTED",
	completion: 0,
	updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("buildCreatorWorkspaceView", () => {
	it("sorts shots and derives related production data without copying state", () => {
		const second = shot("shot-2", 2);
		const first = { ...shot("shot-1", 1), assetIds: ["asset-1"] };
		const result = buildCreatorWorkspaceView({
			shots: [second, first],
			activeShotId: "shot-2",
			assets: [
				{
					id: "asset-1",
					assetIndex: 0,
					kind: "image",
					resourceType: "character",
					url: "https://example.com/character.png",
				},
			],
			graph: {
				nodes: [
					{
						id: "frame-1",
						type: "frame",
						title: "首帧",
						shotId: "shot-1",
						path: "https://example.com/frame.png",
						createdAt: "2026-01-01T00:00:00.000Z",
					},
				],
				edges: [],
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		});

		expect(result.shots.map((item) => item.shot.id)).toEqual(["shot-1", "shot-2"]);
		expect(result.activeShot?.shot).toBe(second);
		expect(result.shots[0]?.assets).toHaveLength(1);
		expect(result.shots[0]?.media.map((item) => item.source)).toEqual([
			"https://example.com/frame.png",
			"https://example.com/character.png",
		]);
	});
});
