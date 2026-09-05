import type { ProjectProductionState } from "@/domains/projects/api/projects";
import type { ProductionPipeline } from "@/lib/overview/production-pipeline";

/**
 * The stable, read-only context shared by every production stage.
 * Stage pages may add their own data, but they should not rebuild these facts independently.
 */
export interface ProjectProductionContext {
	projectId: string;
	name: string;
	templateId?: string;
	templateName?: string;
	currentStageId?: string;
	stageCount: number;
	completedStageCount: number;
	progress: number;
	resourceCount: number;
	selectedAssetCount: number;
	shotCount: number;
	draftStoryboardCount: number;
	blockerCount: number;
	qcIssueCount: number;
	versionCount: number;
	outputArchiveCount: number;
	qcPassCount: number;
	sharedMemoryReady: boolean;
	outputDirectory?: string;
	production?: ProjectProductionState;
}

export const buildProjectProductionContext = (input: {
	projectId: string;
	name: string;
	pipeline: ProductionPipeline;
	resourceCount: number;
	selectedAssetCount: number;
	shotCount: number;
	draftStoryboardCount?: number;
	outputDirectory?: string;
	production?: ProjectProductionState;
}): ProjectProductionContext => {
	const production = input.production;
	const qcIssueCount = Object.values(production?.qcResults ?? {}).reduce(
		(total, result) => total + (result.status === "PASS" ? 0 : 1),
		0,
	);
	const qcPassCount = Object.values(production?.qcResults ?? {}).filter(
		(result) => result.status === "PASS",
	).length;
	const blockerCount =
		(production?.blockers ?? []).length +
		Object.values(production?.stageStates ?? {}).filter(
			(state) => state.status === "BLOCKED" || Boolean(state.blocker),
		).length;
	return {
		projectId: input.projectId,
		name: input.name,
		templateId: production?.template.id,
		templateName: production?.template.name ?? input.pipeline.templateLabel,
		currentStageId:
			production?.currentStageId ??
			input.pipeline.stages.find((stage) => stage.status === "current")?.id,
		stageCount: input.pipeline.total,
		completedStageCount: input.pipeline.completed,
		progress: input.pipeline.percent,
		resourceCount: input.resourceCount,
		selectedAssetCount: input.selectedAssetCount,
		shotCount: input.shotCount,
		draftStoryboardCount: input.draftStoryboardCount ?? 0,
		blockerCount,
		qcIssueCount,
		versionCount: production?.versions?.length ?? 0,
		outputArchiveCount: production?.outputArchives?.length ?? 0,
		qcPassCount,
		sharedMemoryReady: Boolean(
			production?.sharedContext?.projectBrief ||
			production?.sharedContext?.script ||
			production?.sharedContext?.visualDNA,
		),
		outputDirectory: input.outputDirectory ?? production?.sharedContext?.outputDirectory,
		production,
	};
};
