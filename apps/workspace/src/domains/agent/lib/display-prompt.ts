import type { AgentReference } from "@/domains/agent/api/agent";

// Shared wording for a comments-only send (no typed prompt): used both as the
// composer's display fallback and as the machine-prompt default so the user
// and the agent see the same sentence.
export const openCommentsPromptFallback = "处理当前未解决批注";

const referenceDisplayPrompt = (references?: Pick<AgentReference, "title">[]) => {
	const titles = (references ?? []).map((reference) => reference.title.trim()).filter(Boolean);
	if (titles.length === 0) return "";
	return titles.map((title) => `@${title}`).join(" ");
};

// Builds the machine prompt handed to the agent runtime: references the user
// did not spell out inline are prepended as `@Title` tokens so the agent knows
// what to read. This text is NOT what the chat bubble shows — the bubble uses
// displayPrompt / displaySegments.
export const agentPromptWithReferences = ({
	prompt,
	references,
}: {
	prompt: string;
	references?: Pick<AgentReference, "title">[];
}) => {
	const trimmedPrompt = prompt.trim();
	const missingReferences = (references ?? []).filter(
		(reference) => !promptIncludesReference(trimmedPrompt, reference.title),
	);
	return [referenceDisplayPrompt(missingReferences), trimmedPrompt].filter(Boolean).join(" ");
};

const promptIncludesReference = (prompt: string, title: string) => {
	const trimmedTitle = title.trim();
	if (!prompt || !trimmedTitle) return false;
	return prompt.includes(`@${trimmedTitle}`);
};
