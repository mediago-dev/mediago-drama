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
): Node[] =>
	nodes.map((node) => {
		const override = overrides[node.id];
		return override ? { ...node, position: { ...override } } : node;
	});

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
