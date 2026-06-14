import type { Editor, JSONContent, Range } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Library, Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "@/styles/tiptap-prompt-slash.css";

export interface PromptInsertItem {
	id: string;
	layerLabel: string;
	name: string;
	prompt: string;
	sourceLabel?: string;
}

export interface PromptSlashMenuPosition {
	left: number;
	placement: "bottom" | "top";
	top: number;
}

export interface PromptSlashMenuProps {
	items: PromptInsertItem[];
	onHover: (index: number) => void;
	onSelect: (item: PromptInsertItem) => void;
	position: PromptSlashMenuPosition;
	selectedIndex: number;
}

const maxPromptSlashItems = 40;

export const PromptSlashMenu: React.FC<PromptSlashMenuProps> = ({
	items,
	onHover,
	onSelect,
	position,
	selectedIndex,
}) => {
	const menuRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const selectedElement = menuRef.current?.querySelector<HTMLElement>(
			".prompt-slash-option[data-selected='true']",
		);
		selectedElement?.scrollIntoView?.({ block: "nearest" });
	}, [selectedIndex, items]);

	if (typeof document === "undefined") return null;

	return createPortal(
		<div
			ref={menuRef}
			className="prompt-slash-menu-layer"
			data-placement={position.placement}
			role="presentation"
			style={{
				left: position.left,
				top: position.top,
			}}
			onClick={stopPromptSlashEvent}
			onMouseDown={stopPromptSlashEvent}
			onPointerDown={stopPromptSlashEvent}
			onWheel={stopPromptSlashEvent}
		>
			{items.length === 0 ? (
				<div className="prompt-slash-menu-empty">无匹配提示词</div>
			) : (
				<PromptSlashOptions
					items={items}
					selectedIndex={selectedIndex}
					onHover={onHover}
					onSelect={onSelect}
				/>
			)}
		</div>,
		document.body,
	);
};

const PromptSlashOptions: React.FC<{
	items: PromptInsertItem[];
	onHover: (index: number) => void;
	onSelect: (item: PromptInsertItem) => void;
	selectedIndex: number;
}> = ({ items, onHover, onSelect, selectedIndex }) => {
	let previousLayer = "";

	return (
		<div className="prompt-slash-menu" role="listbox">
			{items.map((item, index) => {
				const showGroup = item.layerLabel !== previousLayer;
				previousLayer = item.layerLabel;
				const selected = index === selectedIndex;
				const Icon = item.layerLabel === "风格" ? Sparkles : Library;

				return (
					<div key={item.id}>
						{showGroup ? <div className="prompt-slash-group">{item.layerLabel}</div> : null}
						<button
							type="button"
							className="prompt-slash-option"
							data-selected={selected ? "true" : "false"}
							role="option"
							aria-selected={selected}
							onMouseEnter={() => onHover(index)}
							onMouseDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
								onSelect(item);
							}}
							onClick={stopPromptSlashEvent}
						>
							<Icon className="prompt-slash-option-icon" />
							<span className="prompt-slash-option-body">
								<span className="prompt-slash-option-title">{item.name}</span>
								<span className="prompt-slash-option-meta">
									{item.sourceLabel ? `${item.layerLabel} · ${item.sourceLabel}` : item.layerLabel}
								</span>
								<span className="prompt-slash-option-preview">{promptPreview(item.prompt)}</span>
							</span>
						</button>
					</div>
				);
			})}
		</div>
	);
};

const stopPromptSlashEvent = (event: React.SyntheticEvent) => {
	event.stopPropagation();
};

export const filterPromptInsertItems = (items: PromptInsertItem[], query: string) => {
	const normalizedQuery = normalizePromptSearchText(query);
	if (!normalizedQuery) return items.slice(0, maxPromptSlashItems);

	return items
		.filter((item) =>
			[item.name, item.layerLabel, item.sourceLabel ?? "", item.prompt].some((value) =>
				normalizePromptSearchText(value).includes(normalizedQuery),
			),
		)
		.slice(0, maxPromptSlashItems);
};

export const insertPromptItem = (editor: Editor, range: Range, item: PromptInsertItem) => {
	const prompt = item.prompt.trim();
	if (!prompt) return;

	const parsedContent = parsePromptMarkdown(editor, prompt);
	if (parsedContent) {
		editor.chain().focus().insertContentAt(range, parsedContent, { updateSelection: true }).run();
		return;
	}

	const tr = editor.state.tr.insertText(prompt, range.from, range.to);
	const selectionPos = Math.min(range.from + prompt.length, tr.doc.content.size);
	tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos)));
	editor.view.dispatch(tr);
	editor.view.focus();
};

const parsePromptMarkdown = (
	editor: Editor,
	prompt: string,
): JSONContent[] | JSONContent | null => {
	const markdown = (
		editor as Editor & {
			markdown?: { parse: (value: string) => JSONContent };
		}
	).markdown;
	if (!markdown) return null;

	try {
		const parsed = markdown.parse(prompt);
		if (parsed.type === "doc") return parsed.content ?? [];
		return parsed;
	} catch {
		return null;
	}
};

const normalizePromptSearchText = (value: string) => value.trim().toLocaleLowerCase("zh-Hans-CN");

const promptPreview = (prompt: string) =>
	prompt
		.split(/\r\n|\r|\n/u)
		.map((line) => line.trim())
		.find(Boolean) ?? "空提示词";

export const promptSlashCommandTestInternals = {
	filterPromptInsertItems,
	insertPromptItem,
};
