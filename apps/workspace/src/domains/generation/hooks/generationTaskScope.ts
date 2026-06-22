import type { GenerationTask } from "@/domains/generation/api/generation";

export interface GenerationTaskScope {
	documentId?: string | null;
	projectId?: string | null;
	sectionId?: string | null;
}

export const generationTaskScopeKey = (scope: GenerationTaskScope) => {
	const sectionId = cleanTaskScopePart(scope.sectionId);
	if (!sectionId) return "";

	return [
		cleanTaskScopePart(scope.projectId),
		cleanTaskScopePart(scope.documentId),
		sectionId,
	].join("\u001f");
};

export const filterGenerationTasksForScope = (
	tasks: GenerationTask[],
	scope: GenerationTaskScope,
) => {
	const scopeKey = generationTaskScopeKey(scope);
	if (!scopeKey) return tasks;

	return tasks.filter((task) => generationTaskScopeKey(task) === scopeKey);
};

const cleanTaskScopePart = (value: string | null | undefined) => value?.trim() ?? "";
