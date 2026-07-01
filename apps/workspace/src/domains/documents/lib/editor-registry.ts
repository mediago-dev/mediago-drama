import type { DocumentRangeSelection } from "@/domains/agent/api/agent";

export interface MarkdownBlockDeltaOptions {
	fullDocument?: boolean;
	blockId?: string;
}

export interface MarkdownSectionIdentity {
	blockId: string;
	documentId: string;
	headingLevel: number;
	headingOccurrence: number;
	headingText: string;
}

export interface MarkdownSectionMentionReference {
	documentId: string;
	blockId?: string;
	title: string;
	category?: string;
}

export type MarkdownSectionMediaKind = "audio" | "video";

export interface MarkdownSectionMedia {
	kind: MarkdownSectionMediaKind;
	src: string;
	title?: string;
}

export interface MarkdownHybridEditorHandle {
	documentId: string;
	applyBlockDelta: (
		anchorText: string,
		content: string,
		options?: MarkdownBlockDeltaOptions,
	) => boolean;
	setSelection: (selection: DocumentRangeSelection) => boolean;
	commitBlockDelta: () => boolean;
	hasPendingBlockDelta: () => boolean;
}

let editorHandle: MarkdownHybridEditorHandle | null = null;

export const registerEditor = (handle: MarkdownHybridEditorHandle | null) => {
	editorHandle = handle;
};

export const getEditorHandle = () => editorHandle;
