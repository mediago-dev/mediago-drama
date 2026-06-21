import type { Editor, Extensions, Range } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	filterPromptInsertItems,
	insertPromptItem,
	PromptSlashMenu,
	type PromptInsertItem,
	type PromptSlashMenuPosition,
} from "@/domains/generation/components/PromptSlashCommand";
import { cn } from "@/shared/lib/utils";
import "@/styles/tiptap.css";

export interface PromptEditorProps {
	className?: string;
	editorClassName?: string;
	extensions?: Extensions;
	onChange: (value: string) => void;
	placeholder: string;
	slashItems?: PromptInsertItem[];
	value: string;
}

const emptyPromptMarkdownExtensions: Extensions = [];

interface PromptSlashState {
	items: PromptInsertItem[];
	position: PromptSlashMenuPosition;
	query: string;
	range: Range;
	selectedIndex: number;
}

export const PromptEditor: React.FC<PromptEditorProps> = ({
	className,
	editorClassName,
	extensions,
	onChange,
	placeholder,
	slashItems,
	value,
}) => {
	const surfaceRef = useRef<HTMLDivElement | null>(null);
	const [slashState, setSlashState] = useState<PromptSlashState | null>(null);
	const slashStateRef = useRef<PromptSlashState | null>(null);
	const editor = usePromptMarkdownEditor({
		editorClassName,
		editable: true,
		extensions,
		onChange,
		placeholder,
		value,
	});
	const resolvedSlashItems = useMemo(() => slashItems ?? [], [slashItems]);

	useEffect(() => {
		slashStateRef.current = slashState;
	}, [slashState]);

	const refreshSlashState = useCallback(() => {
		const nextState = resolvePromptSlashState(editor, resolvedSlashItems);

		setSlashState((current) => {
			if (!nextState) return null;

			const selectedIndex =
				current && current.range.from === nextState.range.from && current.query === nextState.query
					? Math.min(current.selectedIndex, Math.max(0, nextState.items.length - 1))
					: 0;

			return { ...nextState, selectedIndex };
		});
	}, [editor, resolvedSlashItems]);

	useEffect(() => {
		if (!editor) return;

		const update = () => refreshSlashState();
		editor.on("update", update);
		editor.on("selectionUpdate", update);
		editor.on("focus", update);
		editor.on("blur", update);
		update();

		return () => {
			editor.off("update", update);
			editor.off("selectionUpdate", update);
			editor.off("focus", update);
			editor.off("blur", update);
		};
	}, [editor, refreshSlashState]);

	useEffect(() => {
		if (!slashState) return;

		const closeOnOutsidePointer = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (surfaceRef.current?.contains(target)) return;
			if (target instanceof Element && target.closest(".prompt-slash-menu-layer")) return;
			setSlashState(null);
		};

		document.addEventListener("pointerdown", closeOnOutsidePointer);
		return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
	}, [slashState]);

	const selectSlashItem = useCallback(
		(item: PromptInsertItem) => {
			const current = slashStateRef.current;
			if (!editor || !current) return;

			insertPromptItem(editor, current.range, item);
			setSlashState(null);
		},
		[editor],
	);

	const handleKeyDownCapture = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			const current = slashStateRef.current;
			if (!current) return;

			if (event.key === "ArrowUp" || event.key === "ArrowDown") {
				event.preventDefault();
				event.stopPropagation();
				if (current.items.length === 0) return;

				const step = event.key === "ArrowDown" ? 1 : -1;
				setSlashState((state) =>
					state
						? {
								...state,
								selectedIndex: movePromptSlashSelectionInGroup(
									state.items,
									state.selectedIndex,
									step,
								),
							}
						: state,
				);
				return;
			}

			if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
				event.preventDefault();
				event.stopPropagation();
				if (current.items.length === 0) return;

				const step = event.key === "ArrowRight" ? 1 : -1;
				setSlashState((state) =>
					state
						? {
								...state,
								selectedIndex: movePromptSlashSelectionGroup(
									state.items,
									state.selectedIndex,
									step,
								),
							}
						: state,
				);
				return;
			}

			if (event.key === "Enter" || event.key === "Tab") {
				if (current.items.length === 0) return;

				event.preventDefault();
				event.stopPropagation();
				selectSlashItem(current.items[current.selectedIndex] ?? current.items[0]);
				return;
			}

			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				setSlashState(null);
			}
		},
		[selectSlashItem],
	);

	const handleKeyUpCapture = useCallback(() => {
		refreshSlashState();
	}, [refreshSlashState]);

	return (
		<div
			ref={surfaceRef}
			className={cn(
				"min-h-0 flex-1 overflow-y-auto bg-ide-editor px-4 py-3 text-xs leading-5 text-foreground transition-colors",
				className,
			)}
			onClick={() => editor?.chain().focus().run()}
			onKeyDownCapture={handleKeyDownCapture}
			onKeyUpCapture={handleKeyUpCapture}
		>
			<EditorContent editor={editor} />
			{slashState ? (
				<PromptSlashMenu
					items={slashState.items}
					position={slashState.position}
					selectedIndex={slashState.selectedIndex}
					onHover={(index) =>
						setSlashState((state) => (state ? { ...state, selectedIndex: index } : state))
					}
					onSelect={selectSlashItem}
				/>
			) : null}
		</div>
	);
};

export const PromptMarkdownPreview: React.FC<{
	className?: string;
	editorClassName?: string;
	placeholder?: string;
	value: string;
}> = ({ className, editorClassName, placeholder = "暂无提示词。", value }) => {
	const editor = usePromptMarkdownEditor({
		editorClassName,
		editable: false,
		placeholder,
		value,
	});

	return (
		<div
			className={cn(
				"min-h-0 overflow-y-auto px-4 py-3 text-xs leading-6 text-foreground",
				className,
			)}
		>
			<EditorContent editor={editor} />
		</div>
	);
};

const usePromptMarkdownEditor = ({
	editorClassName,
	editable,
	extensions = emptyPromptMarkdownExtensions,
	onChange,
	placeholder,
	value,
}: {
	editorClassName?: string;
	editable: boolean;
	extensions?: Extensions;
	onChange?: (value: string) => void;
	placeholder: string;
	value: string;
}) => {
	const onChangeRef = useRef(onChange);
	const emittedMarkdownRef = useRef(value);
	const resolvedExtensions = useMemo(() => {
		const promptExtensions: Extensions = [
			StarterKit.configure({}),
			...extensions,
			Placeholder.configure({ placeholder }),
			Markdown.configure({
				indentation: {
					style: "space",
					size: 2,
				},
			}),
		];

		return promptExtensions;
	}, [extensions, placeholder]);
	const editor = useEditor(
		{
			editable,
			extensions: resolvedExtensions,
			content: value,
			contentType: "markdown",
			editorProps: {
				attributes: {
					"aria-label": placeholder,
					class: cn(
						"prompt-markdown-prosemirror tiptap-content min-h-full outline-none",
						editorClassName,
					),
				},
			},
			immediatelyRender: false,
			onUpdate: ({ editor: nextEditor }) => {
				if (!editable) return;

				emitPromptMarkdownChange(nextEditor, emittedMarkdownRef, onChangeRef);
			},
			onBlur: ({ editor: nextEditor }) => {
				if (!editable) return;

				emitPromptMarkdownChange(nextEditor, emittedMarkdownRef, onChangeRef, {
					flushDom: true,
				});
			},
		},
		[editable, resolvedExtensions, placeholder, editorClassName],
	);

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	useEffect(() => {
		if (!editor || value === emittedMarkdownRef.current) return;

		emittedMarkdownRef.current = value;
		editor.commands.setContent(value, {
			contentType: "markdown",
			emitUpdate: false,
		});
	}, [editor, value]);

	return editor;
};

const emitPromptMarkdownChange = (
	editor: Pick<Editor, "getMarkdown" | "view">,
	emittedMarkdownRef: React.MutableRefObject<string>,
	onChangeRef: React.MutableRefObject<((value: string) => void) | undefined>,
	options: { flushDom?: boolean } = {},
) => {
	if (options.flushDom) flushPromptEditorDomObserver(editor);

	const markdown = editor.getMarkdown();
	if (markdown === emittedMarkdownRef.current) return;

	emittedMarkdownRef.current = markdown;
	onChangeRef.current?.(markdown);
};

const flushPromptEditorDomObserver = (editor: Pick<Editor, "view">) => {
	const view = editor.view as Editor["view"] & {
		domObserver?: {
			flush?: () => void;
		};
	};

	view.domObserver?.flush?.();
};

const resolvePromptSlashState = (
	editor: Editor | null,
	items: PromptInsertItem[],
): Omit<PromptSlashState, "selectedIndex"> | null => {
	if (!editor || !editor.isEditable || !promptEditorHasDomFocus(editor) || items.length === 0) {
		return null;
	}

	const match = findPromptSlashMatch(editor);
	if (!match) return null;

	return {
		items: filterPromptInsertItems(items, match.query),
		position: promptSlashMenuPosition(editor, match.range),
		query: match.query,
		range: match.range,
	};
};

const findPromptSlashMatch = (editor: Editor): { query: string; range: Range } | null => {
	const { selection } = editor.state;
	if (!selection.empty) return null;

	const $from = selection.$from;
	if (!$from.parent.isTextblock) return null;

	const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, "\n", "\n");
	return findPromptSlashMatchFromText(textBeforeCursor, selection.from);
};

const promptEditorHasDomFocus = (editor: Editor) => {
	const activeElement = editor.view.dom.ownerDocument.activeElement;
	return activeElement === editor.view.dom || editor.view.dom.contains(activeElement);
};

function findPromptSlashMatchFromText(
	textBeforeCursor: string,
	selectionFrom: number,
): { query: string; range: Range } | null {
	const slashIndex = textBeforeCursor.lastIndexOf("/");
	if (slashIndex < 0) return null;

	const previousCharacter = slashIndex > 0 ? textBeforeCursor[slashIndex - 1] : "";
	if (previousCharacter && !/\s/u.test(previousCharacter)) return null;

	const query = textBeforeCursor.slice(slashIndex + 1);
	if (/^\s/u.test(query)) return null;

	const from = selectionFrom - query.length - 1;

	return {
		query,
		range: { from, to: selectionFrom },
	};
}

const promptSlashMenuPosition = (editor: Editor, range: Range): PromptSlashMenuPosition => {
	const coords = editor.view.coordsAtPos(range.from);
	const viewportMargin = 12;
	const menuWidth = Math.min(560, window.innerWidth - viewportMargin * 2);
	const menuHeight = 304;
	const availableBelow = window.innerHeight - coords.bottom;
	const availableAbove = coords.top;
	const placement =
		availableBelow < menuHeight && availableAbove > availableBelow ? "top" : "bottom";
	const left = Math.min(
		Math.max(viewportMargin, coords.left),
		Math.max(viewportMargin, window.innerWidth - menuWidth - viewportMargin),
	);

	return {
		left,
		placement,
		top: placement === "top" ? coords.top - 6 : coords.bottom + 6,
	};
};

interface PromptSlashGroupRange {
	end: number;
	label: string;
	start: number;
}

const movePromptSlashSelectionInGroup = (
	items: PromptInsertItem[],
	selectedIndex: number,
	step: number,
) => {
	const range = promptSlashSelectedGroupRange(items, selectedIndex);
	if (!range) return 0;

	const groupLength = range.end - range.start + 1;
	const offset =
		selectedIndex >= range.start && selectedIndex <= range.end ? selectedIndex - range.start : 0;

	return range.start + ((offset + groupLength + step) % groupLength);
};

const movePromptSlashSelectionGroup = (
	items: PromptInsertItem[],
	selectedIndex: number,
	step: number,
) => {
	const ranges = promptSlashGroupRanges(items);
	if (ranges.length === 0) return 0;

	const currentGroupIndex = Math.max(
		0,
		ranges.findIndex((range) => selectedIndex >= range.start && selectedIndex <= range.end),
	);
	const nextGroupIndex = (currentGroupIndex + ranges.length + step) % ranges.length;
	return ranges[nextGroupIndex]?.start ?? 0;
};

const promptSlashSelectedGroupRange = (
	items: PromptInsertItem[],
	selectedIndex: number,
): PromptSlashGroupRange | null => {
	const ranges = promptSlashGroupRanges(items);
	if (ranges.length === 0) return null;

	return (
		ranges.find((range) => selectedIndex >= range.start && selectedIndex <= range.end) ?? ranges[0]
	);
};

const promptSlashGroupRanges = (items: PromptInsertItem[]): PromptSlashGroupRange[] => {
	const ranges: PromptSlashGroupRange[] = [];

	items.forEach((item, index) => {
		const label = item.categoryLabel || "提示词";
		const lastRange = ranges[ranges.length - 1];

		if (lastRange && lastRange.label === label) {
			lastRange.end = index;
			return;
		}

		ranges.push({ end: index, label, start: index });
	});

	return ranges;
};

export const promptEditorTestInternals = {
	emitPromptMarkdownChange,
	findPromptSlashMatchFromText,
	flushPromptEditorDomObserver,
	movePromptSlashSelectionGroup,
	movePromptSlashSelectionInGroup,
};
