import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentSectionGeneratorProps } from "@/domains/documents/components/DocumentSectionGenerator";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { AudioGenerationDialog } from "@/shared/components/generation-dialogs/AudioGenerationDialog";

const mocks = vi.hoisted(() => ({
	DocumentSectionGenerator: vi.fn(() => null),
}));

vi.mock("@/domains/documents/components/DocumentSectionGenerator", () => ({
	DocumentSectionGenerator: mocks.DocumentSectionGenerator,
}));

const section: MarkdownSectionContext = {
	blockId: "section-audio",
	documentId: "doc-1",
	headingLevel: 2,
	headingOccurrence: 1,
	headingText: "旁白",
	markdown: "## 旁白\n\n台词。",
	plainText: "旁白\n\n台词。",
	prompt: "台词。",
};

describe("AudioGenerationDialog", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("renders document sections as audio generation", () => {
		render(
			<AudioGenerationDialog
				open
				projectId="project-a"
				selectedAssetKeys={["audio:/voice.mp3"]}
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
			kind: "audio",
			projectId: "project-a",
			section,
			selectedAssetKeys: ["audio:/voice.mp3"],
			viewMode: "history",
		});
		expect(generatorProps?.onToggleAsset).toBeTruthy();
	});
});
