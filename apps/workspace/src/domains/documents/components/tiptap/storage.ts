import type { Editor } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import type { DocumentComment } from "@/domains/documents/stores";
import type { TextAnchor } from "@/domains/documents/lib/operations";
import type { BlockHandleStorage } from "./types";

export interface InlineDecorationRange {
	from: number;
	to: number;
}

interface EditorStorageState {
	blockHandle?: BlockHandleStorage;
	commentAnchors?: {
		activeCommentId: string | null;
		items: DocumentComment[];
		onClick?: (commentId: string) => void;
		pendingSelectionAnchor: TextAnchor | null;
		pendingSelectionRange: InlineDecorationRange | null;
	};
}

export const blockHandlePluginKey = new PluginKey("block-handle");
export const commentAnchorPluginKey = new PluginKey("comment-anchors");

const editorStorage = (editor: Editor) => editor.storage as unknown as EditorStorageState;

export const blockHandleStorage = (editor: Editor) => {
	const storage = editorStorage(editor).blockHandle;
	if (!storage) {
		return { hoveredRange: null };
	}
	return storage;
};

export const commentAnchorStorage = (editor: Editor) =>
	editorStorage(editor).commentAnchors ?? {
		activeCommentId: null,
		items: [],
		pendingSelectionAnchor: null,
		pendingSelectionRange: null,
	};
