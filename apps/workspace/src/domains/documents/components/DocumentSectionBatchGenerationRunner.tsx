import { useCallback, useEffect, useMemo, useRef } from "react";
import type React from "react";
import type { GenerationKind } from "@/domains/generation/api/generation";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { useDocumentSectionGenerationContext } from "@/domains/documents/components/useDocumentSectionGenerationContext";
import { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";
import { kindLabel } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";

export interface DocumentSectionBatchGenerationJob {
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

export const DocumentSectionBatchGenerationRunner: React.FC<
	DocumentSectionBatchGenerationRunnerProps
> = ({ concurrency = 3, jobs, onJobError, onJobSettled }) => {
	const activeJobs = useMemo(() => jobs.slice(0, Math.max(1, concurrency)), [concurrency, jobs]);

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
	const submittedRef = useRef(false);
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
		historyScopeId: generationContext.historyScopeId,
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

	useEffect(() => {
		submittedRef.current = false;
	}, [job.id]);

	useEffect(() => {
		if (submittedRef.current) return;
		if (!workspace.hasLiveCatalog) return;

		const hasDefaultPrompt = generationContext.activeSection.prompt.trim() !== "";
		const hasDocumentContext = Boolean(generationContext.documentContext);
		const routeReady =
			workspace.hasConfiguredRoutesForKind &&
			!workspace.needsConversation &&
			workspace.selectedRoute.status === "available" &&
			workspace.selectedRoute.configured;
		if (!routeReady || (!hasDefaultPrompt && !hasDocumentContext)) {
			submittedRef.current = true;
			reportError(
				!hasDefaultPrompt && !hasDocumentContext
					? "没有可用的默认提示词。"
					: `暂无可用${kindLabel(job.kind)}生成供应商。`,
			);
			onJobSettled(job.id);
			return;
		}

		submittedRef.current = true;
		void workspace.submitGeneration({ resetPrompt: false }).finally(() => onJobSettled(job.id));
	}, [
		generationContext.activeSection.prompt,
		generationContext.documentContext,
		job.id,
		job.kind,
		onJobSettled,
		reportError,
		workspace.hasConfiguredRoutesForKind,
		workspace.hasLiveCatalog,
		workspace.needsConversation,
		workspace.selectedRoute.configured,
		workspace.selectedRoute.status,
		workspace.submitGeneration,
	]);

	return null;
};
