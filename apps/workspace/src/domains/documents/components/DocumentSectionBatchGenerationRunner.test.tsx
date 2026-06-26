import { cleanup, render, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import {
	DocumentSectionBatchGenerationRunner,
	type DocumentSectionBatchGenerationJob,
} from "@/domains/documents/components/DocumentSectionBatchGenerationRunner";
import { useDocumentsStore, type MarkdownDocument } from "@/domains/documents/stores";
import { useGenerationWorkspace } from "@/domains/generation/hooks/useGenerationWorkspace";

vi.mock("@/domains/generation/hooks/useGenerationWorkspace", () => ({
	useGenerationWorkspace: vi.fn(),
}));

vi.mock("@/domains/projects/api/projects", () => ({
	getProjects: vi.fn(async () => ({ projects: [{ id: "project-a", name: "短剧项目" }] })),
	projectsKey: "/projects",
}));

const submitGeneration = vi.fn(async () => undefined);

const section: MarkdownSectionContext = {
	blockId: "section_lintong",
	documentId: "characters",
	headingLevel: 2,
	headingOccurrence: 1,
	headingText: "林书彤",
	markdown: "## 林书彤\n\n冷静的调查记者。",
	plainText: "林书彤\n\n冷静的调查记者。",
	prompt: "## 林书彤\n\n冷静的调查记者。",
};

const job: DocumentSectionBatchGenerationJob = {
	id: "job-1",
	kind: "image",
	projectId: "project-a",
	section,
};

describe("DocumentSectionBatchGenerationRunner", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		submitGeneration.mockResolvedValue(undefined);
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			hasConfiguredRoutesForKind: true,
			hasLiveCatalog: true,
			needsConversation: false,
			selectedRoute: {
				configured: true,
				status: "available",
			},
			submitGeneration,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			assets: [],
			documents: [
				baseDocument({
					category: "character",
					content: section.markdown,
					id: "characters",
					title: "角色设定",
				}),
			],
			projectId: "project-a",
			workspaceDir: "/workspace/project-a",
		});
	});

	afterEach(() => {
		cleanup();
		useDocumentsStore.getState().prepareWorkspaceLoad("reset");
	});

	it("submits section generation with the default prompt context in the background", async () => {
		const onJobSettled = vi.fn();

		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<DocumentSectionBatchGenerationRunner jobs={[job]} onJobSettled={onJobSettled} />
			</SWRConfig>,
		);

		await waitFor(() => {
			expect(submitGeneration).toHaveBeenCalledWith({ resetPrompt: false });
		});

		const workspaceOptions = vi.mocked(useGenerationWorkspace).mock.calls.at(-1)?.[0];
		expect(workspaceOptions).toMatchObject({
			assetTitle: "林书彤",
			conversationId: "project-a-image",
			conversationScopeId: "agent",
			documentContext: {
				documentId: "characters",
				projectId: "project-a",
				sectionId: "section_lintong",
			},
			initialKind: "image",
			initialPrompt: "## 林书彤\n\n冷静的调查记者。",
			projectId: "project-a",
			sectionId: "section_lintong",
			useRawPrompt: true,
		});
		expect(workspaceOptions?.notificationTarget).toMatchObject({
			documentId: "characters",
			documentTitle: "角色设定",
			kind: "document-section",
			projectId: "project-a",
		});
		await waitFor(() => expect(onJobSettled).toHaveBeenCalledWith("job-1"));
	});

	it("settles with an error when no configured route is available", async () => {
		const onJobError = vi.fn();
		const onJobSettled = vi.fn();
		vi.mocked(useGenerationWorkspace).mockReturnValue({
			hasConfiguredRoutesForKind: false,
			hasLiveCatalog: true,
			needsConversation: false,
			selectedRoute: {
				configured: false,
				status: "unavailable",
			},
			submitGeneration,
		} as unknown as ReturnType<typeof useGenerationWorkspace>);

		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<DocumentSectionBatchGenerationRunner
					jobs={[job]}
					onJobError={onJobError}
					onJobSettled={onJobSettled}
				/>
			</SWRConfig>,
		);

		await waitFor(() => {
			expect(onJobError).toHaveBeenCalledWith(job, expect.stringContaining("暂无可用"));
		});
		expect(submitGeneration).not.toHaveBeenCalled();
		expect(onJobSettled).toHaveBeenCalledWith("job-1");
	});
});

const baseDocument = (document: Partial<MarkdownDocument> & Pick<MarkdownDocument, "id">) => ({
	category: "screenplay" as const,
	comments: [],
	content: "",
	folderId: null,
	isDirty: false,
	parentId: null,
	sortOrder: 0,
	tags: [],
	title: document.id,
	updatedAt: "2026-06-18T00:00:00.000Z",
	version: 1,
	workbenchDraft: null,
	...document,
	id: document.id,
});
