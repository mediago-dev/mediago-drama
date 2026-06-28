import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
} from "react";
import { Node as TiptapNode, type Range } from "@tiptap/core";
import { EditorContent, type Editor, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import type { SuggestionOptions } from "@tiptap/suggestion";
import {
	AgentSkillSlashMenu,
	filterAgentSkillSlashItems,
	type AgentSkillSlashItem,
	type AgentSkillSlashMenuPosition,
} from "@/domains/agent/components/AgentSkillSlashMenu";
import type { AgentReference } from "@/domains/agent/api/agent";
import {
	createMentionSuggestion,
	fallbackMentionCategory,
	mentionDisplayText,
	referenceFromMentionNode,
	renderDataAttribute,
} from "@/domains/documents/lib/mention-suggestion";
import { cn } from "@/shared/lib/utils";
import "@/styles/tiptap-mention.css";

export interface AgentComposerValue {
	displayText: string;
	references: AgentReference[];
	text: string;
}

export interface AgentComposerState {
	hasText: boolean;
	referenceCount: number;
}

export interface AgentComposerHandle {
	clear(): void;
	focus(): void;
	getValue(): AgentComposerValue;
	seed(seed: AgentComposerSeedInput): boolean;
}

export interface AgentComposerSeedInput {
	reference?: AgentReference;
	text?: string;
}

interface AgentComposerProps {
	className?: string;
	disabled?: boolean;
	onChange?: (state: AgentComposerState) => void;
	onSubmit?: () => void;
	placeholder?: string;
	skillItems?: AgentSkillSlashItem[];
	skillsErrorMessage?: string;
	skillsLoading?: boolean;
}

interface AgentSkillSlashState {
	items: AgentSkillSlashItem[];
	position: AgentSkillSlashMenuPosition;
	query: string;
	range: Range;
	selectedIndex: number;
}

const emptyAgentSkillSlashItems: AgentSkillSlashItem[] = [];

const AgentSkill = TiptapNode.create({
	name: "skill",
	group: "inline",
	inline: true,
	atom: true,
	selectable: false,
	addAttributes() {
		return {
			name: {
				default: "",
				parseHTML: (element: HTMLElement) => element.getAttribute("data-agent-skill-name") ?? "",
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-agent-skill-name", attributes.name),
			},
			title: {
				default: "",
				parseHTML: (element: HTMLElement) => element.getAttribute("data-agent-skill-title") ?? "",
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-agent-skill-title", attributes.title),
			},
		};
	},
	parseHTML() {
		return [{ tag: "span[data-agent-skill-name]" }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return [
			"span",
			{
				...HTMLAttributes,
				class: "agent-skill-chip",
				contenteditable: "false",
			},
			["span", { class: "agent-skill-chip-icon", "aria-hidden": "true" }],
			["span", { class: "agent-skill-chip-title" }, agentSkillDisplayLabel(node.attrs)],
		];
	},
	renderText({ node }) {
		return agentSkillDisplayLabel(node.attrs);
	},
});

const AgentMention = Mention.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			blockId: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute("data-block-id"),
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-block-id", attributes.blockId),
			},
			assetId: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute("data-asset-id"),
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-asset-id", attributes.assetId),
			},
			assetKind: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute("data-asset-kind"),
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-asset-kind", attributes.assetKind),
			},
			category: {
				default: fallbackMentionCategory,
				parseHTML: (element: HTMLElement) =>
					element.getAttribute("data-category") ?? fallbackMentionCategory,
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-category", attributes.category),
			},
			documentId: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute("data-document-id"),
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-document-id", attributes.documentId),
			},
			mimeType: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute("data-mime-type"),
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-mime-type", attributes.mimeType),
			},
			kind: {
				default: "document",
				parseHTML: (element: HTMLElement) => element.getAttribute("data-kind") ?? "document",
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-kind", attributes.kind),
			},
			title: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute("data-title"),
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-title", attributes.title),
			},
			url: {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute("data-url"),
				renderHTML: (attributes: Record<string, unknown>) =>
					renderDataAttribute("data-url", attributes.url),
			},
		};
	},
}).configure({
	deleteTriggerWithBackspace: true,
	HTMLAttributes: {
		class: "agent-reference-mention",
	},
	renderHTML: ({ node, options }) => [
		"span",
		options.HTMLAttributes,
		mentionDisplayText(node.attrs.title ?? node.attrs.label ?? node.attrs.id),
	],
	renderText: ({ node }) =>
		mentionDisplayText(node.attrs.title ?? node.attrs.label ?? node.attrs.id),
	suggestion: createMentionSuggestion() as Omit<SuggestionOptions, "editor">,
});

export const AgentComposer = forwardRef<AgentComposerHandle, AgentComposerProps>(
	function AgentComposer(
		{
			className,
			disabled = false,
			onChange,
			onSubmit,
			placeholder = "告诉智能体要在当前文档中插入或改写什么",
			skillItems = emptyAgentSkillSlashItems,
			skillsErrorMessage,
			skillsLoading = false,
		},
		ref,
	) {
		const onChangeRef = useRef(onChange);
		const onSubmitRef = useRef(onSubmit);
		const surfaceRef = useRef<HTMLDivElement>(null);
		const skillSlashStateRef = useRef<AgentSkillSlashState | null>(null);
		const lastComposerStateRef = useRef<AgentComposerState | null>(null);
		const [isReferenceOnly, setIsReferenceOnly] = useState(false);
		const [skillSlashState, setSkillSlashState] = useState<AgentSkillSlashState | null>(null);

		useEffect(() => {
			onChangeRef.current = onChange;
		}, [onChange]);

		useEffect(() => {
			onSubmitRef.current = onSubmit;
		}, [onSubmit]);

		useEffect(() => {
			skillSlashStateRef.current = skillSlashState;
		}, [skillSlashState]);

		const emitChange = useCallback((nextEditor: Editor) => {
			const value = readComposerValue(nextEditor);
			const nextIsReferenceOnly = value.references.length > 0 && value.text.trim().length === 0;
			const nextState = {
				hasText: value.text.trim().length > 0,
				referenceCount: value.references.length,
			};
			setIsReferenceOnly((current) =>
				current === nextIsReferenceOnly ? current : nextIsReferenceOnly,
			);

			const previousState = lastComposerStateRef.current;
			if (
				previousState &&
				previousState.hasText === nextState.hasText &&
				previousState.referenceCount === nextState.referenceCount
			) {
				return;
			}
			lastComposerStateRef.current = nextState;
			onChangeRef.current?.(nextState);
		}, []);

		const extensions = useMemo(
			() => [
				StarterKit.configure({
					blockquote: false,
					bulletList: false,
					code: false,
					codeBlock: false,
					dropcursor: false,
					gapcursor: false,
					heading: false,
					horizontalRule: false,
					listItem: false,
					orderedList: false,
				}),
				Placeholder.configure({
					placeholder,
				}),
				AgentSkill,
				AgentMention,
			],
			[placeholder],
		);

		const editor = useEditor(
			{
				content: "",
				editorProps: {
					attributes: {
						"aria-label": placeholder,
						"aria-multiline": "true",
						class: "agent-composer-prosemirror",
						role: "textbox",
					},
					handleKeyDown: (_view, event) => {
						if (event.key !== "Enter" || event.shiftKey || event.isComposing) return false;
						event.preventDefault();
						if (!disabled) onSubmitRef.current?.();
						return true;
					},
				},
				extensions,
				immediatelyRender: true,
				onUpdate: ({ editor: nextEditor }) => {
					emitChange(nextEditor);
				},
			},
			[],
		);

		const refreshSkillSlashState = useCallback(() => {
			const nextState = resolveAgentSkillSlashState(editor, skillItems);

			setSkillSlashState((current) => {
				if (!nextState) return null;

				const selectedIndex =
					current &&
					current.range.from === nextState.range.from &&
					current.query === nextState.query
						? Math.min(current.selectedIndex, Math.max(0, nextState.items.length - 1))
						: 0;

				return { ...nextState, selectedIndex };
			});
		}, [editor, skillItems]);

		useEffect(() => {
			if (!editor) return;

			const update = () => refreshSkillSlashState();
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
		}, [editor, refreshSkillSlashState]);

		useEffect(() => {
			if (!skillSlashStateRef.current) return;
			refreshSkillSlashState();
		}, [refreshSkillSlashState]);

		useEffect(() => {
			if (!skillSlashState) return;

			const closeOnOutsidePointer = (event: PointerEvent) => {
				const target = event.target;
				if (!(target instanceof Node)) return;
				if (surfaceRef.current?.contains(target)) return;
				if (target instanceof Element && target.closest(".agent-skill-slash-menu-layer")) return;
				setSkillSlashState(null);
			};

			document.addEventListener("pointerdown", closeOnOutsidePointer);
			return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
		}, [skillSlashState]);

		const selectSkillSlashItem = useCallback(
			(item: AgentSkillSlashItem) => {
				const current = skillSlashStateRef.current;
				if (!editor || !current) return;

				insertAgentSkillSlashItem(editor, current.range, item);
				setSkillSlashState(null);
				emitChange(editor);
			},
			[editor, emitChange],
		);

		const handleKeyDownCapture = useCallback(
			(event: KeyboardEvent<HTMLDivElement>) => {
				const current = skillSlashStateRef.current;
				if (!current) return;

				if (event.key === "ArrowUp" || event.key === "ArrowDown") {
					event.preventDefault();
					event.stopPropagation();
					if (current.items.length === 0) return;

					const step = event.key === "ArrowDown" ? 1 : -1;
					setSkillSlashState((state) =>
						state
							? {
									...state,
									selectedIndex: moveAgentSkillSlashSelection(
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
					event.preventDefault();
					event.stopPropagation();
					const selectedItem = current.items[current.selectedIndex] ?? current.items[0];
					if (selectedItem) {
						selectSkillSlashItem(selectedItem);
					} else {
						setSkillSlashState(null);
					}
					return;
				}

				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					setSkillSlashState(null);
				}
			},
			[selectSkillSlashItem],
		);

		const handleKeyUpCapture = useCallback(() => {
			refreshSkillSlashState();
		}, [refreshSkillSlashState]);

		useEffect(() => {
			editor?.setEditable(!disabled);
		}, [disabled, editor]);

		useEffect(() => {
			if (disabled) setSkillSlashState(null);
		}, [disabled]);

		useEffect(() => {
			if (!editor) return;
			emitChange(editor);
		}, [editor, emitChange]);

		useEffect(() => {
			const element = surfaceRef.current?.querySelector<HTMLElement>(".ProseMirror");
			if (!element) return;
			element.setAttribute("aria-label", placeholder);
			element.setAttribute("data-placeholder", placeholder);
			element.querySelectorAll<HTMLElement>("p").forEach((paragraph) => {
				paragraph.setAttribute("data-placeholder", placeholder);
			});
			element
				.querySelector<HTMLElement>(".is-editor-empty")
				?.setAttribute("data-placeholder", placeholder);
		}, [editor, isReferenceOnly, placeholder]);

		useImperativeHandle(
			ref,
			() => ({
				clear: () => {
					if (!editor) return;
					editor.commands.clearContent();
					emitChange(editor);
				},
				focus: () => {
					editor?.chain().focus().run();
				},
				getValue: () =>
					editor ? readComposerValue(editor) : { displayText: "", references: [], text: "" },
				seed: (seed) => {
					if (!editor) return false;
					editor.commands.clearContent();
					insertComposerSeed(editor, seed);
					emitChange(editor);
					return true;
				},
			}),
			[editor, emitChange],
		);

		return (
			<div
				ref={surfaceRef}
				className={cn(
					"agent-composer agent-composer-surface min-h-8 flex-1 resize-none overflow-y-auto rounded-sm border border-input bg-ide-editor px-2 py-1.5 text-xs leading-5 text-foreground transition-colors focus-within:border-ring",
					disabled && "cursor-not-allowed opacity-60",
					className,
				)}
				data-disabled={disabled ? "true" : "false"}
				data-reference-only={isReferenceOnly ? "true" : "false"}
				onClick={() => {
					if (!disabled) editor?.chain().focus().run();
				}}
				onKeyDownCapture={handleKeyDownCapture}
				onKeyUpCapture={handleKeyUpCapture}
			>
				<EditorContent editor={editor} />
				{skillSlashState ? (
					<AgentSkillSlashMenu
						errorMessage={skillsErrorMessage}
						isLoading={skillsLoading}
						items={skillSlashState.items}
						position={skillSlashState.position}
						selectedIndex={skillSlashState.selectedIndex}
						onSelect={selectSkillSlashItem}
					/>
				) : null}
			</div>
		);
	},
);

const resolveAgentSkillSlashState = (
	editor: Editor | null,
	items: AgentSkillSlashItem[],
): Omit<AgentSkillSlashState, "selectedIndex"> | null => {
	if (!editor || !editor.isEditable || !agentComposerHasDomFocus(editor)) return null;

	const match = findAgentSkillSlashMatch(editor);
	if (!match) return null;

	return {
		items: filterAgentSkillSlashItems(items, match.query),
		position: agentSkillSlashMenuPosition(editor, match.range),
		query: match.query,
		range: match.range,
	};
};

const findAgentSkillSlashMatch = (editor: Editor): { query: string; range: Range } | null => {
	const { selection } = editor.state;
	if (!selection.empty) return null;

	const $from = selection.$from;
	if (!$from.parent.isTextblock) return null;

	const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, "\n", "\n");
	return findAgentSkillSlashMatchFromText(textBeforeCursor, selection.from);
};

function findAgentSkillSlashMatchFromText(
	textBeforeCursor: string,
	selectionFrom: number,
): { query: string; range: Range } | null {
	const slashIndex = textBeforeCursor.lastIndexOf("/");
	if (slashIndex < 0) return null;

	const previousCharacter = slashIndex > 0 ? textBeforeCursor[slashIndex - 1] : "";
	if (previousCharacter && !/\s/u.test(previousCharacter)) return null;

	const query = textBeforeCursor.slice(slashIndex + 1);
	if (/\s/u.test(query)) return null;

	const from = selectionFrom - query.length - 1;
	return {
		query,
		range: { from, to: selectionFrom },
	};
}

const agentComposerHasDomFocus = (editor: Editor) => {
	const activeElement = editor.view.dom.ownerDocument.activeElement;
	return activeElement === editor.view.dom || editor.view.dom.contains(activeElement);
};

const agentSkillSlashMenuPosition = (editor: Editor, range: Range): AgentSkillSlashMenuPosition => {
	const coords = editor.view.coordsAtPos(range.from);
	const viewportMargin = 12;
	const menuWidth = Math.min(384, window.innerWidth - viewportMargin * 2);
	const menuHeight = 288;
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

const insertAgentSkillSlashItem = (editor: Editor, range: Range, item: AgentSkillSlashItem) => {
	editor
		.chain()
		.focus()
		.insertContentAt(
			range,
			[
				{
					type: "skill",
					attrs: agentSkillAttributes(item),
				},
				{ type: "text", text: " " },
			],
			{ updateSelection: true },
		)
		.run();
};

const agentSkillInstructionText = (item: AgentSkillSlashItem) => {
	const title = typeof item.title === "string" ? item.title.trim() : "";
	const titleText = title && title !== item.name ? `（${title}）` : "";
	return `请先调用 MCP \`load_skill\` 装载 \`${item.name}\`${titleText}，并使用该 Skill 完成以下需求：`;
};

const agentSkillAttributes = (item: AgentSkillSlashItem) => ({
	name: item.name,
	title: item.title?.trim() || item.name,
});

const agentSkillFromAttrs = (attrs: Record<string, unknown>): AgentSkillSlashItem | null => {
	const name = typeof attrs.name === "string" ? attrs.name.trim() : "";
	if (!name) return null;
	const title = typeof attrs.title === "string" ? attrs.title.trim() : "";
	return { description: "", name, title: title || name };
};

const agentSkillDisplayLabel = (value: Record<string, unknown>) => {
	const title = typeof value.title === "string" ? value.title.trim() : "";
	const name = typeof value.name === "string" ? value.name.trim() : "";
	return title || name || "Skill";
};

const moveAgentSkillSlashSelection = (
	items: AgentSkillSlashItem[],
	selectedIndex: number,
	step: number,
) => {
	if (items.length === 0) return 0;
	return (selectedIndex + items.length + step) % items.length;
};

const insertComposerSeed = (editor: Editor, seed: AgentComposerSeedInput) => {
	const content: Array<Record<string, unknown>> = [];
	if (seed.reference) {
		content.push({
			type: "mention",
			attrs: mentionAttributesFromReference(seed.reference),
		});
	}

	const text = seed.text?.trim();
	if (text) {
		content.push({
			type: "text",
			text: `${content.length > 0 ? " " : ""}${text}`,
		});
	}

	if (content.length === 0) {
		editor.chain().focus().run();
		return;
	}

	editor.chain().focus().insertContent(content).run();
};

const mentionAttributesFromReference = (reference: AgentReference) => ({
	id: reference.assetId ?? reference.documentId,
	assetId: reference.assetId,
	assetKind: reference.assetKind,
	blockId: reference.blockId,
	category: reference.category ?? fallbackMentionCategory,
	documentId: reference.documentId,
	kind: reference.kind,
	label: reference.title,
	mimeType: reference.mimeType,
	title: reference.title,
	url: reference.url,
});

const readComposerValue = (editor: Editor): AgentComposerValue => {
	const references: AgentReference[] = [];
	const seenReferences = new Set<string>();
	const blockTexts: string[] = [];
	const displayBlockTexts: string[] = [];

	editor.state.doc.forEach((node) => {
		const parts: string[] = [];
		const displayParts: string[] = [];
		node.descendants((child) => {
			if (child.isText) {
				parts.push(child.text ?? "");
				displayParts.push(child.text ?? "");
				return false;
			}

			if (child.type.name === "hardBreak") {
				parts.push("\n");
				displayParts.push("\n");
				return false;
			}

			if (child.type.name === "mention") {
				const displayText = mentionTextFromAttrs(child.attrs);
				const reference = referenceFromMentionNode(child);
				parts.push(" ");
				if (displayText) displayParts.push(displayText);
				if (reference) {
					const key = `${reference.documentId}:${reference.blockId ?? ""}`;
					if (!seenReferences.has(key)) {
						seenReferences.add(key);
						references.push(reference);
					}
				}
				return false;
			}

			if (child.type.name === "skill") {
				const skill = agentSkillFromAttrs(child.attrs);
				if (skill) {
					parts.push(agentSkillInstructionText(skill));
					displayParts.push(agentSkillDisplayLabel(child.attrs));
				}
				return false;
			}

			return true;
		});
		blockTexts.push(parts.join(""));
		displayBlockTexts.push(displayParts.join(""));
	});

	return {
		displayText: displayBlockTexts.join("\n"),
		references,
		text: blockTexts.join("\n"),
	};
};

const mentionTextFromAttrs = (attrs: Record<string, unknown>) => {
	const value = attrs.title ?? attrs.label ?? attrs.id;
	if (typeof value !== "string" || value.trim() === "") return "";
	return mentionDisplayText(value);
};
