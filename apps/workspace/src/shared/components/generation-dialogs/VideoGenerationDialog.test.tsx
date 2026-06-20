import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentSectionGeneratorProps } from "@/domains/documents/components/DocumentSectionGenerator";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import type { MediaGenerationWorkspaceProps } from "@/domains/generation/components/MediaGenerationWorkspace";
import { VideoGenerationDialog } from "@/shared/components/generation-dialogs/VideoGenerationDialog";

const mocks = vi.hoisted(() => ({
	DocumentSectionGenerator: vi.fn(() => null),
	MediaGenerationWorkspace: vi.fn(() => null),
}));

vi.mock("@/domains/documents/components/DocumentSectionGenerator", () => ({
	DocumentSectionGenerator: mocks.DocumentSectionGenerator,
}));

vi.mock("@/domains/generation/components/MediaGenerationWorkspace", () => ({
	MediaGenerationWorkspace: mocks.MediaGenerationWorkspace,
}));

const section: MarkdownSectionContext = {
	blockId: "section-video",
	documentId: "doc-1",
	headingLevel: 2,
	headingOccurrence: 1,
	headingText: "第 01 组",
	markdown: "## 第 01 组\n\n动作。",
	plainText: "第 01 组\n\n动作。",
	prompt: "动作。",
};

describe("VideoGenerationDialog", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("renders the shared video workspace for timeline generation", () => {
		render(
			<VideoGenerationDialog
				open
				title="生成视频素材"
				workspaceProps={{
					historyScopeId: "timeline-video",
					initialPrompt: "镜头推进",
				}}
				onOpenChange={vi.fn()}
			/>,
		);

		const workspaceCalls = mocks.MediaGenerationWorkspace.mock.calls as unknown as Array<
			[MediaGenerationWorkspaceProps]
		>;
		const workspaceProps = workspaceCalls.at(-1)?.[0];

		expect(workspaceProps).toMatchObject({
			historyScopeId: "timeline-video",
			initialPrompt: "镜头推进",
			kind: "video",
		});
		expect(mocks.DocumentSectionGenerator).not.toHaveBeenCalled();
	});

	it("renders document sections through the same video dialog component", () => {
		render(
			<VideoGenerationDialog
				open
				projectId="project-a"
				selectedAssetKeys={["video:/scene.mp4"]}
				section={section}
				onOpenChange={vi.fn()}
				onOpenReferenceGeneration={vi.fn()}
				onToggleAsset={vi.fn()}
			/>,
		);

		const generatorCalls = mocks.DocumentSectionGenerator.mock.calls as unknown as Array<
			[DocumentSectionGeneratorProps]
		>;
		const generatorProps = generatorCalls.at(-1)?.[0];

		expect(generatorProps).toMatchObject({
			kind: "video",
			projectId: "project-a",
			section,
			selectedAssetKeys: ["video:/scene.mp4"],
			viewMode: "history",
		});
		expect(generatorProps?.onToggleAsset).toBeTruthy();
		expect(mocks.MediaGenerationWorkspace).not.toHaveBeenCalled();
	});
});
