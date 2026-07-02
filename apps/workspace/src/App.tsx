import type React from "react";
import { useLocation } from "react-router-dom";
import { AgentStateSync } from "@/domains/agent/components/AgentStateSync";
import { AgentPanel } from "@/domains/agent/components/AgentPanel";
import { AgentPermissionNotificationSync } from "@/domains/agent/components/AgentPermissionNotificationSync";
import { DocumentStateSync } from "@/domains/documents/components/DocumentStateSync";
import { AgentWorkbenchHeaderActions } from "@/domains/workspace/components/AgentWorkbenchTopBar";
import { AppLayout } from "@/domains/workspace/components/AppLayout";
import { ProjectNavigator } from "@/domains/workspace/components/ProjectNavigator";
import { resolveAppRouteDescriptor } from "@/domains/workspace/lib/app-route-descriptor";
import {
	getRouteAssetId,
	getRouteAgentSessionId,
	getRouteDocumentId,
	getRouteProjectId,
	isAgentDocumentRoute,
	isAgentProjectViewState,
	isAgentRoute,
	isSettingsRoute,
	shouldForceDocumentWorkbench,
	workbenchModeForRoute,
} from "@/domains/workspace/lib/workbench-route";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";
import { useWorkModeStore } from "@/lib/stores/work-mode";
import { AppRoutes } from "@/router/routes";
import { AnalyticsRouteSync } from "@/shared/analytics";
import { cn } from "@/shared/lib/utils";

export const App: React.FC = () => {
	const location = useLocation();
	const workMode = useWorkModeStore((state) => state.mode);
	const routeProjectId = getRouteProjectId(location.search);
	const routeAgentSessionId = getRouteAgentSessionId(location.search);
	const routeDocumentId = getRouteDocumentId(location.search);
	const routeAssetId = getRouteAssetId(location.search);
	const preserveAgentTab = isAgentProjectViewState(location.state, "agent");
	const preserveDocumentTab =
		isAgentProjectViewState(location.state, "document") ||
		isAgentProjectViewState(location.state, "overview");
	const isProjectRoute = isAgentRoute(location.pathname) && Boolean(routeProjectId);
	const isEpisodeRoute = isAgentDocumentRoute(location.pathname, location.search);
	const routeIsSettings = isSettingsRoute(location.pathname);
	const showProjectWorkspaceFrame = isProjectRoute && !routeIsSettings;
	const routeWorkbenchMode = workbenchModeForRoute(location.pathname, workMode);
	const forceDocumentWorkbench = shouldForceDocumentWorkbench(location.pathname, location.search);
	const agentLayoutTab = useAgentLayoutStore((state) => state.tab);
	const forceProjectDocumentTab =
		isProjectRoute && !preserveAgentTab && Boolean(routeDocumentId || routeAssetId);
	const defaultProjectAgentTab =
		isProjectRoute && !preserveDocumentTab && !routeDocumentId && !routeAssetId;
	const activeWorkbenchTab =
		forceDocumentWorkbench || forceProjectDocumentTab || preserveDocumentTab
			? "document"
			: defaultProjectAgentTab
				? "agent"
				: agentLayoutTab;
	const routeDescriptor = resolveAppRouteDescriptor(location.pathname, location.search, {
		projectId: routeProjectId,
		workMode,
	});
	const showWorkbenchTabs =
		showProjectWorkspaceFrame && routeWorkbenchMode === "agent" && !forceDocumentWorkbench;
	const isAgentSurfaceActive =
		showProjectWorkspaceFrame && routeWorkbenchMode === "agent" && activeWorkbenchTab === "agent";
	const headerActions = showWorkbenchTabs ? (
		<AgentWorkbenchHeaderActions mode={routeWorkbenchMode} showTabs={!forceDocumentWorkbench} />
	) : null;

	return (
		<>
			<AnalyticsRouteSync />
			<AgentStateSync
				agentSurfaceActive={isAgentSurfaceActive}
				projectId={routeProjectId}
				routeSessionId={routeAgentSessionId}
			/>
			<AgentPermissionNotificationSync
				isAgentSurfaceActive={isAgentSurfaceActive}
				projectId={routeProjectId}
			/>
			<DocumentStateSync projectId={routeProjectId} />

			<AppLayout
				headerActions={headerActions}
				headerTitle={routeDescriptor.title}
				showHeader={!isEpisodeRoute && !routeIsSettings}
				sidebar={<ProjectNavigator activeProjectId={routeProjectId} />}
				sidebarHidden={routeDescriptor.sidebarHidden}
			>
				{showProjectWorkspaceFrame ? (
					<div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
						<div className="relative min-h-0 flex-1 overflow-hidden">
							<div
								className={cn(
									"h-full min-h-0 min-w-0 overflow-hidden",
									activeWorkbenchTab === "agent" && "hidden",
								)}
							>
								<AppRoutes />
							</div>
							<div
								className={cn(
									"absolute inset-0 overflow-hidden bg-ide-panel",
									activeWorkbenchTab === "document" && "hidden",
								)}
							>
								<AgentPanel />
							</div>
						</div>
					</div>
				) : (
					<AppRoutes />
				)}
			</AppLayout>
		</>
	);
};
