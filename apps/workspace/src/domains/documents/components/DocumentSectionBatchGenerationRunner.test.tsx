import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarkdownSectionContext } from "@/domains/documents/components/MarkdownHybridEditor";
import {
	appendDocumentSectionPromptSupplement,
	clearSubmittedBatchGenerationJobIdsForTest,
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
	batchId: "batch-1",
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
		clearSubmittedBatchGenerationJobIdsForTest();
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
		expect(workspaceOptions?.historyScopeId).toBeUndefined();
		expect(workspaceOptions?.notificationTarget).toMatchObject({
			documentId: "characters",
			documentTitle: "角色设定",
			kind: "document-section",
			projectId: "project-a",
		});
		await waitFor(() => expect(onJobSettled).toHaveBeenCalledWith("job-1"));
	});

	it("submits batch jobs sequentially by default", async () => {
		const onJobSettled = vi.fn();

		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<DocumentSectionBatchGenerationRunner
					jobs={[job, { ...job, id: "job-2" }, { ...job, id: "job-3" }]}
					onJobSettled={onJobSettled}
				/>
			</SWRConfig>,
		);

		await waitFor(() => {
			expect(submitGeneration).toHaveBeenCalledTimes(1);
		});
	});

	it("does not submit jobs that were not created by an explicit batch click", async () => {
		const onJobSettled = vi.fn();

		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<DocumentSectionBatchGenerationRunner
					jobs={[{ ...job, batchId: undefined }]}
					onJobSettled={onJobSettled}
				/>
			</SWRConfig>,
		);

		await waitFor(() => {
			expect(vi.mocked(useGenerationWorkspace)).toHaveBeenCalled();
		});
		expect(submitGeneration).not.toHaveBeenCalled();
		expect(onJobSettled).not.toHaveBeenCalled();
	});

	it("does not duplicate a job submission when StrictMode replays effects", async () => {
		const onJobSettled = vi.fn();
		let resolveSubmit: (() => void) | undefined;
		submitGeneration.mockImplementation(
			() =>
				new Promise<undefined>((resolve) => {
					resolveSubmit = () => resolve(undefined);
				}),
		);

		render(
			<React.StrictMode>
				<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
					<DocumentSectionBatchGenerationRunner jobs={[job]} onJobSettled={onJobSettled} />
				</SWRConfig>
			</React.StrictMode>,
		);

		await waitFor(() => {
			expect(submitGeneration).toHaveBeenCalledTimes(1);
		});

		await act(async () => {
			resolveSubmit?.();
		});
		await waitFor(() => expect(onJobSettled).toHaveBeenCalledWith("job-1"));
	});

	it("submits section generation with explicit batch generation settings", async () => {
		const onJobSettled = vi.fn();
		const generationSettings = {
			family: { id: "image-family", kind: "image", label: "Image family" },
			params: { n: 1, ratio: "16:9" },
			promptOptimization: {
				model: "text-model",
				referenceName: "电影感提示词",
				referencePrompt: "强化镜头语言、光影与构图。",
				routeId: "text-route",
			},
			referenceAssetIds: ["selected-ref"],
			route: {
				adapter: "test.adapter",
				async: false,
				configured: true,
				docUrl: "https://example.test/docs",
				familyId: "image-family",
				id: "image-route",
				kind: "image",
				label: "Image route",
				model: "image-model",
				params: [],
				provider: "provider",
				status: "available",
				supportsReferenceUrls: true,
				versionId: "image-version",
			},
			version: {
				canonicalModel: "image-model",
				capabilities: { async: false, supportsReferenceUrls: true },
				familyId: "image-family",
				id: "image-version",
				kind: "image",
				label: "Image version",
			},
		} satisfies NonNullable<DocumentSectionBatchGenerationJob["generationSettings"]>;

		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<DocumentSectionBatchGenerationRunner
					jobs={[{ ...job, generationSettings }]}
					onJobSettled={onJobSettled}
				/>
			</SWRConfig>,
		);

		await waitFor(() => {
			expect(submitGeneration).toHaveBeenCalledWith({
				resetPrompt: false,
				selectedFamily: generationSettings?.family,
				selectedParams: generationSettings?.params,
				promptOptimization: generationSettings?.promptOptimization,
				referenceAssetIds: ["selected-ref"],
				selectedRoute: generationSettings?.route,
				selectedVersion: generationSettings?.version,
			});
		});
		await waitFor(() => expect(onJobSettled).toHaveBeenCalledWith("job-1"));
	});

	it("appends a batch prompt supplement before submitting generation", async () => {
		const onJobSettled = vi.fn();
		const generationSettings = {
			family: { id: "image-family", kind: "image", label: "Image family" },
			params: { n: 1, ratio: "16:9" },
			promptSupplement: {
				referenceName: "电影感提示词",
				referencePrompt: "强化镜头语言、光影与构图。",
			},
			route: {
				adapter: "test.adapter",
				async: false,
				configured: true,
				docUrl: "https://example.test/docs",
				familyId: "image-family",
				id: "image-route",
				kind: "image",
				label: "Image route",
				model: "image-model",
				params: [],
				provider: "provider",
				status: "available",
				supportsReferenceUrls: true,
				versionId: "image-version",
			},
			version: {
				canonicalModel: "image-model",
				capabilities: { async: false, supportsReferenceUrls: true },
				familyId: "image-family",
				id: "image-version",
				kind: "image",
				label: "Image version",
			},
		} satisfies NonNullable<DocumentSectionBatchGenerationJob["generationSettings"]>;

		render(
			<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
				<DocumentSectionBatchGenerationRunner
					jobs={[{ ...job, generationSettings }]}
					onJobSettled={onJobSettled}
				/>
			</SWRConfig>,
		);

		await waitFor(() => {
			expect(submitGeneration).toHaveBeenCalledWith({
				resetPrompt: false,
				prompt: "## 林书彤\n\n冷静的调查记者。\n\n强化镜头语言、光影与构图。",
				selectedFamily: generationSettings?.family,
				selectedParams: generationSettings?.params,
				promptOptimization: undefined,
				selectedRoute: generationSettings?.route,
				selectedVersion: generationSettings?.version,
			});
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

describe("appendDocumentSectionPromptSupplement", () => {
	it("appends the supplement under the current prompt", () => {
		expect(
			appendDocumentSectionPromptSupplement("原提示词", {
				referenceName: "补充",
				referencePrompt: "补充提示词",
			}),
		).toBe("原提示词\n\n补充提示词");
	});

	it("uses the supplement as the prompt when the current prompt is empty", () => {
		expect(
			appendDocumentSectionPromptSupplement(" ", {
				referenceName: "补充",
				referencePrompt: "补充提示词",
			}),
		).toBe("补充提示词");
	});

	it("does not append duplicate supplement content", () => {
		expect(
			appendDocumentSectionPromptSupplement("原提示词\n\n补充提示词", {
				referenceName: "补充",
				referencePrompt: "补充提示词",
			}),
		).toBe("原提示词\n\n补充提示词");
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
