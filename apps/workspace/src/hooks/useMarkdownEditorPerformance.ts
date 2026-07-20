import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useRef } from "react";

const markdownChangeFlushDelayMs = 160;

interface UseMarkdownEditorPerformanceOptions {
	isChangeSuppressed?: () => boolean;
	onChange: (value: string) => void;
	onMarkdownSerialized?: (markdown: string, editor: Editor) => void;
	value: string;
}

export const useMarkdownEditorPerformance = ({
	isChangeSuppressed,
	onChange,
	onMarkdownSerialized,
	value,
}: UseMarkdownEditorPerformanceOptions) => {
	const onChangeRef = useRef(onChange);
	const onMarkdownSerializedRef = useRef(onMarkdownSerialized);
	const isChangeSuppressedRef = useRef(isChangeSuppressed);
	const emittedMarkdownRef = useRef(value);
	const pendingMarkdownEditorRef = useRef<Editor | null>(null);
	const pendingMarkdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	onChangeRef.current = onChange;
	onMarkdownSerializedRef.current = onMarkdownSerialized;
	isChangeSuppressedRef.current = isChangeSuppressed;

	const clearPendingMarkdownTimer = useCallback(() => {
		if (pendingMarkdownTimerRef.current === null) return;
		clearTimeout(pendingMarkdownTimerRef.current);
		pendingMarkdownTimerRef.current = null;
	}, []);

	const flushPendingMarkdownChange = useCallback(() => {
		clearPendingMarkdownTimer();
		const pendingEditor = pendingMarkdownEditorRef.current;
		pendingMarkdownEditorRef.current = null;
		if (!pendingEditor || pendingEditor.isDestroyed) return;

		const markdown = pendingEditor.getMarkdown();
		if (markdown === emittedMarkdownRef.current) return;

		emittedMarkdownRef.current = markdown;
		onMarkdownSerializedRef.current?.(markdown, pendingEditor);
		if (isChangeSuppressedRef.current?.()) return;
		onChangeRef.current(markdown);
	}, [clearPendingMarkdownTimer]);

	const handleUpdate = useCallback(
		(editor: Editor) => {
			if (isChangeSuppressedRef.current?.()) return;
			pendingMarkdownEditorRef.current = editor;
			if (pendingMarkdownTimerRef.current !== null) return;

			pendingMarkdownTimerRef.current = setTimeout(() => {
				flushPendingMarkdownChange();
			}, markdownChangeFlushDelayMs);
		},
		[flushPendingMarkdownChange],
	);
	const hasPendingMarkdownChange = useCallback(() => pendingMarkdownEditorRef.current !== null, []);

	useEffect(() => {
		const flushBeforeSaveShortcut = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
				flushPendingMarkdownChange();
			}
		};
		window.addEventListener("keydown", flushBeforeSaveShortcut, true);
		return () => window.removeEventListener("keydown", flushBeforeSaveShortcut, true);
	}, [flushPendingMarkdownChange]);

	useEffect(
		() => () => {
			flushPendingMarkdownChange();
		},
		[flushPendingMarkdownChange],
	);

	return {
		emittedMarkdownRef,
		flushPendingMarkdownChange,
		handleBlur: flushPendingMarkdownChange,
		handleUpdate,
		hasPendingMarkdownChange,
		onChangeRef,
		shouldRerenderOnTransaction: false,
	};
};
