import { agentGenerationConversationScopeId } from "@/domains/generation/api/generation";
import type { MarkdownSectionIdentity } from "./editor-registry";

export const sectionGenerationIdentityKey = (section: MarkdownSectionIdentity) =>
	[sectionGenerationKeyPart(section.documentId), sectionGenerationKeyPart(section.blockId)].join(
		":",
	);

export const sectionGenerationConversationScopeId = (
	section: MarkdownSectionIdentity,
	projectId?: string | null,
) => {
	const identity = sectionGenerationIdentityKey(section);
	const project = projectId?.trim();
	if (project) return `agent:${sectionGenerationKeyPart(project)}:section:${identity}`;

	return `section:${identity}`;
};

export const sectionGenerationPreferenceScopeId = (
	section: MarkdownSectionIdentity,
	projectId?: string | null,
) => {
	if (projectId?.trim()) return agentGenerationConversationScopeId;

	return sectionGenerationConversationScopeId(section);
};

export const sectionGenerationHistoryScopeId = (
	section: MarkdownSectionIdentity,
	projectId?: string | null,
) => sectionGenerationConversationScopeId(section, projectId);

const sectionGenerationKeyPart = (value: string) => encodeURIComponent(value.trim());
