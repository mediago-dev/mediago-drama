import type React from "react";
import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { AgentStateSync } from "@/domains/agent/components/AgentStateSync";
import { AgentCompletionNotificationSync } from "@/domains/agent/components/AgentCompletionNotificationSync";
import { AgentPermissionNotificationSync } from "@/domains/agent/components/AgentPermissionNotificationSync";
import { DocumentStateSync } from "@/domains/documents/components/DocumentStateSync";
import { AppLayout } from "@/domains/workspace/components/AppLayout";
import { ProjectNavigator } from "@/domains/workspace/components/ProjectNavigator";
import { resolveAppRouteDescriptor } from "@/domains/workspace/lib/app-route-descriptor";
import {
	getRouteAgentSessionId,
	getRouteDocumentId,
	getRouteProjectId,
	isAgentRoute,
	isSettingsRoute,
	workbenchModeForRoute,
} from "@/domains/workspace/lib/workbench-route";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";
import { useWorkModeStore } from "@/lib/stores/work-mode";
import { AppRoutes } from "@/router/routes";
import { AnalyticsRouteSync } from "@/shared/analytics";
import { useEscapeBackNavigation } from "@/hooks/useEscapeBackNavigation";

export const App: React.FC = () => {
	const location = useLocation();
	const navigate = useNavigate();
	useEscapeBackNavigation(navigate);
	const workMode = useWorkModeStore((state) => state.mode);
	const routeProjectId = getRouteProjectId(location.search);
	const routeAgentSessionId = getRouteAgentSessionId(location.search);
	const routeDocumentId = getRouteDocumentId(location.search);
	const isProjectRoute = isAgentRoute(location.pathname) && Boolean(routeProjectId);
	const routeIsSettings = isSettingsRoute(location.pathname);
	const showProjectWorkspaceFrame = isProjectRoute && !routeIsSettings;
	const routeWorkbenchMode = workbenchModeForRoute(location.pathname, workMode);
	const agentLayoutTab = useAgentLayoutStore((state) => state.tab);
	const setAgentPanelSize = useAgentLayoutStore((state) => state.setPanelSize);
	const setAgentLayoutTab = useAgentLayoutStore((state) => state.setTab);
	const lastProjectSurfaceRef = useRef<string | null>(null);
	const routeDescriptor = resolveAppRouteDescriptor(location.pathname, location.search, {
		projectId: routeProjectId,
		workMode,
	});
	const isAgentSurfaceActive =
		showProjectWorkspaceFrame && routeWorkbenchMode === "agent" && agentLayoutTab === "agent";
	const returnFromDocument = () => {
		const params = new URLSearchParams(location.search);
		params.delete("documentId");
		setAgentLayoutTab("agent");
		window.history.pushState({}, "", `${location.pathname}?${params.toString()}`);
		window.dispatchEvent(new PopStateEvent("popstate"));
	};
	useEffect(() => {
		if (!showProjectWorkspaceFrame) {
			lastProjectSurfaceRef.current = null;
			return;
		}
		// 在项目内切换“开始制作 / 参考图 / 资产 / 镜头”等工作面时，
		// 对话是工作区本身，不应被路由切换收起。只在工作面变化时展开，
		// 这样用户仍可在当前页面手动收起。
		const surfaceKey = `${routeProjectId ?? ""}:${location.pathname}:${routeWorkbenchMode}`;
		if (lastProjectSurfaceRef.current === surfaceKey) return;
		lastProjectSurfaceRef.current = surfaceKey;
		setAgentLayoutTab("agent");
		setAgentPanelSize("expanded");
	}, [
		location.pathname,
		routeProjectId,
		routeWorkbenchMode,
		setAgentLayoutTab,
		setAgentPanelSize,
		showProjectWorkspaceFrame,
	]);
	if (location.pathname === "/prompt-pack-editor") {
		return (
			<>
				<AnalyticsRouteSync />
				<AppRoutes />
			</>
		);
	}

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
			<AgentCompletionNotificationSync
				isAgentSurfaceActive={isAgentSurfaceActive}
				projectId={routeProjectId}
			/>
			<DocumentStateSync projectId={routeProjectId} />

			<AppLayout
				headerLeading={
					routeDocumentId ? (
						<button
							type="button"
							aria-label="返回制作流程"
							title="返回刚才的制作界面"
							className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
							onClick={returnFromDocument}
						>
							<ArrowLeft className="size-4" aria-hidden="true" />
							<span>返回制作流程</span>
						</button>
					) : null
				}
				headerTitle={routeDescriptor.title}
				showHeader={!routeIsSettings}
				sidebar={<ProjectNavigator activeProjectId={routeProjectId} />}
				sidebarHidden={routeDescriptor.sidebarHidden}
			>
				{showProjectWorkspaceFrame ? (
					<div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
						<div className="min-h-0 min-w-0 flex-1 overflow-hidden">
							<AppRoutes />
						</div>
						<div id="production-assistant-dock-root" className="shrink-0" />
					</div>
				) : (
					<AppRoutes />
				)}
			</AppLayout>
		</>
	);
};
