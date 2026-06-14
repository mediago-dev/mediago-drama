import type React from "react";
import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { EpisodeTimelineView } from "@/domains/episode/components/EpisodeTimelineView";
import { ProjectWorkspaceShell } from "@/domains/workspace/components/ProjectWorkspaceShell";
import {
	findDocumentById,
	getProjectScopedDocuments,
	isStoryboardWorkbenchDocument,
	selectStoryboardWorkbenchDocument,
} from "@/domains/documents/lib/filters";
import { useDocumentsStore } from "@/domains/documents/stores";
import { useProjectStore } from "@/domains/projects/stores";
import {
	agentProjectPath,
	getRouteDocumentId,
	getRouteProjectId,
} from "@/domains/workspace/lib/workbench-route";

export const EpisodeTimeline: React.FC = () => {
	const location = useLocation();
	const documentId = getRouteDocumentId(location.search);
	const projectId = getRouteProjectId(location.search);
	const activeProjectId = useProjectStore((state) => state.activeProjectId);
	const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);
	const documents = useDocumentsStore((state) => state.documents);
	const activeDocumentId = useDocumentsStore((state) => state.activeDocumentId);
	const loadedProjectId = useDocumentsStore((state) => state.projectId);
	const selectDocument = useDocumentsStore((state) => state.selectDocument);
	const syncStatus = useDocumentsStore((state) => state.syncStatus);
	const projectDocuments = getProjectScopedDocuments(documents, loadedProjectId, projectId);
	const fallbackDocument = selectStoryboardWorkbenchDocument(projectDocuments, activeDocumentId);
	const targetDocument = documentId
		? findDocumentById(projectDocuments, documentId)
		: fallbackDocument;

	useEffect(() => {
		if (projectId && activeProjectId !== projectId) setActiveProjectId(projectId);
	}, [activeProjectId, projectId, setActiveProjectId]);

	useEffect(() => {
		if (targetDocument && activeDocumentId !== targetDocument.id) selectDocument(targetDocument.id);
	}, [activeDocumentId, selectDocument, targetDocument]);

	if (!projectId) return <Navigate to="/" replace />;
	if (!documentId && targetDocument) {
		return (
			<Navigate
				to={agentProjectPath(projectId, {
					documentId: targetDocument.id,
					workbench: "timeline",
				})}
				replace
			/>
		);
	}
	if (targetDocument && !isStoryboardWorkbenchDocument(targetDocument)) {
		return <Navigate to={agentProjectPath(projectId, { documentId: targetDocument.id })} replace />;
	}
	if (!targetDocument) {
		if (loadedProjectId === projectId && (syncStatus === "synced" || syncStatus === "error")) {
			return <Navigate to={agentProjectPath(projectId)} replace />;
		}

		return (
			<ProjectWorkspaceShell>
				<div className="grid h-full min-h-0 place-items-center bg-ide-editor">
					<p className="text-sm text-muted-foreground">正在加载剪辑台草稿...</p>
				</div>
			</ProjectWorkspaceShell>
		);
	}

	return (
		<ProjectWorkspaceShell>
			<EpisodeTimelineView documentId={targetDocument.id} />
		</ProjectWorkspaceShell>
	);
};
