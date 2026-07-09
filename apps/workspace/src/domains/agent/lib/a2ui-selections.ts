import type { AgentA2UIPayload } from "@/domains/agent/api/agent";

const agentSelectionSurfacePrefix = "agent-selection-";

// AgentSelectionRef identifies the selection record behind a deterministic
// agent-selection A2UI card so the client can look up its decision state.
export interface AgentSelectionRef {
	selectionId: string;
	projectId?: string;
}

// agentSelectionRefFromA2UI extracts the selection reference from an
// agent-selection A2UI card. The server names these surfaces
// "agent-selection-<selectionId>"; the action contexts carry the selectionId
// (fallback for older payloads) and the owning projectId.
export const agentSelectionRefFromA2UI = (
	payload?: AgentA2UIPayload | null,
): AgentSelectionRef | null => {
	let selectionId = "";
	const surfaceId = payload?.surfaceId?.trim() ?? "";
	if (surfaceId.startsWith(agentSelectionSurfacePrefix)) {
		selectionId = surfaceId.slice(agentSelectionSurfacePrefix.length).trim();
	}
	const messages = parseA2UIMessages(payload?.messages);
	const context = messages === undefined ? null : findAgentSelectionContext(messages);
	if (!selectionId && context?.selectionId) {
		selectionId = context.selectionId;
	}
	if (!selectionId) return null;
	return context?.projectId ? { selectionId, projectId: context.projectId } : { selectionId };
};

const parseA2UIMessages = (value: unknown): unknown => {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
};

const findAgentSelectionContext = (
	value: unknown,
	depth = 0,
): { selectionId: string; projectId?: string } | null => {
	if (depth > 12 || value == null) return null;

	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findAgentSelectionContext(item, depth + 1);
			if (found) return found;
		}
		return null;
	}

	if (typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const context = eventContext(record);
	if (context?.kind === "agent_selection") {
		const selectionId = typeof context.selectionId === "string" ? context.selectionId.trim() : "";
		if (!selectionId) return null;
		const projectId = typeof context.projectId === "string" ? context.projectId.trim() : "";
		return projectId ? { selectionId, projectId } : { selectionId };
	}

	for (const item of Object.values(record)) {
		const found = findAgentSelectionContext(item, depth + 1);
		if (found) return found;
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
