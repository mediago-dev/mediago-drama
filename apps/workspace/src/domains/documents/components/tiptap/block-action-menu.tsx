import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	Check,
	ChevronRight,
	Copy,
	GripVertical,
	Heading1,
	Heading2,
	Heading3,
	IndentDecrease,
	IndentIncrease,
	List,
	ListOrdered,
	MessageSquarePlus,
	ImagePlus,
	Video,
	AudioLines,
	Plus,
	Quote,
	Scissors,
	Trash2,
	Type,
} from "lucide-react";
import type { Editor } from "@tiptap/react";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
	PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";
import {
	activeBlockConversion,
	blockTextAlign,
	canConvertBlock,
	canOutdentBlock,
	convertBlock,
	copyBlock,
	cutBlock,
	deleteBlock,
	indentBlock,
	insertBlockAfter,
	outdentBlock,
	selectBlockText,
	setBlockAlign,
	type BlockAlign,
	type BlockConversion,
} from "./block-actions";
import type { BlockRange, HoveredBlockRect } from "./types";
import { supportsBlockMediaActions } from "./block-action-menu-visibility";

interface BlockActionMenuProps {
	editor: Editor;
	onMouseLeave: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	range: BlockRange;
	rect: HoveredBlockRect;
	onMediaAction?: (kind: "image" | "video" | "audio", range: BlockRange) => void;
}

interface ConversionOption {
	conversion: BlockConversion;
	icon: React.ReactNode;
	label: string;
}

const conversionOptions: ConversionOption[] = [
	{ conversion: { type: "paragraph" }, icon: <Type className="size-4" />, label: "正文" },
	{
		conversion: { type: "heading", level: 1 },
		icon: <Heading1 className="size-4" />,
		label: "一级标题",
	},
	{
		conversion: { type: "heading", level: 2 },
		icon: <Heading2 className="size-4" />,
		label: "二级标题",
	},
	{
		conversion: { type: "heading", level: 3 },
		icon: <Heading3 className="size-4" />,
		label: "三级标题",
	},
	{ conversion: { type: "bulletList" }, icon: <List className="size-4" />, label: "项目列表" },
	{
		conversion: { type: "orderedList" },
		icon: <ListOrdered className="size-4" />,
		label: "编号列表",
	},
	{ conversion: { type: "blockquote" }, icon: <Quote className="size-4" />, label: "引用" },
	{
		conversion: { type: "codeBlock" },
		icon: <span className="font-mono text-xs leading-none">{"{}"}</span>,
		label: "代码块",
	},
];

const alignOptions: Array<{ align: BlockAlign; icon: React.ReactNode; label: string }> = [
	{ align: "left", icon: <AlignLeft className="size-4" />, label: "左对齐" },
	{ align: "center", icon: <AlignCenter className="size-4" />, label: "居中对齐" },
	{ align: "right", icon: <AlignRight className="size-4" />, label: "右对齐" },
];

const blockTypeLabel = (range: BlockRange): string => {
	switch (range.nodeType) {
		case "heading":
			return `H${range.headingLevel ?? 1}`;
		case "bulletList":
		case "orderedList":
			return "列表";
		case "blockquote":
			return "引用";
		case "codeBlock":
			return "代码";
		case "paragraph":
			return "正文";
		default:
			return "块";
	}
};

// The handle trigger is 1.5rem (24px) tall. The editor body renders at a 1.75
// line-height over a 1rem font (see .tiptap-content in tiptap.css), so the first
// text line is ~28px. Center the handle within that first line rather than the
// whole block, otherwise a multi-line paragraph pushes it to its vertical middle.
const TRIGGER_HEIGHT = 24;
const FIRST_LINE_HEIGHT = 28;

const sameConversion = (a: BlockConversion | null, b: BlockConversion): boolean => {
	if (!a || a.type !== b.type) return false;
	if (a.type === "heading" && b.type === "heading") return a.level === b.level;
	return true;
};

export const BlockActionMenu: React.FC<BlockActionMenuProps> = ({
	editor,
	onMouseLeave,
	onOpenChange,
	open,
	range,
	rect,
	onMediaAction,
}) => {
	const active = activeBlockConversion(range);
	const showConversions = canConvertBlock(range);

	const runAndClose = useCallback(
		(action: () => void) => {
			action();
			onOpenChange(false);
		},
		[onOpenChange],
	);

	const handleMediaAction = useCallback(
		(kind: "image" | "video" | "audio") => {
			onMediaAction?.(kind, range);
			onOpenChange(false);
		},
		[onMediaAction, onOpenChange, range],
	);

	const handleComment = useCallback(() => {
		// Selecting the block's text surfaces the existing selection bubble, whose
		// 评论 action drives the full comment-composer flow.
		selectBlockText(editor, range.index);
		onOpenChange(false);
	}, [editor, onOpenChange, range.index]);

	return (
		<div
			className="tiptap-block-menu"
			style={{
				top:
					rect.top + Math.max((Math.min(rect.height, FIRST_LINE_HEIGHT) - TRIGGER_HEIGHT) / 2, 0),
			}}
			onMouseDown={(event) => event.preventDefault()}
			onMouseLeave={onMouseLeave}
		>
			<Popover open={open} onOpenChange={onOpenChange}>
				<PopoverTrigger asChild>
					<button
						type="button"
						className="tiptap-block-menu-trigger"
						aria-label="块操作菜单"
						title="块操作"
					>
						<span className="tiptap-block-menu-trigger-label">{blockTypeLabel(range)}</span>
						<GripVertical className="size-3.5" />
					</button>
				</PopoverTrigger>
				<PopoverContent
					align="start"
					side="left"
					sideOffset={8}
					className="tiptap-block-menu-panel w-56 p-1"
					onCloseAutoFocus={(event) => event.preventDefault()}
				>
					{showConversions ? (
						<>
							<div className="tiptap-block-menu-converts">
								{conversionOptions.map((option) => (
									<button
										key={`${option.conversion.type}:${
											option.conversion.type === "heading" ? option.conversion.level : ""
										}`}
										type="button"
										aria-label={option.label}
										title={option.label}
										aria-pressed={sameConversion(active, option.conversion)}
										className={cn(
											"tiptap-block-menu-convert",
											sameConversion(active, option.conversion) && "is-active",
										)}
										onClick={() =>
											runAndClose(() => convertBlock(editor, range.index, option.conversion))
										}
									>
										{option.icon}
									</button>
								))}
							</div>
							<MenuSeparator />
							<IndentAlignSubmenu editor={editor} index={range.index} onAction={runAndClose} />
							<MenuSeparator />
						</>
					) : null}

					<MenuItem
						icon={<MessageSquarePlus className="size-4" />}
						label="评论"
						onSelect={handleComment}
					/>
					<MenuItem
						icon={<Scissors className="size-4" />}
						label="剪切"
						onSelect={() => runAndClose(() => cutBlock(editor, range.index))}
					/>
					<MenuItem
						icon={<Copy className="size-4" />}
						label="复制"
						onSelect={() => runAndClose(() => copyBlock(editor, range.index))}
					/>
					<MenuSeparator />
					<MenuItem
						icon={<Trash2 className="size-4" />}
						label="删除"
						variant="destructive"
						onSelect={() => runAndClose(() => deleteBlock(editor, range.index))}
					/>
					<MenuSeparator />
					<MenuItem
						icon={<Plus className="size-4" />}
						label="在下方添加"
						onSelect={() => runAndClose(() => insertBlockAfter(editor, range.index))}
					/>
					{onMediaAction && supportsBlockMediaActions(range) ? (
						<>
							<MenuSeparator />
							<MenuItem
								icon={<ImagePlus className="size-4" />}
								label="生成图片"
								onSelect={() => handleMediaAction("image")}
							/>
							<MenuItem
								icon={<Video className="size-4" />}
								label="生成视频"
								onSelect={() => handleMediaAction("video")}
							/>
							<MenuItem
								icon={<AudioLines className="size-4" />}
								label="选择音频"
								onSelect={() => handleMediaAction("audio")}
							/>
						</>
					) : null}
				</PopoverContent>
			</Popover>
		</div>
	);
};

const IndentAlignSubmenu: React.FC<{
	editor: Editor;
	index: number;
	onAction: (action: () => void) => void;
}> = ({ editor, index, onAction }) => {
	const [open, setOpen] = useState(false);
	const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const cancelClose = useCallback(() => {
		if (closeTimerRef.current === null) return;
		clearTimeout(closeTimerRef.current);
		closeTimerRef.current = null;
	}, []);

	const scheduleClose = useCallback(() => {
		cancelClose();
		closeTimerRef.current = setTimeout(() => setOpen(false), 140);
	}, [cancelClose]);

	useEffect(() => cancelClose, [cancelClose]);

	const currentAlign = blockTextAlign(editor, index);
	const canOutdent = canOutdentBlock(editor, index);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverAnchor asChild>
				<button
					type="button"
					className="tiptap-block-menu-item"
					aria-expanded={open}
					onMouseEnter={() => {
						cancelClose();
						setOpen(true);
					}}
					onMouseLeave={scheduleClose}
					onClick={() => setOpen((value) => !value)}
				>
					<span className="tiptap-block-menu-item-icon">
						<AlignLeft className="size-4" />
					</span>
					<span className="tiptap-block-menu-item-label">缩进和对齐</span>
					<ChevronRight className="tiptap-block-menu-trailing size-3.5" />
				</button>
			</PopoverAnchor>
			<PopoverContent
				align="start"
				side="right"
				sideOffset={4}
				className="tiptap-block-menu-panel w-40 p-1"
				onOpenAutoFocus={(event) => event.preventDefault()}
				onCloseAutoFocus={(event) => event.preventDefault()}
				onMouseEnter={cancelClose}
				onMouseLeave={scheduleClose}
			>
				{alignOptions.map((option) => (
					<MenuItem
						key={option.align}
						icon={option.icon}
						label={option.label}
						active={currentAlign === option.align}
						onSelect={() => onAction(() => setBlockAlign(editor, index, option.align))}
					/>
				))}
				<MenuSeparator />
				<MenuItem
					icon={<IndentIncrease className="size-4" />}
					label="增加缩进"
					onSelect={() => onAction(() => indentBlock(editor, index))}
				/>
				<MenuItem
					icon={<IndentDecrease className="size-4" />}
					label="减少缩进"
					disabled={!canOutdent}
					onSelect={() => onAction(() => outdentBlock(editor, index))}
				/>
			</PopoverContent>
		</Popover>
	);
};

const MenuItem: React.FC<{
	active?: boolean;
	disabled?: boolean;
	icon: React.ReactNode;
	label: string;
	onSelect: () => void;
	variant?: "default" | "destructive";
}> = ({ active = false, disabled = false, icon, label, onSelect, variant = "default" }) => (
	<button
		type="button"
		disabled={disabled}
		aria-pressed={active}
		className={cn(
			"tiptap-block-menu-item",
			variant === "destructive" && "is-destructive",
			disabled && "is-disabled",
		)}
		onClick={disabled ? undefined : onSelect}
	>
		<span className="tiptap-block-menu-item-icon">{icon}</span>
		<span className="tiptap-block-menu-item-label">{label}</span>
		{active ? <Check className="tiptap-block-menu-trailing size-3.5" /> : null}
	</button>
);

const MenuSeparator: React.FC = () => <div className="tiptap-block-menu-separator" />;
