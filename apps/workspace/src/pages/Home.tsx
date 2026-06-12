import type React from "react";
import { lazy, Suspense, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useProjectStore } from "@/domains/projects/stores";
import {
	getRouteDocumentId,
	getRouteProjectId,
	isAgentProjectViewState,
} from "@/domains/workspace/lib/workbench-route";

const WritingWorkspace = lazy(() =>
	import("@/domains/documents/components/WritingWorkspace").then((module) => ({
		default: module.WritingWorkspace,
	})),
);
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
	const activeProjectId = useProjectStore((state) => state.activeProjectId);
	const setActiveProjectId = useProjectStore((state) => state.setActiveProjectId);

	useEffect(() => {
		if (projectId && activeProjectId !== projectId) setActiveProjectId(projectId);
	}, [activeProjectId, projectId, setActiveProjectId]);

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
