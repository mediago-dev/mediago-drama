export interface EpisodeCanvasNodePosition {
	x: number;
	y: number;
}

export type EpisodeCanvasNodePositionOverrides = Record<string, EpisodeCanvasNodePosition>;

interface CanvasNodePositionChange {
	id?: string;
	position?: EpisodeCanvasNodePosition | null;
	type: string;
}

export const applyCanvasNodePositionChanges = (
	current: EpisodeCanvasNodePositionOverrides,
	changes: CanvasNodePositionChange[],
): EpisodeCanvasNodePositionOverrides => {
	let next = current;

	for (const change of changes) {
		if (change.type !== "position" || !change.id) continue;

		const position = sanitizeCanvasNodePosition(change.position);
		if (!position) continue;

		const previous = current[change.id];
		if (previous?.x === position.x && previous.y === position.y) continue;

		if (next === current) next = { ...current };
		next[change.id] = position;
	}

	return next;
};

export const applyCanvasNodePositionOverrides = <
	Node extends { id: string; position: EpisodeCanvasNodePosition },
>(
	nodes: Node[],
	overrides: EpisodeCanvasNodePositionOverrides,
): Node[] => {
	let nextNodes: Node[] | null = null;

	for (const [index, node] of nodes.entries()) {
		const override = overrides[node.id];
		if (!override || (override.x === node.position.x && override.y === node.position.y)) {
			if (nextNodes) nextNodes.push(node);
			continue;
		}

		if (!nextNodes) nextNodes = nodes.slice(0, index);
		nextNodes.push({ ...node, position: { ...override } });
	}

	return nextNodes ?? nodes;
};

const sanitizeCanvasNodePosition = (
	position?: EpisodeCanvasNodePosition | null,
): EpisodeCanvasNodePosition | null => {
	if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
		return null;
	}

	return {
		x: position.x,
		y: position.y,
	};
};
