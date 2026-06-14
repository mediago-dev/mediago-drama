import { isOverviewDocumentId } from "@/lib/overview/overview-template";
import type { MarkdownDocument } from "@/domains/documents/stores";

export const defaultEditorPrewarmLimit = 3;
const storyboardPrewarmWeight = 1_000_000;
const activeDocumentPrewarmWeight = 10_000_000;

export const selectDocumentsForEditorPrewarm = (
	documents: MarkdownDocument[],
	activeDocumentId: string,
	limit = defaultEditorPrewarmLimit,
) =>
	documents
		.filter((document) => document.content.trim() && !isOverviewDocumentId(document.id))
		.map((document, index) => ({
			document,
			index,
			score:
				document.content.length +
				(document.category === "storyboard" ? storyboardPrewarmWeight : 0) +
				(document.id === activeDocumentId ? activeDocumentPrewarmWeight : 0),
		}))
		.sort((first, second) => second.score - first.score || first.index - second.index)
		.slice(0, Math.max(0, limit))
		.map(({ document }) => document);
