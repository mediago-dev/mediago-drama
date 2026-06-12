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

export const SettingsMarkdownEditor: React.FC<SettingsMarkdownEditorProps> = ({
	ariaLabel = "Markdown 编辑器",
	ariaLabelledBy,
	className,
	onChange,
	placeholder = "编写 Markdown...",
	value,
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
					openOnClick: false,
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
		[placeholder],
	);
	const editor = useEditor(
		{
			extensions,
			content: value,
			contentType: "markdown",
			editorProps: {
				attributes: {
					...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : { "aria-label": ariaLabel }),
					class: "settings-markdown-prosemirror tiptap-content min-h-full outline-none",
				},
			},
			immediatelyRender: false,
			onUpdate: ({ editor: nextEditor }) => {
				const markdown = nextEditor.getMarkdown();
				emittedMarkdownRef.current = markdown;
				onChangeRef.current(markdown);
			},
		},
		[ariaLabel, ariaLabelledBy, extensions],
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
