import { findTextAnchorMatch, type TextAnchorInput } from "@/domains/documents/lib/operations";

interface DOMTextNodePosition {
	end: number;
	node: Text;
	start: number;
	text: string;
}

export const createDOMTextAnchorResolver = (root: HTMLElement) => {
	const { text, textNodes } = collectTextNodes(root);

	return {
		findRect(anchor: TextAnchorInput, options: { fallbackToToken?: boolean } = {}) {
			const match = findTextAnchorMatch(text, anchor, options);
			if (!match) return null;

			const start = resolveTextPosition(textNodes, match.start, "forward");
			const end = resolveTextPosition(textNodes, match.end, "backward");
			if (!start || !end) return null;

			const range = document.createRange();
			range.setStart(start.node, start.offset);
			range.setEnd(end.node, end.offset);
			const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
			range.detach();
			return rect && rect.height > 0 ? rect : null;
		},
	};
};

const collectTextNodes = (root: HTMLElement) => {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const textNodes: DOMTextNodePosition[] = [];
	let text = "";
	let node = walker.nextNode();
	while (node) {
		const nodeText = node.textContent ?? "";
		if (nodeText) {
			const start = text.length;
			text += nodeText;
			textNodes.push({
				end: text.length,
				node: node as Text,
				start,
				text: nodeText,
			});
		}
		node = walker.nextNode();
	}

	return { text, textNodes };
};

const resolveTextPosition = (
	nodes: DOMTextNodePosition[],
	offset: number,
	bias: "backward" | "forward",
) => {
	const orderedNodes = bias === "backward" ? [...nodes].reverse() : nodes;
	for (const item of orderedNodes) {
		const contains =
			bias === "backward"
				? offset > item.start && offset <= item.end
				: offset >= item.start && offset < item.end;
		if (contains) {
			return {
				node: item.node,
				offset: Math.min(Math.max(offset - item.start, 0), item.text.length),
			};
		}
	}

	const last = nodes.at(-1);
	return last ? { node: last.node, offset: last.text.length } : null;
};
