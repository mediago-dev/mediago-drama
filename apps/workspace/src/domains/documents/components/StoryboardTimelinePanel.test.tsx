import { fireEvent, render, screen } from "@testing-library/react";
import useSWR from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentsStore } from "@/domains/documents/stores";
import { StoryboardTimelinePanel } from "./StoryboardTimelinePanel";

vi.mock("swr", () => ({
	default: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

vi.mock("@/domains/workspace/api/workspace", () => ({
	getWorkspaceResolvedEpisode: vi.fn(),
	workspaceResolvedEpisodeKey: (documentId: string, projectId?: string | null) => [
		"workspace-resolved-episode",
		projectId ?? "",
		documentId,
	],
}));

describe("StoryboardTimelinePanel", () => {
	beforeEach(() => {
		vi.mocked(useSWR).mockReset();
		vi.mocked(useSWR).mockReturnValue({ data: undefined, isLoading: false } as never);
		useDocumentsStore.getState().prepareWorkspaceLoad("reset");
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			documents: [],
			projectId: "project-a",
			workspaceDir: "/workspace/project-a",
		});
	});

	it("defers resolved storyboard timeline loading until the panel is expanded", () => {
		vi.mocked(useSWR).mockImplementation((key: unknown) => {
			if (Array.isArray(key) && key[0] === "workspace-resolved-episode") {
				return {
					data: {
						documentId: "doc-a",
						episode: {
							aspectRatio: "16:9",
							duration: 5,
							id: "episode-doc-a",
							sections: [{ id: "section-1", title: "开场落水", start: 0, end: 5, summary: "画面" }],
							title: "第一章 分镜脚本",
							tracks: [
								{
									id: "track-video",
									type: "video",
									label: "视频",
									clips: [
										{
											id: "video-1",
											title: "画面",
											start: 0,
											end: 5,
											content: "推镜",
											status: "draft",
										},
									],
								},
								{ id: "track-voiceover", type: "voiceover", label: "旁白", clips: [] },
								{ id: "track-caption", type: "caption", label: "字幕", clips: [] },
							],
						},
						projectId: "project-a",
						workspaceDir: "/workspace/project-a",
					},
					isLoading: false,
				} as never;
			}
			return { data: undefined, isLoading: false } as never;
		});

		render(
			<StoryboardTimelinePanel
				documentId="doc-a"
				documentTitle="第一章 分镜脚本"
				documentContent={"# 第一章\n\n".repeat(500)}
			/>,
		);

		expect(useSWR).toHaveBeenCalledWith(null, expect.any(Function));

		fireEvent.click(screen.getByRole("button", { name: "展开分镜同步面板" }));

		expect(useSWR).toHaveBeenLastCalledWith(
			["workspace-resolved-episode", "project-a", "doc-a"],
			expect.any(Function),
		);
		expect(screen.getByText("开场落水")).toBeTruthy();
	});
});
