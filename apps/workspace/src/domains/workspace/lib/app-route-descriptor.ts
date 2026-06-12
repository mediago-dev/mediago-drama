import type { WorkMode } from "@/lib/stores/work-mode";
import type { SidebarScreenId } from "@/domains/workspace/components/ProjectNavigatorTypes";
import {
	resolveSidebarScreen,
	workModeForScreen,
} from "@/domains/workspace/lib/sidebar-navigation";
import { getRouteDocumentId, isAgentRoute, isProjectSettingsRoute } from "./workbench-route";

export type AppPageLevel = 1 | 2 | 9999;

export interface AppRouteDescriptor {
	/**
	 * Page level is the product navigation depth, not the URL segment count.
	 * The sidebar slide animation is derived from this number.
	 */
	level: AppPageLevel;
	sidebarHidden: boolean;
	sidebarScreen: SidebarScreenId;
	title: string;
	workMode: WorkMode | null;
}

interface ResolveAppRouteDescriptorOptions {
	projectId?: string | null;
	workMode: WorkMode;
}

const screenLevel: Record<Exclude<SidebarScreenId, "settings">, AppPageLevel> = {
	projects: 1,
	"studio-types": 1,
	project: 2,
	"studio-conversations": 2,
};

export const sidebarScreenLevel = (
	screen: SidebarScreenId,
	_options: { isProjectSettings: boolean },
): AppPageLevel => {
	if (screen === "settings") return 9999;
	return screenLevel[screen];
};

export const usesProjectSettingsSidebar = (
	activeScreen: SidebarScreenId,
	isProjectSettingsRoute: boolean,
) => isProjectSettingsRoute || activeScreen === "project";

export const resolveAppRouteDescriptor = (
	pathname: string,
	search: string,
	options: ResolveAppRouteDescriptorOptions,
): AppRouteDescriptor => {
	const sidebarScreen = resolveSidebarScreen(pathname, search, options);
	const isProjectSettings = isProjectSettingsRoute(pathname, search);
	const workMode = workModeForScreen(sidebarScreen);

	return {
		level: sidebarScreenLevel(sidebarScreen, { isProjectSettings }),
		sidebarHidden: isAgentRoute(pathname) && Boolean(getRouteDocumentId(search)),
		sidebarScreen,
		title: routeTitle(sidebarScreen, isProjectSettings),
		workMode,
	};
};

const routeTitle = (screen: SidebarScreenId, isProjectSettings: boolean) => {
	if (screen === "settings") return isProjectSettings ? "项目设置" : "设置";
	if (screen === "studio-types" || screen === "studio-conversations") return "创作台";
	return "智能体工作台";
};
