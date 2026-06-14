import type React from "react";
import { lazy, Suspense, useEffect, useLayoutEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { selectDocumentsForEditorPrewarm } from "@/domains/documents/lib/editor-prewarm";
import { useDocumentsStore } from "@/domains/documents/stores";
import { useProjectStore } from "@/domains/projects/stores";
import { WorkspaceContentFallback } from "@/domains/workspace/components/WorkspaceContentFallback";
import {
	agentProjectPath,
	getRouteAssetId,
	getRouteDocumentId,
	getRouteDocumentWorkbench,
	getRouteProjectId,
	isAgentProjectViewState,
} from "@/domains/workspace/lib/workbench-route";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";

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

export const Home: React.FC = () => {
	const location = useLocation();
	const projectId = getRouteProjectId(location.search);
	const documentId = getRouteDocumentId(location.search);
	const assetId = getRouteAssetId(location.search);
	const documentWorkbench = getRouteDocumentWorkbench(location.search);
	const preserveAgentTab = isAgentProjectViewState(location.state, "agent");
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const activeAssetId = useDocumentsStore((state) => state.activeAssetId);
	const documents = useDocumentsStore((state) => state.documents);
	const assets = useDocumentsStore((state) => state.assets);
	const documentsProjectId = useDocumentsStore((state) => state.projectId);
	const syncStatus = useDocumentsStore((state) => state.syncStatus);
	const selectDocument = useDocumentsStore((state) => state.selectDocument);
	const selectAsset = useDocumentsStore((state) => state.selectAsset);
	const activeProjectId = useProjectStore((state) => state.activeProjectId);
	const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);
	const setAgentLayoutTab = useAgentLayoutStore((state) => state.setTab);
	const targetDocument = documentId
		? documents.find((document) => document.id === documentId)
		: null;
	const targetAsset = assetId ? assets.find((asset) => asset.id === assetId) : null;
	const hasWorkspaceTarget = documentWorkbench !== "timeline" && Boolean(documentId || assetId);
	const workspaceTargetMissing =
		documentsProjectId === projectId &&
		hasWorkspaceTarget &&
		((documentId && !targetDocument) || (assetId && !targetAsset)) &&
		(syncStatus === "synced" || syncStatus === "error");
	const workspaceTargetPending =
		hasWorkspaceTarget &&
		(!documentsProjectId ||
			documentsProjectId !== projectId ||
			(documentId && (!targetDocument || activeDocumentId !== targetDocument.id)) ||
			(assetId && (!targetAsset || activeAssetId !== targetAsset.id)));

	useEffect(() => {
		if (projectId && activeProjectId !== projectId) setActiveProjectId(projectId);
	}, [activeProjectId, projectId, setActiveProjectId]);

	useEffect(() => {
		if (!projectId || documentWorkbench === "timeline" || preserveAgentTab) return;
		setAgentLayoutTab("document");
	}, [documentWorkbench, preserveAgentTab, projectId, setAgentLayoutTab]);

	useEffect(() => {
		if (!projectId) return;
		void loadWritingWorkspace();
	}, [projectId]);

	useLayoutEffect(() => {
		if (!projectId || documentsProjectId !== projectId || documentWorkbench === "timeline") return;
		if (targetDocument && activeDocumentId !== targetDocument.id) {
			selectDocument(targetDocument.id);
			return;
		}
		if (targetAsset && activeAssetId !== targetAsset.id) selectAsset(targetAsset.id);
	}, [
		activeAssetId,
		activeDocumentId,
		documentWorkbench,
		documentsProjectId,
		projectId,
		selectAsset,
		selectDocument,
		targetAsset,
		targetDocument,
	]);

	useEffect(() => {
		if (!projectId || documentsProjectId !== projectId || documentId || assetId) {
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
	}, [activeDocumentId, assetId, documentId, documents, documentsProjectId, projectId]);

	if (!projectId) return <Navigate to="/" replace />;
	if (workspaceTargetMissing) {
		return <Navigate to={agentProjectPath(projectId)} replace />;
	}
	if (documentId && documentWorkbench === "timeline") {
		return (
			<Suspense fallback={<WorkspaceContentFallback />}>
				<EpisodeTimeline />
			</Suspense>
		);
	}
	if (documentId || assetId) {
		if (workspaceTargetPending) return <WorkspaceContentFallback />;
		return (
			<Suspense fallback={<WorkspaceContentFallback />}>
				<WritingWorkspace />
			</Suspense>
		);
	}
	return (
		<Suspense fallback={<WorkspaceContentFallback />}>
			<ProjectOverview />
		</Suspense>
	);
};
