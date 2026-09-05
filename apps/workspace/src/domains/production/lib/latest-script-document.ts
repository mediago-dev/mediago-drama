import type { AgentMessage } from "@/domains/agent/stores/types";
import type { MarkdownDocument } from "@/domains/documents/stores";

const SCRIPT_WORDS = /(脚本|剧本|screenplay|script)/i;
const MARKDOWN_LINK = /\[([^\]]+)]\(([^)]+)\)/g;

const normalize = (value: string) => {
	let decoded = value;
	try {
		decoded = decodeURIComponent(value);
	} catch {
		// Keep malformed or partially encoded links usable for fuzzy matching.
	}
	return decoded
		.toLowerCase()
		.replace(/\.md(?:\?.*)?$/i, "")
		.replace(/[《》「」『』【】\[\]()（）<>\s_\-/\\]/g, "");
};

const scriptVersion = (document: MarkdownDocument) => {
	const versions = Array.from(
		`${document.title} ${document.filename ?? ""}`.matchAll(/\bv\s*(\d+)\b/gi),
		(match) => Number(match[1]),
	);
	return Math.max(document.version || 0, ...versions, 0);
};

const isScriptDocument = (document: MarkdownDocument) =>
	document.category === "screenplay" ||
	SCRIPT_WORDS.test(`${document.title} ${document.filename ?? ""}`);

const compareNewest = (first: MarkdownDocument, second: MarkdownDocument) =>
	scriptVersion(second) - scriptVersion(first) ||
	new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime();

const linkMatchesDocument = (label: string, href: string, document: MarkdownDocument) => {
	const candidates = [document.id, document.title, document.filename ?? ""]
		.map(normalize)
		.filter(Boolean);
	const normalizedLabel = normalize(label);
	const normalizedHref = normalize(href);
	return candidates.some(
		(candidate) =>
			normalizedLabel === candidate ||
			normalizedLabel.includes(candidate) ||
			candidate.includes(normalizedLabel) ||
			normalizedHref.includes(candidate),
	);
};

/** Conversation order wins; version and update time resolve documents linked in the same reply. */
export const selectLatestChatScriptDocument = (
	messages: AgentMessage[],
	documents: MarkdownDocument[],
): MarkdownDocument | null => {
	const readableDocuments = documents.filter((document) => document.content.trim());
	const scripts = readableDocuments.filter(isScriptDocument);
	for (const message of [...messages].reverse()) {
		if (
			message.role !== "assistant" ||
			message.kind !== "message" ||
			message.phase === "commentary"
		)
			continue;
		for (const link of message.content.matchAll(MARKDOWN_LINK)) {
			const label = link[1] ?? "";
			const href = link[2] ?? "";
			if (!SCRIPT_WORDS.test(`${label} ${href}`)) continue;
			// A document linked as “剧本/脚本” is authoritative even when an older
			// backend saved it with a generic category or a title without the word 剧本.
			const match = readableDocuments
				.filter((document) => linkMatchesDocument(label, href, document))
				.sort(compareNewest)[0];
			if (match) return match;
		}
	}
	return [...scripts].sort(compareNewest)[0] ?? null;
};
