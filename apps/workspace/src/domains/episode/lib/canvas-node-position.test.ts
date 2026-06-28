import { describe, expect, it } from "vitest";
import {
	applyCanvasNodePositionChanges,
	applyCanvasNodePositionOverrides,
	type EpisodeCanvasNodePositionOverrides,
} from "./canvas-node-position";

describe("canvas-node-position", () => {
	it("copies valid drag positions into overrides", () => {
		const sourcePosition = { x: 120, y: 48 };
		const result = applyCanvasNodePositionChanges({}, [
			{ id: "node-1", position: sourcePosition, type: "position" },
		]);

		sourcePosition.x = 999;

		expect(result).toEqual({ "node-1": { x: 120, y: 48 } });
	});

	it("ignores non-position and invalid position changes", () => {
		const current: EpisodeCanvasNodePositionOverrides = { existing: { x: 1, y: 2 } };
		const result = applyCanvasNodePositionChanges(current, [
			{ id: "node-1", position: { x: Number.NaN, y: 10 }, type: "position" },
			{ id: "node-2", position: { x: 10, y: Number.POSITIVE_INFINITY }, type: "position" },
			{ id: "node-3", type: "select" },
		]);

		expect(result).toBe(current);
	});

	it("returns the same overrides object when the position did not change", () => {
		const current: EpisodeCanvasNodePositionOverrides = { "node-1": { x: 10, y: 20 } };
		const result = applyCanvasNodePositionChanges(current, [
			{ id: "node-1", position: { x: 10, y: 20 }, type: "position" },
		]);

		expect(result).toBe(current);
	});

	it("applies overrides without mutating the source node", () => {
		const nodes = [{ id: "node-1", position: { x: 0, y: 0 }, title: "Node" }];
		const result = applyCanvasNodePositionOverrides(nodes, { "node-1": { x: 8, y: 16 } });

		expect(result).toEqual([{ id: "node-1", position: { x: 8, y: 16 }, title: "Node" }]);
		expect(nodes).toEqual([{ id: "node-1", position: { x: 0, y: 0 }, title: "Node" }]);
	});

	it("returns the same node array when overrides do not change positions", () => {
		const nodes = [{ id: "node-1", position: { x: 8, y: 16 }, title: "Node" }];

		expect(applyCanvasNodePositionOverrides(nodes, {})).toBe(nodes);
		expect(applyCanvasNodePositionOverrides(nodes, { "node-1": { x: 8, y: 16 } })).toBe(nodes);
	});
});
