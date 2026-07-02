import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { createSectionGenerationPrompt } from "@/domains/documents/lib/section-generation-prompt";
import {
	createSectionBlockId,
	documentSectionHeadingLevel,
	documentSectionHeadingText,
	findMarkdownSectionEndLine,
	findMarkdownSectionHeadingLine,
	listDocumentSections,
	normalizeHeadingText,
	stripSectionIdCommentLines,
} from "@/domains/documents/lib/sections";
import type { MarkdownDocument } from "@/domains/documents/stores";
import type { EpisodeCanvasNode, EpisodeCanvasReference } from "./canvas-graph";

export const createReferenceImageGenerationSection = ({
	documents,
	node,
}: {
	documents: MarkdownDocument[];
	node: EpisodeCanvasNode;
}): MarkdownSectionContext | null => {
	if (node.type !== "reference-image") return null;

	const reference = node.data.reference;
	if (!reference || reference.status === "placeholder") return null;

	const referencedSection = sectionContextFromReference(reference, documents);
	if (referencedSection) return referencedSection;

	return null;
};

const sectionContextFromReference = (
	reference: EpisodeCanvasReference,
	documents: MarkdownDocument[],
): MarkdownSectionContext | null => {
	const agentReference = reference.agentReference;
	if (agentReference.kind === "asset") return null;

	const document = documents.find((item) => item.id === agentReference.documentId);
	if (!document) return null;

	const sections = listDocumentSections(document);
	const identity = sectionIdentityFromReference(document, sections, reference);
	if (!identity) return null;

	return sectionContextFromIdentity(document, identity);
};

const sectionIdentityFromReference = (
	document: MarkdownDocument,
	sections: ReturnType<typeof listDocumentSections>,
	reference: EpisodeCanvasReference,
) => {
	const agentReference = reference.agentReference;
	if (agentReference.kind === "section" && agentReference.blockId) {
		return sectionIdentityFromReferenceBlockId(document, sections, agentReference.blockId);
	}
	if (agentReference.kind === "document" && sections.length === 1) {
		return sectionIdentityFromDocumentSection(document, sections, sections[0]);
	}
	return null;
};

const sectionIdentityFromReferenceBlockId = (
	document: MarkdownDocument,
	sections: ReturnType<typeof listDocumentSections>,
	blockId: string,
) => {
	const explicitSection = sections.find((section) => section.blockId === blockId);
	if (explicitSection)
		return sectionIdentityFromDocumentSection(document, sections, explicitSection);

	const legacyIdentity = legacySectionIdentityFromBlockId(document, blockId);
	if (!legacyIdentity) return null;

	const currentSection = findListedSectionByIdentity(sections, legacyIdentity);
	if (currentSection) return sectionIdentityFromDocumentSection(document, sections, currentSection);

	return legacyIdentity;
};

const sectionIdentityFromDocumentSection = (
	document: MarkdownDocument,
	sections: ReturnType<typeof listDocumentSections>,
	section: ReturnType<typeof listDocumentSections>[number],
) => {
	const sectionIndex = sections.findIndex((item) => item.blockId === section.blockId);
	if (sectionIndex < 0) return null;

	const headingOccurrence = sections
		.slice(0, sectionIndex + 1)
		.filter(
			(item) =>
				item.level === section.level &&
				normalizeHeadingText(item.title) === normalizeHeadingText(section.title),
		).length;
	return {
		blockId: section.blockId,
		documentId: document.id,
		headingLevel: section.level,
		headingOccurrence,
		headingText: section.title,
	};
};

const legacySectionIdentityFromBlockId = (document: MarkdownDocument, blockId: string) => {
	const occurrenceByHeading = new Map<string, number>();
	const lines = document.content.split("\n");

	for (const line of lines) {
		const level = documentSectionHeadingLevel;
		const title = documentSectionHeadingText(line);
		if (!title) continue;
		const occurrenceKey = `${level}|${title}`;
		const headingOccurrence = (occurrenceByHeading.get(occurrenceKey) ?? 0) + 1;
		occurrenceByHeading.set(occurrenceKey, headingOccurrence);

		if (createSectionBlockId(document.id, level, headingOccurrence, title) !== blockId) continue;

		return {
			blockId,
			documentId: document.id,
			headingLevel: level,
			headingOccurrence,
			headingText: title,
		};
	}

	return null;
};

const findListedSectionByIdentity = (
	sections: ReturnType<typeof listDocumentSections>,
	identity: {
		headingLevel: number;
		headingOccurrence: number;
		headingText: string;
	},
) => {
	let occurrence = 0;
	const headingText = normalizeHeadingText(identity.headingText);

	for (const section of sections) {
		if (section.level !== identity.headingLevel) continue;
		if (normalizeHeadingText(section.title) !== headingText) continue;

		occurrence += 1;
		if (occurrence === identity.headingOccurrence) return section;
	}

	return null;
};

const sectionContextFromIdentity = (
	document: MarkdownDocument,
	identity: {
		blockId: string;
		documentId: string;
		headingLevel: number;
		headingOccurrence: number;
		headingText: string;
	},
): MarkdownSectionContext | null => {
	const lines = document.content.split("\n");
	const headingIndex = findMarkdownSectionHeadingLine(lines, identity);
	if (headingIndex < 0) return null;

	const markdown = lines
		.slice(
			headingIndex,
			findMarkdownSectionEndLine(lines, headingIndex, documentSectionHeadingLevel),
		)
		.join("\n")
		.trim();
	if (!markdown) return null;

	return {
		...identity,
		markdown,
		plainText: plainTextFromReferencePrompt(markdown),
		prompt: createSectionGenerationPrompt(markdown, identity.headingText),
	};
};

const plainTextFromReferencePrompt = (markdown: string) =>
	stripSectionIdCommentLines(markdown)
		.split("\n")
		.map((line) =>
			line
				.replace(/^#{1,6}\s+/, "")
				.replace(/!\[[^\]]*\]\((?:<[^>]+>|[^\s)]+)\)/gu, "")
				.replace(/@\[((?:\\.|[^\]\\])*)\]\((?:<[^>]+>|[^\s)]+)\)/gu, "$1")
				.replace(/\*\*/g, "")
				.trim(),
		)
		.filter(Boolean)
		.join("\n")
		.trim();
