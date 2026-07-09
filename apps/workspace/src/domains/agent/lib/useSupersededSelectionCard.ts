import { selectAgentMessages, useAgentStore } from "@/domains/agent/stores";

// useSupersededSelectionCard reports whether the agent has already moved past a
// selection/form card. The agent blocks on exactly one selection at a time, so a
// card is still awaited only while it is the timeline's last message; once any
// later message appears — the flow proceeded after the ask timed out, the turn
// ended with a note, or the user typed instead — the card is superseded. A
// superseded card must render frozen rather than keep live action buttons that
// would submit a decision into a flow that already continued (the server keeps
// the selection record `pending` on timeout, so nothing else freezes it until
// the far-off expiry sweep). A still-awaited card stays the last message even
// after a transcript hydrate, so this never freezes a card the user can answer.
export const useSupersededSelectionCard = (messageId: string): boolean =>
	useAgentStore((state) => {
		const messages = selectAgentMessages(state);
		const last = messages[messages.length - 1];
		return last ? last.id !== messageId : false;
	});
