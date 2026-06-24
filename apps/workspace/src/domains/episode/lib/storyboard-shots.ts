import { createSectionBlockId, sectionIdBeforeHeadingLine } from "@/domains/documents/lib/sections";

export interface StoryboardShotSummary {
	cameraMove?: string;
	durationLabel?: string;
	durationSeconds?: number;
	perspective?: string;
	prompt: string;
	shotSize?: string;
	text: string;
	title: string;
}

export interface StoryboardLaneSource {
	blockId?: string;
	headingLevel: number;
	headingOccurrence: number;
	id: string;
	markdown: string;
	shots: StoryboardShotSummary[];
	title: string;
}

export interface ReadStoryboardLaneSourcesOptions {
	documentId?: string | null;
}

interface MarkdownHeading {
	level: number;
	lineIndex: number;
	text: string;
}

const headingPattern = /^(#{1,6})\s+(.+?)\s*$/u;
const storyboardGroupTitlePattern = /^第\s*\S+\s*组/u;
const storyboardShotTitlePattern = /^(分镜|镜头)(?:\s+|[0-9０-９一二三四五六七八九十百]+|$)/u;

export const readStoryboardLaneSources = (
	markdown: string,
	options: ReadStoryboardLaneSourcesOptions = {},
): StoryboardLaneSource[] => {
	const lines = stripFrontmatter(markdown).split("\n");
	const headings = readHeadings(lines);
	const groups = collectHeadingSections(lines, headings, (heading) =>
		storyboardGroupTitlePattern.test(heading.text),
	);
	if (groups.length > 0) return groups.map((section) => sectionToLaneSource(section, options));

	const shots = collectHeadingSections(lines, headings, (heading) =>
		storyboardShotTitlePattern.test(heading.text),
	);
	if (shots.length > 0) return shots.map((section) => sectionToLaneSource(section, options));

	const sections = collectHeadingSections(lines, headings, (heading) => heading.level <= 3);
	return sections.map((section) => sectionToLaneSource(section, options));
};

export const parseStoryboardShots = (markdown: string): StoryboardShotSummary[] => {
	const lines = stripFrontmatter(markdown).split("\n");
	const headings = readHeadings(lines);
	const sections = collectHeadingSections(lines, headings, (heading) =>
		storyboardShotTitlePattern.test(heading.text),
	);

	if (sections.length === 0 && markdown.trim()) {
		const prompt = normalizeShotText(markdown);
		return [
			{
				prompt,
				text: prompt,
				title: "文字分镜",
			},
		];
	}

	return sections.map((section) => parseShotSection(section.title, section.markdown));
};

const sectionToLaneSource = (
	section: HeadingSection,
	options: ReadStoryboardLaneSourcesOptions,
): StoryboardLaneSource => ({
	blockId: section.blockId || stableSectionBlockId(section, options.documentId),
	headingLevel: section.headingLevel,
	headingOccurrence: section.headingOccurrence,
	id: `${section.index}-${slugify(section.title)}`,
	markdown: section.markdown,
	shots: parseStoryboardShots(section.markdown),
	title: section.title,
});

interface HeadingSection {
	blockId?: string;
	headingLevel: number;
	headingOccurrence: number;
	index: number;
	markdown: string;
	title: string;
}

const collectHeadingSections = (
	lines: string[],
	headings: MarkdownHeading[],
	shouldStart: (heading: MarkdownHeading) => boolean,
): HeadingSection[] => {
	const sections: HeadingSection[] = [];
	const occurrences = new Map<string, number>();

	for (let headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
		const heading = headings[headingIndex];
		if (!shouldStart(heading)) continue;

		const occurrenceKey = `${heading.level}|${heading.text}`;
		const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
		occurrences.set(occurrenceKey, occurrence);
		const nextHeading = headings
			.slice(headingIndex + 1)
			.find((candidate) => candidate.level <= heading.level && shouldStart(candidate));
		const endLine = nextHeading?.lineIndex ?? lines.length;
		const markdown = lines.slice(heading.lineIndex, endLine).join("\n").trim();

		sections.push({
			blockId: sectionIdBeforeHeadingLine(lines, heading.lineIndex) ?? undefined,
			headingLevel: heading.level,
			headingOccurrence: occurrence,
			index: sections.length,
			markdown,
			title: heading.text,
		});
	}

	return sections;
};

const stableSectionBlockId = (section: HeadingSection, documentId?: string | null) => {
	const normalizedDocumentId = documentId?.trim();
	if (!normalizedDocumentId) return undefined;
	return createSectionBlockId(
		normalizedDocumentId,
		section.headingLevel,
		section.headingOccurrence,
		section.title,
	);
};

const readHeadings = (lines: string[]): MarkdownHeading[] =>
	lines.flatMap((line, lineIndex) => {
		const match = headingPattern.exec(line);
		if (!match?.[1] || !match[2]) return [];

		return {
			level: match[1].length,
			lineIndex,
			text: cleanInlineMarkdown(match[2]).trim(),
		};
	});

const parseShotSection = (title: string, markdown: string): StoryboardShotSummary => {
	const fields = new Map<string, string>();
	const bodyLines: string[] = [];
	const promptLines: string[] = [];

	for (const rawLine of markdown.split("\n")) {
		const line = cleanStoryboardLine(rawLine);
		if (!line || storyboardShotTitlePattern.test(line)) continue;

		promptLines.push(line);
		const field = parseStoryboardField(line);
		if (field) {
			fields.set(field.key, field.value);
			continue;
		}

		bodyLines.push(line);
	}

	const durationLabel = fields.get("时长") ?? fields.get("时间");

	return {
		cameraMove: fields.get("运镜"),
		durationLabel,
		durationSeconds: durationLabel ? parseDurationSeconds(durationLabel) : undefined,
		perspective: fields.get("视角"),
		prompt: promptLines.join("\n").trim(),
		shotSize: fields.get("景别"),
		text:
			fields.get("动作") ??
			fields.get("画面") ??
			fields.get("描述") ??
			bodyLines.join("\n").trim() ??
			"",
		title,
	};
};

const parseStoryboardField = (line: string) => {
	const match = /^([^:：]{1,12})[:：]\s*(.+)$/u.exec(line);
	if (!match?.[1]) return null;

	const key = cleanInlineMarkdown(match[1]).trim();
	const value = cleanInlineMarkdown(match[2] ?? "").trim();
	if (!key || !value) return null;

	return { key, value };
};

const parseDurationSeconds = (value: string) => {
	const range = /(\d+(?:\.\d+)?)\s*(?:-|~|至|—|–)\s*(\d+(?:\.\d+)?)/u.exec(value);
	if (range?.[1] && range[2]) {
		const start = Number(range[1]);
		const end = Number(range[2]);
		if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return end - start;
	}

	const seconds = /(\d+(?:\.\d+)?)\s*(?:秒|s)?/iu.exec(value)?.[1];
	if (!seconds) return undefined;

	const parsed = Number(seconds);
	return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeShotText = (markdown: string) =>
	markdown.split("\n").map(cleanStoryboardLine).filter(Boolean).join("\n").trim();

const cleanStoryboardLine = (line: string) =>
	cleanInlineMarkdown(
		line
			.replace(/^\s*[-*]\s+/, "")
			.replace(/^#{1,6}\s+/, "")
			.trim(),
	).trim();

const cleanInlineMarkdown = (value: string) =>
	value.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ");

const stripFrontmatter = (markdown: string) => markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");

const slugify = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, "-")
		.replace(/^-|-$/g, "") || "lane";
