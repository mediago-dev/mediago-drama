export interface TextAnchor {
	quote: string;
	contextBefore: string;
	contextAfter: string;
}

export type TextAnchorInput = TextAnchor | string;

export interface DocumentCommentLike {
	id: string;
	anchorText: string;
	anchor: TextAnchor;
	body: string;
	createdAt: string;
	resolved: boolean;
}

export interface OperationDocumentLike {
	title: string;
	content: string;
	comments: DocumentCommentLike[];
}

interface DocumentOperationBase {
	id: string;
	type: string;
	summary: string;
	target: {
		anchor?: TextAnchor;
		commentId?: string;
		documentId?: string;
		heading?: string;
		position?: "append" | "prepend" | "before_heading" | "after_heading";
	};
	createdAt: string;
}

export interface InsertMarkdownOperation extends DocumentOperationBase {
	type: "insert_markdown";
	payload: {
		markdown: string;
	};
}

export interface InsertSectionOperation extends DocumentOperationBase {
	type: "insert_section";
	payload: {
		heading: string;
		markdown: string;
		level?: 2 | 3;
	};
}

export interface ReplaceTextOperation extends DocumentOperationBase {
	type: "replace_text";
	payload: {
		replacement: string;
	};
}

export interface DeleteSectionOperation extends DocumentOperationBase {
	type: "delete_section";
	payload: Record<string, never>;
}

export interface ReplaceSectionOperation extends DocumentOperationBase {
	type: "replace_section";
	payload: {
		markdown: string;
	};
}

export interface ReorderSectionsOperation extends DocumentOperationBase {
	type: "reorder_sections";
	payload: {
		headings: string[];
	};
}

export interface AddCommentOperation extends DocumentOperationBase {
	type: "add_comment";
	payload: {
		body: string;
	};
}

export interface UpdateCommentOperation extends DocumentOperationBase {
	type: "update_comment";
	payload: {
		body: string;
	};
}

export interface ResolveCommentOperation extends DocumentOperationBase {
	type: "resolve_comment";
	payload: Record<string, never>;
}

export interface DeleteCommentOperation extends DocumentOperationBase {
	type: "delete_comment";
	payload: Record<string, never>;
}

export interface UpdateDocumentMetadataOperation extends DocumentOperationBase {
	type: "update_document_metadata";
	payload: {
		title?: string;
	};
}

export interface DocumentPatchEditOperation extends DocumentOperationBase {
	type: "document_patch_edit";
	payload: {
		patches: Array<{
			op: "replace_range";
			range: { start: number; end: number };
			replacement: string;
		}>;
		beforeLength?: number;
		afterLength?: number;
	};
}

export interface DocumentReplaceEditOperation extends DocumentOperationBase {
	type: "document_replace_edit";
	payload: {
		content: string;
	};
}

export interface DocumentTemplateEditOperation extends DocumentOperationBase {
	type: "document_template_edit";
	payload: {
		template: string;
		section: string;
		fields: Record<string, string>;
	};
}

export interface DocumentTitleEditOperation extends DocumentOperationBase {
	type: "document_title_edit";
	payload: {
		beforeTitle?: string;
		afterTitle?: string;
	};
}

export interface DocumentMetadataEditOperation extends DocumentOperationBase {
	type: "document_metadata_edit";
	payload: Record<string, unknown>;
}

export type DocumentOperation =
	| InsertMarkdownOperation
	| InsertSectionOperation
	| ReplaceTextOperation
	| DeleteSectionOperation
	| ReplaceSectionOperation
	| ReorderSectionsOperation
	| AddCommentOperation
	| UpdateCommentOperation
	| ResolveCommentOperation
	| DeleteCommentOperation
	| UpdateDocumentMetadataOperation
	| DocumentPatchEditOperation
	| DocumentReplaceEditOperation
	| DocumentTemplateEditOperation
	| DocumentTitleEditOperation
	| DocumentMetadataEditOperation;

export interface DocumentOperationResult {
	document: OperationDocumentLike;
	applied: number;
	appliedOperations: DocumentOperation[];
}

interface MarkdownSectionRange {
	startLine: number;
	endLine: number;
	level: number;
}

export const createDocumentOperation = <Operation extends DocumentOperation>(
	operation: Omit<Operation, "createdAt" | "id"> & Partial<Pick<Operation, "createdAt" | "id">>,
): Operation =>
	({
		...operation,
		id: operation.id ?? createOperationId(operation.type),
		createdAt: operation.createdAt ?? new Date().toISOString(),
	}) as Operation;

export const createTextAnchor = (content: string, quote: string): TextAnchor => {
	const normalizedQuote = quote.trim();
	const index = normalizedQuote ? content.indexOf(normalizedQuote) : -1;
	const contextLength = 72;

	if (index < 0) {
		return {
			quote: normalizedQuote,
			contextBefore: "",
			contextAfter: "",
		};
	}

	return {
		quote: normalizedQuote,
		contextBefore: content.slice(Math.max(index - contextLength, 0), index),
		contextAfter: content.slice(
			index + normalizedQuote.length,
			index + normalizedQuote.length + contextLength,
		),
	};
};

export const findMarkdownBlockForAnchor = (
	content: string,
	anchor: TextAnchorInput,
): string | null => {
	const quote = typeof anchor === "string" ? anchor.trim() : anchor.quote.trim();
	if (!quote) return null;

	const index = findTextAnchorIndex(content, anchor);
	if (index < 0) return null;

	const from = findMarkdownBlockStart(content, index);
	const to = findMarkdownBlockEnd(content, index + quote.length);
	const block = content.slice(from, to).trim();
	return block || null;
};

export const findTextAnchorIndex = (content: string, anchor: TextAnchorInput) => {
	const quote = textAnchorQuote(anchor);
	if (!quote) return -1;

	let fallback = -1;
	let index = content.indexOf(quote);
	while (index >= 0) {
		if (fallback < 0) fallback = index;

		if (typeof anchor === "string") return index;

		const before = content.slice(0, index);
		const after = content.slice(index + quote.length);
		const beforeMatches = contextBeforeMatches(before, anchor.contextBefore);
		const afterMatches = contextAfterMatches(after, anchor.contextAfter);
		if (beforeMatches && afterMatches) return index;

		index = content.indexOf(quote, index + 1);
	}

	return fallback;
};

export const findTextAnchorMatch = (
	content: string,
	anchor: TextAnchorInput,
	options: { fallbackToToken?: boolean } = {},
) => {
	const quote = textAnchorQuote(anchor);
	if (!quote) return null;

	const index = findTextAnchorIndex(content, anchor);
	if (index >= 0) return { start: index, end: index + quote.length };
	if (!options.fallbackToToken) return null;

	const token = quote
		.split(/\s+/)
		.map((item) => item.trim())
		.find((item) => item.length >= 2);
	if (!token) return null;

	const tokenIndex = content.indexOf(token);
	return tokenIndex >= 0 ? { start: tokenIndex, end: tokenIndex + token.length } : null;
};

const textAnchorQuote = (anchor: TextAnchorInput) =>
	typeof anchor === "string" ? anchor.trim() : anchor.quote.trim();

const contextBeforeMatches = (before: string, context: string) => {
	if (!context) return true;
	if (before.endsWith(context)) return true;
	const normalizedContext = normalizeAnchorComparable(context);
	return !normalizedContext || normalizeAnchorComparable(before).endsWith(normalizedContext);
};

const contextAfterMatches = (after: string, context: string) => {
	if (!context) return true;
	if (after.startsWith(context)) return true;
	const normalizedContext = normalizeAnchorComparable(context);
	return !normalizedContext || normalizeAnchorComparable(after).startsWith(normalizedContext);
};

const normalizeAnchorComparable = (value: string) => value.replace(/\s+/g, " ").trim();

const findMarkdownBlockStart = (content: string, index: number) => {
	let start = 0;
	const blankLinePattern = /\n[ \t]*\n/g;
	let match = blankLinePattern.exec(content);
	while (match && match.index < index) {
		start = match.index + match[0].length;
		match = blankLinePattern.exec(content);
	}
	return start;
};

const findMarkdownBlockEnd = (content: string, index: number) => {
	const blankLinePattern = /\n[ \t]*\n/g;
	blankLinePattern.lastIndex = index;
	const match = blankLinePattern.exec(content);
	return match ? match.index : content.length;
};

export const applyDocumentOperationsToDocument = (
	document: OperationDocumentLike,
	operations: DocumentOperation[],
): DocumentOperationResult => {
	let nextDocument = cloneDocument(document);
	const appliedOperations: DocumentOperation[] = [];

	for (const operation of operations) {
		const before = nextDocument;
		nextDocument = applyDocumentOperation(nextDocument, operation);
		if (!sameDocument(before, nextDocument)) {
			appliedOperations.push(operation);
		}
	}

	return {
		document: nextDocument,
		applied: appliedOperations.length,
		appliedOperations,
	};
};

const applyDocumentOperation = (
	document: OperationDocumentLike,
	operation: DocumentOperation,
): OperationDocumentLike => {
	if (operation.type === "update_document_metadata") {
		const title = operation.payload.title?.trim();
		return title && title !== document.title ? { ...document, title } : document;
	}

	if (
		operation.type === "document_patch_edit" ||
		operation.type === "document_replace_edit" ||
		operation.type === "document_template_edit" ||
		operation.type === "document_title_edit" ||
		operation.type === "document_metadata_edit"
	) {
		return document;
	}

	if (operation.type === "resolve_comment") {
		const commentId = operation.target.commentId;
		if (!commentId) return document;

		const comments = document.comments.map((comment) =>
			comment.id === commentId ? { ...comment, resolved: true } : comment,
		);
		return { ...document, comments };
	}

	if (operation.type === "delete_comment") {
		const commentId = operation.target.commentId;
		if (!commentId) return document;

		const comments = document.comments.filter((comment) => comment.id !== commentId);
		return { ...document, comments };
	}

	if (operation.type === "update_comment") {
		const body = operation.payload.body.trim();
		const commentId = operation.target.commentId;
		if (!body || !commentId) return document;

		const comments = document.comments.map((comment) =>
			comment.id === commentId ? { ...comment, body } : comment,
		);
		return { ...document, comments };
	}

	if (operation.type === "add_comment") {
		const body = operation.payload.body.trim();
		const anchor = operation.target.anchor;
		if (!body || !anchor?.quote) return document;

		return {
			...document,
			comments: [
				{
					id: operation.target.commentId ?? createOperationId("comment"),
					anchorText: anchor.quote,
					anchor,
					body,
					createdAt: operation.createdAt,
					resolved: false,
				},
				...document.comments,
			],
		};
	}

	if (operation.type === "replace_text") {
		const replacement = operation.payload.replacement.trim();
		const range = findAnchorRange(document.content, operation.target.anchor);
		if (!replacement || !range) return document;

		return {
			...document,
			content: `${document.content.slice(0, range.start)}${replacement}${document.content.slice(
				range.end,
			)}`,
		};
	}

	if (operation.type === "delete_section") {
		const heading = operation.target.heading?.trim();
		if (!heading) return document;
		return {
			...document,
			content: deleteSection(document.content, heading),
		};
	}

	if (operation.type === "replace_section") {
		const heading = operation.target.heading?.trim();
		const markdown = operation.payload.markdown.trim();
		if (!heading || !markdown) return document;
		return {
			...document,
			content: replaceSection(document.content, heading, markdown),
		};
	}

	if (operation.type === "reorder_sections") {
		const headings = operation.payload.headings.map((heading) => heading.trim()).filter(Boolean);
		if (headings.length === 0) return document;
		return {
			...document,
			content: reorderSections(document.content, headings),
		};
	}

	if (operation.type === "insert_section") {
		const level = operation.payload.level ?? 2;
		const heading = operation.payload.heading.trim();
		const markdown = operation.payload.markdown.trim();
		if (!heading && !markdown) return document;

		const section = `${"#".repeat(level)} ${heading || "未命名"}${markdown ? `\n\n${markdown}` : ""}`;
		return {
			...document,
			content: insertMarkdown(document.content, section, operation.target),
		};
	}

	const markdown = operation.payload.markdown.trim();
	if (!markdown) return document;

	return {
		...document,
		content: insertMarkdown(document.content, markdown, operation.target),
	};
};

const insertMarkdown = (
	content: string,
	markdown: string,
	target: DocumentOperationBase["target"],
) => {
	if (target.position === "prepend") return prependMarkdown(content, markdown);
	if (target.position === "before_heading" && target.heading) {
		return insertBeforeHeading(content, target.heading, markdown);
	}
	if (target.position === "after_heading" && target.heading) {
		return insertAfterHeading(content, target.heading, markdown);
	}

	return appendMarkdown(content, markdown);
};

const appendMarkdown = (content: string, markdown: string) => {
	const separator = content.trim() ? "\n\n" : "";
	return `${content.trimEnd()}${separator}${markdown}\n`;
};

const prependMarkdown = (content: string, markdown: string) => {
	const separator = content.trim() ? "\n\n" : "";
	return `${markdown}${separator}${content.trimStart()}`;
};

const insertBeforeHeading = (content: string, heading: string, markdown: string) => {
	const lines = content.split("\n");
	const range = findSectionRange(lines, heading);
	if (!range) return appendMarkdown(content, markdown);

	const nextLines = [...lines];
	const prefix = range.startLine > 0 && nextLines[range.startLine - 1]?.trim() ? [""] : [];
	nextLines.splice(range.startLine, 0, ...prefix, markdown, "");
	return nextLines.join("\n");
};

const insertAfterHeading = (content: string, heading: string, markdown: string) => {
	const lines = content.split("\n");
	const range = findSectionRange(lines, heading);
	if (!range) return appendMarkdown(content, markdown);

	const nextLines = [...lines];
	nextLines.splice(range.startLine + 1, 0, "", markdown, "");
	return nextLines.join("\n");
};

const deleteSection = (content: string, heading: string) => {
	const lines = content.split("\n");
	const range = findSectionRange(lines, heading);
	if (!range) return content;

	const nextLines = [...lines];
	nextLines.splice(range.startLine, range.endLine - range.startLine);
	return trimExcessBlankLines(nextLines.join("\n"));
};

const replaceSection = (content: string, heading: string, markdown: string) => {
	const lines = content.split("\n");
	const range = findSectionRange(lines, heading);
	if (!range) return content;

	const replacement = markdown.trim().split("\n");
	const nextLines = [...lines];
	nextLines.splice(
		range.startLine + 1,
		range.endLine - range.startLine - 1,
		"",
		...replacement,
		"",
	);
	return trimExcessBlankLines(nextLines.join("\n"));
};

const reorderSections = (content: string, headings: string[]) => {
	const lines = content.split("\n");
	const requested = headings.map(normalizeHeadingText).filter(Boolean);
	if (new Set(requested).size !== requested.length) return content;

	const ranges = requested.map((heading) => findSectionRange(lines, heading));
	if (ranges.some((range) => !range)) return content;

	const sectionRanges = ranges.filter((range): range is MarkdownSectionRange => !!range);
	const level = sectionRanges[0]?.level;
	if (!level || sectionRanges.some((range) => range.level !== level)) return content;

	const sortedRanges = [...sectionRanges].sort(
		(first, second) => first.startLine - second.startLine,
	);
	for (let index = 1; index < sortedRanges.length; index += 1) {
		if (sortedRanges[index].startLine < sortedRanges[index - 1].endLine) return content;
	}

	const regionStart = sortedRanges[0].startLine;
	const regionEnd = sortedRanges.at(-1)?.endLine ?? regionStart;
	const siblingRanges = collectSiblingSectionRanges(lines, level, regionStart, regionEnd);
	const siblingHeadings = siblingRanges.map((range) =>
		normalizeHeadingText(lines[range.startLine]),
	);
	if (
		siblingRanges.length !== requested.length ||
		siblingHeadings.some((heading) => !requested.includes(heading))
	) {
		return content;
	}

	const blocks = new Map(
		siblingRanges.map((range) => [
			normalizeHeadingText(lines[range.startLine]),
			lines.slice(range.startLine, range.endLine),
		]),
	);
	const reorderedLines = requested.flatMap((heading) => blocks.get(heading) ?? []);
	return [...lines.slice(0, regionStart), ...reorderedLines, ...lines.slice(regionEnd)].join("\n");
};

const findSectionRange = (lines: string[], heading: string) => {
	const normalizedHeading = normalizeHeadingText(heading);
	const startLine = lines.findIndex((line) => normalizeHeadingText(line) === normalizedHeading);
	if (startLine < 0) return null;

	const level = headingLevel(lines[startLine]);
	if (!level) return null;
	let endLine = lines.length;
	for (let index = startLine + 1; index < lines.length; index += 1) {
		const nextLevel = headingLevel(lines[index]);
		if (nextLevel && nextLevel <= level) {
			endLine = index;
			break;
		}
	}
	return { startLine, endLine, level };
};

const collectSiblingSectionRanges = (
	lines: string[],
	level: number,
	regionStart: number,
	regionEnd: number,
) => {
	const ranges: MarkdownSectionRange[] = [];
	for (let index = regionStart; index < regionEnd; index += 1) {
		if (headingLevel(lines[index]) !== level) continue;
		let endLine = regionEnd;
		for (let next = index + 1; next < regionEnd; next += 1) {
			const nextLevel = headingLevel(lines[next]);
			if (nextLevel && nextLevel <= level) {
				endLine = next;
				break;
			}
		}
		ranges.push({ startLine: index, endLine, level });
		index = endLine - 1;
	}
	return ranges;
};

const headingLevel = (line: string) => line.match(/^(#{1,6})\s+\S/)?.[1]?.length ?? 0;

const normalizeHeadingText = (line: string) => {
	const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
	return (match?.[1] ?? line).trim().toLowerCase();
};

const trimExcessBlankLines = (content: string) =>
	content
		.replace(/\n{4,}/g, "\n\n\n")
		.replace(/^\n+/, "")
		.replace(/\s+$/, "\n");

const findAnchorRange = (content: string, anchor: TextAnchor | undefined) => {
	if (!anchor?.quote) return null;

	const exactIndex = content.indexOf(anchor.quote);
	if (exactIndex >= 0) {
		return {
			start: exactIndex,
			end: exactIndex + anchor.quote.length,
		};
	}

	if (!anchor.contextBefore && !anchor.contextAfter) return null;

	const beforeIndex = anchor.contextBefore ? content.indexOf(anchor.contextBefore) : -1;
	const searchStart =
		beforeIndex >= 0
			? beforeIndex + anchor.contextBefore.length
			: Math.max(content.indexOf(anchor.contextAfter), 0);
	const afterIndex = anchor.contextAfter ? content.indexOf(anchor.contextAfter, searchStart) : -1;

	if (afterIndex > searchStart) {
		return {
			start: searchStart,
			end: afterIndex,
		};
	}

	return null;
};

const cloneDocument = (document: OperationDocumentLike): OperationDocumentLike => ({
	...document,
	comments: document.comments.map((comment) => ({
		...comment,
		anchor: { ...comment.anchor },
	})),
});

const sameDocument = (first: OperationDocumentLike, second: OperationDocumentLike) =>
	first.title === second.title &&
	first.content === second.content &&
	JSON.stringify(first.comments) === JSON.stringify(second.comments);

const createOperationId = (prefix: string) =>
	`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
