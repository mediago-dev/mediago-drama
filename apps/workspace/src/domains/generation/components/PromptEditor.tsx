import type { Extensions } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/shared/lib/utils";
import "@/styles/tiptap.css";

export interface PromptEditorProps {
	className?: string;
	editorClassName?: string;
	extensions?: Extensions;
	onChange: (value: string) => void;
	placeholder: string;
	value: string;
}

const emptyPromptMarkdownExtensions: Extensions = [];

export const PromptEditor: React.FC<PromptEditorProps> = ({
	className,
	editorClassName,
	extensions,
	onChange,
	placeholder,
	value,
}) => {
	const editor = usePromptMarkdownEditor({
		editorClassName,
		editable: true,
		extensions,
		onChange,
		placeholder,
		value,
	});

	return (
		<div
			className={cn(
				"min-h-0 flex-1 overflow-y-auto bg-ide-editor px-4 py-3 text-xs leading-5 text-foreground transition-colors",
				className,
			)}
			onClick={() => editor?.chain().focus().run()}
		>
			<EditorContent editor={editor} />
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
	const resolvedExtensions = useMemo(
		() => [
			StarterKit.configure({}),
			...extensions,
			Placeholder.configure({ placeholder }),
			Markdown.configure({
				indentation: {
					style: "space",
					size: 2,
				},
			}),
		],
		[extensions, placeholder],
	);
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

				const markdown = nextEditor.getMarkdown();
				emittedMarkdownRef.current = markdown;
				onChangeRef.current?.(markdown);
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
		});
	}, [editor, value]);

	return editor;
};
