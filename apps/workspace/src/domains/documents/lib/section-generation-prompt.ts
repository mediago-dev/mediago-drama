import { stripSectionIdCommentLines } from "@/domains/documents/lib/sections";

const markdownImageLinePattern = /^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)$/;

export const createSectionGenerationPrompt = (markdown: string, fallbackTitle = "") => {
	const prompt = stripSectionGenerationPromptNoise(markdown).trim();
	if (prompt) return prompt;

	return fallbackTitle.trim();
};

export const stripSectionGenerationPromptNoise = (markdown: string) =>
	stripSectionIdCommentLines(markdown)
		.split("\n")
		.filter((line) => !markdownImageLinePattern.test(line.trim()))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n");
