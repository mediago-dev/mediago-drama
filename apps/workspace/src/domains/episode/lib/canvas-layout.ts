import type {
	EpisodeCanvasGraph,
	EpisodeCanvasNode,
	EpisodeCanvasNodeType,
} from "@/domains/episode/lib/canvas-graph";
import type { StoryboardShotSummary } from "@/domains/episode/lib/storyboard-shots";

export interface EpisodeCanvasLayoutMetrics {
	height: number;
	width: number;
}

export interface EpisodeCanvasLayoutResult extends EpisodeCanvasGraph {
	metrics: EpisodeCanvasLayoutMetrics;
}

const canvasNodeWidth = 288;
const columnGap = 220;
const referenceColumnX = 24;

const columnX: Record<EpisodeCanvasNodeType, number> = {
	"reference-prompt": referenceColumnX,
	"reference-image": referenceColumnX + (canvasNodeWidth + columnGap),
	performance: referenceColumnX + (canvasNodeWidth + columnGap) * 2,
	"video-prompt": referenceColumnX + (canvasNodeWidth + columnGap) * 2,
	"text-storyboard": referenceColumnX + (canvasNodeWidth + columnGap) * 3,
	"storyboard-image": referenceColumnX + (canvasNodeWidth + columnGap) * 4,
	"video-output": referenceColumnX + (canvasNodeWidth + columnGap) * 3,
};

const nodeHeight: Record<EpisodeCanvasNodeType, number> = {
	performance: 178,
	"reference-image": 244,
	"reference-prompt": 206,
	"storyboard-image": 174,
	"text-storyboard": 214,
	"video-prompt": 214,
	"video-output": 172,
};

const laneGap = 44;
const lanePaddingY = 22;
const minimumLaneHeight = 236;
const referenceGap = 18;
const graphWidth = columnX["video-output"] + canvasNodeWidth + 140;

export const layoutEpisodeCanvasGraph = (graph: EpisodeCanvasGraph): EpisodeCanvasLayoutResult => {
	const nodesByLane = new Map<string, EpisodeCanvasNode[]>();
	for (const node of graph.nodes) {
		const laneNodes = nodesByLane.get(node.data.laneId) ?? [];
		laneNodes.push(node);
		nodesByLane.set(node.data.laneId, laneNodes);
	}

	let cursorY = 24;
	const nodes = graph.nodes.map((node) => ({ ...node, position: { ...node.position } }));
	const nodeById = new Map(nodes.map((node) => [node.id, node]));

	for (const lane of graph.lanes) {
		const laneNodes = nodesByLane.get(lane.id) ?? [];
		const sourceRows = sourceNodeRows(laneNodes);
		const sourceStackHeight = stackedNodeRowHeight(sourceRows);
		const mainColumnHeight = Math.max(
			0,
			...laneNodes.filter((node) => !isSourceStackNode(node)).map(estimateCanvasNodeHeight),
		);
		const laneHeight = Math.max(
			minimumLaneHeight,
			lanePaddingY * 2 + Math.max(sourceStackHeight, mainColumnHeight),
		);
		const centerY = cursorY + laneHeight / 2;
		let sourceCursorY = cursorY + lanePaddingY;

		for (const row of sourceRows) {
			const rowHeight = Math.max(...row.map(estimateCanvasNodeHeight));

			for (const node of row) {
				const positioned = nodeById.get(node.id);
				if (!positioned) continue;

				positioned.position = {
					x: columnX[node.type],
					y: sourceCursorY + (rowHeight - estimateCanvasNodeHeight(node)) / 2,
				};
			}

			sourceCursorY += rowHeight + referenceGap;
		}

		for (const node of laneNodes) {
			const positioned = nodeById.get(node.id);
			if (!positioned) continue;

			if (isSourceStackNode(node)) continue;

			positioned.position = {
				x: columnX[node.type],
				y: centerY - estimateCanvasNodeHeight(node) / 2,
			};
		}

		cursorY += laneHeight + laneGap;
	}

	return {
		...graph,
		metrics: {
			height: Math.max(cursorY + 24 - laneGap, 360),
			width: graphWidth,
		},
		nodes,
	};
};

const sourceNodeRows = (nodes: EpisodeCanvasNode[]) => {
	const videoPromptRows = nodes
		.filter((node) => node.type === "video-prompt")
		.map((node) => [node]);

	return [...videoPromptRows, ...referenceNodeRows(nodes)];
};

const referenceNodeRows = (nodes: EpisodeCanvasNode[]) => {
	const rowsByKey = new Map<string, EpisodeCanvasNode[]>();

	for (const node of nodes) {
		if (node.type !== "reference-image" && node.type !== "reference-prompt") continue;

		const key = node.data.reference?.key ?? node.id;
		rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), node]);
	}

	return Array.from(rowsByKey.values()).map((row) =>
		row.sort((first, second) => columnX[first.type] - columnX[second.type]),
	);
};

const stackedNodeRowHeight = (rows: EpisodeCanvasNode[][]) => {
	if (rows.length === 0) return 0;

	return (
		rows.reduce((height, row) => height + Math.max(...row.map(estimateCanvasNodeHeight)), 0) +
		(rows.length - 1) * referenceGap
	);
};

const isSourceStackNode = (node: EpisodeCanvasNode) =>
	node.type === "reference-image" ||
	node.type === "reference-prompt" ||
	node.type === "video-prompt";

const estimateCanvasNodeHeight = (node: EpisodeCanvasNode) => {
	if (node.type === "reference-image" && node.data.imageUrl) {
		return 348;
	}
	if (node.type === "reference-prompt") return estimateReferencePromptNodeHeight(node);
	if (node.type === "video-prompt") return estimateVideoPromptNodeHeight(node);

	return nodeHeight[node.type];
};

const estimateReferencePromptNodeHeight = (node: EpisodeCanvasNode) => {
	const textLineCount = estimateWrappedTextLineCount(node.data.body);
	return Math.max(nodeHeight[node.type], 86 + textLineCount * 20);
};

const estimateVideoPromptNodeHeight = (node: EpisodeCanvasNode) => {
	const shots = node.data.shots ?? [];
	if (shots.length === 0) {
		const textLineCount = estimateWrappedTextLineCount(node.data.body);
		return Math.max(nodeHeight[node.type], 86 + textLineCount * 20);
	}

	const shotRowsHeight = shots.reduce(
		(height, shot) => height + estimateVideoPromptShotHeight(shot),
		0,
	);
	return Math.max(nodeHeight[node.type], 72 + shotRowsHeight + (shots.length - 1) * 8);
};

const estimateVideoPromptShotHeight = (shot: StoryboardShotSummary) => {
	const textLineCount = estimateWrappedTextLineCount(videoPromptShotText(shot), 24);
	return 34 + textLineCount * 16;
};

const videoPromptShotText = (shot: StoryboardShotSummary) =>
	shot.prompt ||
	[shot.shotSize, shot.perspective, shot.cameraMove, shot.text].filter(Boolean).join(" / ");

const estimateWrappedTextLineCount = (text: string | undefined, charsPerLine = 18) => {
	const lines = (text || "暂无提示词").split("\n");
	return lines.reduce((count, line) => {
		const visibleLength = Math.max(line.trim().length, 1);
		return count + Math.ceil(visibleLength / charsPerLine);
	}, 0);
};
