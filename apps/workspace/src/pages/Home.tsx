import type React from "react";
import { lazy, Suspense, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { selectDocumentsForEditorPrewarm } from "@/domains/documents/lib/editor-prewarm";
import { useDocumentsStore } from "@/domains/documents/stores";
import { useProjectStore } from "@/domains/projects/stores";
import {
	getRouteDocumentId,
	getRouteProjectId,
	isAgentProjectViewState,
} from "@/domains/workspace/lib/workbench-route";

type BrowserIdleWindow = Window & {
	cancelIdleCallback?: (handle: number) => void;
	requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
};

const loadWritingWorkspaceModule = () => import("@/domains/documents/components/WritingWorkspace");

const loadWritingWorkspace = () =>
	loadWritingWorkspaceModule().then((module) => ({
		default: module.WritingWorkspace,
	}));

const WritingWorkspace = lazy(() => loadWritingWorkspace());
const EpisodeTimeline = lazy(() =>
	import("@/pages/EpisodeTimeline").then((module) => ({ default: module.EpisodeTimeline })),
);
const ProjectOverview = lazy(() =>
	import("@/pages/ProjectOverview").then((module) => ({ default: module.ProjectOverview })),
);

const HomeFallback: React.FC = () => (
	<div className="h-full min-h-0 bg-ide-editor text-ide-editor-foreground" />
);

export const Home: React.FC = () => {
	const location = useLocation();
	const projectId = getRouteProjectId(location.search);
	const documentId = getRouteDocumentId(location.search);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const documents = useDocumentsStore((state) => state.documents);
	const documentsProjectId = useDocumentsStore((state) => state.projectId);
	const activeProjectId = useProjectStore((state) => state.activeProjectId);
	const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);

	useEffect(() => {
		if (projectId && activeProjectId !== projectId) setActiveProjectId(projectId);
	}, [activeProjectId, projectId, setActiveProjectId]);

	useEffect(() => {
		if (!projectId) return;
		void loadWritingWorkspace();
	}, [projectId]);

	useEffect(() => {
		if (
			!projectId ||
			documentsProjectId !== projectId ||
			documentId ||
			isAgentProjectViewState(location.state, "document")
		) {
			return;
		}

		const candidates = selectDocumentsForEditorPrewarm(documents, activeDocumentId);
		if (candidates.length === 0) return;

		let cancelled = false;
		let timeoutHandle: number | null = null;
		let idleHandle: number | null = null;
		let candidateIndex = 0;
		const browserWindow = window as BrowserIdleWindow;

		const clearScheduledWork = () => {
			if (timeoutHandle !== null) {
				window.clearTimeout(timeoutHandle);
				timeoutHandle = null;
			}
			if (idleHandle !== null && browserWindow.cancelIdleCallback) {
				browserWindow.cancelIdleCallback(idleHandle);
				idleHandle = null;
			}
		};

		const scheduleNextPrewarm = (delayMs: number) => {
			clearScheduledWork();
			if (cancelled || candidateIndex >= candidates.length) return;

			timeoutHandle = window.setTimeout(() => {
				timeoutHandle = null;
				const runPrewarm = () => {
					idleHandle = null;
					void loadWritingWorkspaceModule().then((module) => {
						if (cancelled) return;

						const candidate = candidates[candidateIndex];
						candidateIndex += 1;
						if (candidate) module.prewarmWritingDocumentEditor(candidate);
						scheduleNextPrewarm(120);
					});
				};

				if (browserWindow.requestIdleCallback) {
					idleHandle = browserWindow.requestIdleCallback(runPrewarm, { timeout: 2500 });
					return;
				}

				timeoutHandle = window.setTimeout(runPrewarm, 300);
			}, delayMs);
		};

		scheduleNextPrewarm(450);

		return () => {
			cancelled = true;
			clearScheduledWork();
		};
	}, [activeDocumentId, documentId, documents, documentsProjectId, location.state, projectId]);

	if (!projectId) return <Navigate to="/" replace />;
	if (documentId) {
		return (
			<Suspense fallback={<HomeFallback />}>
				<EpisodeTimeline />
			</Suspense>
		);
	}
	if (isAgentProjectViewState(location.state, "overview")) {
		return (
			<Suspense fallback={<HomeFallback />}>
				<ProjectOverview />
			</Suspense>
		);
	}
	return (
		<Suspense fallback={<HomeFallback />}>
			<WritingWorkspace />
		</Suspense>
	);
};
