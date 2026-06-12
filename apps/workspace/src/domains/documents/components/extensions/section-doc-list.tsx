import type React from "react";
import { useMemo } from "react";
import { FileText } from "lucide-react";
import { Node, mergeAttributes, type JSONContent, type MarkdownToken } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import type { EditorState } from "@tiptap/pm/state";
import {
	documentCategoryDescriptorMap,
	documentsForCategory,
} from "@/domains/documents/lib/categories";
import type { DocumentCategory } from "@/domains/documents/stores";
import { useDocumentsStore } from "@/domains/documents/stores";
import { cn } from "@/shared/lib/utils";

const sectionDocListDirectivePattern =
	/^<!--\s*section-doc-list\s+category=(?:"([^"]+)"|'([^']+)'|([^\s>]+))\s*-->\s*(?:\n|$)/;

const documentCategories = new Set<DocumentCategory>([
	"screenplay",
	"character",
	"scene",
	"storyboard",
	"source-material",
]);

const normalizeCategory = (value: unknown): DocumentCategory => {
	const category = typeof value === "string" ? value.trim() : "";
	return documentCategories.has(category as DocumentCategory)
		? (category as DocumentCategory)
		: "source-material";
};

export const SectionDocList = Node.create({
	name: "sectionDocList",
	group: "block",
	atom: true,
	selectable: false,
	draggable: false,

	addAttributes() {
		return {
			category: {
				default: "source-material",
				parseHTML: (element) => normalizeCategory(element.getAttribute("data-category")),
				renderHTML: (attributes) => ({
					"data-category": normalizeCategory(attributes.category),
				}),
			},
		};
	},

	parseHTML() {
		return [{ tag: "section[data-section-doc-list]" }];
	},

	renderHTML({ HTMLAttributes }) {
		return [
			"section",
			mergeAttributes(HTMLAttributes, {
				"data-section-doc-list": "",
			}),
		];
	},

	addNodeView() {
		return ReactNodeViewRenderer(SectionDocListView);
	},

	addKeyboardShortcuts() {
		return {
			Backspace: () => isSectionDocListDeleteBoundary(this.editor.state, this.name, "backward"),
			Delete: () => isSectionDocListDeleteBoundary(this.editor.state, this.name, "forward"),
		};
	},

	markdownTokenizer: {
		name: "sectionDocList",
		level: "block",
		start(src: string) {
			return src.search(/<!--\s*section-doc-list\b/);
		},
		tokenize(src: string) {
			const match = src.match(sectionDocListDirectivePattern);
			if (!match) return undefined;
			return {
				type: "sectionDocList",
				raw: match[0],
				attributes: {
					category: normalizeCategory(match[1] ?? match[2] ?? match[3]),
				},
			};
		},
	},

	parseMarkdown(token: MarkdownToken, helpers) {
		return helpers.createNode(
			"sectionDocList",
			{
				category: normalizeCategory(token.attributes?.category),
			},
			[],
		);
	},

	renderMarkdown(node: JSONContent) {
		const category = normalizeCategory(node.attrs?.category);
		return `<!-- section-doc-list category="${category}" -->`;
	},
});

const SectionDocListView: React.FC<NodeViewProps> = ({ node }) => {
	const category = normalizeCategory(node.attrs.category);
	const descriptor = documentCategoryDescriptorMap[category];
	const Icon = descriptor?.icon ?? FileText;
	const allDocuments = useDocumentsStore((state) => state.documents);
	const documents = useMemo(
		() => documentsForCategory(allDocuments, category),
		[allDocuments, category],
	);

	return (
		<NodeViewWrapper
			as="section"
			data-section-doc-list=""
			data-category={category}
			className="my-3 rounded-sm border border-border bg-muted/40 px-3 py-2"
			contentEditable={false}
		>
			<div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
				<Icon className="size-3.5" />
				<span>{descriptor?.label ?? "文档"}清单</span>
				<span className="ml-auto rounded-sm bg-background px-1.5 py-0.5 text-2xs leading-none">
					{documents.length}
				</span>
			</div>
			{documents.length === 0 ? (
				<p className="text-sm italic text-muted-foreground">
					此分类暂无文档。用左侧 + 创建后会自动出现在这里。
				</p>
			) : (
				<ul className="m-0 list-none space-y-1 p-0">
					{documents.map((document) => (
						<li key={document.id} className="flex min-w-0 items-baseline gap-2 text-sm">
							<a
								href={`doc://${encodeURIComponent(document.id)}`}
								data-doc-id={document.id}
								className={cn(
									"min-w-0 truncate font-medium text-foreground underline-offset-2 hover:text-primary hover:underline",
									document.isDirty && "text-primary",
								)}
							>
								{document.title || "未命名"}
							</a>
							<span className="shrink-0 text-xs text-muted-foreground">
								— <em>{formatDateTime(document.updatedAt)}</em>
							</span>
						</li>
					))}
				</ul>
			)}
		</NodeViewWrapper>
	);
};

const formatDateTime = (value: string) => {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "暂无记录";
	return date.toLocaleString("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
};

const isSectionDocListDeleteBoundary = (
	state: EditorState,
	nodeName: string,
	direction: "backward" | "forward",
) => {
	const { selection } = state;
	if (!selection.empty) return false;

	const { $from } = selection;
	if (direction === "backward") {
		if ($from.nodeBefore?.type.name === nodeName) return true;
		if ($from.parentOffset > 0 || $from.depth === 0) return false;
		return state.doc.resolve($from.before($from.depth)).nodeBefore?.type.name === nodeName;
	}

	if ($from.nodeAfter?.type.name === nodeName) return true;
	if ($from.parentOffset < $from.parent.content.size || $from.depth === 0) return false;
	return state.doc.resolve($from.after($from.depth)).nodeAfter?.type.name === nodeName;
};
