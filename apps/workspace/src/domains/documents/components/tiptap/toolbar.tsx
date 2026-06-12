import type React from "react";
import { useCallback, useState } from "react";
import {
	Heading1,
	Heading2,
	Heading3,
	Heading4,
	ImageIcon,
	Link2,
	List,
	ListOrdered,
	Quote,
	Table2,
	Type,
} from "lucide-react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { cn } from "@/shared/lib/utils";

export const TiptapToolbar: React.FC<{ editor: Editor | null }> = ({ editor }) => {
	const [activePopover, setActivePopover] = useState<"link" | "image" | null>(null);
	const [linkValue, setLinkValue] = useState("");
	const [imageValue, setImageValue] = useState("");
	const toolbarState =
		useEditorState<ToolbarState>({
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
					heading4: currentEditor.isActive("heading", { level: 4 }),
					link: currentEditor.isActive("link"),
					orderedList: currentEditor.isActive("orderedList"),
					paragraph: currentEditor.isActive("paragraph"),
				};
			},
		}) ?? inactiveToolbarState;

	const openLinkPopover = useCallback(() => {
		if (!editor) return;

		const currentHref = editor.getAttributes("link").href as string | undefined;
		setLinkValue(currentHref ?? "");
		setImageValue("");
		setActivePopover("link");
	}, [editor]);

	const openImagePopover = useCallback(() => {
		setImageValue("");
		setLinkValue("");
		setActivePopover("image");
	}, []);

	const applyLink = useCallback(() => {
		if (!editor) return;

		const href = linkValue.trim();
		if (href === "") {
			editor.chain().focus().extendMarkRange("link").unsetLink().run();
			setActivePopover(null);
			return;
		}

		editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
		setActivePopover(null);
	}, [editor, linkValue]);

	const applyImage = useCallback(() => {
		if (!editor) return;

		const src = imageValue.trim();
		if (!src) return;

		editor.chain().focus().setImage({ src }).run();
		setActivePopover(null);
	}, [editor, imageValue]);

	return (
		<div className="tiptap-toolbar" aria-label="编辑器格式工具栏">
			<ToolbarButton
				label="段落"
				active={toolbarState.paragraph}
				onClick={() => editor?.chain().focus().setParagraph().run()}
			>
				<Type className="size-4" />
			</ToolbarButton>
			<ToolbarButton
				label="一级标题"
				active={toolbarState.heading1}
				onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
			>
				<Heading1 className="size-4" />
			</ToolbarButton>
			<ToolbarButton
				label="二级标题"
				active={toolbarState.heading2}
				onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
			>
				<Heading2 className="size-4" />
			</ToolbarButton>
			<ToolbarButton
				label="三级标题"
				active={toolbarState.heading3}
				onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
			>
				<Heading3 className="size-4" />
			</ToolbarButton>
			<ToolbarButton
				label="四级标题"
				active={toolbarState.heading4}
				onClick={() => editor?.chain().focus().toggleHeading({ level: 4 }).run()}
			>
				<Heading4 className="size-4" />
			</ToolbarButton>
			<ToolbarSeparator />
			<ToolbarButton
				label="项目列表"
				active={toolbarState.bulletList}
				onClick={() => editor?.chain().focus().toggleBulletList().run()}
			>
				<List className="size-4" />
			</ToolbarButton>
			<ToolbarButton
				label="编号列表"
				active={toolbarState.orderedList}
				onClick={() => editor?.chain().focus().toggleOrderedList().run()}
			>
				<ListOrdered className="size-4" />
			</ToolbarButton>
			<ToolbarButton
				label="引用"
				active={toolbarState.blockquote}
				onClick={() => editor?.chain().focus().toggleBlockquote().run()}
			>
				<Quote className="size-4" />
			</ToolbarButton>
			<ToolbarButton
				label="代码块"
				active={toolbarState.codeBlock}
				onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
			>
				<span className="font-mono text-sm">{"{}"}</span>
			</ToolbarButton>
			<ToolbarSeparator />
			<div className="relative inline-flex">
				<ToolbarButton label="链接" active={toolbarState.link} onClick={openLinkPopover}>
					<Link2 className="size-4" />
				</ToolbarButton>
				{activePopover === "link" ? (
					<ToolbarInlinePopover
						label="链接地址"
						placeholder="https://example.com"
						value={linkValue}
						onChange={setLinkValue}
						onCancel={() => setActivePopover(null)}
						onSubmit={applyLink}
						submitLabel={linkValue.trim() ? "应用" : "移除"}
					/>
				) : null}
			</div>
			<ToolbarButton
				label="表格"
				onClick={() =>
					editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
				}
			>
				<Table2 className="size-4" />
			</ToolbarButton>
			<div className="relative inline-flex">
				<ToolbarButton label="图片" onClick={openImagePopover}>
					<ImageIcon className="size-4" />
				</ToolbarButton>
				{activePopover === "image" ? (
					<ToolbarInlinePopover
						label="图片地址"
						placeholder="https://example.com/image.png"
						value={imageValue}
						onChange={setImageValue}
						onCancel={() => setActivePopover(null)}
						onSubmit={applyImage}
						submitLabel="插入"
					/>
				) : null}
			</div>
		</div>
	);
};

const ToolbarInlinePopover: React.FC<{
	label: string;
	onCancel: () => void;
	onChange: (value: string) => void;
	onSubmit: () => void;
	placeholder: string;
	submitLabel: string;
	value: string;
}> = ({ label, onCancel, onChange, onSubmit, placeholder, submitLabel, value }) => (
	<form
		className="tiptap-toolbar-popover"
		onMouseDown={(event) => event.stopPropagation()}
		onSubmit={(event) => {
			event.preventDefault();
			onSubmit();
		}}
	>
		<label className="block text-caption font-medium text-muted-foreground">
			<span>{label}</span>
			<input
				autoFocus
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				className="mt-1 h-7 w-64 rounded-sm border border-input bg-ide-editor px-2 font-mono text-xs text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-ring focus:ring-0"
			/>
		</label>
		<div className="mt-2 flex justify-end gap-1.5">
			<button type="button" className="tiptap-toolbar-popover-button" onClick={onCancel}>
				取消
			</button>
			<button type="submit" className="tiptap-toolbar-popover-button-primary">
				{submitLabel}
			</button>
		</div>
	</form>
);

interface ToolbarState {
	blockquote: boolean;
	bulletList: boolean;
	codeBlock: boolean;
	heading1: boolean;
	heading2: boolean;
	heading3: boolean;
	heading4: boolean;
	link: boolean;
	orderedList: boolean;
	paragraph: boolean;
}

const inactiveToolbarState: ToolbarState = {
	blockquote: false,
	bulletList: false,
	codeBlock: false,
	heading1: false,
	heading2: false,
	heading3: false,
	heading4: false,
	link: false,
	orderedList: false,
	paragraph: false,
};

interface ToolbarButtonProps {
	active?: boolean;
	children: React.ReactNode;
	label: string;
	onClick: () => void;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ active, children, label, onClick }) => (
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

const ToolbarSeparator: React.FC = () => <div className="mx-1 h-5 w-px bg-border" />;
