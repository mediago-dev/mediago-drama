import type { AgentA2UIPayload } from "@/domains/agent/api/agent";

const agentSelectionSurfacePrefix = "agent-selection-";

// agentSelectionIdFromA2UI extracts the selection id from a deterministic
// agent-selection A2UI card so the client can look up its persisted decision.
// The server names these surfaces "agent-selection-<selectionId>"; older or
// partial payloads fall back to the selectionId in the action contexts.
export const agentSelectionIdFromA2UI = (payload?: AgentA2UIPayload | null) => {
	const surfaceId = payload?.surfaceId?.trim() ?? "";
	if (surfaceId.startsWith(agentSelectionSurfacePrefix)) {
		const selectionId = surfaceId.slice(agentSelectionSurfacePrefix.length).trim();
		if (selectionId) return selectionId;
	}
	const messages = parseA2UIMessages(payload?.messages);
	if (messages === undefined) return null;
	return findAgentSelectionId(messages);
};

const parseA2UIMessages = (value: unknown): unknown => {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
};

const findAgentSelectionId = (value: unknown, depth = 0): string | null => {
	if (depth > 12 || value == null) return null;

	if (Array.isArray(value)) {
		for (const item of value) {
			const selectionId = findAgentSelectionId(item, depth + 1);
			if (selectionId) return selectionId;
		}
		return null;
	}

	if (typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const context = eventContext(record);
	if (context?.kind === "agent_selection") {
		const selectionId = context.selectionId;
		return typeof selectionId === "string" && selectionId.trim() ? selectionId.trim() : null;
	}

	for (const item of Object.values(record)) {
		const selectionId = findAgentSelectionId(item, depth + 1);
		if (selectionId) return selectionId;
	}
	return null;
};

const eventContext = (record: Record<string, unknown>) => {
	const action = objectRecord(record.action);
	const event = objectRecord(action?.event);
	return objectRecord(event?.context);
};

const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
	value != null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
