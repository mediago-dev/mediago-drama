import type { AgentDisplaySegment, AgentMessageMetadata } from "@/domains/agent/stores";

// Merges adjacent text runs, drops empty entries, and trims the outer
// whitespace so a segment list is stable regardless of how the composer
// produced it.
export const normalizeDisplaySegments = (
	segments: AgentDisplaySegment[],
): AgentDisplaySegment[] => {
	const merged: AgentDisplaySegment[] = [];
	for (const segment of segments) {
		if (segment.type === "text") {
			if (!segment.text) continue;
			const last = merged[merged.length - 1];
			if (last?.type === "text") {
				merged[merged.length - 1] = { type: "text", text: last.text + segment.text };
				continue;
			}
			merged.push({ type: "text", text: segment.text });
			continue;
		}
		merged.push(segment);
	}

	const first = merged[0];
	if (first?.type === "text") {
		const text = first.text.replace(/^\s+/u, "");
		if (text) merged[0] = { type: "text", text };
		else merged.shift();
	}
	const last = merged[merged.length - 1];
	if (last?.type === "text") {
		const text = last.text.replace(/\s+$/u, "");
		if (text) merged[merged.length - 1] = { type: "text", text };
		else merged.pop();
	}
	return merged;
};

export const hasRichDisplaySegment = (segments: AgentDisplaySegment[]) =>
	segments.some((segment) => segment.type !== "text");

// Renders segments back to the plain-text form of the prompt: mentions as
// `@Title` tokens, skills as their label, text verbatim. This is the single
// source of the text representation — keep it in sync with nothing.
export const displaySegmentsToText = (segments: AgentDisplaySegment[]) =>
	segments
		.map((segment) => {
			if (segment.type === "text") return segment.text;
			if (segment.type === "mention") return `@${segment.title.trim()}`;
			return segment.title || segment.name;
		})
		.join("");

// Reads segments back out of persisted metadata. Transcript snapshots come
// from the backend as untyped JSON, so every entry is shape-checked instead
// of trusted.
export const displaySegmentsFromMetadata = (
	metadata: AgentMessageMetadata | undefined,
): AgentDisplaySegment[] => {
	const raw = metadata?.displaySegments;
	if (!Array.isArray(raw)) return [];
	return normalizeDisplaySegments(raw.map(displaySegmentFromUnknown).filter(isDisplaySegment));
};

const displaySegmentFromUnknown = (value: unknown): AgentDisplaySegment | null => {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	if (record.type === "text" && typeof record.text === "string") {
		return { type: "text", text: record.text };
	}
	if (record.type === "mention" && typeof record.title === "string" && record.title.trim()) {
		return {
			type: "mention",
			title: record.title,
			...(typeof record.category === "string" && record.category
				? { category: record.category }
				: {}),
			...(typeof record.kind === "string" && record.kind ? { kind: record.kind } : {}),
		};
	}
	if (record.type === "skill" && typeof record.name === "string" && record.name.trim()) {
		return {
			type: "skill",
			name: record.name,
			...(typeof record.title === "string" && record.title ? { title: record.title } : {}),
		};
	}
	return null;
};

const isDisplaySegment = (segment: AgentDisplaySegment | null): segment is AgentDisplaySegment =>
	segment !== null;
