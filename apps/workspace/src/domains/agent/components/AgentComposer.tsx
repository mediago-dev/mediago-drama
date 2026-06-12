import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { EditorContent, type Editor, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import type { SuggestionOptions } from "@tiptap/suggestion";
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
}

const maxComposerRows = 3;

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
		},
		ref,
	) {
		const onChangeRef = useRef(onChange);
		const onSubmitRef = useRef(onSubmit);
		const surfaceRef = useRef<HTMLDivElement>(null);
		const [isReferenceOnly, setIsReferenceOnly] = useState(false);

		useEffect(() => {
			onChangeRef.current = onChange;
		}, [onChange]);

		useEffect(() => {
			onSubmitRef.current = onSubmit;
		}, [onSubmit]);

		const emitChange = useCallback((nextEditor: Editor) => {
			const value = readComposerValue(nextEditor);
			setIsReferenceOnly(value.references.length > 0 && value.text.trim().length === 0);
			onChangeRef.current?.({
				hasText: value.text.trim().length > 0,
				referenceCount: value.references.length,
			});
			window.requestAnimationFrame(() => resizeComposer(surfaceRef.current));
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
				onCreate: ({ editor: nextEditor }) => {
					emitChange(nextEditor);
				},
				onUpdate: ({ editor: nextEditor }) => {
					emitChange(nextEditor);
				},
			},
			[],
		);

		useEffect(() => {
			editor?.setEditable(!disabled);
		}, [disabled, editor]);

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

		useLayoutEffect(() => {
			resizeComposer(surfaceRef.current);
		}, [editor]);

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
					"agent-composer min-h-8 flex-1 rounded-sm border border-input bg-ide-editor px-2 py-1.5 text-xs leading-5 text-foreground transition-colors focus-within:border-ring",
					disabled && "cursor-not-allowed opacity-60",
					className,
				)}
				data-disabled={disabled ? "true" : "false"}
				data-reference-only={isReferenceOnly ? "true" : "false"}
				onClick={() => {
					if (!disabled) editor?.chain().focus().run();
				}}
			>
				<EditorContent editor={editor} />
			</div>
		);
	},
);

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

const resizeComposer = (surface: HTMLDivElement | null) => {
	const element = surface?.querySelector<HTMLElement>(".ProseMirror");
	if (!element) return;

	element.style.height = "auto";
	const styles = window.getComputedStyle(element);
	const lineHeight = cssPixels(styles.lineHeight, 20);
	const paddingY = cssPixels(styles.paddingTop) + cssPixels(styles.paddingBottom);
	const maxHeight = lineHeight * maxComposerRows + paddingY;
	const scrollHeight = element.scrollHeight;
	const nextHeight = Math.min(scrollHeight, maxHeight);

	element.style.height = `${Math.ceil(nextHeight)}px`;
	element.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
};

const cssPixels = (value: string, fallback = 0) => {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};
