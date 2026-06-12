export interface HoveredBlockRect {
	height: number;
	isHeading: boolean;
	range: BlockRange | null;
	top: number;
}

export interface BlockRange {
	from: number;
	headingLevel?: number;
	index: number;
	nodeType: string;
	text: string;
	to: number;
}

export interface StreamingBlockTarget {
	anchorText: string;
	baseMarkdown: string;
	blockIndex: number;
}

export interface BlockHandleStorage {
	hoveredRange: BlockRange | null;
}
