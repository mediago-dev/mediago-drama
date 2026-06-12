import type {
	MarkdownSectionIdentity,
	MarkdownSectionImage,
	MarkdownSectionImagePlaceholder,
} from "@/domains/documents/lib/editor-registry";
import {
	findMarkdownSectionEndLine,
	findMarkdownSectionHeadingLine,
} from "@/domains/documents/lib/sections";

export const appendSectionImageMarkdown = (
	markdown: string,
	section: MarkdownSectionIdentity,
	image: MarkdownSectionImage,
) => {
	const lines = markdown.split("\n");
	const headingIndex = findSectionHeadingLine(lines, section);
	if (headingIndex < 0) return null;

	const sectionEnd = findSectionEndLine(lines, headingIndex, section.headingLevel);
	const sectionLines = lines.slice(headingIndex, sectionEnd);
	const imageMarkdown = sectionImageMarkdown(image);
	const imageAlreadyExists = sectionLines.some(
		(line) => sectionImageSourceFromLine(line.trim(), section.blockId) === image.src,
	);
	if (imageAlreadyExists) {
		return {
			markdown,
			changed: false,
		};
	}

	const nextSectionLines = appendSectionImageLine(sectionLines, imageMarkdown);

	return {
		markdown: [
			...lines.slice(0, headingIndex),
			...nextSectionLines,
			...lines.slice(sectionEnd),
		].join("\n"),
		changed: true,
	};
};

export const appendSectionImagePlaceholderMarkdown = (
	markdown: string,
	section: MarkdownSectionIdentity,
	placeholder: MarkdownSectionImagePlaceholder,
) => {
	const lines = markdown.split("\n");
	const headingIndex = findSectionHeadingLine(lines, section);
	if (headingIndex < 0) return null;

	const sectionEnd = findSectionEndLine(lines, headingIndex, section.headingLevel);
	const sectionLines = lines.slice(headingIndex, sectionEnd);
	const placeholderMarkdown = sectionImagePlaceholderMarkdown(section.blockId, placeholder);
	const placeholderAlreadyExists = sectionLines.some(
		(line) => sectionImagePlaceholderIdFromLine(line.trim(), section.blockId) === placeholder.id,
	);
	if (placeholderAlreadyExists) {
		return {
			markdown,
			changed: false,
		};
	}

	const nextSectionLines = appendSectionImageLine(sectionLines, placeholderMarkdown);

	return {
		markdown: [
			...lines.slice(0, headingIndex),
			...nextSectionLines,
			...lines.slice(sectionEnd),
		].join("\n"),
		changed: true,
	};
};

export const removeSectionImageMarkdown = (
	markdown: string,
	section: MarkdownSectionIdentity,
	image: MarkdownSectionImage,
) => {
	const lines = markdown.split("\n");
	const headingIndex = findSectionHeadingLine(lines, section);
	if (headingIndex < 0) return null;

	const sectionEnd = findSectionEndLine(lines, headingIndex, section.headingLevel);
	const sectionLines = lines.slice(headingIndex, sectionEnd);
	let changed = false;
	const nextSectionLines = trimTrailingBlankLines(
		sectionLines.filter((line) => {
			const source = sectionImageSourceFromLine(line.trim(), section.blockId);
			if (source !== image.src) return true;

			changed = true;
			return false;
		}),
	);
	if (!changed) return { markdown, changed: false };

	return {
		markdown: [
			...lines.slice(0, headingIndex),
			...nextSectionLines,
			...lines.slice(sectionEnd),
		].join("\n"),
		changed: true,
	};
};

export const replaceSectionImagePlaceholderMarkdown = (
	markdown: string,
	section: MarkdownSectionIdentity,
	placeholderId: string,
	image: MarkdownSectionImage,
) => {
	const lines = markdown.split("\n");
	const headingIndex = findSectionHeadingLine(lines, section);
	if (headingIndex < 0) return null;

	const sectionEnd = findSectionEndLine(lines, headingIndex, section.headingLevel);
	const sectionLines = lines.slice(headingIndex, sectionEnd);
	const imageMarkdown = sectionImageMarkdown(image);
	const imageAlreadyExists = sectionLines.some(
		(line) => sectionImageSourceFromLine(line.trim(), section.blockId) === image.src,
	);
	let changed = false;
	let replaced = false;
	const nextSectionLines = trimTrailingBlankLines(
		sectionLines.flatMap((line) => {
			const currentPlaceholderId = sectionImagePlaceholderIdFromLine(line.trim(), section.blockId);
			if (currentPlaceholderId !== placeholderId) return [line];

			changed = true;
			replaced = true;
			return imageAlreadyExists ? [] : [imageMarkdown];
		}),
	);

	if (!replaced) {
		return appendSectionImageMarkdown(markdown, section, image);
	}
	if (!changed) return { markdown, changed: false };

	return {
		markdown: [
			...lines.slice(0, headingIndex),
			...nextSectionLines,
			...lines.slice(sectionEnd),
		].join("\n"),
		changed: true,
	};
};

export const removeSectionImagePlaceholderMarkdown = (
	markdown: string,
	section: MarkdownSectionIdentity,
	placeholderId: string,
) => {
	const lines = markdown.split("\n");
	const headingIndex = findSectionHeadingLine(lines, section);
	if (headingIndex < 0) return null;

	const sectionEnd = findSectionEndLine(lines, headingIndex, section.headingLevel);
	const sectionLines = lines.slice(headingIndex, sectionEnd);
	let changed = false;
	const nextSectionLines = trimTrailingBlankLines(
		sectionLines.filter((line) => {
			const currentPlaceholderId = sectionImagePlaceholderIdFromLine(line.trim(), section.blockId);
			if (currentPlaceholderId !== placeholderId) return true;

			changed = true;
			return false;
		}),
	);
	if (!changed) return { markdown, changed: false };

	return {
		markdown: [
			...lines.slice(0, headingIndex),
			...nextSectionLines,
			...lines.slice(sectionEnd),
		].join("\n"),
		changed: true,
	};
};

export const isSectionImagePlaceholderElement = (image: HTMLImageElement) =>
	isSectionImagePlaceholderAlt(image.alt) ||
	Boolean(sectionImagePlaceholderIdFromSource(image.currentSrc || image.src || ""));

const findSectionHeadingLine = (lines: string[], section: MarkdownSectionIdentity) => {
	return findMarkdownSectionHeadingLine(lines, section);
};

const findSectionEndLine = (lines: string[], headingIndex: number, headingLevel: number) => {
	return findMarkdownSectionEndLine(lines, headingIndex, headingLevel);
};

const markdownImageLinePattern = /^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)$/;

const sectionImageMarkdown = (image: MarkdownSectionImage) =>
	`![${escapeMarkdownAlt(image.title?.trim() || "章节图片")}](<${image.src}>)`;

const sectionImagePlaceholderAltPrefix = "mediago-drama-section-image-pending:";
const legacySectionImagePlaceholderAltPrefix = "media-cli-section-image-pending:";
const sectionImagePlaceholderAltPrefixes = [
	sectionImagePlaceholderAltPrefix,
	legacySectionImagePlaceholderAltPrefix,
];

const sectionImagePlaceholderLinePattern = (blockId: string) =>
	new RegExp(
		`^!\\[(?:${sectionImagePlaceholderAltPrefixes.map(escapeRegExp).join("|")})${escapeRegExp(
			blockId,
		)}:([^\\]]+)\\]\\(<?.+>?\\)$`,
	);

const sectionImagePlaceholderMarkdown = (
	blockId: string,
	placeholder: MarkdownSectionImagePlaceholder,
) => `![正在生成图片](<${sectionImagePlaceholderSource(blockId, placeholder)}>)`;

const sectionImageSourceFromLine = (line: string, _blockId: string) => {
	const image = markdownImageFromLine(line);
	if (!image) return null;
	if (isSectionImagePlaceholderAlt(image.alt)) return null;
	if (sectionImagePlaceholderIdFromSource(image.source)) return null;

	return image.source;
};

const sectionImagePlaceholderIdFromLine = (line: string, blockId: string) => {
	const match = sectionImagePlaceholderLinePattern(blockId).exec(line);
	if (match?.[1]) return match[1];

	const image = markdownImageFromLine(line);
	return image ? sectionImagePlaceholderIdFromSource(image.source) : null;
};

const appendSectionImageLine = (sectionLines: string[], imageMarkdown: string) => {
	const cleanedSectionLines = trimTrailingBlankLines(sectionLines);
	const needsSeparator =
		cleanedSectionLines.length > 0 &&
		cleanedSectionLines[cleanedSectionLines.length - 1].trim() !== "";

	return [...cleanedSectionLines, ...(needsSeparator ? [""] : []), imageMarkdown];
};

const markdownImageFromLine = (line: string) => {
	const match = markdownImageLinePattern.exec(line);
	if (!match) return null;

	return {
		alt: match[1],
		source: match[2] ?? match[3] ?? "",
	};
};

const sectionImagePlaceholderSource = (
	blockId: string,
	placeholder: MarkdownSectionImagePlaceholder,
) => {
	const label = placeholder.title?.trim() || "生成中";
	const escapedLabel = escapeSvgText(label.length > 18 ? `${label.slice(0, 18)}...` : label);
	const colors = sectionImagePlaceholderColors();
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720"><metadata>${sectionImagePlaceholderAltPrefix}${escapeSvgText(blockId)}:${escapeSvgText(placeholder.id)}</metadata><style>@keyframes pulse{0%,100%{opacity:.42}50%{opacity:.92}}@keyframes sweep{0%{transform:translateX(-960px)}100%{transform:translateX(960px)}}.base{fill:${colors.base}}.line{fill:${colors.line}}.dot{fill:${colors.subtle};animation:pulse 1.2s ease-in-out infinite}.dot:nth-of-type(2){animation-delay:.15s}.dot:nth-of-type(3){animation-delay:.3s}.sweep{fill:${colors.sweep};opacity:.35;animation:sweep 1.6s ease-in-out infinite}.text{fill:${colors.text};font:600 34px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.sub{fill:${colors.subtle};font:400 24px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}</style><rect class="base" width="960" height="720" rx="24"/><rect class="sweep" x="0" y="0" width="320" height="720" transform="skewX(-14)"/><text class="text" x="480" y="300" text-anchor="middle">正在生成图片</text><g><circle class="dot" cx="438" cy="360" r="14"/><circle class="dot" cx="480" cy="360" r="14"/><circle class="dot" cx="522" cy="360" r="14"/></g><rect class="line" x="300" y="430" width="360" height="12" rx="6"/><text class="sub" x="480" y="492" text-anchor="middle">${escapedLabel}</text></svg>`;

	return `data:image/svg+xml;base64,${base64EncodeUtf8(svg)}`;
};

const sectionImagePlaceholderColors = () => ({
	base: readCssColorToken("--muted", "rgb(240 243 247)"),
	line: readCssColorToken("--border", "rgb(231 236 243)"),
	subtle: readCssColorToken("--muted-foreground", "rgb(109 121 143)"),
	sweep: readCssColorToken("--card", "rgb(255 255 255)"),
	text: readCssColorToken("--foreground", "rgb(11 21 38)"),
});

const readCssColorToken = (name: string, fallback: string) => {
	if (typeof window === "undefined") return fallback;

	const value = window
		.getComputedStyle(window.document.documentElement)
		.getPropertyValue(name)
		.trim();
	return value || fallback;
};

const sectionImagePlaceholderIdFromSource = (source: string) => {
	if (!source.startsWith("data:image/svg+xml;base64,")) return null;

	const svg = base64DecodeUtf8(source.slice("data:image/svg+xml;base64,".length));
	const match = new RegExp(
		`<metadata>(?:${sectionImagePlaceholderAltPrefixes.map(escapeRegExp).join("|")})[^:<]+:([^<]+)</metadata>`,
	).exec(svg);
	return match?.[1] ?? null;
};

const isSectionImagePlaceholderAlt = (alt: string) =>
	sectionImagePlaceholderAltPrefixes.some((prefix) => alt.startsWith(prefix));

const escapeSvgText = (value: string) =>
	value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const escapeMarkdownAlt = (value: string) => value.replace(/[[\]\\]/g, "\\$&");

const base64EncodeUtf8 = (value: string) => {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary);
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

const trimTrailingBlankLines = (lines: string[]) => {
	const nextLines = [...lines];
	while (nextLines.length > 0 && !nextLines[nextLines.length - 1].trim()) {
		nextLines.pop();
	}

	return nextLines;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
