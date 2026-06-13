import { describe, expect, it } from "vitest";
import {
	resolveAppRouteDescriptor,
	usesProjectSettingsSidebar,
} from "@/domains/workspace/lib/app-route-descriptor";

describe("app route descriptor", () => {
	it("treats work modes as level-one home screens", () => {
		expect(resolveAppRouteDescriptor("/", "", { workMode: "agent" })).toMatchObject({
			level: 1,
			sidebarScreen: "projects",
			title: "智能体工作台",
		});
		expect(resolveAppRouteDescriptor("/", "", { workMode: "studio" })).toMatchObject({
			level: 1,
			sidebarScreen: "studio-types",
			title: "工具箱",
		});
	});

	it("marks project and detail pages as second-level pages", () => {
		expect(
			resolveAppRouteDescriptor("/agent", "?projectId=project-1", {
				workMode: "agent",
				projectId: "project-1",
			}),
		).toMatchObject({
			level: 2,
			sidebarHidden: false,
			sidebarScreen: "project",
		});
		expect(
			resolveAppRouteDescriptor("/agent", "?projectId=project-1&documentId=doc-1", {
				workMode: "agent",
				projectId: "project-1",
			}),
		).toMatchObject({
			level: 2,
			sidebarHidden: true,
			sidebarScreen: "project",
		});
		expect(resolveAppRouteDescriptor("/studio/video", "", { workMode: "studio" })).toMatchObject({
			level: 2,
			sidebarScreen: "studio-conversations",
		});
	});

	it("uses a sentinel level for all settings pages", () => {
		expect(resolveAppRouteDescriptor("/settings", "", { workMode: "agent" })).toMatchObject({
			level: 9999,
			sidebarScreen: "settings",
			title: "设置",
		});
		expect(
			resolveAppRouteDescriptor("/settings", "?projectId=project-1", {
				workMode: "agent",
				projectId: "project-1",
			}),
		).toMatchObject({
			level: 9999,
			sidebarScreen: "settings",
			title: "项目设置",
		});
	});

	it("uses project-settings sidebar semantics while entering and leaving project settings", () => {
		expect(usesProjectSettingsSidebar("project", false)).toBe(true);
		expect(usesProjectSettingsSidebar("settings", true)).toBe(true);
		expect(usesProjectSettingsSidebar("projects", false)).toBe(false);
		expect(usesProjectSettingsSidebar("settings", false)).toBe(false);
	});
});
