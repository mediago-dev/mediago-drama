import type React from "react";
import { useCallback, useImperativeHandle } from "react";
import type { Editor } from "@tiptap/react";
import type { DocumentRangeSelection } from "@/domains/agent/api/agent";
import type {
	MarkdownBlockDeltaOptions,
	MarkdownHybridEditorHandle,
	MarkdownSectionIdentity,
	MarkdownSectionImage,
	MarkdownSectionImagePlaceholder,
} from "@/domains/documents/lib/editor-registry";
import {
	findTextNodeRange,
	findTopLevelBlockRangeByIndex,
	resolveReplacementMarkdown,
	resolveStreamingTarget,
} from "./ranges";
import {
	appendSectionImageMarkdown,
	appendSectionImagePlaceholderMarkdown,
	removeSectionImageMarkdown,
	removeSectionImagePlaceholderMarkdown,
	replaceSectionImagePlaceholderMarkdown,
} from "./section-images";
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

	const setSectionImage = useCallback(
		(section: MarkdownSectionIdentity, image: MarkdownSectionImage) => {
			if (!editor) return false;

			const currentMarkdown = editor.getMarkdown();
			const result = appendSectionImageMarkdown(currentMarkdown, section, image);
			if (!result) return false;
			if (!result.changed) return true;

			emittedMarkdownRef.current = result.markdown;
			editor.commands.setContent(result.markdown, {
				contentType: "markdown",
				emitUpdate: false,
			});
			onChangeRef.current(result.markdown);
			return true;
		},
		[editor, emittedMarkdownRef, onChangeRef],
	);

	const removeSectionImage = useCallback(
		(section: MarkdownSectionIdentity, image: MarkdownSectionImage) => {
			if (!editor) return false;

			const currentMarkdown = editor.getMarkdown();
			const result = removeSectionImageMarkdown(currentMarkdown, section, image);
			if (!result?.changed) return false;

			emittedMarkdownRef.current = result.markdown;
			editor.commands.setContent(result.markdown, {
				contentType: "markdown",
				emitUpdate: false,
			});
			onChangeRef.current(result.markdown);
			return true;
		},
		[editor, emittedMarkdownRef, onChangeRef],
	);

	const setSectionImagePlaceholder = useCallback(
		(section: MarkdownSectionIdentity, placeholder: MarkdownSectionImagePlaceholder) => {
			if (!editor) return false;

			const currentMarkdown = editor.getMarkdown();
			const result = appendSectionImagePlaceholderMarkdown(currentMarkdown, section, placeholder);
			if (!result) return false;
			if (!result.changed) return true;

			emittedMarkdownRef.current = result.markdown;
			editor.commands.setContent(result.markdown, {
				contentType: "markdown",
				emitUpdate: false,
			});
			onChangeRef.current(result.markdown);
			return true;
		},
		[editor, emittedMarkdownRef, onChangeRef],
	);

	const replaceSectionImagePlaceholder = useCallback(
		(section: MarkdownSectionIdentity, placeholderId: string, image: MarkdownSectionImage) => {
			if (!editor) return false;

			const currentMarkdown = editor.getMarkdown();
			const result = replaceSectionImagePlaceholderMarkdown(
				currentMarkdown,
				section,
				placeholderId,
				image,
			);
			if (!result) return false;
			if (!result.changed) return true;

			emittedMarkdownRef.current = result.markdown;
			editor.commands.setContent(result.markdown, {
				contentType: "markdown",
				emitUpdate: false,
			});
			onChangeRef.current(result.markdown);
			return true;
		},
		[editor, emittedMarkdownRef, onChangeRef],
	);

	const removeSectionImagePlaceholder = useCallback(
		(section: MarkdownSectionIdentity, placeholderId: string) => {
			if (!editor) return false;

			const currentMarkdown = editor.getMarkdown();
			const result = removeSectionImagePlaceholderMarkdown(currentMarkdown, section, placeholderId);
			if (!result?.changed) return false;

			emittedMarkdownRef.current = result.markdown;
			editor.commands.setContent(result.markdown, {
				contentType: "markdown",
				emitUpdate: false,
			});
			onChangeRef.current(result.markdown);
			return true;
		},
		[editor, emittedMarkdownRef, onChangeRef],
	);

	useImperativeHandle(
		ref,
		() => ({
			documentId,
			applyBlockDelta,
			setSelection: setStructuredSelection,
			setSectionImage,
			removeSectionImage,
			setSectionImagePlaceholder,
			replaceSectionImagePlaceholder,
			removeSectionImagePlaceholder,
			commitBlockDelta,
			hasPendingBlockDelta,
		}),
		[
			applyBlockDelta,
			commitBlockDelta,
			documentId,
			hasPendingBlockDelta,
			removeSectionImage,
			removeSectionImagePlaceholder,
			replaceSectionImagePlaceholder,
			ref,
			setSectionImage,
			setSectionImagePlaceholder,
			setStructuredSelection,
		],
	);
};
