export const compactGenerationLabel = (label: string) => label.replace(/\s+/g, " ").trim();

export const displayGenerationLabelWithoutAlias = (label: string) => {
	const compacted = compactGenerationLabel(label);
	const separator = " / ";
	const separatorIndex = compacted.indexOf(separator);
	if (separatorIndex < 0) return compacted;

	return compacted.slice(separatorIndex + separator.length).trim() || compacted;
};
