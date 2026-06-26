import { Extension } from "@tiptap/core";
import { Heading } from "@tiptap/extension-heading";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { LockedHeadingPlan } from "@/domains/documents/lib/locked-headings";

interface LockedHeadingRange {
	from: number;
	level: number;
	node: ProseMirrorNode;
	sectionId: string;
	text: string;
	to: number;
}

interface LockedHeadingSignature {
	level: number;
	text: string;
}

const lockedHeadingPluginKey = new PluginKey<{ imprint?: boolean }>("locked-headings");

export const LockedHeading = Heading.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			locked: {
				default: false,
				rendered: false,
			},
			sectionId: {
				default: null,
				rendered: false,
			},
		};
	},
});

export const createLockedHeadingsExtension = (plan: LockedHeadingPlan) =>
	Extension.create({
		name: "lockedHeadings",
		addProseMirrorPlugins() {
			return [createLockedHeadingsPlugin(plan)];
		},
	});

const createLockedHeadingsPlugin = (plan: LockedHeadingPlan) => {
	let imprintQueued = false;

	const queueImprint = (view: EditorView) => {
		if (imprintQueued) return;
		imprintQueued = true;
		queueMicrotask(() => {
			imprintQueued = false;
			imprintLockedHeadings(view, plan);
		});
	};

	return new Plugin({
		key: lockedHeadingPluginKey,
		filterTransaction(transaction, state) {
			if (!transaction.docChanged) return true;
			if (transaction.getMeta(lockedHeadingPluginKey)?.imprint) return true;

			const before = lockedHeadingSignature(state.doc, plan);
			const after = lockedHeadingSignature(transaction.doc, plan);
			if (!sameSignature(before, after)) return false;
			if (transactionTouchesLockedHeading(transaction, state, plan)) return false;
			return true;
		},
		props: {
			decorations(state) {
				const decorations = collectLockedHeadingRanges(state.doc, plan).map((range) =>
					Decoration.node(range.from, range.to, {
						class: "template-locked-heading",
						"data-section-id": range.sectionId,
						title: "标题不可编辑",
					}),
				);
				return DecorationSet.create(state.doc, decorations);
			},
			handleDrop(view) {
				return selectionTouchesLockedHeading(view.state, plan);
			},
			handleKeyDown(view, event) {
				if (!selectionTouchesLockedHeading(view.state, plan)) return false;
				if (!isEditingKey(event)) return false;
				event.preventDefault();
				return true;
			},
			handlePaste(view) {
				return selectionTouchesLockedHeading(view.state, plan);
			},
		},
		view(view) {
			queueImprint(view);
			return {
				update(nextView) {
					queueImprint(nextView);
				},
			};
		},
	});
};

const imprintLockedHeadings = (view: EditorView, plan: LockedHeadingPlan) => {
	const ranges = collectTemplateHeadingRanges(view.state.doc, plan);
	if (ranges.length === 0) return;

	let transaction = view.state.tr;
	let changed = false;
	for (const range of ranges) {
		const attrs = range.node.attrs;
		if (attrs.locked === true && attrs.sectionId === range.sectionId) continue;
		transaction = transaction.setNodeMarkup(range.from, undefined, {
			...attrs,
			locked: true,
			sectionId: range.sectionId,
		});
		changed = true;
	}
	if (!changed) return;
	transaction.setMeta(lockedHeadingPluginKey, { imprint: true });
	view.dispatch(transaction);
};

const collectTemplateHeadingRanges = (
	doc: ProseMirrorNode,
	plan: LockedHeadingPlan,
): LockedHeadingRange[] => {
	const ranges: LockedHeadingRange[] = [];
	let position = 0;

	for (let index = 0; index < doc.childCount && ranges.length < plan.count; index += 1) {
		const node = doc.child(index);
		const from = position;
		const to = from + node.nodeSize;
		position = to;
		if (node.type.name !== "heading") continue;

		const expected = plan.titles[ranges.length];
		if (!expected) break;
		ranges.push({
			from,
			level: Number(node.attrs.level ?? expected.level),
			node,
			sectionId: expected.sectionId,
			text: node.textContent.trim(),
			to,
		});
	}

	return ranges;
};

const collectLockedHeadingRanges = (doc: ProseMirrorNode, plan: LockedHeadingPlan) =>
	collectTemplateHeadingRanges(doc, plan).filter(
		(range) => range.node.attrs.locked === true || range.sectionId,
	);

const lockedHeadingSignature = (
	doc: ProseMirrorNode,
	plan: LockedHeadingPlan,
): LockedHeadingSignature[] =>
	collectTemplateHeadingRanges(doc, plan).map((range) => ({
		level: range.level,
		text: range.text,
	}));

const sameSignature = (first: LockedHeadingSignature[], second: LockedHeadingSignature[]) =>
	first.length === second.length &&
	first.every(
		(item, index) => item.level === second[index]?.level && item.text === second[index]?.text,
	);

const transactionTouchesLockedHeading = (
	transaction: Transaction,
	state: EditorState,
	plan: LockedHeadingPlan,
) => {
	const ranges = collectLockedHeadingRanges(state.doc, plan);
	if (ranges.length === 0) return false;
	return transaction.steps.some((step) => {
		const range = step as unknown as { from?: number; to?: number };
		if (typeof range.from !== "number" || typeof range.to !== "number") return false;
		return ranges.some((heading) =>
			rangesOverlap(range.from ?? 0, range.to ?? 0, heading.from, heading.to),
		);
	});
};

const selectionTouchesLockedHeading = (state: EditorState, plan: LockedHeadingPlan) => {
	const ranges = collectLockedHeadingRanges(state.doc, plan);
	if (ranges.length === 0) return false;
	const from = Math.min(state.selection.from, state.selection.to);
	const to = Math.max(state.selection.from, state.selection.to);
	return ranges.some((range) =>
		from === to
			? from > range.from && from < range.to
			: rangesOverlap(from, to, range.from, range.to),
	);
};

const rangesOverlap = (from: number, to: number, rangeFrom: number, rangeTo: number) =>
	from < rangeTo && to > rangeFrom;

const isEditingKey = (event: KeyboardEvent) => {
	if (event.metaKey || event.ctrlKey) {
		return ["v", "x", "z", "y"].includes(event.key.toLowerCase());
	}
	return event.key.length === 1 || ["Backspace", "Delete", "Enter", "Tab"].includes(event.key);
};
