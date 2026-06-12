import { Node, mergeAttributes, type JSONContent, type MarkdownToken } from "@tiptap/core";
import {
	createSectionId,
	normalizeSectionId,
	sectionIdAnchorNodeName,
	sectionIdCommentMarkdown,
} from "@/domains/documents/lib/sections";

const sectionIdDirectivePattern = /^<!--\s*section-id:\s*([A-Za-z0-9_-]+)\s*-->\s*(?:\n|$)/;

export const SectionIdAnchor = Node.create({
	name: sectionIdAnchorNodeName,
	group: "block",
	atom: true,
	selectable: false,
	draggable: false,

	addAttributes() {
		return {
			sectionId: {
				default: null,
				parseHTML: (element) => normalizeSectionId(element.getAttribute("data-section-id")) || null,
				renderHTML: (attributes) => ({
					"data-section-id": normalizeSectionId(attributes.sectionId),
				}),
			},
		};
	},

	parseHTML() {
		return [{ tag: "div[data-section-id-anchor]" }];
	},

	renderHTML({ HTMLAttributes }) {
		return [
			"div",
			mergeAttributes(HTMLAttributes, {
				"data-section-id-anchor": "",
				contenteditable: "false",
				style: "display: none;",
			}),
		];
	},

	markdownTokenizer: {
		name: sectionIdAnchorNodeName,
		level: "block",
		start(src: string) {
			return src.search(/<!--\s*section-id:/);
		},
		tokenize(src: string) {
			const match = src.match(sectionIdDirectivePattern);
			const sectionId = normalizeSectionId(match?.[1]);
			if (!match || !sectionId) return undefined;
			return {
				type: sectionIdAnchorNodeName,
				raw: match[0],
				attributes: {
					sectionId,
				},
			};
		},
	},

	parseMarkdown(token: MarkdownToken, helpers) {
		const sectionId = normalizeSectionId(token.attributes?.sectionId) || createSectionId();
		return helpers.createNode(sectionIdAnchorNodeName, { sectionId }, []);
	},

	renderMarkdown(node: JSONContent) {
		return sectionIdCommentMarkdown(normalizeSectionId(node.attrs?.sectionId));
	},
});
