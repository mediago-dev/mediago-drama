export const compactGenerationLabel = (label: string) => label.replace(/\s+/g, " ").trim();

export const displayGenerationLabelWithoutAlias = (label: string) => {
	const compacted = compactGenerationLabel(label);
	const separator = " / ";
	const separatorIndex = compacted.indexOf(separator);
	if (separatorIndex < 0) return compacted;

	return compacted.slice(separatorIndex + separator.length).trim() || compacted;
};

/**
 * Version labels are authored as "产品名 / 底层模型名" in the catalog.
 * The product name is the user-facing model choice; the technical model is
 * kept in the route/request data and should not replace it in the UI.
 */
export const displayGenerationVersionLabel = (label: string) => {
	const compacted = compactGenerationLabel(label);
	const separator = " / ";
	const separatorIndex = compacted.indexOf(separator);
	if (separatorIndex < 0) return compacted;

	return compacted.slice(0, separatorIndex).trim() || compacted;
};

/** The model maker/supplier is metadata, not the execution route. */
export const displayGenerationSupplierLabel = (input: {
	canonicalModel?: string;
	label?: string;
}) => {
	const source = `${input.canonicalModel ?? ""} ${input.label ?? ""}`.toLowerCase();
	if (source.includes("gemini") || source.includes("nano-banana")) return "Gemini";
	if (source.includes("gpt")) return "OpenAI";
	if (source.includes("seedance") || source.includes("seedream")) return "字节跳动";
	return "";
};
