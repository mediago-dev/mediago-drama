import type { AgentA2UIPayload } from "@/domains/agent/api/agent";

export const agentPermissionRequestIdFromA2UI = (payload?: AgentA2UIPayload | null) => {
	const messages = parseA2UIMessages(payload?.messages);
	if (messages === undefined) return null;
	return findAgentPermissionRequestId(messages);
};

const parseA2UIMessages = (value: unknown): unknown => {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
};

const findAgentPermissionRequestId = (value: unknown, depth = 0): string | null => {
	if (depth > 12 || value == null) return null;

	if (Array.isArray(value)) {
		for (const item of value) {
			const requestId = findAgentPermissionRequestId(item, depth + 1);
			if (requestId) return requestId;
		}
		return null;
	}

	if (typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const context = eventContext(record);
	if (context?.kind === "agent_permission") {
		const requestId = context.requestId;
		return typeof requestId === "string" && requestId.trim() ? requestId.trim() : null;
	}

	for (const item of Object.values(record)) {
		const requestId = findAgentPermissionRequestId(item, depth + 1);
		if (requestId) return requestId;
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
