import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, type Editor, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Code2, Heading1, Heading2, Heading3, List, ListOrdered, Quote, Type } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/shared/lib/utils";
import "@/styles/tiptap.css";

export interface SettingsMarkdownEditorProps {
	ariaLabel?: string;
	ariaLabelledBy?: string;
	className?: string;
	editable?: boolean;
	editorClassName?: string;
	onChange: (value: string) => void;
	placeholder?: string;
	showToolbar?: boolean;
	value: string;
	variant?: "document" | "panel";
}

export interface SettingsMarkdownPreviewProps {
	ariaLabel?: string;
	ariaLabelledBy?: string;
	className?: string;
	editorClassName?: string;
	placeholder?: string;
	value: string;
}

export const SettingsMarkdownEditor: React.FC<SettingsMarkdownEditorProps> = ({
	ariaLabel = "Markdown 编辑器",
	ariaLabelledBy,
	className,
	editable = true,
	editorClassName,
	onChange,
	placeholder = "编写 Markdown...",
	showToolbar = false,
	value,
	variant = "panel",
}) => {
	const editor = useSettingsMarkdownEditor({
		ariaLabel,
		ariaLabelledBy,
		editable,
		editorClassName,
		onChange,
		placeholder,
		value,
	});

	return (
		<div
			className={cn(
				variant === "document"
					? "min-h-[560px] bg-transparent text-base leading-7 text-foreground"
					: "min-h-[560px] overflow-y-auto rounded-md border border-input bg-ide-editor px-4 py-3 text-sm leading-6 text-foreground shadow-sm transition-[border-color,box-shadow] focus-within:border-ring",
				className,
			)}
			onClick={() => {
				if (editable) editor?.chain().focus().run();
			}}
		>
			{showToolbar && editable ? <SettingsMarkdownToolbar editor={editor} /> : null}
			<div className={cn(variant === "document" && "pt-5")}>
				<EditorContent editor={editor} />
			</div>
		</div>
	);
};

const SettingsMarkdownToolbar: React.FC<{ editor: Editor | null }> = ({ editor }) => {
	const state =
		useEditorState<SettingsToolbarState>({
			editor,
			selector: ({ editor: currentEditor }) => {
				if (!currentEditor) return inactiveToolbarState;
				return {
					blockquote: currentEditor.isActive("blockquote"),
					bulletList: currentEditor.isActive("bulletList"),
					codeBlock: currentEditor.isActive("codeBlock"),
					heading1: currentEditor.isActive("heading", { level: 1 }),
					heading2: currentEditor.isActive("heading", { level: 2 }),
					heading3: currentEditor.isActive("heading", { level: 3 }),
					orderedList: currentEditor.isActive("orderedList"),
					paragraph: currentEditor.isActive("paragraph"),
				};
			},
		}) ?? inactiveToolbarState;

	return (
		<div
			className="sticky top-0 z-10 flex min-h-10 items-center gap-0.5 border-b border-border bg-ide-editor/95 py-1 backdrop-blur-sm"
			aria-label="编辑器格式工具栏"
		>
			<SettingsToolbarButton
				active={state.paragraph}
				label="正文"
				onClick={() => editor?.chain().focus().setParagraph().run()}
			>
				<Type className="size-4" />
			</SettingsToolbarButton>
			<SettingsToolbarButton
				active={state.heading1}
				label="一级标题"
				onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
			>
				<Heading1 className="size-4" />
			</SettingsToolbarButton>
			<SettingsToolbarButton
				active={state.heading2}
				label="二级标题"
				onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
			>
				<Heading2 className="size-4" />
			</SettingsToolbarButton>
			<SettingsToolbarButton
				active={state.heading3}
				label="三级标题"
				onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
			>
				<Heading3 className="size-4" />
			</SettingsToolbarButton>
			<SettingsToolbarSeparator />
			<SettingsToolbarButton
				active={state.bulletList}
				label="项目列表"
				onClick={() => editor?.chain().focus().toggleBulletList().run()}
			>
				<List className="size-4" />
			</SettingsToolbarButton>
			<SettingsToolbarButton
				active={state.orderedList}
				label="编号列表"
				onClick={() => editor?.chain().focus().toggleOrderedList().run()}
			>
				<ListOrdered className="size-4" />
			</SettingsToolbarButton>
			<SettingsToolbarButton
				active={state.blockquote}
				label="引用"
				onClick={() => editor?.chain().focus().toggleBlockquote().run()}
			>
				<Quote className="size-4" />
			</SettingsToolbarButton>
			<SettingsToolbarButton
				active={state.codeBlock}
				label="代码块"
				onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
			>
				<Code2 className="size-4" />
			</SettingsToolbarButton>
		</div>
	);
};

interface SettingsToolbarButtonProps {
	active?: boolean;
	children: React.ReactNode;
	label: string;
	onClick: () => void;
}

const SettingsToolbarButton: React.FC<SettingsToolbarButtonProps> = ({
	active,
	children,
	label,
	onClick,
}) => (
	<button
		type="button"
		aria-label={label}
		title={label}
		onMouseDown={(event) => event.preventDefault()}
		onClick={onClick}
		className={cn(
			"inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground",
			active && "bg-ide-list-active text-ide-list-active-foreground",
		)}
	>
		{children}
	</button>
);

const SettingsToolbarSeparator: React.FC = () => <span className="mx-1 h-5 w-px bg-border" />;

interface SettingsToolbarState {
	blockquote: boolean;
	bulletList: boolean;
	codeBlock: boolean;
	heading1: boolean;
	heading2: boolean;
	heading3: boolean;
	orderedList: boolean;
	paragraph: boolean;
}

const inactiveToolbarState: SettingsToolbarState = {
	blockquote: false,
	bulletList: false,
	codeBlock: false,
	heading1: false,
	heading2: false,
	heading3: false,
	orderedList: false,
	paragraph: false,
};

export const SettingsMarkdownPreview: React.FC<SettingsMarkdownPreviewProps> = ({
	ariaLabel = "Markdown 预览",
	ariaLabelledBy,
	className,
	editorClassName,
	placeholder = "暂无内容。",
	value,
}) => {
	const editor = useSettingsMarkdownEditor({
		ariaLabel,
		ariaLabelledBy,
		editable: false,
		editorClassName,
		placeholder,
		value,
	});

	return (
		<div
			className={cn(
				"min-h-40 overflow-y-auto rounded-md border border-border bg-ide-panel px-3 py-2 text-sm leading-6 text-foreground",
				className,
			)}
		>
			<EditorContent editor={editor} />
		</div>
	);
};

const useSettingsMarkdownEditor = ({
	ariaLabel,
	ariaLabelledBy,
	editable,
	editorClassName,
	onChange,
	placeholder,
	value,
}: {
	ariaLabel: string;
	ariaLabelledBy?: string;
	editable: boolean;
	editorClassName?: string;
	onChange?: (value: string) => void;
	placeholder: string;
	value: string;
}) => {
	const onChangeRef = useRef(onChange);
	const emittedMarkdownRef = useRef(value);
	const extensions = useMemo(
		() => [
			StarterKit.configure({
				link: {
					autolink: true,
					defaultProtocol: "https",
					enableClickSelection: true,
					linkOnPaste: true,
					openOnClick: !editable,
				},
			}),
			Placeholder.configure({ placeholder }),
			Markdown.configure({
				indentation: {
					style: "space",
					size: 2,
				},
			}),
		],
		[editable, placeholder],
	);
	const editor = useEditor(
		{
			editable,
			extensions,
			content: value,
			contentType: "markdown",
			editorProps: {
				attributes: {
					...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : { "aria-label": ariaLabel }),
					class: cn(
						"settings-markdown-prosemirror tiptap-content min-h-full outline-none",
						editorClassName,
					),
				},
			},
			immediatelyRender: false,
			onUpdate: ({ editor: nextEditor }) => {
				if (!editable) return;

				const markdown = nextEditor.getMarkdown();
				emittedMarkdownRef.current = markdown;
				onChangeRef.current?.(markdown);
			},
		},
		[ariaLabel, ariaLabelledBy, editable, editorClassName, extensions],
	);

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	useEffect(() => {
		if (!editor || editor.isDestroyed || value === emittedMarkdownRef.current) return;

		emittedMarkdownRef.current = value;
		editor.commands.setContent(value, {
			contentType: "markdown",
			emitUpdate: false,
		});
	}, [editor, value]);

	return editor;
};
