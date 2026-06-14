import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";
import type { DocumentComment } from "@/domains/documents/stores";
import { cn } from "@/shared/lib/utils";
import { createTextNodeRangeResolver, findTopLevelBlockRange, sameBlockRange } from "./ranges";
import {
	blockHandlePluginKey,
	blockHandleStorage,
	commentAnchorPluginKey,
	commentAnchorStorage,
} from "./storage";
import type { BlockRange } from "./types";

export const createBlockHandleExtension = (
	onHoverChange: (rect: DOMRect | null, range?: BlockRange) => void,
) =>
	Extension.create({
		name: "blockHandle",
		addStorage() {
			return {
				hoveredRange: null as BlockRange | null,
			};
		},
		addProseMirrorPlugins() {
			const editor = this.editor;

			const clearHoveredBlock = (view: Editor["view"]) => {
				const storage = blockHandleStorage(editor);
				if (!storage.hoveredRange) {
					onHoverChange(null);
					return;
				}

				storage.hoveredRange = null;
				onHoverChange(null);
				view.dispatch(view.state.tr.setMeta(blockHandlePluginKey, Date.now()));
			};

			return [
				new Plugin({
					key: blockHandlePluginKey,
					props: {
						decorations(state) {
							const range = blockHandleStorage(editor).hoveredRange;
							if (!range) return DecorationSet.empty;

							return DecorationSet.create(state.doc, [
								Decoration.node(range.from, range.to, {
									class: "block-hovered",
								}),
							]);
						},
						handleDOMEvents: {
							mouseleave(view, event) {
								if (isBlockHandleTarget(event.relatedTarget)) return false;
								clearHoveredBlock(view);
								return false;
							},
							mousemove(view, event) {
								const position = view.posAtCoords({
									left: event.clientX,
									top: event.clientY,
								});
								if (!position) {
									clearHoveredBlock(view);
									return false;
								}

								const range = findTopLevelBlockRange(view.state.doc, position.pos);
								if (!range) {
									clearHoveredBlock(view);
									return false;
								}

								const dom = view.nodeDOM(range.from);
								const element =
									dom instanceof HTMLElement ? dom : dom instanceof Text ? dom.parentElement : null;
								if (!element) {
									clearHoveredBlock(view);
									return false;
								}

								const storage = blockHandleStorage(editor);
								const previousRange = storage.hoveredRange;
								storage.hoveredRange = range;
								onHoverChange(element.getBoundingClientRect(), range);

								if (!sameBlockRange(previousRange, range)) {
									view.dispatch(view.state.tr.setMeta(blockHandlePluginKey, Date.now()));
								}

								return false;
							},
						},
					},
				}),
			];
		},
	});

const isBlockHandleTarget = (target: EventTarget | null) =>
	target instanceof HTMLElement &&
	Boolean(target.closest(".tiptap-block-handle, .tiptap-section-generate-action"));

export const commentAnchorExtension = Extension.create({
	name: "commentAnchors",
	addStorage() {
		return {
			activeCommentId: null as string | null,
			items: [] as DocumentComment[],
			onClick: undefined as ((commentId: string) => void) | undefined,
			pendingSelectionAnchor: null,
			pendingSelectionRange: null,
		};
	},
	addProseMirrorPlugins() {
		const editor = this.editor;

		return [
			new Plugin({
				key: commentAnchorPluginKey,
				props: {
					decorations(state) {
						const { activeCommentId, items, pendingSelectionAnchor, pendingSelectionRange } =
							commentAnchorStorage(editor);
						if (items.length === 0 && !pendingSelectionAnchor && !pendingSelectionRange) {
							return DecorationSet.empty;
						}

						const decorations: Decoration[] = [];
						const rangeResolver = createTextNodeRangeResolver(state.doc);
						const pendingRange =
							normalizeDecorationRange(pendingSelectionRange, state.doc.content.size) ??
							(pendingSelectionAnchor ? rangeResolver.findRange(pendingSelectionAnchor) : null);
						if (pendingRange) {
							const range = pendingRange;
							if (range && range.from !== range.to) {
								decorations.push(
									Decoration.inline(range.from, range.to, {
										class: "document-comment-anchor document-selection-anchor",
									}),
								);
							}
						}

						for (const comment of items) {
							const range = rangeResolver.findRange(comment.anchor);
							if (!range || range.from === range.to) continue;

							decorations.push(
								Decoration.inline(range.from, range.to, {
									class: cn(
										"document-comment-anchor",
										comment.resolved && "document-comment-anchor-resolved",
										activeCommentId === comment.id && "document-comment-anchor-active",
									),
									"data-comment-id": comment.id,
								}),
							);
						}

						return DecorationSet.create(state.doc, decorations);
					},
					handleClick(_view, _position, event) {
						const target = event.target;
						const element =
							target instanceof HTMLElement
								? target
								: target instanceof Node
									? target.parentElement
									: null;
						const anchor = element?.closest<HTMLElement>("[data-comment-id]");
						const commentId = anchor?.dataset.commentId;
						if (!commentId) return false;

						commentAnchorStorage(editor).onClick?.(commentId);
						return true;
					},
				},
			}),
		];
	},
});

const normalizeDecorationRange = (
	range: { from: number; to: number } | null,
	maxPosition: number,
) => {
	if (!range) return null;

	const from = Math.min(Math.max(range.from, 0), maxPosition);
	const to = Math.min(Math.max(range.to, 0), maxPosition);
	if (from === to) return null;
	return {
		from: Math.min(from, to),
		to: Math.max(from, to),
	};
};
