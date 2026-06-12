import type { AgentMessage } from "@/domains/agent/stores";
import type { AgentMessageKind } from "@/domains/agent/stores";

export type TimelineEntry =
	| { type: "user"; message: AgentMessage }
	| { type: "assistant"; id: string; messages: AgentMessage[] };

export type AssistantRenderItem =
	| { type: "message"; message: AgentMessage }
	| { type: "thoughts"; id: string; messages: AgentMessage[] }
	| { type: "tools"; id: string; messages: AgentMessage[] };

export const buildTimelineEntries = (messages: AgentMessage[]): TimelineEntry[] => {
	const entries: TimelineEntry[] = [];
	let activeGroup: { id: string; messages: AgentMessage[] } | null = null;

	const flushGroup = () => {
		if (!activeGroup || activeGroup.messages.length === 0) return;
		entries.push({ type: "assistant", id: activeGroup.id, messages: activeGroup.messages });
		activeGroup = null;
	};

	for (const message of messages) {
		if ((message.kind ?? "message") === "runtime" && message.metadata?.runtimeLog !== true) {
			continue;
		}

		if (message.role === "user") {
			flushGroup();
			entries.push({ type: "user", message });
			continue;
		}

		if (!activeGroup) {
			activeGroup = { id: `assistant-group-${message.id}`, messages: [] };
		}
		activeGroup.messages.push(message);
	}

	flushGroup();
	return entries;
};

export const groupAssistantMessages = (messages: AgentMessage[]): AssistantRenderItem[] => {
	const items: AssistantRenderItem[] = [];
	let thoughtGroup: AgentMessage[] = [];
	let toolGroup: AgentMessage[] = [];

	const flushThoughts = () => {
		if (thoughtGroup.length === 0) return;
		items.push({
			type: "thoughts",
			id: `thoughts-${thoughtGroup[0].id}`,
			messages: thoughtGroup,
		});
		thoughtGroup = [];
	};

	const flushTools = () => {
		if (toolGroup.length === 0) return;
		items.push({
			type: "tools",
			id: `tools-${toolGroup[0].id}`,
			messages: toolGroup,
		});
		toolGroup = [];
	};

	for (const message of messages) {
		const kind = message.kind ?? "message";
		if (kind === "thought") {
			flushTools();
			thoughtGroup.push(message);
			continue;
		}

		if (isActionKind(kind)) {
			flushThoughts();
			toolGroup.push(message);
			continue;
		}

		flushThoughts();
		flushTools();
		items.push({ type: "message", message });
	}
	flushThoughts();
	flushTools();
	return items;
};

const actionKinds = new Set<AgentMessageKind>(["tool", "file", "patch", "diff", "terminal"]);

export const isActionKind = (kind: AgentMessageKind) => actionKinds.has(kind);
