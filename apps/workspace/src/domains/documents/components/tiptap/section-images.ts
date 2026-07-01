const sectionImagePlaceholderAltPrefix = "mediago-drama-section-image-pending:";
const legacySectionImagePlaceholderAltPrefix = "media-cli-section-image-pending:";
const sectionImagePlaceholderAltPrefixes = [
	sectionImagePlaceholderAltPrefix,
	legacySectionImagePlaceholderAltPrefix,
];

// Detects the animated SVG placeholder images that older documents may still embed, so the
// editor can skip them when collecting real images. Nothing writes these placeholders (or any
// section image) into document content anymore; this is kept only to tolerate legacy content.
export const isSectionImagePlaceholderElement = (image: HTMLImageElement) =>
	isSectionImagePlaceholderAlt(image.alt) ||
	Boolean(sectionImagePlaceholderIdFromSource(image.currentSrc || image.src || ""));

const isSectionImagePlaceholderAlt = (alt: string) =>
	sectionImagePlaceholderAltPrefixes.some((prefix) => alt.startsWith(prefix));

const sectionImagePlaceholderIdFromSource = (source: string) => {
	if (!source.startsWith("data:image/svg+xml;base64,")) return null;

	const svg = base64DecodeUtf8(source.slice("data:image/svg+xml;base64,".length));
	const match = new RegExp(
		`<metadata>(?:${sectionImagePlaceholderAltPrefixes.map(escapeRegExp).join("|")})[^:<]+:([^<]+)</metadata>`,
	).exec(svg);
	return match?.[1] ?? null;
};

const base64DecodeUtf8 = (value: string) => {
	try {
		const binary = atob(value);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}

		return new TextDecoder().decode(bytes);
	} catch {
		return "";
	}
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
