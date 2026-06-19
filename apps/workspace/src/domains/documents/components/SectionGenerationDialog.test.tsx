import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentSectionGeneratorProps } from "@/domains/documents/components/DocumentSectionGenerator";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { SectionGenerationDialog } from "@/domains/documents/components/SectionGenerationDialog";

let capturedGeneratorProps: DocumentSectionGeneratorProps | null = null;

vi.mock("@/domains/documents/components/DocumentSectionGenerator", () => ({
	DocumentSectionGenerator: (props: DocumentSectionGeneratorProps) => {
		capturedGeneratorProps = props;
		return <div data-testid="section-generator" />;
	},
}));

const section: MarkdownSectionContext = {
	blockId: "section_character",
	documentId: "story-doc",
	headingLevel: 2,
	headingOccurrence: 1,
	headingText: "主角 / 低阶散修",
	markdown: "## 主角 / 低阶散修\n\n角色设定。",
	plainText: "主角 / 低阶散修\n\n角色设定。",
	prompt: "角色设定。",
};

describe("SectionGenerationDialog", () => {
	afterEach(() => {
		cleanup();
		capturedGeneratorProps = null;
	});

	it("opens the material library picker from the title bar", async () => {
		render(
			<SectionGenerationDialog
				open
				section={section}
				onGenerationComplete={vi.fn()}
				onGenerationError={vi.fn()}
				onGenerationStart={vi.fn()}
				onOpenChange={vi.fn()}
				onToggleImage={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "从素材库中选择" }));

		await waitFor(() => {
			expect(capturedGeneratorProps?.materialLibraryImportOpen).toBe(true);
		});
	});
});
