export const markdownSection = (markdown: string, headings: string[]) => {
	const range = markdownSectionRange(markdown, headings);
	if (!range) return "";
	return range.lines.slice(range.bodyStart, range.end).join("\n").trim();
};

interface MarkdownSectionRange {
	bodyStart: number;
	end: number;
	lines: string[];
}

const markdownHeadingPattern = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

const markdownSectionRange = (
	markdown: string,
	headings: string[],
): MarkdownSectionRange | null => {
	const lines = markdown.trim().replaceAll("\r\n", "\n").split("\n");
	let start = 0;
	let end = lines.length;
	let parentLevel = 0;
	let foundHeading = -1;
	for (const heading of headings) {
		const normalizedHeading = normalizeHeadingTitle(heading);
		foundHeading = -1;
		let foundLevel = 0;
		for (let index = start; index < end; index += 1) {
			const current = markdownHeading(lines[index]);
			if (!current || current.level <= parentLevel) continue;
			if (normalizeHeadingTitle(current.title) !== normalizedHeading) continue;
			foundHeading = index;
			foundLevel = current.level;
			break;
		}
		if (foundHeading < 0) return null;
		let nextEnd = end;
		for (let index = foundHeading + 1; index < end; index += 1) {
			const current = markdownHeading(lines[index]);
			if (current && current.level === foundLevel) {
				nextEnd = index;
				break;
			}
		}
		start = foundHeading + 1;
		end = nextEnd;
		parentLevel = foundLevel;
	}
	return { bodyStart: start, end, lines };
};

const markdownHeading = (line: string) => {
	const match = markdownHeadingPattern.exec(line.trim());
	if (!match) return null;
	return {
		level: match[1]?.length ?? 0,
		title: match[2]?.trim() ?? "",
	};
};

const normalizeHeadingTitle = (value: string) => value.trim();
