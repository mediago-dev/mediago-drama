import type { MarkdownSectionContext, SectionGenerateKind } from "./MarkdownHybridEditor";
import { sectionMediaSourceFromLine } from "./tiptap/section-media";
import type { MarkdownDocument } from "@/domains/documents/stores";
import {
	findMarkdownSectionEndLine,
	findMarkdownSectionHeadingLine,
} from "@/domains/documents/lib/sections";
import { apiResourceURL } from "@/shared/lib/api-base";

export const sectionAssetKeysFromDocuments = (
	documents: MarkdownDocument[],
	section: MarkdownSectionContext,
	kind: SectionGenerateKind,
) => {
	const sectionMarkdown = latestSectionMarkdownFromDocuments(documents, section);
	if (kind === "image") return sectionImageAssetKeys(sectionMarkdown);
	if (kind === "audio" || kind === "video") return sectionMediaAssetKeys(sectionMarkdown, kind);

	return [];
};

export const sectionImageAssetKeysFromDocuments = (
	documents: MarkdownDocument[],
	section: MarkdownSectionContext,
) => sectionAssetKeysFromDocuments(documents, section, "image");

const latestSectionMarkdownFromDocuments = (
	documents: MarkdownDocument[],
	section: MarkdownSectionContext,
) => {
	const document = documents.find((item) => item.id === section.documentId);
	if (!document) return section.markdown;

	return sectionMarkdownFromDocument(document.content, section) ?? section.markdown;
};

const sectionMarkdownFromDocument = (markdown: string, section: MarkdownSectionContext) => {
	const lines = markdown.split("\n");
	const headingIndex = findMarkdownSectionHeadingLine(lines, section);
	if (headingIndex < 0) return null;

	const sectionEnd = findMarkdownSectionEndLine(lines, headingIndex, section.headingLevel);
	return lines.slice(headingIndex, sectionEnd).join("\n");
};

const sectionImageAssetKeys = (markdown: string) => {
	const keys = markdown.split("\n").flatMap((line) => {
		const source = sectionImageSourceFromLine(line.trim());
		return source ? [`image:${apiResourceURL(source)}`] : [];
	});

	return Array.from(new Set(keys));
};

const sectionMediaAssetKeys = (
	markdown: string,
	kind: Extract<SectionGenerateKind, "audio" | "video">,
) => {
	const keys = markdown.split("\n").flatMap((line) => {
		const source = sectionMediaSourceFromLine(line.trim(), kind);
		return source ? [`${kind}:${apiResourceURL(source)}`] : [];
	});

	return Array.from(new Set(keys));
};

const sectionImageSourceFromLine = (line: string) => {
	const match = /^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)$/.exec(line);
	if (!match) return null;
	if (
		["mediago-drama-section-image-pending:", "media-cli-section-image-pending:"].some((prefix) =>
			match[1].startsWith(prefix),
		)
	)
		return null;
	const source = match[2] ?? match[3] ?? null;
	if (match[1] === "正在生成图片" && source?.startsWith("data:image/svg+xml;base64,")) return null;

	return source;
};
