import { describe, expect, it } from "vitest";
import {
	resolveSidebarScreen,
	studioTabFromPath,
} from "@/domains/workspace/lib/sidebar-navigation";

describe("sidebar navigation", () => {
	it("uses work mode to resolve the root shell", () => {
		expect(resolveSidebarScreen("/", "", { workMode: "agent", projectId: null })).toBe("projects");
		expect(resolveSidebarScreen("/", "", { workMode: "studio", projectId: null })).toBe(
			"studio-types",
		);
	});

	it("uses the project sidebar for agent project routes", () => {
		expect(resolveSidebarScreen("/agent", "?projectId=project-1", { workMode: "agent" })).toBe(
			"project",
		);
		expect(
			resolveSidebarScreen("/agent", "?projectId=project-1&documentId=doc-1", {
				workMode: "agent",
			}),
		).toBe("project");
	});

	it("uses explicit studio path segments for generation conversations", () => {
		expect(resolveSidebarScreen("/studio/image", "", { workMode: "studio" })).toBe(
			"studio-conversations",
		);
		expect(resolveSidebarScreen("/studio/audio-transcribe", "", { workMode: "studio" })).toBe(
			"studio-types",
		);
		expect(resolveSidebarScreen("/studio/unmapped-tool", "", { workMode: "studio" })).toBe(
			"studio-types",
		);
		expect(studioTabFromPath("/studio/video")).toBe("video");
	});
});
