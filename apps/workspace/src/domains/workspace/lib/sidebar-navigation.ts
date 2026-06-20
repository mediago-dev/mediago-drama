import type { WorkMode } from "@/lib/stores/work-mode";
import type {
	ActiveStudioTab,
	SidebarScreenId,
} from "@/domains/workspace/components/ProjectNavigatorTypes";

export const sidebarScreenOrder: readonly SidebarScreenId[] = [
	"projects",
	"project",
	"studio-types",
	"studio-conversations",
	"settings",
];

interface ResolveSidebarScreenOptions {
	projectId?: string | null;
	workMode: WorkMode;
}

export const resolveSidebarScreen = (
	pathname: string,
	_search: string,
	{ projectId, workMode }: ResolveSidebarScreenOptions,
): SidebarScreenId => {
	if (isSettingsRoute(pathname)) return "settings";

	if (pathname.startsWith("/studio/")) {
		return "studio-types";
	}

	if (pathname === "/agent") return "project";

	if (pathname === "/") {
		if (workMode === "studio") return "studio-types";
		return projectId ? "project" : "projects";
	}

	return "projects";
};

export const isRootScreen = (screen: SidebarScreenId) =>
	screen === "projects" || screen === "studio-types";

export const workModeForScreen = (screen: SidebarScreenId): WorkMode | null => {
	if (screen === "projects" || screen === "project") return "agent";
	if (screen === "studio-types" || screen === "studio-conversations") return "studio";
	return null;
};

export const studioTabFromPath = (pathname: string): ActiveStudioTab => {
	const tab = studioPathSegment(pathname);
	return tab === "image" || tab === "video" || tab === "text" || tab === "audio" ? tab : null;
};

const isSettingsRoute = (pathname: string) =>
	pathname === "/settings" || pathname.startsWith("/settings/");

const studioPathSegment = (pathname: string) =>
	pathname
		.replace(/^\/studio\/?/, "")
		.split("/")[0]
		.trim();
