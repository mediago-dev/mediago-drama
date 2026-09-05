import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { showAgentPermissionSystemNotification } from "@/domains/agent/lib/permission-notifications";
import { selectAgentPermissionRequests, useAgentStore } from "@/domains/agent/stores";
import { agentProjectRouteState } from "@/domains/workspace/lib/workbench-route";
import { useAgentLayoutStore } from "@/lib/stores/agent-layout";
import { useToast } from "@/hooks/useToast";

interface AgentPermissionNotificationSyncProps {
	isAgentSurfaceActive: boolean;
	projectId?: string | null;
}

export const AgentPermissionNotificationSync: React.FC<AgentPermissionNotificationSyncProps> = ({
	isAgentSurfaceActive,
	projectId,
}) => {
	const navigate = useNavigate();
	const location = useLocation();
	const toast = useToast();
	const permissionRequests = useAgentStore(selectAgentPermissionRequests);
	const [windowActive, setWindowActive] = useState(isWindowActive);
	const notifiedRequestIds = useRef(new Set<string>());

	useEffect(() => {
		const syncWindowActive = () => setWindowActive(isWindowActive());
		window.addEventListener("focus", syncWindowActive);
		window.addEventListener("blur", syncWindowActive);
		document.addEventListener("visibilitychange", syncWindowActive);
		return () => {
			window.removeEventListener("focus", syncWindowActive);
			window.removeEventListener("blur", syncWindowActive);
			document.removeEventListener("visibilitychange", syncWindowActive);
		};
	}, []);

	useEffect(() => {
		const pendingIds = new Set(permissionRequests.map((request) => request.requestId.trim()));
		for (const requestId of notifiedRequestIds.current) {
			if (!pendingIds.has(requestId)) notifiedRequestIds.current.delete(requestId);
		}

		const shouldNotify = permissionRequests.length > 0 && (!windowActive || !isAgentSurfaceActive);
		if (!shouldNotify) return;

		for (const request of permissionRequests) {
			const requestId = request.requestId.trim();
			if (!requestId || notifiedRequestIds.current.has(requestId)) continue;
			notifiedRequestIds.current.add(requestId);
			void showAgentPermissionSystemNotification(request, () => {
				window.focus();
				useAgentLayoutStore.getState().setTab("agent");
				if (projectId) {
					navigate(preserveProjectRoute(location, projectId), {
						state: agentProjectRouteState("agent"),
					});
				}
			}).then((result) => {
				if (result === "shown") return;
				toast.warning("Agent 等待权限确认", {
					description: request.toolCall?.title || "有工具调用需要确认后继续。",
				});
			});
		}
	}, [
		isAgentSurfaceActive,
		location,
		navigate,
		permissionRequests,
		projectId,
		toast,
		windowActive,
	]);

	return null;
};

const isWindowActive = () =>
	typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();

const preserveProjectRoute = (location: ReturnType<typeof useLocation>, projectId: string) => {
	const params = new URLSearchParams(location.search);
	params.set("projectId", projectId);
	return `${location.pathname === "/projects" ? location.pathname : "/projects"}?${params.toString()}`;
};
