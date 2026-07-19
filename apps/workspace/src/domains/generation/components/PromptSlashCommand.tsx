import type { Editor, JSONContent, Range } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { ChevronRight, Library, Sparkles, type LucideIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import "@/styles/tiptap-prompt-slash.css";
import type { GenerationContentSourceRef } from "@/domains/generation/api/generation";
import { useCascadedPickerHoverIntent } from "./cascadedPickerSafeTriangle";

export interface PromptInsertItem {
	id: string;
	categoryLabel: string;
	name: string;
	prompt: string;
	sourceRef?: GenerationContentSourceRef;
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

interface PromptInsertIndexedItem {
	index: number;
	item: PromptInsertItem;
}

interface PromptInsertGroup {
	icon: LucideIcon;
	id: string;
	items: PromptInsertIndexedItem[];
	label: string;
	meta: string;
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
	const groups = useMemo(() => groupPromptInsertItems(items), [items]);
	const selectedGroupIndex = promptSlashSelectedGroupIndex(groups, selectedIndex);
	const activeGroup = groups[selectedGroupIndex] ?? groups[0];

	useEffect(() => {
		const selectedElement = menuRef.current?.querySelector<HTMLElement>(
			".prompt-slash-option[data-selected='true']",
		);
		selectedElement?.scrollIntoView?.({ block: "nearest" });
	}, [selectedIndex, items, selectedGroupIndex]);

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
					activeGroup={activeGroup}
					groups={groups}
					selectedGroupIndex={selectedGroupIndex}
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
	activeGroup?: PromptInsertGroup;
	groups: PromptInsertGroup[];
	onHover: (index: number) => void;
	onSelect: (item: PromptInsertItem) => void;
	selectedGroupIndex: number;
	selectedIndex: number;
}> = ({ activeGroup, groups, onHover, onSelect, selectedGroupIndex, selectedIndex }) => {
	const {
		clearHoverIntent,
		handleSourcePanePointerEnter,
		handleSourcePointerEnter,
		handleSourcePointerMove,
		handleSubmenuPointerLeave,
		registerSourceButton,
		sourcePaneRef,
		submenuRef,
		suppressedSourceHoverId,
	} = useCascadedPickerHoverIntent({
		activeSourceId: activeGroup?.id,
		onActivateSource: (groupId) => {
			const group = groups.find((candidate) => candidate.id === groupId);
			onHover(group?.items[0]?.index ?? 0);
		},
	});

	return (
		<div className="prompt-slash-cascader" onPointerLeave={clearHoverIntent}>
			<div
				ref={sourcePaneRef as React.RefObject<HTMLDivElement | null>}
				className="prompt-slash-pane prompt-slash-primary"
				onPointerEnter={handleSourcePanePointerEnter}
			>
				<div className="prompt-slash-pane-label">分类</div>
				{groups.map((group, index) => {
					const Icon = group.icon;

					return (
						<button
							key={group.id}
							ref={(node) => registerSourceButton(group.id, node)}
							aria-label={`${group.label} ${group.meta}`}
							className="prompt-slash-source"
							data-hover-suppressed={group.id === suppressedSourceHoverId ? "true" : "false"}
							data-selected={index === selectedGroupIndex ? "true" : "false"}
							onMouseDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
							}}
							onPointerEnter={(event) => handleSourcePointerEnter(group.id, event)}
							onPointerMove={(event) => handleSourcePointerMove(group.id, event)}
							onClick={stopPromptSlashEvent}
							type="button"
						>
							<Icon className="prompt-slash-source-icon" />
							<span className="prompt-slash-source-body">
								<span className="prompt-slash-source-title">{group.label}</span>
								<span className="prompt-slash-source-meta">{group.meta}</span>
							</span>
							<ChevronRight className="prompt-slash-source-chevron" />
						</button>
					);
				})}
			</div>
			<div
				ref={submenuRef as React.RefObject<HTMLDivElement | null>}
				className="prompt-slash-pane prompt-slash-secondary"
				role="listbox"
				onPointerEnter={clearHoverIntent}
				onPointerLeave={handleSubmenuPointerLeave}
			>
				<div className="prompt-slash-pane-label">提示词</div>
				{activeGroup?.items.map(({ index, item }) => {
					const selected = index === selectedIndex;
					const Icon = promptSlashItemIcon(item);

					return (
						<button
							key={item.id}
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
									{item.sourceLabel
										? `${item.categoryLabel} · ${item.sourceLabel}`
										: item.categoryLabel}
								</span>
								<span className="prompt-slash-option-preview">{promptPreview(item.prompt)}</span>
							</span>
						</button>
					);
				})}
			</div>
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
			[item.name, item.categoryLabel, item.sourceLabel ?? "", item.prompt].some((value) =>
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

const groupPromptInsertItems = (items: PromptInsertItem[]): PromptInsertGroup[] => {
	const groups: PromptInsertGroup[] = [];
	const groupById = new Map<string, PromptInsertGroup>();

	items.forEach((item, index) => {
		const label = item.categoryLabel || "提示词";
		let group = groupById.get(label);

		if (!group) {
			group = {
				icon: promptSlashItemIcon(item),
				id: label,
				items: [],
				label,
				meta: "",
			};
			groupById.set(label, group);
			groups.push(group);
		}

		group.items.push({ index, item });
		group.meta = `${group.items.length} 项`;
	});

	return groups;
};

const promptSlashSelectedGroupIndex = (groups: PromptInsertGroup[], selectedIndex: number) => {
	const index = groups.findIndex((group) =>
		group.items.some((groupItem) => groupItem.index === selectedIndex),
	);
	return index >= 0 ? index : 0;
};

const promptSlashItemIcon = (item: PromptInsertItem) =>
	item.categoryLabel === "风格" ? Sparkles : Library;

const promptPreview = (prompt: string) =>
	prompt
		.split(/\r\n|\r|\n/u)
		.map((line) => line.trim())
		.find(Boolean) ?? "空提示词";

export const promptSlashCommandTestInternals = {
	filterPromptInsertItems,
	groupPromptInsertItems,
	insertPromptItem,
	promptSlashSelectedGroupIndex,
};
