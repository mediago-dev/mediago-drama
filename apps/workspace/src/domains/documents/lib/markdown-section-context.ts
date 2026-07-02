import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { createSectionGenerationPrompt } from "@/domains/documents/lib/section-generation-prompt";
import {
	documentSectionHeadingLevel,
	documentSectionHeadingText,
	findMarkdownSectionEndLine,
	findMarkdownSectionHeadingLine,
	stripSectionIdCommentLines,
} from "@/domains/documents/lib/sections";
import type { MarkdownDocument } from "@/domains/documents/stores";

export const latestMarkdownSectionContextFromDocuments = (
	documents: MarkdownDocument[],
	section: MarkdownSectionContext,
): MarkdownSectionContext => {
	const document = documents.find((item) => item.id === section.documentId);
	if (!document) return section;

	return markdownSectionContextFromDocument(document, section) ?? section;
};

export const markdownSectionContextFromDocument = (
	document: MarkdownDocument,
	section: MarkdownSectionContext,
): MarkdownSectionContext | null => {
	const lines = document.content.split("\n");
	const headingIndex = findMarkdownSectionHeadingLine(lines, section);
	if (headingIndex < 0) return null;

	const headingLevel = documentSectionHeadingLevel;
	const headingText = documentSectionHeadingText(lines[headingIndex]) || section.headingText;
	const markdown = lines
		.slice(headingIndex, findMarkdownSectionEndLine(lines, headingIndex, headingLevel))
		.join("\n")
		.trim();
	if (!markdown) return null;

	return {
		...section,
		headingLevel,
		headingText,
		markdown,
		plainText: markdownSectionPlainText(markdown),
		prompt: createSectionGenerationPrompt(markdown, headingText),
	};
};

export const markdownSectionPlainText = (markdown: string) =>
	stripSectionIdCommentLines(markdown)
		.split("\n")
		.map((line) =>
			line
				.replace(/^#{1,6}\s+/u, "")
				.replace(/!\[[^\]]*\]\((?:<[^>]+>|[^\s)]+)\)/gu, "")
				.replace(/@\[((?:\\.|[^\]\\])*)\]\((?:<[^>]+>|[^\s)]+)\)/gu, "$1")
				.replace(/\*\*/gu, "")
				.trim(),
		)
		.filter(Boolean)
		.join("\n\n")
		.trim();
