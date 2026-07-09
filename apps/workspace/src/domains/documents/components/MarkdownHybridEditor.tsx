import type React from "react";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import { EditorContent, useEditor } from "@tiptap/react";
import { PhotoSlider } from "react-photo-view";
import {
	Editor as CoreEditor,
	mergeAttributes,
	type Editor,
	type Extensions,
	type JSONContent,
} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TextAlign from "@tiptap/extension-text-align";
import type { MarkdownHybridEditorHandle } from "@/domains/documents/lib/editor-registry";
import {
	createLockedHeadingsExtension,
	LockedHeading,
} from "@/domains/documents/components/extensions/locked-heading";
import { SectionIdAnchor } from "@/domains/documents/components/extensions/section-id-anchor";
import { SectionMediaPreview } from "@/domains/documents/components/extensions/section-media-preview";
import {
	commentAnchorExtension,
	createBlockHandleExtension,
} from "@/domains/documents/components/tiptap/extensions";
import { HeadingActionButton } from "@/domains/documents/components/tiptap/editor-overlays";
import { BlockActionMenu } from "@/domains/documents/components/tiptap/block-action-menu";
import {
	diffTopLevelBlocks,
	findTopLevelBlockRangeByIndex,
} from "@/domains/documents/components/tiptap/ranges";
import {
	blockHandlePluginKey,
	blockHandleStorage,
	commentAnchorPluginKey,
	commentAnchorStorage,
	type InlineDecorationRange,
} from "@/domains/documents/components/tiptap/storage";
import {
	createMarkdownHeadingContext,
	type MarkdownHeadingContext,
	type MarkdownSectionContext,
} from "@/domains/documents/components/tiptap/section-context";
import {
	createVisibleTextSelectionBookmark,
	restoreVisibleTextSelectionBookmark,
} from "@/domains/documents/components/tiptap/selection-bookmark";
import { isSectionImagePlaceholderElement } from "@/domains/documents/components/tiptap/section-images";
import { TiptapToolbar } from "@/domains/documents/components/tiptap/toolbar";
import { useMarkdownEditorImperativeHandle } from "@/domains/documents/components/tiptap/useMarkdownEditorImperativeHandle";
import type {
	HoveredBlockRect,
	StreamingBlockTarget,
} from "@/domains/documents/components/tiptap/types";
import type { LockedHeadingPlan } from "@/domains/documents/lib/locked-headings";
import type { TextAnchor } from "@/domains/documents/lib/operations";
import type { DocumentComment } from "@/domains/documents/stores";
import { apiResourceURL } from "@/shared/lib/api-base";
import "@/styles/tiptap.css";
import "react-photo-view/dist/react-photo-view.css";

export interface MarkdownHybridEditorProps {
	comments?: DocumentComment[];
	activeCommentId?: string | null;
	documentId: string;
	extraExtensions?: Extensions;
	headingActionAriaLabel?: string;
	headingActionIcon?: React.ReactNode;
	headingActionLabel?: string;
	headingActionTitle?: string;
	isHeadingActionEnabled?: (heading: MarkdownHeadingContext) => boolean;
	lockedHeadingPlan?: LockedHeadingPlan | null;
	pendingSelectionAnchor?: TextAnchor | null;
	pendingSelectionRange?: InlineDecorationRange | null;
	value: string;
	onChange: (value: string) => void;
	onCommentAnchorClick?: (commentId: string) => void;
	onHeadingAction?: (heading: MarkdownHeadingContext) => void;
	onSelectionChange?: (value: string) => void;
	onSelectionCoordChange?: (coords: SelectionCoords | null) => void;
	onSelectionRangeChange?: (range: InlineDecorationRange | null) => void;
}

export type { MarkdownHybridEditorHandle };

export type { MarkdownHeadingContext, MarkdownSectionContext };

export interface SelectionCoords {
	bottom?: number;
	x: number;
	y: number;
}

const defaultComments: DocumentComment[] = [];
const defaultExtraExtensions: Extensions = [];
const markdownChangeFlushDelayMs = 160;
const parsedMarkdownCacheLimit = 8;

interface ParsedMarkdownCacheEntry {
	json: JSONContent;
	markdown: string;
}

const parsedMarkdownCache = new Map<string, ParsedMarkdownCacheEntry>();

const cachedParsedMarkdown = (documentId: string, markdown: string): JSONContent | null => {
	const entry = parsedMarkdownCache.get(documentId);
	if (!entry || entry.markdown !== markdown) return null;

	parsedMarkdownCache.delete(documentId);
	parsedMarkdownCache.set(documentId, entry);
	return entry.json;
};

const rememberParsedMarkdown = (documentId: string, markdown: string, editor: Editor) => {
	if (!markdown || editor.isDestroyed) return;

	parsedMarkdownCache.delete(documentId);
	parsedMarkdownCache.set(documentId, {
		json: editor.getJSON(),
		markdown,
	});

	while (parsedMarkdownCache.size > parsedMarkdownCacheLimit) {
		const oldestKey = parsedMarkdownCache.keys().next().value;
		if (!oldestKey) break;
		parsedMarkdownCache.delete(oldestKey);
	}
};

const createMarkdownSchemaExtensions = (
	extraExtensions: Extensions = defaultExtraExtensions,
	lockedHeadingPlan: LockedHeadingPlan | null = null,
): Extensions => [
	StarterKit.configure({
		heading: false,
		horizontalRule: false,
		link: {
			autolink: true,
			defaultProtocol: "https",
			enableClickSelection: true,
			linkOnPaste: true,
			openOnClick: false,
		},
	}),
	LockedHeading.configure({ levels: [1, 2, 3, 4] }),
	TextAlign.configure({ types: ["heading", "paragraph"] }),
	SectionIdAnchor,
	SectionMediaPreview,
	MarkdownImage.configure({
		allowBase64: true,
	}),
	Table.configure({
		resizable: true,
	}),
	TableRow,
	TableHeader,
	TableCell,
	...extraExtensions,
	...(lockedHeadingPlan ? [createLockedHeadingsExtension(lockedHeadingPlan)] : []),
];

const MarkdownImage = Image.extend({
	renderHTML({ HTMLAttributes }) {
		const source = typeof HTMLAttributes.src === "string" ? apiResourceURL(HTMLAttributes.src) : "";
		return [
			"img",
			mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, source ? { src: source } : {}),
		];
	},
});

const markdownExtension = () =>
	Markdown.configure({
		indentation: {
			style: "space",
			size: 2,
		},
	});

export const createMarkdownParsingExtensions = (
	extraExtensions: Extensions = defaultExtraExtensions,
	lockedHeadingPlan: LockedHeadingPlan | null = null,
): Extensions => [
	...createMarkdownSchemaExtensions(extraExtensions, lockedHeadingPlan),
	markdownExtension(),
];

const createMarkdownEditorExtensions = (
	blockHandleExtension: Extensions[number],
	extraExtensions: Extensions = defaultExtraExtensions,
	lockedHeadingPlan: LockedHeadingPlan | null = null,
): Extensions => [
	...createMarkdownSchemaExtensions(extraExtensions, lockedHeadingPlan),
	blockHandleExtension,
	commentAnchorExtension,
	Placeholder.configure({
		placeholder: "开始写作...",
	}),
	markdownExtension(),
];

export const prewarmMarkdownHybridEditorContent = ({
	documentId,
	extraExtensions = defaultExtraExtensions,
	lockedHeadingPlan = null,
	value,
}: {
	documentId: string;
	extraExtensions?: Extensions;
	lockedHeadingPlan?: LockedHeadingPlan | null;
	value: string;
}) => {
	if (!documentId || !value || cachedParsedMarkdown(documentId, value)) return;

	const editor = new CoreEditor({
		editable: false,
		extensions: createMarkdownParsingExtensions(extraExtensions, lockedHeadingPlan),
		content: value,
		contentType: "markdown",
	});
	rememberParsedMarkdown(documentId, value, editor);
	editor.destroy();
};

interface ImagePreviewState {
	index: number;
	images: Array<{ key: string; src: string }>;
}

export const MarkdownHybridEditor = forwardRef<
	MarkdownHybridEditorHandle,
	MarkdownHybridEditorProps
>(function MarkdownHybridEditor(
	{
		comments = defaultComments,
		activeCommentId = null,
		documentId,
		extraExtensions = defaultExtraExtensions,
		headingActionAriaLabel = "打开标题操作",
		headingActionIcon,
		headingActionLabel = "设置",
		headingActionTitle = headingActionAriaLabel,
		isHeadingActionEnabled,
		lockedHeadingPlan = null,
		pendingSelectionAnchor = null,
		pendingSelectionRange = null,
		value,
		onChange,
		onCommentAnchorClick,
		onHeadingAction,
		onSelectionChange,
		onSelectionCoordChange,
		onSelectionRangeChange,
	},
	ref,
) {
	const onChangeRef = useRef(onChange);
	const onHeadingActionRef = useRef(onHeadingAction);
	const onSelectionChangeRef = useRef(onSelectionChange);
	const onSelectionCoordChangeRef = useRef(onSelectionCoordChange);
	const onSelectionRangeChangeRef = useRef(onSelectionRangeChange);
	const emittedMarkdownRef = useRef(value);
	const isStreamingRef = useRef(false);
	const pendingMarkdownEditorRef = useRef<Editor | null>(null);
	const pendingMarkdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const streamingTargetRef = useRef<StreamingBlockTarget | null>(null);
	const editorSurfaceRef = useRef<HTMLDivElement>(null);
	const blockMenuOpenRef = useRef(false);
	const [hoveredBlockRect, setHoveredBlockRect] = useState<HoveredBlockRect | null>(null);
	const [blockMenuOpen, setBlockMenuOpen] = useState(false);
	const [blockMenuRect, setBlockMenuRect] = useState<HoveredBlockRect | null>(null);
	const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null);
	const initialEditorContent = useMemo(
		() => cachedParsedMarkdown(documentId, value) ?? value,
		[documentId, value],
	);
	const blockHandleExtension = useMemo(
		() =>
			createBlockHandleExtension((rect, range) => {
				const surface = editorSurfaceRef.current;
				if (!rect || !surface) {
					setHoveredBlockRect(null);
					return;
				}

				const surfaceRect = surface.getBoundingClientRect();
				setHoveredBlockRect({
					height: rect.height,
					isHeading: range?.nodeType === "heading",
					range: range ?? null,
					top: rect.top - surfaceRect.top + surface.scrollTop,
				});
			}),
		[],
	);
	const extensions = useMemo(
		() => createMarkdownEditorExtensions(blockHandleExtension, extraExtensions, lockedHeadingPlan),
		[blockHandleExtension, extraExtensions, lockedHeadingPlan],
	);

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	useEffect(() => {
		onHeadingActionRef.current = onHeadingAction;
	}, [onHeadingAction]);

	useEffect(() => {
		onSelectionChangeRef.current = onSelectionChange;
	}, [onSelectionChange]);

	useEffect(() => {
		onSelectionCoordChangeRef.current = onSelectionCoordChange;
	}, [onSelectionCoordChange]);

	useEffect(() => {
		onSelectionRangeChangeRef.current = onSelectionRangeChange;
	}, [onSelectionRangeChange]);

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
		rememberParsedMarkdown(documentId, markdown, pendingEditor);
		if (isStreamingRef.current) return;
		onChangeRef.current(markdown);
	}, [clearPendingMarkdownTimer, documentId]);

	const scheduleMarkdownChangeFlush = useCallback(
		(nextEditor: Editor) => {
			pendingMarkdownEditorRef.current = nextEditor;
			if (pendingMarkdownTimerRef.current !== null) return;

			pendingMarkdownTimerRef.current = setTimeout(() => {
				flushPendingMarkdownChange();
			}, markdownChangeFlushDelayMs);
		},
		[flushPendingMarkdownChange],
	);

	const editor = useEditor(
		{
			extensions,
			content: initialEditorContent,
			...(typeof initialEditorContent === "string" ? { contentType: "markdown" as const } : {}),
			editorProps: {
				attributes: {
					class: "tiptap-content",
					"aria-label": "Markdown 编辑器",
				},
			},
			immediatelyRender: false,
			shouldRerenderOnTransaction: false,
			onBlur: () => {
				flushPendingMarkdownChange();
			},
			onCreate: ({ editor: nextEditor }) => {
				rememberParsedMarkdown(documentId, value, nextEditor);
			},
			onUpdate: ({ editor: nextEditor }) => {
				if (isStreamingRef.current) return;
				scheduleMarkdownChangeFlush(nextEditor);
			},
			onSelectionUpdate: ({ editor: nextEditor }) => {
				const { from, to } = nextEditor.state.selection;
				const selectedText = from === to ? "" : nextEditor.state.doc.textBetween(from, to, "\n");
				onSelectionChangeRef.current?.(selectedText);
				if (from === to || !selectedText.trim()) {
					onSelectionCoordChangeRef.current?.(null);
					onSelectionRangeChangeRef.current?.(null);
					return;
				}

				onSelectionRangeChangeRef.current?.({
					from: Math.min(from, to),
					to: Math.max(from, to),
				});
				const selectionHead = selectionHeadPosition(nextEditor.state.selection);
				const coords = nextEditor.view.coordsAtPos(selectionHead);
				onSelectionCoordChangeRef.current?.({
					bottom: coords.bottom,
					x: coords.left,
					y: coords.top,
				});
			},
		},
		[],
	);

	useEffect(() => {
		if (!editor) return;
		return () => {
			rememberParsedMarkdown(documentId, emittedMarkdownRef.current, editor);
		};
	}, [documentId, editor]);

	useMarkdownEditorImperativeHandle({
		documentId,
		editor,
		emittedMarkdownRef,
		isStreamingRef,
		onChangeRef,
		ref,
		streamingTargetRef,
	});

	useEffect(
		() => () => {
			flushPendingMarkdownChange();
		},
		[flushPendingMarkdownChange],
	);

	useEffect(() => {
		if (!editor) return;
		if (isStreamingRef.current) return;
		if (pendingMarkdownEditorRef.current) {
			flushPendingMarkdownChange();
			return;
		}
		if (value === emittedMarkdownRef.current) return;

		const previousMarkdown = emittedMarkdownRef.current;
		const changedBlock = diffTopLevelBlocks(editor, previousMarkdown, value);
		if (changedBlock) {
			const blockRange = findTopLevelBlockRangeByIndex(editor.state.doc, changedBlock.blockIndex);
			if (blockRange) {
				const wasStreaming = isStreamingRef.current;
				isStreamingRef.current = true;
				const applied = editor.commands.insertContentAt(
					{ from: blockRange.from, to: blockRange.to },
					changedBlock.markdown,
					{
						contentType: "markdown",
						errorOnInvalidContent: false,
						updateSelection: false,
					},
				);
				isStreamingRef.current = wasStreaming;
				if (applied) {
					emittedMarkdownRef.current = value;
					streamingTargetRef.current = null;
					return;
				}
			}
		}

		const selectionBookmark = createVisibleTextSelectionBookmark(editor);
		emittedMarkdownRef.current = value;
		editor.commands.setContent(value, {
			contentType: "markdown",
			emitUpdate: false,
		});
		isStreamingRef.current = false;
		streamingTargetRef.current = null;
		restoreVisibleTextSelectionBookmark(editor, selectionBookmark);
	}, [editor, flushPendingMarkdownChange, value]);

	useEffect(() => {
		if (!editor) return;

		const storage = commentAnchorStorage(editor);
		storage.items = comments;
		storage.activeCommentId = activeCommentId;
		storage.pendingSelectionAnchor = pendingSelectionAnchor;
		storage.pendingSelectionRange = pendingSelectionRange;
		storage.onClick = onCommentAnchorClick;
		editor.view.dispatch(editor.state.tr.setMeta(commentAnchorPluginKey, Date.now()));
	}, [
		activeCommentId,
		comments,
		editor,
		onCommentAnchorClick,
		pendingSelectionAnchor,
		pendingSelectionRange,
	]);

	const clearHoveredBlockHandle = useCallback(() => {
		if (blockMenuOpenRef.current) return;
		setHoveredBlockRect(null);
		if (!editor) return;

		const storage = blockHandleStorage(editor);
		if (!storage.hoveredRange) return;

		storage.hoveredRange = null;
		editor.view.dispatch(editor.state.tr.setMeta(blockHandlePluginKey, Date.now()));
	}, [editor]);

	const handleBlockMenuOpenChange = useCallback(
		(open: boolean) => {
			blockMenuOpenRef.current = open;
			setBlockMenuOpen(open);
			if (open) {
				setBlockMenuRect(hoveredBlockRect);
				return;
			}
			setBlockMenuRect(null);
			clearHoveredBlockHandle();
		},
		[clearHoveredBlockHandle, hoveredBlockRect],
	);

	const hoveredHeadingContext = useMemo(() => {
		if (!editor || !hoveredBlockRect?.range || hoveredBlockRect.range.nodeType !== "heading") {
			return null;
		}

		return createMarkdownHeadingContext(editor, documentId, hoveredBlockRect.range);
	}, [documentId, editor, hoveredBlockRect]);

	const canShowHeadingAction =
		Boolean(hoveredHeadingContext && onHeadingAction) &&
		(!hoveredHeadingContext ||
			!isHeadingActionEnabled ||
			isHeadingActionEnabled(hoveredHeadingContext));

	const openHeadingAction = useCallback(() => {
		if (!hoveredHeadingContext || !onHeadingActionRef.current) return;

		onHeadingActionRef.current(hoveredHeadingContext);
		clearHoveredBlockHandle();
	}, [clearHoveredBlockHandle, hoveredHeadingContext]);

	const openImagePreview = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
		const target = event.target;
		if (!(target instanceof Element)) return;

		const image = target.closest(".tiptap-content img");
		if (!(image instanceof HTMLImageElement)) return;
		if (isSectionImagePlaceholderElement(image)) return;

		const content = editorSurfaceRef.current?.querySelector<HTMLElement>(".tiptap-content");
		if (!content?.contains(image)) return;

		const imageEntries = Array.from(content.querySelectorAll<HTMLImageElement>("img[src]"))
			.filter((element) => !isSectionImagePlaceholderElement(element))
			.map((element, index) => {
				const src = element.currentSrc || element.src || element.getAttribute("src") || "";
				return src ? { element, key: `${index}:${src}`, src } : null;
			})
			.filter((entry): entry is { element: HTMLImageElement; key: string; src: string } =>
				Boolean(entry),
			);
		const index = imageEntries.findIndex((entry) => entry.element === image);
		if (index < 0) return;

		event.preventDefault();
		event.stopPropagation();
		setImagePreview({
			index,
			images: imageEntries.map(({ key, src }) => ({ key, src })),
		});
	}, []);

	const activeBlockRect = blockMenuOpen ? blockMenuRect : hoveredBlockRect;

	return (
		<div className="tiptap-editor">
			<TiptapToolbar editor={editor} />
			<div ref={editorSurfaceRef} className="tiptap-editor-surface" onClick={openImagePreview}>
				{canShowHeadingAction && hoveredBlockRect ? (
					<HeadingActionButton
						ariaLabel={headingActionAriaLabel}
						icon={headingActionIcon ?? <Settings2 className="size-3.5" />}
						label={headingActionLabel}
						rect={hoveredBlockRect}
						title={headingActionTitle}
						onAction={openHeadingAction}
						onMouseLeave={clearHoveredBlockHandle}
					/>
				) : null}
				{editor && activeBlockRect?.range ? (
					<BlockActionMenu
						editor={editor}
						open={blockMenuOpen}
						range={activeBlockRect.range}
						rect={activeBlockRect}
						onMouseLeave={clearHoveredBlockHandle}
						onOpenChange={handleBlockMenuOpenChange}
					/>
				) : null}
				<EditorContent editor={editor} />
			</div>
			<PhotoSlider
				images={imagePreview?.images ?? []}
				index={imagePreview?.index ?? 0}
				maskOpacity={0.84}
				visible={Boolean(imagePreview?.images.length)}
				onClose={() => setImagePreview(null)}
				onIndexChange={(index) => {
					setImagePreview((current) => (current ? { ...current, index } : current));
				}}
			/>
		</div>
	);
});

const selectionHeadPosition = (selection: { from: number; head?: number; to: number }) =>
	typeof selection.head === "number" ? selection.head : selection.to;
