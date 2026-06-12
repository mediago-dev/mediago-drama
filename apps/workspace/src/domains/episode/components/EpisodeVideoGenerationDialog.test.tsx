import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleEpisode } from "@/domains/episode/lib/sample";
import { EpisodeVideoGenerationDialog } from "./EpisodeVideoGenerationDialog";

const mocks = vi.hoisted(() => ({
	getProjects: vi.fn(),
	MediaGenerationWorkspace: vi.fn(() => null),
}));

vi.mock("@/domains/projects/api/projects", () => ({
	getProjects: mocks.getProjects,
	projectsKey: "/projects",
}));

vi.mock("@/domains/generation/components/MediaGenerationWorkspace", () => ({
	MediaGenerationWorkspace: mocks.MediaGenerationWorkspace,
}));

describe("EpisodeVideoGenerationDialog", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("passes a document notification target to video generation requests", () => {
		mocks.getProjects.mockResolvedValue({
			projects: [{ id: "project-a", name: "项目 A" }],
		});
		const videoTrack = sampleEpisode.tracks.find((track) => track.type === "video");
		const selectedClip = videoTrack?.clips[1] ?? null;

		render(
			<EpisodeVideoGenerationDialog
				documentId="doc-a"
				documentTitle="第一集分镜"
				episode={sampleEpisode}
				open
				projectId="project-a"
				selectedClip={selectedClip}
				selectedVideoUrl={null}
				onGeneratedVideoReady={vi.fn()}
				onOpenChange={vi.fn()}
			/>,
		);

		const workspaceCalls = mocks.MediaGenerationWorkspace.mock.calls as unknown as Array<
			[Record<string, unknown>]
		>;
		const workspaceProps = workspaceCalls.at(-1)?.[0];

		expect(workspaceProps).toMatchObject({
			kind: "video",
			notificationTarget: {
				kind: "document-section",
				projectId: "project-a",
				documentId: "doc-a",
				documentTitle: "第一集分镜",
				section: {
					blockId: `episode-video:${sampleEpisode.id}:${selectedClip?.id}`,
					documentId: "doc-a",
					headingLevel: 2,
					headingOccurrence: 1,
					headingText: selectedClip?.title,
					plainText: selectedClip?.content,
					prompt: expect.stringContaining(selectedClip?.content ?? ""),
				},
			},
		});
	});
});
