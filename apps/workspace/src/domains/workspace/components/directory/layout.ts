export const directoryTreeRowIndentPx = 8;
export const directoryTreeDepthStepPx = 12;

export const directoryTreeRowIndent = (depth: number) =>
	`${depth * directoryTreeDepthStepPx + directoryTreeRowIndentPx}px`;
