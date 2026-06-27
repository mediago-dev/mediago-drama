import { describe, expect, it } from "vitest";
import {
	agentProjectPath,
	getRouteAgentSessionId,
	getRouteAssetId,
	getRouteDocumentId,
	getRouteDocumentWorkbench,
	getRouteProjectId,
	isAgentDocumentRoute,
	isProjectSettingsRoute,
	settingsPath,
	shouldForceDocumentWorkbench,
	studioTabPath,
	workbenchModeForRoute,
} from "@/domains/workspace/lib/workbench-route";

describe("workbench route", () => {
	it("identifies query-scoped route ids", () => {
		const search =
			"?projectId=project-1&documentId=doc-1&workbench=timeline&agentSessionId=session-1";
		expect(getRouteProjectId(search)).toBe("project-1");
		expect(getRouteAgentSessionId(search)).toBe("session-1");
		expect(getRouteAgentSessionId("?agentSession=session-legacy")).toBe("session-legacy");
		expect(getRouteDocumentId(search)).toBe("doc-1");
		expect(getRouteDocumentWorkbench(search)).toBe("timeline");
		expect(getRouteDocumentWorkbench("?workbench=canvas")).toBe("canvas");
		expect(getRouteProjectId("")).toBeNull();
		expect(getRouteAssetId("?assetId=asset-1")).toBe("asset-1");
		expect(getRouteDocumentWorkbench("?workbench=unknown")).toBeNull();
	});

	it("detects route work modes", () => {
		expect(workbenchModeForRoute("/", "studio")).toBe("studio");
		expect(workbenchModeForRoute("/projects")).toBe("agent");
		expect(workbenchModeForRoute("/unknown")).toBeNull();
		expect(workbenchModeForRoute("/toolbox/image")).toBe("studio");
	});

	it("forces document content only for studio workbenches", () => {
		expect(shouldForceDocumentWorkbench("/projects", "?projectId=project-1")).toBe(false);
		expect(shouldForceDocumentWorkbench("/projects", "?projectId=project-1&documentId=doc-1")).toBe(
			false,
		);
		expect(
			shouldForceDocumentWorkbench(
				"/projects",
				"?projectId=project-1&documentId=doc-1&workbench=timeline",
			),
		).toBe(false);
		expect(isAgentDocumentRoute("/projects", "?projectId=project-1&documentId=doc-1")).toBe(false);
		expect(
			isAgentDocumentRoute("/projects", "?projectId=project-1&documentId=doc-1&workbench=timeline"),
		).toBe(false);
		expect(
			isAgentDocumentRoute("/projects", "?projectId=project-1&documentId=doc-1&workbench=canvas"),
		).toBe(false);
		expect(shouldForceDocumentWorkbench("/unknown", "")).toBe(false);
		expect(shouldForceDocumentWorkbench("/toolbox/image", "")).toBe(true);
	});

	it("builds shallow app routes", () => {
		expect(agentProjectPath("project-1")).toBe("/projects?projectId=project-1");
		expect(agentProjectPath("project-1", { documentId: "doc-1" })).toBe(
			"/projects?projectId=project-1&documentId=doc-1",
		);
		expect(agentProjectPath("project-1", { assetId: "asset-1" })).toBe(
			"/projects?projectId=project-1&assetId=asset-1",
		);
		expect(agentProjectPath("project-1", { documentId: "doc-1", workbench: "timeline" })).toBe(
			"/projects?projectId=project-1&documentId=doc-1",
		);
		expect(agentProjectPath("project-1", { documentId: "doc-1", workbench: "canvas" })).toBe(
			"/projects?projectId=project-1&documentId=doc-1",
		);
		expect(agentProjectPath("project-1", { agentSessionId: "session-1" })).toBe(
			"/projects?projectId=project-1&agentSessionId=session-1",
		);
		expect(studioTabPath("image", { conversationId: "session-1" })).toBe(
			"/toolbox/image?conversation=session-1",
		);
		expect(settingsPath("project-1")).toBe("/settings?projectId=project-1");
		expect(isProjectSettingsRoute("/settings", "?projectId=project-1")).toBe(true);
	});
});
