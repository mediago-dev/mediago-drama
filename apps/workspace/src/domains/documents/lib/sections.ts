import type { MarkdownDocument } from "@/domains/documents/stores";

export interface DocumentSectionSummary {
	blockId: string;
	level: number;
	title: string;
}

export interface MarkdownSectionIdentityLike {
	blockId: string;
	headingLevel: number;
	headingOccurrence: number;
	headingText: string;
}

export const sectionIdAnchorNodeName = "sectionIdAnchor";

const sectionIdPattern = /^section_[A-Za-z0-9_-]+$/;
const sectionIdCommentPattern = /^\s*<!--\s*section-id:\s*([A-Za-z0-9_-]+)\s*-->\s*$/;
const headingLinePattern = /^(#{1,6})\s+(.+?)\s*$/;
const documentSectionHeadingPattern = /^##(?!#)\s+(.+?)\s*$/;

export const documentSectionHeadingLevel = 2;

export const documentSectionHeadingText = (line: string) => {
	const match = documentSectionHeadingPattern.exec(line);
	return match ? normalizeHeadingText(match[1] ?? "") : "";
};

export const listDocumentSections = (doc: MarkdownDocument): DocumentSectionSummary[] => {
	const occurrenceByHeading = new Map<string, number>();
	const seenSectionIds = new Set<string>();
	const sections: DocumentSectionSummary[] = [];
	const lines = doc.content.split(/\r?\n/);

	for (let index = 0; index < lines.length; index += 1) {
		const title = documentSectionHeadingText(lines[index]);
		if (!title) continue;
		const level = documentSectionHeadingLevel;

		const key = `${level}|${title}`;
		const occurrence = (occurrenceByHeading.get(key) ?? 0) + 1;
		occurrenceByHeading.set(key, occurrence);

		const sectionId = sectionIdBeforeHeadingLine(lines, index);
		const blockId =
			sectionId && !seenSectionIds.has(sectionId)
				? sectionId
				: createSectionBlockId(doc.id, level, occurrence, title);
		if (sectionId && !seenSectionIds.has(sectionId)) {
			seenSectionIds.add(sectionId);
		}

		sections.push({
			blockId,
			level,
			title,
		});
	}

	return sections;
};

export const createSectionId = (existingIds: Iterable<string> = []) => {
	const existing = new Set(existingIds);
	let sectionId = "";
	do {
		sectionId = `section_${randomSectionIdPart()}`;
	} while (existing.has(sectionId));
	return sectionId;
};

export const normalizeSectionId = (value: unknown) => {
	const sectionId = typeof value === "string" ? value.trim() : "";
	return sectionIdPattern.test(sectionId) ? sectionId : "";
};

export const sectionIdFromCommentLine = (line: string) => {
	const match = sectionIdCommentPattern.exec(line);
	return normalizeSectionId(match?.[1] ?? "") || null;
};

export const sectionIdCommentMarkdown = (sectionId: string) =>
	`<!-- section-id: ${normalizeSectionId(sectionId) || createSectionId()} -->`;

export const sectionIdBeforeHeadingLine = (lines: string[], headingIndex: number) => {
	for (let index = headingIndex - 1; index >= 0; index -= 1) {
		const line = lines[index];
		if (!line.trim()) continue;
		return sectionIdFromCommentLine(line);
	}
	return null;
};

export const findMarkdownSectionHeadingLine = (
	lines: string[],
	section: MarkdownSectionIdentityLike,
) => {
	const sectionId = normalizeSectionId(section.blockId);
	if (sectionId) {
		const sectionIdIndex = findMarkdownSectionHeadingLineById(lines, sectionId);
		if (sectionIdIndex >= 0) return sectionIdIndex;
	}

	return findMarkdownSectionHeadingLineByHeading(lines, section);
};

export const findMarkdownSectionEndLine = (
	lines: string[],
	headingIndex: number,
	headingLevel: number,
) => {
	for (let index = headingIndex + 1; index < lines.length; index += 1) {
		const match = headingLinePattern.exec(lines[index]);
		if (match && (match[1]?.length ?? 0) <= headingLevel) {
			return sectionBoundaryBeforeHeadingLine(lines, headingIndex, index);
		}
	}

	return lines.length;
};

export const stripSectionIdCommentLines = (markdown: string) =>
	markdown
		.split("\n")
		.filter((line) => !sectionIdFromCommentLine(line))
		.join("\n");

export const createSectionBlockId = (
	documentId: string,
	headingLevel: number,
	headingOccurrence: number,
	headingText: string,
) =>
	`section-${hashString(
		`${documentId}|${headingLevel}|${headingOccurrence}|${normalizeHeadingText(headingText)}`,
	)}`;

export const hashString = (value: string) => {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash << 5) - hash + value.charCodeAt(index);
		hash |= 0;
	}

	return Math.abs(hash).toString(36);
};

export const normalizeHeadingText = (value: string) => value.trim().replace(/\s+/g, " ");

const findMarkdownSectionHeadingLineById = (lines: string[], sectionId: string) => {
	const normalizedSectionId = normalizeSectionId(sectionId);
	if (!normalizedSectionId) return -1;

	for (let index = 0; index < lines.length; index += 1) {
		if (!documentSectionHeadingPattern.test(lines[index])) continue;
		if (sectionIdBeforeHeadingLine(lines, index) === normalizedSectionId) return index;
	}

	return -1;
};

const findMarkdownSectionHeadingLineByHeading = (
	lines: string[],
	section: MarkdownSectionIdentityLike,
) => {
	let occurrence = 0;
	const normalizedHeading = normalizeHeadingText(section.headingText);

	for (let index = 0; index < lines.length; index += 1) {
		const match = headingLinePattern.exec(lines[index]);
		if (!match) continue;
		const level = match[1]?.length ?? 0;
		if (level !== documentSectionHeadingLevel) continue;
		if (level !== section.headingLevel) continue;
		if (normalizeHeadingText(match[2] ?? "") !== normalizedHeading) continue;

		occurrence += 1;
		if (occurrence === section.headingOccurrence) return index;
	}

	return -1;
};

const sectionBoundaryBeforeHeadingLine = (
	lines: string[],
	headingIndex: number,
	nextHeadingIndex: number,
) => {
	for (let index = nextHeadingIndex - 1; index > headingIndex; index -= 1) {
		const line = lines[index];
		if (!line.trim()) continue;
		if (sectionIdFromCommentLine(line)) return index;
		break;
	}

	return nextHeadingIndex;
};

const randomSectionIdPart = () => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID().replace(/-/g, "");
	}
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};
