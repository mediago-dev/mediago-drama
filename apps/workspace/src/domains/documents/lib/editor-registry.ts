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

export interface MarkdownSectionImage {
	src: string;
	title?: string;
}

export interface MarkdownSectionImagePlaceholder {
	id: string;
	prompt?: string;
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
	setSectionImage: (section: MarkdownSectionIdentity, image: MarkdownSectionImage) => boolean;
	removeSectionImage: (section: MarkdownSectionIdentity, image: MarkdownSectionImage) => boolean;
	setSectionImagePlaceholder: (
		section: MarkdownSectionIdentity,
		placeholder: MarkdownSectionImagePlaceholder,
	) => boolean;
	replaceSectionImagePlaceholder: (
		section: MarkdownSectionIdentity,
		placeholderId: string,
		image: MarkdownSectionImage,
	) => boolean;
	removeSectionImagePlaceholder: (
		section: MarkdownSectionIdentity,
		placeholderId: string,
	) => boolean;
	commitBlockDelta: () => boolean;
	hasPendingBlockDelta: () => boolean;
}

let editorHandle: MarkdownHybridEditorHandle | null = null;

export const registerEditor = (handle: MarkdownHybridEditorHandle | null) => {
	editorHandle = handle;
};

export const getEditorHandle = () => editorHandle;
