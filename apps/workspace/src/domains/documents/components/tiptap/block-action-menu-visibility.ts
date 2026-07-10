import type { BlockRange } from "./types";

export const supportsBlockMediaActions = (range: BlockRange): boolean =>
	range.nodeType === "heading" && range.headingLevel === 2;
