import { useMemo } from "react";
import useSWR from "swr";
import type {
	GenerationKind,
	GenerationMessageRequest,
	GenerationNotificationOpenTarget,
} from "@/domains/generation/api/generation";
import { projectGenerationConversation } from "@/domains/generation/api/generation";
import { getProjects, projectsKey } from "@/domains/projects/api/projects";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { latestMarkdownSectionContextFromDocuments } from "@/domains/documents/lib/markdown-section-context";
import {
	sectionGenerationConversationScopeId,
	sectionGenerationHistoryScopeId,
	sectionGenerationPreferenceScopeId,
} from "@/domains/documents/lib/section-generation";
import { taskTypeForCategory } from "@/domains/generation/lib/prompt-categories";
import { useDocumentsStore } from "@/domains/documents/stores";

export interface UseDocumentSectionGenerationContextOptions {
	kind: GenerationKind;
	projectId?: string;
	resolveLatestSection?: boolean;
	section: MarkdownSectionContext;
}

export const useDocumentSectionGenerationContext = ({
	kind,
	projectId,
	resolveLatestSection = true,
	section,
}: UseDocumentSectionGenerationContextOptions) => {
	const allDocuments = useDocumentsStore((state) => state.documents);
	const allAssets = useDocumentsStore((state) => state.assets);
	const workspaceProjectId = useDocumentsStore((state) => state.projectId);
	const activeSection = useMemo(
		() =>
			resolveLatestSection
				? latestMarkdownSectionContextFromDocuments(allDocuments, section)
				: section,
		[allDocuments, resolveLatestSection, section],
	);
	const normalizedProjectId = useMemo(
		() => projectId?.trim() || workspaceProjectId?.trim() || "",
		[projectId, workspaceProjectId],
	);
	const documentCategory = useMemo(
		() => allDocuments.find((document) => document.id === activeSection.documentId)?.category,
		[activeSection.documentId, allDocuments],
	);
	const { data: projectsData } = useSWR(normalizedProjectId ? projectsKey : null, getProjects);
	const projectName = useMemo(
		() => projectsData?.projects.find((project) => project.id === normalizedProjectId)?.name ?? "",
		[normalizedProjectId, projectsData],
	);
	const projectConversation = useMemo(
		() => projectGenerationConversation(normalizedProjectId, kind, projectName),
		[kind, normalizedProjectId, projectName],
	);
	const conversationScopeId = useMemo(
		() =>
			projectConversation?.conversationScopeId ??
			sectionGenerationKindScopeId(
				sectionGenerationConversationScopeId(activeSection, normalizedProjectId),
				kind,
			),
		[activeSection, kind, normalizedProjectId, projectConversation],
	);
	const historyScopeId = useMemo(
		() =>
			sectionGenerationKindScopeId(
				sectionGenerationHistoryScopeId(activeSection, normalizedProjectId),
				kind,
			),
		[activeSection, kind, normalizedProjectId],
	);
	const sectionId = useMemo(
		() => (projectConversation ? activeSection.blockId.trim() : undefined),
		[activeSection.blockId, projectConversation],
	);
	const modelPreferenceScopeId = useMemo(
		() =>
			sectionGenerationKindScopeId(
				sectionGenerationPreferenceScopeId(activeSection, normalizedProjectId),
				kind,
			),
		[activeSection, kind, normalizedProjectId],
	);
	const documentContext = useMemo<GenerationMessageRequest["documentContext"] | undefined>(() => {
		const documentId = activeSection.documentId.trim();
		const activeSectionId = activeSection.blockId.trim();
		if (!documentId || !activeSectionId) return undefined;

		return {
			...(normalizedProjectId ? { projectId: normalizedProjectId } : {}),
			documentId,
			sectionId: activeSectionId,
		};
	}, [activeSection.blockId, activeSection.documentId, normalizedProjectId]);
	const notificationTarget = useMemo<GenerationNotificationOpenTarget | undefined>(() => {
		if (!normalizedProjectId) return undefined;

		const documentTitle =
			allDocuments.find((document) => document.id === activeSection.documentId)?.title ||
			activeSection.headingText;
		return {
			kind: "document-section",
			projectId: normalizedProjectId,
			documentId: activeSection.documentId,
			documentTitle,
			section: {
				blockId: activeSection.blockId,
				documentId: activeSection.documentId,
				headingLevel: activeSection.headingLevel,
				headingOccurrence: activeSection.headingOccurrence,
				headingText: activeSection.headingText,
				markdown: activeSection.markdown,
				plainText: activeSection.plainText,
				prompt: activeSection.prompt,
			},
		};
	}, [activeSection, allDocuments, normalizedProjectId]);

	return {
		activeSection,
		allAssets,
		allDocuments,
		conversationScopeId,
		documentCategory,
		documentContext,
		historyScopeId,
		modelPreferenceScopeId,
		normalizedProjectId,
		notificationTarget,
		projectConversation,
		sectionId,
		taskType: taskTypeForCategory(documentCategory),
	};
};

export const sectionGenerationKindScopeId = (scopeId: string, kind: GenerationKind) =>
	kind === "image" ? scopeId : `${scopeId}:${kind}`;
