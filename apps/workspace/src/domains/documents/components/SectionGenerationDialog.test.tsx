import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentSectionGeneratorProps } from "@/domains/documents/components/DocumentSectionGenerator";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import { SectionGenerationDialog } from "@/domains/documents/components/SectionGenerationDialog";

let capturedGeneratorProps: DocumentSectionGeneratorProps | null = null;
let capturedGeneratorPropsList: DocumentSectionGeneratorProps[] = [];

vi.mock("@/domains/documents/components/DocumentSectionGenerator", () => ({
	DocumentSectionGenerator: (props: DocumentSectionGeneratorProps) => {
		capturedGeneratorProps = props;
		capturedGeneratorPropsList.push(props);
		return <div data-testid="section-generator" data-section-id={props.section.blockId} />;
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
		capturedGeneratorPropsList = [];
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

	it("opens reference generation in a child dialog without replacing the current section", async () => {
		const parentOpenReferenceGeneration = vi.fn();
		const selectedAssetKeys = vi.fn((targetSection: MarkdownSectionContext) => [
			`image:${targetSection.blockId}`,
		]);
		const referenceSection: MarkdownSectionContext = {
			blockId: "section_reference",
			documentId: "story-doc",
			headingLevel: 2,
			headingOccurrence: 1,
			headingText: "引用角色",
			markdown: "## 引用角色\n\n角色参考。",
			plainText: "引用角色\n\n角色参考。",
			prompt: "角色参考。",
		};

		render(
			<SectionGenerationDialog
				open
				section={section}
				selectedAssetKeys={selectedAssetKeys}
				onGenerationComplete={vi.fn()}
				onGenerationError={vi.fn()}
				onGenerationStart={vi.fn()}
				onOpenChange={vi.fn()}
				onOpenReferenceGeneration={parentOpenReferenceGeneration}
				onToggleImage={vi.fn()}
			/>,
		);

		const currentDialogGeneratorProps = capturedGeneratorPropsList[0];
		expect(currentDialogGeneratorProps?.section).toBe(section);

		await act(async () => {
			currentDialogGeneratorProps?.onOpenReferenceGeneration?.(referenceSection);
		});

		await waitFor(() => {
			expect(capturedGeneratorPropsList.at(-1)?.section).toBe(referenceSection);
		});
		expect(capturedGeneratorPropsList[0]?.section).toBe(section);
		expect(parentOpenReferenceGeneration).not.toHaveBeenCalled();
		expect(capturedGeneratorPropsList.at(-1)?.selectedAssetKeys).toEqual([
			"image:section_reference",
		]);
	});

	it("keeps nested reference generation in a section dialog stack", async () => {
		const firstReferenceSection: MarkdownSectionContext = {
			blockId: "section_reference",
			documentId: "story-doc",
			headingLevel: 2,
			headingOccurrence: 1,
			headingText: "引用角色",
			markdown: "## 引用角色\n\n角色参考。",
			plainText: "引用角色\n\n角色参考。",
			prompt: "角色参考。",
		};
		const secondReferenceSection: MarkdownSectionContext = {
			blockId: "section_reference_child",
			documentId: "story-doc",
			headingLevel: 3,
			headingOccurrence: 1,
			headingText: "引用角色细节",
			markdown: "### 引用角色细节\n\n角色细节参考。",
			plainText: "引用角色细节\n\n角色细节参考。",
			prompt: "角色细节参考。",
		};

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

		await act(async () => {
			capturedGeneratorPropsList[0]?.onOpenReferenceGeneration?.(firstReferenceSection);
		});

		await waitFor(() => {
			expect(
				screen
					.getAllByTestId("section-generator")
					.map((element) => element.getAttribute("data-section-id")),
			).toEqual(["section_character", "section_reference"]);
		});

		const firstReferenceProps = capturedGeneratorPropsList.find(
			(props) => props.section.blockId === "section_reference",
		);
		await act(async () => {
			firstReferenceProps?.onOpenReferenceGeneration?.(secondReferenceSection);
		});

		await waitFor(() => {
			expect(
				screen
					.getAllByTestId("section-generator")
					.map((element) => element.getAttribute("data-section-id")),
			).toEqual(["section_character", "section_reference", "section_reference_child"]);
		});
	});
});
