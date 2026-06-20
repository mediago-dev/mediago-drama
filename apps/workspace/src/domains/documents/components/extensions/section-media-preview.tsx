import {
	Node as TiptapNode,
	mergeAttributes,
	type JSONContent,
	type MarkdownToken,
} from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import type React from "react";
import { AudioPlayer } from "@/components/AudioPlayer";
import { VideoPlayer } from "@/components/VideoPlayer";
import type { MarkdownSectionMediaKind } from "@/domains/documents/lib/editor-registry";
import {
	sectionMediaFromMarkdownLine,
	sectionMediaMarkdown,
} from "@/domains/documents/components/tiptap/section-media";

const sectionMediaNodeName = "sectionMediaPreview";
const sectionMediaStartPattern = /\[章节(?:音频|视频)(?::|：|\])/;

export const SectionMediaPreview = TiptapNode.create({
	name: sectionMediaNodeName,
	group: "block",
	atom: true,
	selectable: true,
	draggable: false,
	priority: 1100,

	addAttributes() {
		return {
			kind: {
				default: "audio",
				parseHTML: (element) => sectionMediaKind(element.getAttribute("data-section-media")),
				renderHTML: (attributes) => ({
					"data-section-media": sectionMediaKind(attributes.kind),
				}),
			},
			src: {
				default: "",
				parseHTML: (element) => element.getAttribute("data-src") ?? mediaSourceFromElement(element),
				renderHTML: (attributes) => ({
					"data-src": stringAttribute(attributes.src),
				}),
			},
			title: {
				default: "",
				parseHTML: (element) => element.getAttribute("data-title") ?? "",
				renderHTML: (attributes) => ({
					"data-title": stringAttribute(attributes.title),
				}),
			},
		};
	},

	parseHTML() {
		return [{ tag: "div[data-section-media]" }];
	},

	renderHTML({ HTMLAttributes }) {
		return sectionMediaPreviewDOMSpec({
			kind: sectionMediaKind(HTMLAttributes["data-section-media"]),
			src: stringAttribute(HTMLAttributes["data-src"]),
			title: stringAttribute(HTMLAttributes["data-title"]),
		});
	},

	addNodeView() {
		return ReactNodeViewRenderer(SectionMediaPreviewView);
	},

	markdownTokenizer: {
		name: sectionMediaNodeName,
		level: "block",
		start(src: string) {
			return src.search(sectionMediaStartPattern);
		},
		tokenize(src: string) {
			const match = /^([^\n]+)(?:\n|$)/.exec(src);
			const line = match?.[1]?.trim();
			const raw = match?.[0];
			if (!line || !raw) return undefined;

			const media = sectionMediaFromMarkdownLine(line);
			if (!media) return undefined;

			return {
				type: sectionMediaNodeName,
				raw,
				attributes: media,
			};
		},
	},

	parseMarkdown(token: MarkdownToken, helpers) {
		return helpers.createNode(sectionMediaNodeName, token.attributes ?? {}, []);
	},

	renderMarkdown(node: JSONContent) {
		return sectionMediaMarkdown({
			kind: sectionMediaKind(node.attrs?.kind),
			src: stringAttribute(node.attrs?.src),
			title: stringAttribute(node.attrs?.title),
		});
	},
});

interface SectionMediaPreviewAttrs {
	kind: MarkdownSectionMediaKind;
	src: string;
	title: string;
}

const sectionMediaPreviewDOMSpec = (attrs: SectionMediaPreviewAttrs): DOMOutputSpec => {
	const label = sectionMediaLabel(attrs);
	const linkLabel = attrs.kind === "audio" ? "打开音频" : "打开视频";

	return [
		"div",
		mergeAttributes({
			class: `tiptap-section-media tiptap-section-media-${attrs.kind}`,
			contenteditable: "false",
			"data-section-media": attrs.kind,
			"data-src": attrs.src,
			"data-title": attrs.title,
		}),
		[
			"div",
			{ class: "tiptap-section-media-header" },
			["span", { class: "tiptap-section-media-label" }, label],
			[
				"a",
				{
					class: "tiptap-section-media-link",
					href: attrs.src,
					rel: "noreferrer",
					target: "_blank",
				},
				linkLabel,
			],
		],
	];
};

const SectionMediaPreviewView: React.FC<NodeViewProps> = ({ node }) => {
	const attrs = sectionMediaPreviewAttrs(node.attrs);
	const linkLabel = attrs.kind === "audio" ? "打开音频" : "打开视频";

	return (
		<NodeViewWrapper
			className={`tiptap-section-media tiptap-section-media-${attrs.kind}`}
			contentEditable={false}
			data-section-media={attrs.kind}
			data-src={attrs.src}
			data-title={attrs.title}
		>
			<div className="tiptap-section-media-header">
				<span className="tiptap-section-media-label">{sectionMediaLabel(attrs)}</span>
				<a className="tiptap-section-media-link" href={attrs.src} rel="noreferrer" target="_blank">
					{linkLabel}
				</a>
			</div>
			{attrs.kind === "audio" ? (
				<AudioPlayer
					className="tiptap-section-media-player"
					mimeType="audio/mpeg"
					src={attrs.src}
					title={attrs.title || "章节音频"}
				/>
			) : (
				<VideoPlayer
					className="tiptap-section-media-player tiptap-section-media-video"
					load="visible"
					mimeType="video/mp4"
					showTitleInControls={false}
					src={attrs.src}
					title={attrs.title || "章节视频"}
				/>
			)}
		</NodeViewWrapper>
	);
};

const sectionMediaPreviewAttrs = (attrs: Record<string, unknown>): SectionMediaPreviewAttrs => ({
	kind: sectionMediaKind(attrs.kind),
	src: stringAttribute(attrs.src),
	title: stringAttribute(attrs.title),
});

const sectionMediaLabel = (attrs: SectionMediaPreviewAttrs) => {
	const prefix = attrs.kind === "audio" ? "章节音频" : "章节视频";
	return attrs.title ? `${prefix}：${attrs.title}` : prefix;
};

const sectionMediaKind = (value: unknown): MarkdownSectionMediaKind =>
	value === "video" ? "video" : "audio";

const stringAttribute = (value: unknown) => (typeof value === "string" ? value : "");

const mediaSourceFromElement = (element: HTMLElement) =>
	element.querySelector<HTMLAudioElement | HTMLVideoElement>("audio[src], video[src]")?.src ?? "";
