import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentMentionHoverPopover } from "@/domains/documents/components/DocumentMentionHoverPopover";
import type { MarkdownDocument } from "@/domains/documents/stores";

const generationApiMocks = vi.hoisted(() => ({
	getSelectedGenerationAssets: vi.fn(),
}));

vi.mock("@/domains/generation/api/generation", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/domains/generation/api/generation")>();
	return {
		...actual,
		getSelectedGenerationAssets: generationApiMocks.getSelectedGenerationAssets,
	};
});

const makeDocument = (document: Partial<MarkdownDocument> & Pick<MarkdownDocument, "id">) => ({
	category: "screenplay" as const,
	comments: [],
	content: "",
	isDirty: false,
	parentId: null,
	sortOrder: 0,
	title: document.id,
	updatedAt: "2026-06-18T00:00:00.000Z",
	version: 1,
	workbenchDraft: null,
	...document,
	id: document.id,
});

const mentionDocuments = [
	makeDocument({
		category: "character",
		id: "character-doc",
		title: "沈阔",
		content:
			"<!-- section-id: section_character -->\n# 沈阔（普通状态）\n\n![沈阔图](</api/media/assets/ref-a/content>)",
	}),
];

describe("DocumentMentionHoverPopover", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		document.body.innerHTML = "";
	});

	it("shows resolved reference images when hovering a document mention", async () => {
		render(
			<DocumentMentionHoverPopover allAssets={[]} allDocuments={mentionDocuments}>
				<span
					className="agent-reference-mention"
					data-block-id="section_character"
					data-category="character"
					data-document-id="character-doc"
					data-kind="section"
					data-title="沈阔（普通状态）"
				>
					@沈阔（普通状态）
				</span>
			</DocumentMentionHoverPopover>,
		);

		fireEvent.pointerOver(screen.getByText("@沈阔（普通状态）"));

		await waitFor(() => expect(referenceImage()).toBeTruthy());
		expect(referenceImage()?.className).toContain("object-contain");
		expect(referenceImage()?.parentElement?.className).toContain("bg-muted-foreground/10");
	});

	it("keeps the popover open when moving from a mention onto nearby text", async () => {
		render(
			<DocumentMentionHoverPopover allAssets={[]} allDocuments={mentionDocuments}>
				<p>
					<span
						className="agent-reference-mention"
						data-block-id="section_character"
						data-category="character"
						data-document-id="character-doc"
						data-kind="section"
						data-title="沈阔（普通状态）"
					>
						@沈阔（普通状态）
					</span>
					<span>附近正文</span>
				</p>
			</DocumentMentionHoverPopover>,
		);

		fireEvent.pointerOver(screen.getByText("@沈阔（普通状态）"));
		await waitFor(() => expect(referenceImage()).toBeTruthy());

		fireEvent.pointerOver(screen.getByText("附近正文"));

		expect(referenceImage()).toBeTruthy();
	});

	it("loads selected resource images for the hovered mention node", async () => {
		generationApiMocks.getSelectedGenerationAssets.mockResolvedValue({
			assets: [
				{
					assetIndex: 0,
					id: "selected-gny",
					kind: "image",
					mediaAssetId: "selected-ref",
					resourceId: "section_character",
					resourceType: "character",
					sourceDocumentId: "character-doc",
					title: "顾南衣参考图",
					url: "/api/v1/media-assets/selected-ref/content",
				},
			],
		});

		render(
			<DocumentMentionHoverPopover
				allAssets={[]}
				allDocuments={[
					makeDocument({
						category: "character",
						id: "character-doc",
						title: "顾南衣",
						content: "<!-- section-id: section_character -->\n# 顾南衣·状态A\n\n18 岁女性。",
					}),
				]}
				projectId="project-a"
			>
				<span
					className="agent-reference-mention"
					data-block-id="section_character"
					data-category="character"
					data-document-id="character-doc"
					data-kind="section"
					data-title="顾南衣·状态A"
				>
					@顾南衣·状态A
				</span>
			</DocumentMentionHoverPopover>,
		);

		fireEvent.pointerOver(screen.getByText("@顾南衣·状态A"));

		await waitFor(() =>
			expect(generationApiMocks.getSelectedGenerationAssets).toHaveBeenCalledWith("project-a", {
				kind: "image",
				resourceId: "section_character",
				resourceType: "character",
				sourceDocumentId: "character-doc",
			}),
		);
		await waitFor(() =>
			expect(referenceImage("/api/v1/media-assets/selected-ref/content")).toBeTruthy(),
		);
	});
});

const referenceImage = (src = "/api/v1/media-assets/ref-a/content") =>
	document.body.querySelector(`img[src="${src}"]`);
