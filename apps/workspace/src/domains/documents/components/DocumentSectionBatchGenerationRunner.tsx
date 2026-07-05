import { useCallback, useEffect, useMemo } from "react";
import type React from "react";
import type {
	GenerationFamily,
	GenerationKind,
	GenerationPromptOptimizationRequest,
	GenerationRoute,
	GenerationVersion,
} from "@/domains/generation/api/generation";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { useDocumentSectionGenerationContext } from "@/domains/documents/components/useDocumentSectionGenerationContext";
import { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import { kindLabel } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";

export interface DocumentSectionBatchGenerationSettings {
	family: GenerationFamily;
	params: Record<string, unknown>;
	promptOptimization?: GenerationPromptOptimizationRequest;
	promptSupplement?: DocumentSectionPromptSupplement;
	referenceAssetIds?: string[];
	route: GenerationRoute;
	version: GenerationVersion;
}

export interface DocumentSectionPromptSupplement {
	referenceName: string;
	referencePrompt: string;
}

export interface DocumentSectionBatchGenerationJob {
	batchId?: string;
	generationSettings?: DocumentSectionBatchGenerationSettings;
	id: string;
	kind: GenerationKind;
	projectId?: string;
	resolveLatestSection?: boolean;
	section: MarkdownSectionContext;
	statusResourceId?: string;
}

export interface DocumentSectionBatchGenerationRunnerProps {
	concurrency?: number;
	jobs: DocumentSectionBatchGenerationJob[];
	onJobError?: (job: DocumentSectionBatchGenerationJob, message: string) => void;
	onJobSettled: (jobId: string) => void;
}

const submittedBatchGenerationJobKeys = new Set<string>();

export const clearSubmittedBatchGenerationJobIdsForTest = () => {
	submittedBatchGenerationJobKeys.clear();
};

export const appendDocumentSectionPromptSupplement = (
	currentPrompt: string,
	supplement: DocumentSectionPromptSupplement | null | undefined,
) => {
	const current = currentPrompt.trim();
	const reference = supplement?.referencePrompt.trim() ?? "";
	if (!current) return reference;
	if (!reference || current.includes(reference)) return current;
	return `${current}\n\n${reference}`;
};

export const DocumentSectionBatchGenerationRunner: React.FC<
	DocumentSectionBatchGenerationRunnerProps
> = ({ concurrency = 1, jobs, onJobError, onJobSettled }) => {
	const activeJobs = useMemo(() => jobs.slice(0, Math.max(1, concurrency)), [concurrency, jobs]);

	useEffect(() => {
		const queuedJobKeys = new Set(jobs.map(batchGenerationJobSubmissionKey).filter(Boolean));
		for (const jobKey of submittedBatchGenerationJobKeys) {
			if (!queuedJobKeys.has(jobKey)) submittedBatchGenerationJobKeys.delete(jobKey);
		}
	}, [jobs]);

	return (
		<>
			{activeJobs.map((job) => (
				<DocumentSectionBatchGenerationWorker
					key={job.id}
					job={job}
					onJobError={onJobError}
					onJobSettled={onJobSettled}
				/>
			))}
		</>
	);
};

const DocumentSectionBatchGenerationWorker: React.FC<{
	job: DocumentSectionBatchGenerationJob;
	onJobError?: (job: DocumentSectionBatchGenerationJob, message: string) => void;
	onJobSettled: (jobId: string) => void;
}> = ({ job, onJobError, onJobSettled }) => {
	const generationContext = useDocumentSectionGenerationContext({
		kind: job.kind,
		projectId: job.projectId,
		resolveLatestSection: job.resolveLatestSection,
		section: job.section,
	});
	const reportError = useCallback(
		(message: string) => {
			onJobError?.(job, message);
		},
		[job, onJobError],
	);
	const workspace = useGenerationWorkspace({
		assetTitle: generationContext.activeSection.headingText,
		conversationId: generationContext.projectConversation?.conversationId,
		conversationScopeId: generationContext.conversationScopeId,
		conversationTitle: generationContext.projectConversation?.conversationTitle,
		documentContext: generationContext.documentContext,
		initialKind: job.kind,
		initialPrompt: generationContext.activeSection.prompt,
		mediaAssetProjectId: generationContext.normalizedProjectId || undefined,
		modelPreferenceScopeId: generationContext.modelPreferenceScopeId,
		notificationTarget: generationContext.notificationTarget,
		onSubmitError: reportError,
		projectId: generationContext.normalizedProjectId || undefined,
		projectStyleOnly: true,
		sectionId: generationContext.sectionId,
		taskType: generationContext.taskType,
		uploadIdPrefix: "section-batch-generation",
		useRawPrompt: true,
	});
	const selectedRoute = job.generationSettings?.route ?? workspace.selectedRoute;

	useEffect(() => {
		const submissionKey = batchGenerationJobSubmissionKey(job);
		if (!submissionKey) return;
		if (submittedBatchGenerationJobKeys.has(submissionKey)) return;
		if (!workspace.hasLiveCatalog) return;

		const supplementalPrompt = job.generationSettings?.promptSupplement
			? appendDocumentSectionPromptSupplement(
					generationContext.activeSection.prompt,
					job.generationSettings.promptSupplement,
				)
			: undefined;
		const hasDefaultPrompt =
			(supplementalPrompt ?? generationContext.activeSection.prompt).trim() !== "";
		const hasDocumentContext = Boolean(generationContext.documentContext);
		const routeReady =
			workspace.hasConfiguredRoutesForKind &&
			!workspace.needsConversation &&
			selectedRoute.status === "available" &&
			selectedRoute.configured;
		if (!routeReady || (!hasDefaultPrompt && !hasDocumentContext)) {
			submittedBatchGenerationJobKeys.add(submissionKey);
			reportError(
				!hasDefaultPrompt && !hasDocumentContext
					? "没有可用的默认提示词。"
					: `暂无可用${kindLabel(job.kind)}生成供应商。`,
			);
			onJobSettled(job.id);
			return;
		}

		submittedBatchGenerationJobKeys.add(submissionKey);
		const generationOverrides = job.generationSettings
			? {
					selectedFamily: job.generationSettings.family,
					selectedParams: job.generationSettings.params,
					...(supplementalPrompt !== undefined ? { prompt: supplementalPrompt } : {}),
					promptOptimization: job.generationSettings.promptOptimization,
					...(job.generationSettings.referenceAssetIds?.length
						? { referenceAssetIds: job.generationSettings.referenceAssetIds }
						: {}),
					selectedRoute: job.generationSettings.route,
					selectedVersion: job.generationSettings.version,
				}
			: {};
		void workspace
			.submitGeneration({
				resetPrompt: false,
				...generationOverrides,
			})
			.finally(() => onJobSettled(job.id));
	}, [
		generationContext.activeSection.prompt,
		generationContext.documentContext,
		job.generationSettings?.family,
		job.generationSettings?.params,
		job.generationSettings?.promptOptimization,
		job.generationSettings?.promptSupplement,
		job.generationSettings?.referenceAssetIds,
		job.generationSettings?.route,
		job.generationSettings?.version,
		job.id,
		job.kind,
		onJobSettled,
		reportError,
		selectedRoute.configured,
		selectedRoute.status,
		workspace.hasConfiguredRoutesForKind,
		workspace.hasLiveCatalog,
		workspace.needsConversation,
		workspace.submitGeneration,
	]);

	return null;
};

const batchGenerationJobSubmissionKey = (job: DocumentSectionBatchGenerationJob) => {
	const batchId = job.batchId?.trim();
	if (!batchId) return "";

	return `${batchId}:${job.id}`;
};
