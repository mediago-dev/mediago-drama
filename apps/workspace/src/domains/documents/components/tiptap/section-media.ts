import type {
	MarkdownSectionIdentity,
	MarkdownSectionMedia,
	MarkdownSectionMediaKind,
} from "@/domains/documents/lib/editor-registry";
import {
	findMarkdownSectionEndLine,
	findMarkdownSectionHeadingLine,
} from "@/domains/documents/lib/sections";

export const appendSectionMediaMarkdown = (
	markdown: string,
	section: MarkdownSectionIdentity,
	media: MarkdownSectionMedia,
) => {
	const lines = markdown.split("\n");
	const headingIndex = findSectionHeadingLine(lines, section);
	if (headingIndex < 0) return null;

	const sectionEnd = findSectionEndLine(lines, headingIndex, section.headingLevel);
	const sectionLines = lines.slice(headingIndex, sectionEnd);
	const mediaMarkdown = sectionMediaMarkdown(media);
	const mediaAlreadyExists = sectionLines.some(
		(line) => sectionMediaSourceFromLine(line.trim(), media.kind) === media.src,
	);
	if (mediaAlreadyExists) {
		return {
			markdown,
			changed: false,
		};
	}

	const nextSectionLines = appendSectionMediaLine(sectionLines, mediaMarkdown);

	return {
		markdown: [
			...lines.slice(0, headingIndex),
			...nextSectionLines,
			...lines.slice(sectionEnd),
		].join("\n"),
		changed: true,
	};
};

export const removeSectionMediaMarkdown = (
	markdown: string,
	section: MarkdownSectionIdentity,
	media: MarkdownSectionMedia,
) => {
	const lines = markdown.split("\n");
	const headingIndex = findSectionHeadingLine(lines, section);
	if (headingIndex < 0) return null;

	const sectionEnd = findSectionEndLine(lines, headingIndex, section.headingLevel);
	const sectionLines = lines.slice(headingIndex, sectionEnd);
	let changed = false;
	const nextSectionLines = trimTrailingBlankLines(
		sectionLines.filter((line) => {
			const source = sectionMediaSourceFromLine(line.trim(), media.kind);
			if (source !== media.src) return true;

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

export const sectionMediaSourceFromLine = (line: string, kind: MarkdownSectionMediaKind) => {
	const media = sectionMediaFromMarkdownLine(line);
	if (!media || media.kind !== kind) return null;

	return media.src;
};

export const sectionMediaFromMarkdownLine = (line: string): MarkdownSectionMedia | null => {
	const link = markdownLinkFromLine(line);
	if (!link) return null;

	const label = sectionMediaLabelFromText(link.label);
	if (!label) return null;

	return {
		kind: label.kind,
		src: link.source,
		...(label.title ? { title: label.title } : {}),
	};
};

const findSectionHeadingLine = (lines: string[], section: MarkdownSectionIdentity) => {
	return findMarkdownSectionHeadingLine(lines, section);
};

const findSectionEndLine = (lines: string[], headingIndex: number, headingLevel: number) => {
	return findMarkdownSectionEndLine(lines, headingIndex, headingLevel);
};

const sectionMediaLabelPrefix: Record<MarkdownSectionMediaKind, string> = {
	audio: "章节音频",
	video: "章节视频",
};

export const sectionMediaMarkdown = (media: MarkdownSectionMedia) => {
	const prefix = sectionMediaLabelPrefix[media.kind];
	const title = media.title?.trim();
	const label = title ? `${prefix}：${title}` : prefix;

	return `[${escapeMarkdownLinkText(label)}](<${media.src}>)`;
};

const markdownLinkLinePattern = /^\[((?:\\.|[^\]\\])*)\]\((?:<([^>]+)>|([^\s)]+))\)$/;

const markdownLinkFromLine = (line: string) => {
	const match = markdownLinkLinePattern.exec(line);
	if (!match) return null;

	return {
		label: unescapeMarkdownLinkText(match[1]),
		source: match[2] ?? match[3] ?? "",
	};
};

const sectionMediaLabelFromText = (label: string) => {
	for (const kind of sectionMediaKinds) {
		const prefix = sectionMediaLabelPrefix[kind];
		if (label === prefix) return { kind, title: "" };
		if (label.startsWith(`${prefix}：`) || label.startsWith(`${prefix}:`)) {
			return {
				kind,
				title: label.slice(prefix.length + 1).trim(),
			};
		}
	}

	return null;
};

const sectionMediaKinds = ["audio", "video"] as const;

const appendSectionMediaLine = (sectionLines: string[], mediaMarkdown: string) => {
	const cleanedSectionLines = trimTrailingBlankLines(sectionLines);
	const needsSeparator =
		cleanedSectionLines.length > 0 &&
		cleanedSectionLines[cleanedSectionLines.length - 1].trim() !== "";

	return [...cleanedSectionLines, ...(needsSeparator ? [""] : []), mediaMarkdown];
};

const trimTrailingBlankLines = (lines: string[]) => {
	const nextLines = [...lines];
	while (nextLines.length > 0 && !nextLines[nextLines.length - 1].trim()) {
		nextLines.pop();
	}

	return nextLines;
};

const escapeMarkdownLinkText = (value: string) => value.replace(/[[\]\\]/g, "\\$&");

const unescapeMarkdownLinkText = (value: string) => value.replace(/\\([[\]\\])/g, "$1");
