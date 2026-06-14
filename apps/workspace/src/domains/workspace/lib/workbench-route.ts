import type { WorkMode } from "@/lib/stores/work-mode";

export type AgentProjectView = "agent" | "document" | "overview";
export type AgentDocumentWorkbench = "timeline";

export const getRouteProjectId = (search: string) => getSearchParam(search, "projectId");

export const getRouteDocumentId = (search: string) => getSearchParam(search, "documentId");

export const getRouteAssetId = (search: string) => getSearchParam(search, "assetId");

export const getRouteDocumentWorkbench = (search: string): AgentDocumentWorkbench | null => {
	const value = getSearchParam(search, "workbench");
	return value === "timeline" ? value : null;
};

export const isAgentRoute = (pathname: string) => pathname === "/agent";

export const isProjectSettingsRoute = (pathname: string, search: string) =>
	isSettingsRoute(pathname) && Boolean(getRouteProjectId(search));

export const isSettingsRoute = (pathname: string) =>
	pathname === "/settings" || pathname.startsWith("/settings/");

export const isAgentDocumentRoute = (pathname: string, search: string) =>
	isAgentRoute(pathname) &&
	Boolean(
		getRouteProjectId(search) &&
		getRouteDocumentId(search) &&
		getRouteDocumentWorkbench(search) === "timeline",
	);

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
	return isAgentDocumentRoute(pathname, search);
};

export const agentProjectPath = (
	projectId: string,
	options: {
		assetId?: string | null;
		documentId?: string | null;
		workbench?: AgentDocumentWorkbench | null;
	} = {},
) => {
	const params = new URLSearchParams();
	params.set("projectId", projectId);
	if (options.documentId) params.set("documentId", options.documentId);
	if (options.assetId && !options.documentId) params.set("assetId", options.assetId);
	if (options.documentId && options.workbench) params.set("workbench", options.workbench);
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
