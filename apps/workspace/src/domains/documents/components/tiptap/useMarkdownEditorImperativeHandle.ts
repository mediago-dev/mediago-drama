import type React from "react";
import { useCallback, useImperativeHandle } from "react";
import type { Editor } from "@tiptap/react";
import type { DocumentRangeSelection } from "@/domains/agent/api/agent";
import type {
	MarkdownBlockDeltaOptions,
	MarkdownHybridEditorHandle,
} from "@/domains/documents/lib/editor-registry";
import {
	findTextNodeRange,
	findTopLevelBlockRangeByIndex,
	resolveReplacementMarkdown,
	resolveStreamingTarget,
} from "./ranges";
import type { StreamingBlockTarget } from "./types";

interface MarkdownEditorImperativeHandleOptions {
	documentId: string;
	editor: Editor | null;
	emittedMarkdownRef: React.MutableRefObject<string>;
	isStreamingRef: React.MutableRefObject<boolean>;
	onChangeRef: React.MutableRefObject<(value: string) => void>;
	ref: React.ForwardedRef<MarkdownHybridEditorHandle>;
	streamingTargetRef: React.MutableRefObject<StreamingBlockTarget | null>;
}

export const useMarkdownEditorImperativeHandle = ({
	documentId,
	editor,
	emittedMarkdownRef,
	isStreamingRef,
	onChangeRef,
	ref,
	streamingTargetRef,
}: MarkdownEditorImperativeHandleOptions) => {
	const applyBlockDelta = useCallback(
		(anchorText: string, content: string, options?: MarkdownBlockDeltaOptions) => {
			if (!editor) return false;

			const target = resolveStreamingTarget(editor, streamingTargetRef.current, anchorText);
			if (!target) return false;

			const blockRange = findTopLevelBlockRangeByIndex(editor.state.doc, target.blockIndex);
			if (!blockRange) return false;

			const replacementMarkdown = resolveReplacementMarkdown(editor, target, content, options);
			if (replacementMarkdown === null) return false;

			streamingTargetRef.current = target;
			const wasStreaming = isStreamingRef.current;
			isStreamingRef.current = true;
			const applied = editor.commands.insertContentAt(
				{ from: blockRange.from, to: blockRange.to },
				replacementMarkdown,
				{
					contentType: "markdown",
					errorOnInvalidContent: false,
					updateSelection: false,
				},
			);

			if (!applied) {
				isStreamingRef.current = wasStreaming;
				return false;
			}

			return true;
		},
		[editor, isStreamingRef, streamingTargetRef],
	);

	const commitBlockDelta = useCallback(() => {
		if (!editor || !isStreamingRef.current) return false;

		isStreamingRef.current = false;
		streamingTargetRef.current = null;
		const markdown = editor.getMarkdown();
		emittedMarkdownRef.current = markdown;
		onChangeRef.current(markdown);
		return true;
	}, [editor, emittedMarkdownRef, isStreamingRef, onChangeRef, streamingTargetRef]);

	const hasPendingBlockDelta = useCallback(() => isStreamingRef.current, [isStreamingRef]);

	const setStructuredSelection = useCallback(
		(selection: DocumentRangeSelection) => {
			if (!editor) return false;
			const quote = selection.quote?.trim();
			if (!quote) return false;
			const range = findTextNodeRange(editor.state.doc, quote);
			if (!range) return false;
			editor.commands.focus();
			editor.commands.setTextSelection(range);
			return true;
		},
		[editor],
	);

	useImperativeHandle(
		ref,
		() => ({
			documentId,
			applyBlockDelta,
			setSelection: setStructuredSelection,
			commitBlockDelta,
			hasPendingBlockDelta,
		}),
		[
			applyBlockDelta,
			commitBlockDelta,
			documentId,
			hasPendingBlockDelta,
			ref,
			setStructuredSelection,
		],
	);
};
