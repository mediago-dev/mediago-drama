import { documentCategoryDescriptorMap } from "@/domains/documents/lib/categories";
import { createSectionId, sectionIdCommentMarkdown, sectionIdFromCommentLine } from "./sections";
import type { DocumentCategory } from "@/domains/documents/stores";

export const mentionCreateLabelForCategory = (category?: DocumentCategory) => {
	const label = category ? documentCategoryDescriptorMap[category]?.label : undefined;
	return label ? `新增${label}` : "新增节点";
};

export const normalizeMentionSectionTitle = (value: string) =>
	value
		.replace(/\r?\n/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^#{1,6}\s*/, "")
		.trim();

export interface AppendSecondLevelHeadingOptions {
	sectionId?: string;
}

export const appendSecondLevelHeading = (
	content: string,
	rawTitle: string,
	options: AppendSecondLevelHeadingOptions = {},
) => {
	const title = normalizeMentionSectionTitle(rawTitle);
	if (!title) return content;

	const sectionId = options.sectionId?.trim() || createSectionId(sectionIdsInMarkdown(content));
	const heading = `${sectionIdCommentMarkdown(sectionId)}\n## ${title}\n`;
	const prefix = content.trimEnd();
	return prefix ? `${prefix}\n\n${heading}` : heading;
};

const sectionIdsInMarkdown = (content: string) =>
	content.split(/\r?\n/).flatMap((line) => {
		const sectionId = sectionIdFromCommentLine(line);
		return sectionId ? [sectionId] : [];
	});
