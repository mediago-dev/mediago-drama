import { describe, expect, it } from "vitest";
import { reconcileEpisodeCanvasFlowNodes } from "./EpisodeCanvasView";

type FlowNode = Parameters<typeof reconcileEpisodeCanvasFlowNodes>[0][number];

const makeNode = (
	data: Record<string, unknown>,
	position: { x: number; y: number } = { x: 0, y: 0 },
): FlowNode =>
	({
		id: "node-1",
		type: "performance",
		position,
		data,
	}) as unknown as FlowNode;

describe("reconcileEpisodeCanvasFlowNodes", () => {
	it("keeps the current array when only handler identities changed (breaks the setNodes loop)", () => {
		const current = [makeNode({ clipId: "c1", isSelected: false, onGenerateClip: () => "old" })];
		// baseNodes 重建：可见字段不变，只有回调函数是新建的引用。
		const next = [makeNode({ clipId: "c1", isSelected: false, onGenerateClip: () => "new" })];

		expect(reconcileEpisodeCanvasFlowNodes(current, next)).toBe(current);
	});

	it("produces a new array when a visible field changed", () => {
		const current = [makeNode({ clipId: "c1", isSelected: false, onGenerateClip: () => {} })];
		const next = [makeNode({ clipId: "c1", isSelected: true, onGenerateClip: () => {} })];

		expect(reconcileEpisodeCanvasFlowNodes(current, next)).not.toBe(current);
	});

	it("produces a new array when a node position changed", () => {
		const current = [makeNode({ clipId: "c1" }, { x: 0, y: 0 })];
		const next = [makeNode({ clipId: "c1" }, { x: 24, y: 0 })];

		expect(reconcileEpisodeCanvasFlowNodes(current, next)).not.toBe(current);
	});
});
