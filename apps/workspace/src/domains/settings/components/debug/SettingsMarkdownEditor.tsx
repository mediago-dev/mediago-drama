import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/shared/lib/utils";
import "@/styles/tiptap.css";

export interface SettingsMarkdownEditorProps {
	ariaLabel?: string;
	ariaLabelledBy?: string;
	className?: string;
	onChange: (value: string) => void;
	placeholder?: string;
	value: string;
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
	onChange,
	placeholder = "编写 Markdown...",
	value,
}) => {
	const editor = useSettingsMarkdownEditor({
		ariaLabel,
		ariaLabelledBy,
		editable: true,
		onChange,
		placeholder,
		value,
	});

	return (
		<div
			className={cn(
				"min-h-[560px] overflow-y-auto rounded-md border border-input bg-ide-editor px-4 py-3 text-sm leading-6 text-foreground shadow-sm transition-[border-color,box-shadow] focus-within:border-ring",
				className,
			)}
			onClick={() => editor?.chain().focus().run()}
		>
			<EditorContent editor={editor} />
		</div>
	);
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
		if (!editor || value === emittedMarkdownRef.current) return;

		emittedMarkdownRef.current = value;
		editor.commands.setContent(value, {
			contentType: "markdown",
			emitUpdate: false,
		});
	}, [editor, value]);

	return editor;
};
