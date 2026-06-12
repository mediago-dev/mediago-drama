import type { WorkMode } from "@/lib/stores/work-mode";

export type AgentProjectView = "document" | "overview";

export const getRouteProjectId = (search: string) => getSearchParam(search, "projectId");

export const getRouteDocumentId = (search: string) => getSearchParam(search, "documentId");

export const isAgentRoute = (pathname: string) => pathname === "/agent";

export const isProjectSettingsRoute = (pathname: string, search: string) =>
	isSettingsRoute(pathname) && Boolean(getRouteProjectId(search));

export const isSettingsRoute = (pathname: string) =>
	pathname === "/settings" || pathname.startsWith("/settings/");

export const isAgentDocumentRoute = (pathname: string, search: string) =>
	isAgentRoute(pathname) && Boolean(getRouteProjectId(search) && getRouteDocumentId(search));

export const workbenchModeForRoute = (
	pathname: string,
	workMode?: WorkMode | null,
): WorkMode | null => {
	if (isAgentRoute(pathname)) return "agent";
	if (pathname === "/studio" || pathname.startsWith("/studio/")) return "studio";
	if (pathname === "/") return workMode ?? null;
	return null;
};

export const shouldForceDocumentWorkbench = (pathname: string, search: string) => {
	if (!isAgentRoute(pathname)) {
		const mode = workbenchModeForRoute(pathname);
		return mode === "studio";
	}
	return Boolean(getRouteDocumentId(search));
};

export const agentProjectPath = (
	projectId: string,
	options: { documentId?: string | null } = {},
) => {
	const params = new URLSearchParams();
	params.set("projectId", projectId);
	if (options.documentId) params.set("documentId", options.documentId);
	return `/agent?${params.toString()}`;
};

export const studioTabPath = (
	tab: "image" | "text" | "video",
	options: { conversationId?: string | null } = {},
) => {
	const params = new URLSearchParams();
	if (options.conversationId) params.set("conversation", options.conversationId);
	const query = params.toString();
	return query ? `/studio/${tab}?${query}` : `/studio/${tab}`;
};

export const settingsPath = (projectId?: string | null) => {
	if (!projectId) return "/settings";
	const params = new URLSearchParams();
	params.set("projectId", projectId);
	return `/settings?${params.toString()}`;
};

export const agentProjectRouteState = (projectView: AgentProjectView) => ({ projectView });

export const isAgentProjectViewState = (state: unknown, projectView: AgentProjectView): boolean =>
	Boolean(
		state &&
		typeof state === "object" &&
		(state as { projectView?: unknown }).projectView === projectView,
	);

const getSearchParam = (search: string, key: string) => {
	const value = new URLSearchParams(search).get(key)?.trim() ?? "";
	return value || null;
};
