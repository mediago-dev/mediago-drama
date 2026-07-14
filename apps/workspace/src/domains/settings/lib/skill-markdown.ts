export interface SkillMarkdownParts {
	body: string;
	frontmatter: string;
	hasFrontmatter: boolean;
}

export const splitSkillMarkdown = (content: string): SkillMarkdownParts => {
	const normalized = content.replace(/\r\n/g, "\n").trim();
	if (!normalized.startsWith("---\n")) {
		return { body: normalized, frontmatter: "", hasFrontmatter: false };
	}

	const rest = normalized.slice("---\n".length);
	const closingIndex = rest.indexOf("\n---");
	if (closingIndex < 0) {
		return { body: normalized, frontmatter: "", hasFrontmatter: false };
	}

	const frontmatter = rest.slice(0, closingIndex).trimEnd();
	let body = rest.slice(closingIndex + "\n---".length);
	if (body.startsWith("\n")) {
		body = body.slice(1);
	}

	return {
		body: body.trim(),
		frontmatter,
		hasFrontmatter: true,
	};
};

export const composeSkillMarkdown = ({
	body,
	frontmatter,
}: Pick<SkillMarkdownParts, "body" | "frontmatter">) => {
	const normalizedBody = body.replace(/\r\n/g, "\n").trim();
	const normalizedFrontmatter = frontmatter.replace(/\r\n/g, "\n").trim();
	if (!normalizedFrontmatter) {
		return normalizedBody ? `${normalizedBody}\n` : "";
	}

	return `---\n${normalizedFrontmatter}\n---\n${normalizedBody ? `${normalizedBody}\n` : ""}`;
};

export const updateSkillDescription = (frontmatter: string, description: string) => {
	const lines = frontmatter.replace(/\r\n/g, "\n").trim().split("\n");
	const descriptionLine = `description: ${JSON.stringify(description.trim())}`;
	const start = lines.findIndex((line) => /^description\s*:/.test(line));

	if (start >= 0) {
		let end = start + 1;
		while (end < lines.length && (lines[end].trim() === "" || /^\s+/.test(lines[end]))) {
			end += 1;
		}
		lines.splice(start, end - start, descriptionLine);
		return lines.join("\n");
	}

	const nameLine = lines.findIndex((line) => /^name\s*:/.test(line));
	lines.splice(nameLine >= 0 ? nameLine + 1 : 0, 0, descriptionLine);
	return lines.join("\n");
};
