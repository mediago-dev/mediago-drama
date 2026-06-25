import type { AgentReference } from "@/domains/agent/api/agent";

export const referenceDisplayPrompt = (references?: Pick<AgentReference, "title">[]) => {
	const titles = (references ?? []).map((reference) => reference.title.trim()).filter(Boolean);
	if (titles.length === 0) return "";
	return titles.map((title) => `@${title}`).join(" ");
};

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

export const agentDisplayPrompt = agentPromptWithReferences;

const promptIncludesReference = (prompt: string, title: string) => {
	const trimmedTitle = title.trim();
	if (!prompt || !trimmedTitle) return false;
	return prompt.includes(`@${trimmedTitle}`);
};
