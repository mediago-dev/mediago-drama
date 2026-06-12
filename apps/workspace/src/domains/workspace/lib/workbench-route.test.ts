import { describe, expect, it } from "vitest";
import {
	agentProjectPath,
	getRouteDocumentId,
	getRouteProjectId,
	isProjectSettingsRoute,
	settingsPath,
	shouldForceDocumentWorkbench,
	studioTabPath,
	workbenchModeForRoute,
} from "@/domains/workspace/lib/workbench-route";

describe("workbench route", () => {
	it("identifies query-scoped route ids", () => {
		const search = "?projectId=project-1&documentId=doc-1";
		expect(getRouteProjectId(search)).toBe("project-1");
		expect(getRouteDocumentId(search)).toBe("doc-1");
		expect(getRouteProjectId("")).toBeNull();
	});

	it("detects route work modes", () => {
		expect(workbenchModeForRoute("/", "studio")).toBe("studio");
		expect(workbenchModeForRoute("/agent")).toBe("agent");
		expect(workbenchModeForRoute("/unknown")).toBeNull();
		expect(workbenchModeForRoute("/studio/image")).toBe("studio");
	});

	it("forces document content only for agent detail views and studio workbenches", () => {
		expect(shouldForceDocumentWorkbench("/agent", "?projectId=project-1")).toBe(false);
		expect(shouldForceDocumentWorkbench("/agent", "?projectId=project-1&documentId=doc-1")).toBe(
			true,
		);
		expect(shouldForceDocumentWorkbench("/unknown", "")).toBe(false);
		expect(shouldForceDocumentWorkbench("/studio/image", "")).toBe(true);
	});

	it("builds shallow app routes", () => {
		expect(agentProjectPath("project-1")).toBe("/agent?projectId=project-1");
		expect(agentProjectPath("project-1", { documentId: "doc-1" })).toBe(
			"/agent?projectId=project-1&documentId=doc-1",
		);
		expect(studioTabPath("image", { conversationId: "session-1" })).toBe(
			"/studio/image?conversation=session-1",
		);
		expect(settingsPath("project-1")).toBe("/settings?projectId=project-1");
		expect(isProjectSettingsRoute("/settings", "?projectId=project-1")).toBe(true);
	});
});
