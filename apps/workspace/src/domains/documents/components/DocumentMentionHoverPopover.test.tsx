import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentMentionHoverPopover } from "@/domains/documents/components/DocumentMentionHoverPopover";
import type { MarkdownDocument } from "@/domains/documents/stores";

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
});

const referenceImage = () =>
	document.body.querySelector('img[src="/api/v1/media-assets/ref-a/content"]');
