import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useSWR, { mutate as mutateSWR } from "swr";
import {
	createWorkspaceDocument,
	createWorkspaceEventSource,
	createWorkspaceFolder,
	getWorkspaceDocuments,
	getWorkspaceState,
	updateWorkspaceDocumentSectionImage,
	updateWorkspaceDocumentSectionMedia,
	updateWorkspaceDocumentSectionMention,
	updateWorkspaceDocumentRecord,
	updateWorkspaceFolder,
	updateWorkspaceState,
} from "@/domains/workspace/api/workspace";
import { updateProjectAsset } from "@/domains/workspace/api/project-assets";
import {
	DocumentStateSync,
	workspaceStateFallbackRefreshIntervalMs,
} from "@/domains/documents/components/DocumentStateSync";
import Toast from "@/shared/lib/toast";
import { selectActiveDocumentOpenComments, useDocumentsStore } from "./store";
import type { DocumentFolder, DocumentOperationLogEntry, MarkdownDocument } from "./types";
import { createTextAnchor, type DocumentOperation } from "@/domains/documents/lib/operations";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";

vi.mock("swr", () => ({
	default: vi.fn(),
	mutate: vi.fn(),
}));

vi.mock("@/domains/workspace/api/workspace", () => ({
	createWorkspaceEventSource: vi.fn(),
	createWorkspaceFolder: vi.fn(),
	createWorkspaceDocument: vi.fn(),
	deleteWorkspaceFolder: vi.fn(),
	deleteWorkspaceDocumentRecord: vi.fn(),
	getWorkspaceDocuments: vi.fn(),
	getWorkspaceState: vi.fn(),
	updateWorkspaceFolder: vi.fn(),
	updateWorkspaceDocumentSectionImage: vi.fn(),
	updateWorkspaceDocumentSectionMedia: vi.fn(),
	updateWorkspaceDocumentSectionMention: vi.fn(),
	updateWorkspaceDocumentRecord: vi.fn(),
	updateWorkspaceState: vi.fn(),
	workspaceDocumentsChangedEventType: "workspace.documents.changed",
	workspaceStateKey: (projectId?: string | null) =>
		projectId ? `/workspace/state?projectId=${encodeURIComponent(projectId)}` : "/workspace/state",
}));

vi.mock("@/domains/workspace/api/project-assets", () => ({
	updateProjectAsset: vi.fn(),
}));

const makeDocument = (id: string): MarkdownDocument => ({
	id,
	title: id,
	content: `# ${id}\n`,
	category: "screenplay",
	parentId: null,
	sortOrder: 0,
	version: 1,
	updatedAt: "2026-05-31T00:00:00.000Z",
	isDirty: false,
	comments: [],
	workbenchDraft: null,
});

const makeFolder = (id: string, options: Partial<DocumentFolder> = {}): DocumentFolder => ({
	id,
	name: id,
	parentId: null,
	sortOrder: 0,
	createdAt: "2026-05-31T00:00:00.000Z",
	updatedAt: "2026-05-31T00:00:00.000Z",
	...options,
});

const makeAsset = (id: string, folderId?: string): ProjectAsset => ({
	id,
	projectId: "project-a",
	kind: "text",
	filename: `${id}.txt`,
	mimeType: "text/plain",
	sizeBytes: 1,
	url: `/assets/${id}`,
	folderId,
	sortOrder: 0,
	createdAt: "2026-05-31T00:00:00.000Z",
	updatedAt: "2026-05-31T00:00:00.000Z",
});

const makeLogEntry = (documentId: string): DocumentOperationLogEntry => ({
	id: `log-${documentId}`,
	documentId,
	operations: [],
	summary: "测试操作",
	source: "user",
	createdAt: "2026-05-31T00:00:00.000Z",
	before: { title: documentId, content: "", comments: [] },
	after: { title: documentId, content: "", comments: [] },
});

type FakeWorkspaceEventSource = ReturnType<typeof createWorkspaceEventSource> & {
	emit: (type: string) => void;
};

const createFakeWorkspaceEventSource = (): FakeWorkspaceEventSource => {
	const listeners = new Map<string, Set<(event: MessageEvent) => void>>();
	const source = {
		addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
			const eventListeners = listeners.get(type) ?? new Set();
			eventListeners.add(listener);
			listeners.set(type, eventListeners);
		}),
		close: vi.fn(),
		emit: (type: string) => {
			for (const listener of listeners.get(type) ?? []) {
				listener({ data: "", lastEventId: "" } as MessageEvent);
			}
		},
		removeEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
			listeners.get(type)?.delete(listener);
		}),
		readyState: 1,
	} as unknown as FakeWorkspaceEventSource;
	return source;
};

describe("documents store remote sync", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
		vi.mocked(useSWR).mockReset();
		vi.mocked(mutateSWR).mockClear();
		vi.mocked(createWorkspaceDocument).mockReset();
		vi.mocked(createWorkspaceEventSource).mockReset();
		vi.mocked(createWorkspaceFolder).mockReset();
		vi.mocked(getWorkspaceDocuments).mockReset();
		vi.mocked(getWorkspaceState).mockReset();
		vi.mocked(updateProjectAsset).mockReset();
		vi.mocked(updateWorkspaceDocumentSectionImage).mockReset();
		vi.mocked(updateWorkspaceDocumentSectionImage).mockImplementation(
			async (documentId, _payload) => {
				const current = useDocumentsStore.getState();
				const document =
					current.documents.find((item) => item.id === documentId) ?? makeDocument(documentId);
				const nextDocument = {
					...document,
					isDirty: false,
				};

				return {
					document: nextDocument,
					state: {
						workspaceDir: current.workspaceDir,
						projectId: current.projectId ?? undefined,
						documents: current.documents.map((item) =>
							item.id === documentId ? nextDocument : item,
						),
					},
				};
			},
		);
		vi.mocked(updateWorkspaceDocumentSectionMedia).mockReset();
		vi.mocked(updateWorkspaceDocumentSectionMedia).mockImplementation(
			async (documentId, _payload) => {
				const current = useDocumentsStore.getState();
				const document =
					current.documents.find((item) => item.id === documentId) ?? makeDocument(documentId);
				const nextDocument = {
					...document,
					isDirty: false,
				};

				return {
					document: nextDocument,
					state: {
						workspaceDir: current.workspaceDir,
						projectId: current.projectId ?? undefined,
						documents: current.documents.map((item) =>
							item.id === documentId ? nextDocument : item,
						),
					},
				};
			},
		);
		vi.mocked(updateWorkspaceDocumentSectionMention).mockReset();
		vi.mocked(updateWorkspaceDocumentSectionMention).mockImplementation(
			async (documentId, _payload) => {
				const current = useDocumentsStore.getState();
				const document =
					current.documents.find((item) => item.id === documentId) ?? makeDocument(documentId);
				const nextDocument = {
					...document,
					isDirty: false,
				};

				return {
					document: nextDocument,
					state: {
						workspaceDir: current.workspaceDir,
						projectId: current.projectId ?? undefined,
						documents: current.documents.map((item) =>
							item.id === documentId ? nextDocument : item,
						),
					},
				};
			},
		);
		vi.mocked(updateWorkspaceDocumentRecord).mockReset();
		vi.mocked(updateWorkspaceDocumentRecord).mockImplementation(async (documentId, payload) => {
			const current = useDocumentsStore.getState();
			const document =
				current.documents.find((item) => item.id === documentId) ?? makeDocument(documentId);
			const nextDocument = {
				...document,
				...(payload.title !== undefined ? { title: payload.title } : {}),
				...(payload.content !== undefined ? { content: payload.content } : {}),
				...(payload.category !== undefined ? { category: payload.category } : {}),
				...(payload.parentId !== undefined ? { parentId: payload.parentId } : {}),
				...(payload.folderId !== undefined ? { folderId: payload.folderId } : {}),
				...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
				...(payload.comments !== undefined ? { comments: payload.comments } : {}),
				...(payload.workbenchDraft !== undefined ? { workbenchDraft: payload.workbenchDraft } : {}),
				isDirty: false,
			};

			return {
				document: nextDocument,
				state: {
					workspaceDir: current.workspaceDir,
					projectId: current.projectId ?? undefined,
					documents: current.documents.map((item) =>
						item.id === documentId ? nextDocument : item,
					),
				},
			};
		});
		vi.mocked(updateWorkspaceFolder).mockReset();
		vi.mocked(updateWorkspaceState).mockReset();
		useDocumentsStore.getState().prepareWorkspaceLoad("reset");
	});

	it("hydrates Zustand from server responses without mutating SWR cache", () => {
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState(
				[makeDocument("doc-a"), makeDocument("doc-b")],
				[makeLogEntry("doc-a"), makeLogEntry("doc-b")],
				"/workspace/project-a",
				"project-a",
			);

		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [makeDocument("doc-a")],
		});

		const state = useDocumentsStore.getState();
		expect(state.projectId).toBe("project-a");
		expect(state.documents.map((document) => document.id)).toEqual(["doc-a"]);
		expect(state.operationLog.map((entry) => entry.documentId)).toEqual(["doc-a"]);
		expect(mutateSWR).not.toHaveBeenCalled();
	});

	it("hydrates folders and clears stale item folder references", () => {
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [
				{ ...makeDocument("doc-a"), folderId: "folder-a" },
				{ ...makeDocument("doc-b"), folderId: "missing-folder" },
			],
			folders: [makeFolder("folder-a")],
			assets: [makeAsset("asset-a", "folder-a"), makeAsset("asset-b", "missing-folder")],
		});

		const state = useDocumentsStore.getState();
		expect(state.folders.map((folder) => folder.id)).toEqual(["folder-a"]);
		expect(state.documents.map((document) => document.folderId ?? null)).toEqual([
			"folder-a",
			null,
		]);
		expect(state.assets.map((asset) => asset.folderId ?? null)).toEqual(["folder-a", null]);
	});

	it("keeps document and asset selection mutually exclusive", () => {
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState(
				[makeDocument("doc-a"), makeDocument("doc-b")],
				[],
				"/workspace/project-a",
				"project-a",
				[makeAsset("asset-a")],
			);

		useDocumentsStore.getState().selectDocument("doc-b");
		expect(useDocumentsStore.getState().activeDocumentId).toBe("doc-b");
		expect(useDocumentsStore.getState().activeAssetId).toBe("");

		useDocumentsStore.getState().selectAsset("asset-a");
		expect(useDocumentsStore.getState().activeDocumentId).toBe("");
		expect(useDocumentsStore.getState().activeAssetId).toBe("asset-a");

		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [makeDocument("doc-a"), makeDocument("doc-b")],
			assets: [makeAsset("asset-a")],
		});

		expect(useDocumentsStore.getState().activeDocumentId).toBe("");
		expect(useDocumentsStore.getState().activeAssetId).toBe("asset-a");
	});

	it("keeps the active open comments selector stable across content-only edits", () => {
		const document = {
			...makeDocument("doc-a"),
			content: "# doc-a\n\n这是一段锚点文本。\n",
			comments: [
				{
					id: "comment-a",
					anchorText: "这是一段锚点文本。",
					anchor: createTextAnchor("# doc-a\n\n这是一段锚点文本。\n", "这是一段锚点文本。"),
					body: "补充张力",
					createdAt: "2026-05-31T00:00:00.000Z",
					resolved: false,
				},
			],
		};
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [document],
		});

		const first = selectActiveDocumentOpenComments(useDocumentsStore.getState());
		useDocumentsStore.getState().updateDocumentContent("doc-a", "# doc-a\n\n新正文。\n");
		const second = selectActiveDocumentOpenComments(useDocumentsStore.getState());
		expect(second).toBe(first);

		useDocumentsStore.setState((state) => ({
			documents: state.documents.map((item) =>
				item.id === "doc-a"
					? {
							...item,
							comments: item.comments.map((comment) =>
								comment.id === "comment-a" ? { ...comment, resolved: true } : comment,
							),
						}
					: item,
			),
		}));
		const third = selectActiveDocumentOpenComments(useDocumentsStore.getState());
		expect(third).not.toBe(first);
		expect(third).toHaveLength(0);
	});

	it("does not update document state when content is unchanged", () => {
		const document = makeDocument("doc-a");
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [document],
		});

		const beforeState = useDocumentsStore.getState();
		const beforeDocument = beforeState.documents[0];
		useDocumentsStore.getState().updateDocumentContent("doc-a", document.content);
		const afterState = useDocumentsStore.getState();

		expect(afterState).toBe(beforeState);
		expect(afterState.documents[0]).toBe(beforeDocument);
		expect(afterState.documents[0]?.version).toBe(document.version);
		expect(afterState.documents[0]?.isDirty).toBe(false);
	});

	it("persists document content updates to the backend and hydrates the saved markdown", async () => {
		const document = makeDocument("doc-a");
		const nextContent = "# doc-a\n\n新正文。\n";
		const savedDocument = {
			...document,
			content: nextContent,
			version: 2,
			isDirty: false,
			updatedAt: "2026-06-01T00:00:00.000Z",
		};
		vi.mocked(updateWorkspaceDocumentRecord).mockResolvedValueOnce({
			document: savedDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [savedDocument],
			},
		});
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [document],
		});

		useDocumentsStore.getState().updateDocumentContent("doc-a", nextContent);

		expect(useDocumentsStore.getState().documents[0]).toMatchObject({
			content: nextContent,
			isDirty: true,
			version: 2,
		});
		expect(useDocumentsStore.getState().syncStatus).toBe("syncing");
		expect(useDocumentsStore.getState().syncMessage).toBe("正在保存文档内容");

		await waitFor(() => {
			expect(updateWorkspaceDocumentRecord).toHaveBeenCalledWith(
				"doc-a",
				{ content: nextContent, expectedVersion: 1 },
				"project-a",
			);
		});
		await waitFor(() => {
			expect(useDocumentsStore.getState().documents[0]).toMatchObject(savedDocument);
		});
		expect(useDocumentsStore.getState().syncStatus).toBe("synced");
	});

	it("ignores a stale autosave success after a section image save hydrates newer markdown", async () => {
		const document = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
			].join("\n"),
			isDirty: true,
		};
		const sectionSavedDocument = {
			...document,
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
				"",
				"![林书彤](</api/v1/media-assets/asset-lin/content>)",
			].join("\n"),
			isDirty: false,
			version: 2,
		};
		const staleAutoSavedDocument = {
			...document,
			isDirty: false,
		};
		let resolveAutoSave!: (
			value: Awaited<ReturnType<typeof updateWorkspaceDocumentRecord>>,
		) => void;
		vi.mocked(updateWorkspaceDocumentRecord).mockReturnValueOnce(
			new Promise((resolve) => {
				resolveAutoSave = resolve;
			}),
		);
		vi.mocked(updateWorkspaceDocumentSectionImage).mockResolvedValueOnce({
			document: sectionSavedDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [sectionSavedDocument],
			},
		});
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [document],
		});

		useDocumentsStore.getState().markDocumentSaved("doc-a");
		const applied = useDocumentsStore.getState().toggleSectionImage(
			{
				blockId: "section_lin",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "林书彤",
			},
			{
				src: "/api/v1/media-assets/asset-lin/content",
				title: "林书彤",
			},
			true,
		);
		expect(applied).toBe(true);

		await waitFor(() => {
			expect(useDocumentsStore.getState().documents[0]?.content).toBe(sectionSavedDocument.content);
		});

		resolveAutoSave({
			document: staleAutoSavedDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [staleAutoSavedDocument],
			},
		});
		await Promise.resolve();
		await Promise.resolve();

		const state = useDocumentsStore.getState();
		expect(state.documents[0]?.content).toBe(sectionSavedDocument.content);
		expect(state.documents[0]?.version).toBe(2);
		expect(state.syncStatus).toBe("synced");
	});

	it("ignores a stale autosave failure after a section image save hydrates newer markdown", async () => {
		const document = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
			].join("\n"),
			isDirty: true,
		};
		const sectionSavedDocument = {
			...document,
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
				"",
				"![林书彤](</api/v1/media-assets/asset-lin/content>)",
			].join("\n"),
			isDirty: false,
			version: 2,
		};
		let rejectAutoSave!: (error: Error) => void;
		vi.mocked(updateWorkspaceDocumentRecord).mockReturnValueOnce(
			new Promise((_, reject) => {
				rejectAutoSave = reject;
			}),
		);
		vi.mocked(updateWorkspaceDocumentSectionImage).mockResolvedValueOnce({
			document: sectionSavedDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [sectionSavedDocument],
			},
		});
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [document],
		});

		useDocumentsStore.getState().markDocumentSaved("doc-a");
		const applied = useDocumentsStore.getState().toggleSectionImage(
			{
				blockId: "section_lin",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "林书彤",
			},
			{
				src: "/api/v1/media-assets/asset-lin/content",
				title: "林书彤",
			},
			true,
		);
		expect(applied).toBe(true);

		await waitFor(() => {
			expect(useDocumentsStore.getState().documents[0]?.content).toBe(sectionSavedDocument.content);
		});

		rejectAutoSave(new Error("backend unavailable"));
		await Promise.resolve();
		await Promise.resolve();

		const state = useDocumentsStore.getState();
		expect(state.documents[0]?.content).toBe(sectionSavedDocument.content);
		expect(state.documents[0]?.version).toBe(2);
		expect(state.syncStatus).toBe("synced");
	});

	it("persists section image selection through the document action layer", async () => {
		const document = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
			].join("\n"),
		};
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [document],
		});

		const nextDocument = {
			...document,
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
				"",
				"![林书彤](</api/v1/media-assets/asset-lin/content>)",
			].join("\n"),
			isDirty: false,
			version: 2,
		};
		vi.mocked(updateWorkspaceDocumentSectionImage).mockResolvedValueOnce({
			document: nextDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [nextDocument],
			},
		});

		const applied = useDocumentsStore.getState().toggleSectionImage(
			{
				blockId: "section_lin",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "林书彤",
			},
			{
				src: "/api/v1/media-assets/asset-lin/content",
				title: "林书彤",
			},
			true,
		);

		expect(applied).toBe(true);
		expect(useDocumentsStore.getState().documents[0]?.content).toBe(document.content);

		await waitFor(() => {
			expect(updateWorkspaceDocumentSectionImage).toHaveBeenCalledWith(
				"doc-a",
				{
					sectionId: "section_lin",
					image: {
						src: "/api/v1/media-assets/asset-lin/content",
						title: "林书彤",
					},
					selected: true,
				},
				"project-a",
			);
			expect(useDocumentsStore.getState().documents[0]?.content).toBe(nextDocument.content);
		});
	});

	it("does not apply section image selection when the backend save fails", async () => {
		const document = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
			].join("\n"),
		};
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [document],
		});
		vi.mocked(updateWorkspaceDocumentSectionImage).mockRejectedValueOnce(
			new Error("backend unavailable"),
		);

		const applied = useDocumentsStore.getState().toggleSectionImage(
			{
				blockId: "section_lin",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "林书彤",
			},
			{
				src: "/api/v1/media-assets/asset-lin/content",
				title: "林书彤",
			},
			true,
		);

		expect(applied).toBe(true);
		expect(useDocumentsStore.getState().documents[0]?.content).toBe(document.content);

		await waitFor(() => {
			expect(updateWorkspaceDocumentSectionImage).toHaveBeenCalled();
			expect(useDocumentsStore.getState().syncStatus).toBe("error");
		});
		expect(useDocumentsStore.getState().syncMessage).toBe("后端保存 section 图片失败");
		expect(useDocumentsStore.getState().documents[0]?.content).toBe(document.content);
	});

	it("ignores a section image save response after switching projects", async () => {
		const projectADocument = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
			].join("\n"),
		};
		const projectBDocument = {
			...makeDocument("doc-b"),
			content: "# doc-b\n\n当前项目内容。",
		};
		const projectASavedDocument = {
			...projectADocument,
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
				"",
				"![林书彤](</api/v1/media-assets/asset-lin/content>)",
			].join("\n"),
			isDirty: false,
			version: 2,
		};
		let resolveImageSave!: (
			value: Awaited<ReturnType<typeof updateWorkspaceDocumentSectionImage>>,
		) => void;
		vi.mocked(updateWorkspaceDocumentSectionImage).mockReturnValueOnce(
			new Promise((resolve) => {
				resolveImageSave = resolve;
			}),
		);

		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [projectADocument],
		});
		const applied = useDocumentsStore.getState().toggleSectionImage(
			{
				blockId: "section_lin",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "林书彤",
			},
			{
				src: "/api/v1/media-assets/asset-lin/content",
				title: "林书彤",
			},
			true,
		);
		expect(applied).toBe(true);

		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-b",
			projectId: "project-b",
			documents: [projectBDocument],
		});
		resolveImageSave({
			document: projectASavedDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [projectASavedDocument],
			},
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(useDocumentsStore.getState().projectId).toBe("project-b");
		expect(useDocumentsStore.getState().workspaceDir).toBe("/workspace/project-b");
		expect(useDocumentsStore.getState().documents).toHaveLength(1);
		expect(useDocumentsStore.getState().documents[0]).toMatchObject({
			content: projectBDocument.content,
			id: projectBDocument.id,
			title: projectBDocument.title,
		});
	});

	it("persists section images with a legacy generated section id", async () => {
		const document = {
			...makeDocument("doc-a"),
			content: ["# doc-a", "", "## 林书彤", "", "角色描述。"].join("\n"),
		};
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [document],
		});

		const nextDocument = {
			...document,
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
				"",
				"![林书彤](</api/v1/media-assets/asset-lin/content>)",
			].join("\n"),
			isDirty: false,
			version: 2,
		};
		vi.mocked(updateWorkspaceDocumentSectionImage).mockResolvedValueOnce({
			document: nextDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [nextDocument],
			},
		});

		const applied = useDocumentsStore.getState().toggleSectionImage(
			{
				blockId: "section-lin",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "林书彤",
			},
			{
				src: "/api/v1/media-assets/asset-lin/content",
				title: "林书彤",
			},
			true,
		);

		expect(applied).toBe(true);
		expect(useDocumentsStore.getState().documents[0]?.content).toBe(document.content);
		await waitFor(() => {
			expect(updateWorkspaceDocumentSectionImage).toHaveBeenCalledWith(
				"doc-a",
				{
					sectionId: "section-lin",
					image: {
						src: "/api/v1/media-assets/asset-lin/content",
						title: "林书彤",
					},
					selected: true,
				},
				"project-a",
			);
			expect(useDocumentsStore.getState().documents[0]?.content).toBe(nextDocument.content);
		});
	});

	it("persists section media selection through the document action layer", async () => {
		const document = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_shot -->",
				"## 分镜 01",
				"",
				"镜头描述。",
			].join("\n"),
		};
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [document],
		});

		const nextDocument = {
			...document,
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_shot -->",
				"## 分镜 01",
				"",
				"镜头描述。",
				"",
				"[章节视频：分镜 01](</api/v1/media-assets/video-1/content>)",
			].join("\n"),
			isDirty: false,
			version: 2,
		};
		vi.mocked(updateWorkspaceDocumentSectionMedia).mockResolvedValueOnce({
			document: nextDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [nextDocument],
			},
		});

		const applied = useDocumentsStore.getState().toggleSectionMedia(
			{
				blockId: "section_shot",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "分镜 01",
			},
			{
				kind: "video",
				src: "/api/v1/media-assets/video-1/content",
				title: "分镜 01",
			},
			true,
		);

		expect(applied).toBe(true);
		expect(useDocumentsStore.getState().documents[0]?.content).toBe(document.content);

		await waitFor(() => {
			expect(updateWorkspaceDocumentSectionMedia).toHaveBeenCalledWith(
				"doc-a",
				{
					sectionId: "section_shot",
					media: {
						kind: "video",
						src: "/api/v1/media-assets/video-1/content",
						title: "分镜 01",
					},
					selected: true,
				},
				"project-a",
			);
			expect(useDocumentsStore.getState().documents[0]?.content).toBe(nextDocument.content);
		});
	});

	it("does not write section media without a writable section id", () => {
		const document = {
			...makeDocument("doc-a"),
			content: ["# doc-a", "", "## 分镜 01", "", "镜头描述。"].join("\n"),
		};
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [document],
		});

		const applied = useDocumentsStore.getState().toggleSectionMedia(
			{
				blockId: "shot",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "分镜 01",
			},
			{
				kind: "video",
				src: "/api/v1/media-assets/video-1/content",
				title: "分镜 01",
			},
			true,
		);

		expect(applied).toBe(false);
		expect(useDocumentsStore.getState().documents[0]?.content).toBe(document.content);
		expect(updateWorkspaceDocumentSectionMedia).not.toHaveBeenCalled();
	});

	it("does not apply section media selection when the backend save fails", async () => {
		const document = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_shot -->",
				"## 分镜 01",
				"",
				"镜头描述。",
			].join("\n"),
		};
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [document],
		});
		vi.mocked(updateWorkspaceDocumentSectionMedia).mockRejectedValueOnce(
			new Error("backend unavailable"),
		);

		const applied = useDocumentsStore.getState().toggleSectionMedia(
			{
				blockId: "section_shot",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "分镜 01",
			},
			{
				kind: "video",
				src: "/api/v1/media-assets/video-1/content",
				title: "分镜 01",
			},
			true,
		);

		expect(applied).toBe(true);
		expect(useDocumentsStore.getState().documents[0]?.content).toBe(document.content);

		await waitFor(() => {
			expect(updateWorkspaceDocumentSectionMedia).toHaveBeenCalled();
			expect(useDocumentsStore.getState().syncStatus).toBe("error");
		});
		expect(useDocumentsStore.getState().syncMessage).toBe("后端保存 section media 失败");
		expect(useDocumentsStore.getState().documents[0]?.content).toBe(document.content);
	});

	it("ignores a section media save response after switching projects", async () => {
		const projectADocument = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_shot -->",
				"## 分镜 01",
				"",
				"镜头描述。",
			].join("\n"),
		};
		const projectBDocument = {
			...makeDocument("doc-b"),
			content: "# doc-b\n\n当前项目内容。",
		};
		const projectASavedDocument = {
			...projectADocument,
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_shot -->",
				"## 分镜 01",
				"",
				"镜头描述。",
				"",
				"[章节视频：分镜 01](</api/v1/media-assets/video-1/content>)",
			].join("\n"),
			isDirty: false,
			version: 2,
		};
		let resolveMediaSave!: (
			value: Awaited<ReturnType<typeof updateWorkspaceDocumentSectionMedia>>,
		) => void;
		vi.mocked(updateWorkspaceDocumentSectionMedia).mockReturnValueOnce(
			new Promise((resolve) => {
				resolveMediaSave = resolve;
			}),
		);

		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [projectADocument],
		});
		const applied = useDocumentsStore.getState().toggleSectionMedia(
			{
				blockId: "section_shot",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "分镜 01",
			},
			{
				kind: "video",
				src: "/api/v1/media-assets/video-1/content",
				title: "分镜 01",
			},
			true,
		);
		expect(applied).toBe(true);

		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-b",
			projectId: "project-b",
			documents: [projectBDocument],
		});
		resolveMediaSave({
			document: projectASavedDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [projectASavedDocument],
			},
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(useDocumentsStore.getState().projectId).toBe("project-b");
		expect(useDocumentsStore.getState().workspaceDir).toBe("/workspace/project-b");
		expect(useDocumentsStore.getState().documents).toHaveLength(1);
		expect(useDocumentsStore.getState().documents[0]).toMatchObject({
			content: projectBDocument.content,
			id: projectBDocument.id,
			title: projectBDocument.title,
		});
	});

	it("persists section mention selection through the backend document action layer", async () => {
		const document = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_shot -->",
				"## 分镜 01",
				"",
				"镜头描述。",
			].join("\n"),
		};
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [document],
		});

		const nextDocument = {
			...document,
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_shot -->",
				"## 分镜 01",
				"",
				"引用资源： @[林书彤](mention://character-doc/section_character)",
				"",
				"镜头描述。",
			].join("\n"),
			isDirty: false,
			version: 2,
		};
		vi.mocked(updateWorkspaceDocumentSectionMention).mockResolvedValueOnce({
			document: nextDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [nextDocument],
			},
		});

		const applied = useDocumentsStore.getState().toggleSectionMention(
			{
				blockId: "section_shot",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "分镜 01",
			},
			{
				documentId: "character-doc",
				blockId: "section_character",
				title: "林书彤",
				category: "character",
			},
			true,
		);

		expect(applied).toBe(true);
		expect(useDocumentsStore.getState().documents[0]?.content).toBe(document.content);

		await waitFor(() => {
			expect(updateWorkspaceDocumentSectionMention).toHaveBeenCalledWith(
				"doc-a",
				{
					sectionId: "section_shot",
					reference: {
						documentId: "character-doc",
						blockId: "section_character",
						title: "林书彤",
						category: "character",
					},
					selected: true,
				},
				"project-a",
			);
			expect(useDocumentsStore.getState().documents[0]?.content).toBe(nextDocument.content);
		});
	});

	it("does not write section mentions without a writable section id", () => {
		const document = {
			...makeDocument("doc-a"),
			content: ["# doc-a", "", "## 分镜 01", "", "镜头描述。"].join("\n"),
		};
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [document],
		});

		const applied = useDocumentsStore.getState().toggleSectionMention(
			{
				blockId: "shot",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "分镜 01",
			},
			{
				documentId: "character-doc",
				blockId: "section_character",
				title: "林书彤",
			},
			true,
		);

		expect(applied).toBe(false);
		expect(useDocumentsStore.getState().documents[0]?.content).toBe(document.content);
		expect(updateWorkspaceDocumentSectionMention).not.toHaveBeenCalled();
	});

	it("does not apply section mention selection when the backend save fails", async () => {
		const document = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_shot -->",
				"## 分镜 01",
				"",
				"镜头描述。",
			].join("\n"),
		};
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [document],
		});
		vi.mocked(updateWorkspaceDocumentSectionMention).mockRejectedValueOnce(
			new Error("backend unavailable"),
		);

		const applied = useDocumentsStore.getState().toggleSectionMention(
			{
				blockId: "section_shot",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "分镜 01",
			},
			{
				documentId: "character-doc",
				blockId: "section_character",
				title: "林书彤",
				category: "character",
			},
			true,
		);

		expect(applied).toBe(true);
		expect(useDocumentsStore.getState().documents[0]?.content).toBe(document.content);

		await waitFor(() => {
			expect(updateWorkspaceDocumentSectionMention).toHaveBeenCalled();
			expect(useDocumentsStore.getState().syncStatus).toBe("error");
		});
		expect(useDocumentsStore.getState().syncMessage).toBe("后端保存 section 引用失败");
		expect(useDocumentsStore.getState().documents[0]?.content).toBe(document.content);
	});

	it("ignores a section mention save response after switching projects", async () => {
		const projectADocument = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_shot -->",
				"## 分镜 01",
				"",
				"镜头描述。",
			].join("\n"),
		};
		const projectBDocument = {
			...makeDocument("doc-b"),
			content: "# doc-b\n\n当前项目内容。",
		};
		const projectASavedDocument = {
			...projectADocument,
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_shot -->",
				"## 分镜 01",
				"",
				"引用资源： @[林书彤](mention://character-doc/section_character)",
				"",
				"镜头描述。",
			].join("\n"),
			isDirty: false,
			version: 2,
		};
		let resolveMentionSave!: (
			value: Awaited<ReturnType<typeof updateWorkspaceDocumentSectionMention>>,
		) => void;
		vi.mocked(updateWorkspaceDocumentSectionMention).mockReturnValueOnce(
			new Promise((resolve) => {
				resolveMentionSave = resolve;
			}),
		);

		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [projectADocument],
		});
		const applied = useDocumentsStore.getState().toggleSectionMention(
			{
				blockId: "section_shot",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "分镜 01",
			},
			{
				documentId: "character-doc",
				blockId: "section_character",
				title: "林书彤",
				category: "character",
			},
			true,
		);
		expect(applied).toBe(true);

		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-b",
			projectId: "project-b",
			documents: [projectBDocument],
		});
		resolveMentionSave({
			document: projectASavedDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [projectASavedDocument],
			},
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(useDocumentsStore.getState().projectId).toBe("project-b");
		expect(useDocumentsStore.getState().workspaceDir).toBe("/workspace/project-b");
		expect(useDocumentsStore.getState().documents).toHaveLength(1);
		expect(useDocumentsStore.getState().documents[0]).toMatchObject({
			content: projectBDocument.content,
			id: projectBDocument.id,
			title: projectBDocument.title,
		});
	});

	it("preserves pending comment state when hydrating the same active document", () => {
		const document = {
			...makeDocument("doc-a"),
			content: "# doc-a\n\n这是一段锚点文本。\n",
			comments: [
				{
					id: "comment-a",
					anchorText: "这是一段锚点文本。",
					anchor: createTextAnchor("# doc-a\n\n这是一段锚点文本。\n", "这是一段锚点文本。"),
					body: "补充张力",
					createdAt: "2026-05-31T00:00:00.000Z",
					resolved: false,
				},
			],
		};
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [document],
		});
		useDocumentsStore.getState().setSelection("doc-a", "这是一段锚点文本。");
		useDocumentsStore.getState().openPendingComment({
			documentId: "doc-a",
			selection: "这是一段锚点文本。",
			x: 320,
			y: 240,
		});
		useDocumentsStore.getState().focusComment("comment-a");

		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [{ ...document, updatedAt: "2026-05-31T00:00:01.000Z" }],
		});

		const state = useDocumentsStore.getState();
		expect(state.selection?.text).toBe("这是一段锚点文本。");
		expect(state.pendingComment).toMatchObject({
			documentId: "doc-a",
			selection: "这是一段锚点文本。",
			x: 320,
			y: 240,
		});
		expect(state.activeCommentId).toBe("comment-a");
		expect(state.showComments).toBe(true);
	});

	it("does not warn when creating an intentionally blank typed document", async () => {
		const warningSpy = vi.spyOn(Toast, "warning").mockImplementation(() => "warning-toast");
		vi.mocked(createWorkspaceDocument).mockImplementation(async (payload, projectId) => {
			const document: MarkdownDocument = {
				...makeDocument(payload.id ?? "doc-created"),
				title: payload.title ?? "新文档",
				content: payload.content ?? "",
				category: payload.category ?? "screenplay",
				parentId: payload.parentId ?? null,
				folderId: payload.folderId ?? null,
				sortOrder: payload.sortOrder ?? 0,
				comments: payload.comments ?? [],
			};
			return {
				document,
				state: {
					workspaceDir: "/workspace/project-a",
					projectId: projectId ?? undefined,
					documents: [document],
					folders: [],
					assets: [],
				},
			};
		});
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [],
			folders: [],
			assets: [],
		});

		try {
			const document = useDocumentsStore.getState().createDocument({ category: "screenplay" });

			expect(document?.content).toBe("");
			await waitFor(() => expect(createWorkspaceDocument).toHaveBeenCalledTimes(1));
			expect(warningSpy).not.toHaveBeenCalled();
		} finally {
			warningSpy.mockRestore();
		}
	});

	it("hydrates folders from DocumentStateSync workspace state payload", () => {
		vi.mocked(useSWR).mockReturnValue({
			data: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [
					{ ...makeDocument("doc-a"), folderId: "folder-a" },
					{ ...makeDocument("doc-b"), folderId: "missing-folder" },
				],
				folders: [makeFolder("folder-a")],
				assets: [makeAsset("asset-a", "folder-a"), makeAsset("asset-b", "missing-folder")],
				operationLog: [],
			},
			error: undefined,
			isLoading: false,
		} as ReturnType<typeof useSWR>);

		render(React.createElement(DocumentStateSync, { projectId: "project-a" }));

		expect(useSWR).toHaveBeenCalledWith(
			"/workspace/state?projectId=project-a",
			expect.any(Function),
			expect.objectContaining({ refreshInterval: workspaceStateFallbackRefreshIntervalMs }),
		);
		const state = useDocumentsStore.getState();
		expect(state.folders.map((folder) => folder.id)).toEqual(["folder-a"]);
		expect(state.documents.map((document) => document.folderId ?? null)).toEqual([
			"folder-a",
			null,
		]);
		expect(state.assets.map((asset) => asset.folderId ?? null)).toEqual(["folder-a", null]);
	});

	it("clears the previous project directory while a newly selected project is loading", async () => {
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState(
				[makeDocument("doc-project-a")],
				[makeLogEntry("doc-project-a")],
				"/workspace/project-a",
				"project-a",
				[makeAsset("asset-project-a")],
				[makeFolder("folder-project-a")],
			);
		vi.mocked(useSWR).mockReturnValue({
			data: undefined,
			error: undefined,
			isLoading: true,
		} as ReturnType<typeof useSWR>);

		render(React.createElement(DocumentStateSync, { projectId: "project-b" }));

		await waitFor(() => {
			const state = useDocumentsStore.getState();
			expect(state.projectId).toBeNull();
			expect(state.documents).toEqual([]);
			expect(state.folders).toEqual([]);
			expect(state.assets).toEqual([]);
			expect(state.syncStatus).toBe("syncing");
			expect(state.syncMessage).toBe("正在加载项目工作区");
		});
	});

	it("does not hydrate polled workspace state over dirty local documents", () => {
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState(
				[{ ...makeDocument("doc-local"), isDirty: true }],
				[],
				"/workspace/project-a",
				"project-a",
			);
		vi.mocked(useSWR).mockReturnValue({
			data: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [makeDocument("doc-remote")],
				folders: [],
				assets: [],
				operationLog: [],
			},
			error: undefined,
			isLoading: false,
		} as ReturnType<typeof useSWR>);

		render(React.createElement(DocumentStateSync, { projectId: "project-a" }));

		const state = useDocumentsStore.getState();
		expect(state.documents.map((document) => document.id)).toEqual(["doc-local"]);
		expect(state.documents[0]?.isDirty).toBe(true);
	});

	it("refreshes workspace state when the workspace event stream reports document changes", async () => {
		vi.stubGlobal("EventSource", class {});
		const source = createFakeWorkspaceEventSource();
		vi.mocked(createWorkspaceEventSource).mockReturnValue(source);
		vi.mocked(getWorkspaceState).mockResolvedValue({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [makeDocument("doc-event")],
			folders: [makeFolder("folder-event")],
			assets: [],
			operationLog: [makeLogEntry("doc-event")],
		});
		vi.mocked(useSWR).mockReturnValue({
			data: undefined,
			error: undefined,
			isLoading: false,
		} as ReturnType<typeof useSWR>);

		render(React.createElement(DocumentStateSync, { projectId: "project-a" }));
		source.emit("workspace.documents.changed");
		await Promise.resolve();
		await Promise.resolve();

		expect(createWorkspaceEventSource).toHaveBeenCalledWith("project-a");
		expect(getWorkspaceState).toHaveBeenCalledWith("project-a");
		const state = useDocumentsStore.getState();
		expect(state.documents.map((document) => document.id)).toEqual(["doc-event"]);
		expect(state.folders.map((folder) => folder.id)).toEqual(["folder-event"]);
	});

	it("moves folders before siblings and persists changed sort orders", () => {
		vi.mocked(updateWorkspaceFolder).mockResolvedValue({
			folder: makeFolder("folder-c"),
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [],
				folders: [
					makeFolder("folder-c", { sortOrder: 0 }),
					makeFolder("folder-a", { sortOrder: 1 }),
					makeFolder("folder-b", { sortOrder: 2 }),
				],
			},
		});
		vi.mocked(getWorkspaceDocuments).mockResolvedValue({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [],
			folders: [
				makeFolder("folder-c", { sortOrder: 0 }),
				makeFolder("folder-a", { sortOrder: 1 }),
				makeFolder("folder-b", { sortOrder: 2 }),
			],
		});
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState(
				[],
				[],
				"/workspace/project-a",
				"project-a",
				[],
				[
					makeFolder("folder-a", { sortOrder: 0 }),
					makeFolder("folder-b", { sortOrder: 1 }),
					makeFolder("folder-c", { sortOrder: 2 }),
				],
			);

		useDocumentsStore.getState().moveFolder("folder-c", "folder-a", "before");

		const foldersById = new Map(
			useDocumentsStore.getState().folders.map((folder) => [folder.id, folder]),
		);
		expect(foldersById.get("folder-c")?.sortOrder).toBe(0);
		expect(foldersById.get("folder-a")?.sortOrder).toBe(1);
		expect(foldersById.get("folder-b")?.sortOrder).toBe(2);
		expect(updateWorkspaceFolder).toHaveBeenCalledWith(
			"folder-a",
			{ parentId: null, sortOrder: 1 },
			"project-a",
		);
		expect(updateWorkspaceFolder).toHaveBeenCalledWith(
			"folder-b",
			{ parentId: null, sortOrder: 2 },
			"project-a",
		);
		expect(updateWorkspaceFolder).toHaveBeenCalledWith(
			"folder-c",
			{ parentId: null, sortOrder: 0 },
			"project-a",
		);
	});

	it("ignores a stale folder move success after a section image save hydrates newer markdown", async () => {
		const document = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
			].join("\n"),
		};
		const movedFolders = [
			makeFolder("folder-c", { sortOrder: 0 }),
			makeFolder("folder-a", { sortOrder: 1 }),
			makeFolder("folder-b", { sortOrder: 2 }),
		];
		const staleDocument = { ...document };
		const sectionSavedDocument = {
			...document,
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
				"",
				"![林书彤](</api/v1/media-assets/asset-lin/content>)",
			].join("\n"),
			isDirty: false,
			version: 2,
		};
		let releaseFolderSave!: () => void;
		let shouldPauseFolderSave = true;
		vi.mocked(updateWorkspaceFolder).mockImplementation(async (folderId, payload) => {
			if (shouldPauseFolderSave) {
				shouldPauseFolderSave = false;
				await new Promise<void>((resolve) => {
					releaseFolderSave = resolve;
				});
			}
			return {
				folder: makeFolder(folderId, {
					parentId: payload.parentId ?? null,
					sortOrder: payload.sortOrder ?? 0,
				}),
				state: {
					workspaceDir: "/workspace/project-a",
					projectId: "project-a",
					documents: [staleDocument],
					folders: movedFolders,
					assets: [],
				},
			};
		});
		vi.mocked(getWorkspaceDocuments).mockResolvedValue({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [staleDocument],
			folders: movedFolders,
			assets: [],
		});
		vi.mocked(updateWorkspaceDocumentSectionImage).mockResolvedValueOnce({
			document: sectionSavedDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [sectionSavedDocument],
				folders: movedFolders,
				assets: [],
			},
		});
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState(
				[document],
				[],
				"/workspace/project-a",
				"project-a",
				[],
				[
					makeFolder("folder-a", { sortOrder: 0 }),
					makeFolder("folder-b", { sortOrder: 1 }),
					makeFolder("folder-c", { sortOrder: 2 }),
				],
			);

		useDocumentsStore.getState().moveFolder("folder-c", "folder-a", "before");
		await waitFor(() => expect(updateWorkspaceFolder).toHaveBeenCalledTimes(3));
		const applied = useDocumentsStore.getState().toggleSectionImage(
			{
				blockId: "section_lin",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "林书彤",
			},
			{
				src: "/api/v1/media-assets/asset-lin/content",
				title: "林书彤",
			},
			true,
		);
		expect(applied).toBe(true);
		await waitFor(() => {
			expect(useDocumentsStore.getState().documents[0]?.content).toBe(sectionSavedDocument.content);
		});

		releaseFolderSave();
		await waitFor(() => expect(getWorkspaceDocuments).toHaveBeenCalledWith("project-a"));
		await Promise.resolve();
		await Promise.resolve();

		const state = useDocumentsStore.getState();
		expect(state.documents[0]?.content).toBe(sectionSavedDocument.content);
		expect(state.documents[0]?.version).toBe(2);
		expect(state.syncStatus).toBe("synced");
	});

	it("ignores a stale folder move failure after a section image save hydrates newer markdown", async () => {
		const document = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
			].join("\n"),
		};
		const movedFolders = [
			makeFolder("folder-c", { sortOrder: 0 }),
			makeFolder("folder-a", { sortOrder: 1 }),
			makeFolder("folder-b", { sortOrder: 2 }),
		];
		const sectionSavedDocument = {
			...document,
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
				"",
				"![林书彤](</api/v1/media-assets/asset-lin/content>)",
			].join("\n"),
			isDirty: false,
			version: 2,
		};
		let rejectFolderSave!: (error: Error) => void;
		let shouldRejectFolderSave = true;
		vi.mocked(updateWorkspaceFolder).mockImplementation(async (folderId, payload) => {
			if (shouldRejectFolderSave) {
				shouldRejectFolderSave = false;
				await new Promise<void>((_, reject) => {
					rejectFolderSave = reject;
				});
			}
			return {
				folder: makeFolder(folderId, {
					parentId: payload.parentId ?? null,
					sortOrder: payload.sortOrder ?? 0,
				}),
				state: {
					workspaceDir: "/workspace/project-a",
					projectId: "project-a",
					documents: [document],
					folders: movedFolders,
					assets: [],
				},
			};
		});
		vi.mocked(updateWorkspaceDocumentSectionImage).mockResolvedValueOnce({
			document: sectionSavedDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [sectionSavedDocument],
				folders: movedFolders,
				assets: [],
			},
		});
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState(
				[document],
				[],
				"/workspace/project-a",
				"project-a",
				[],
				[
					makeFolder("folder-a", { sortOrder: 0 }),
					makeFolder("folder-b", { sortOrder: 1 }),
					makeFolder("folder-c", { sortOrder: 2 }),
				],
			);

		useDocumentsStore.getState().moveFolder("folder-c", "folder-a", "before");
		await waitFor(() => expect(updateWorkspaceFolder).toHaveBeenCalledTimes(3));
		const applied = useDocumentsStore.getState().toggleSectionImage(
			{
				blockId: "section_lin",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "林书彤",
			},
			{
				src: "/api/v1/media-assets/asset-lin/content",
				title: "林书彤",
			},
			true,
		);
		expect(applied).toBe(true);
		await waitFor(() => {
			expect(useDocumentsStore.getState().documents[0]?.content).toBe(sectionSavedDocument.content);
		});

		rejectFolderSave(new Error("backend unavailable"));
		await Promise.resolve();
		await Promise.resolve();

		const state = useDocumentsStore.getState();
		expect(state.documents[0]?.content).toBe(sectionSavedDocument.content);
		expect(state.documents[0]?.version).toBe(2);
		expect(state.syncStatus).toBe("synced");
	});

	it("moves documents before siblings and persists changed sort orders with document patches", async () => {
		vi.mocked(updateWorkspaceDocumentRecord).mockImplementation(async (documentId, payload) => {
			const document = {
				...makeDocument(documentId),
				parentId: payload.parentId ?? null,
				folderId: payload.folderId ?? null,
				sortOrder: payload.sortOrder ?? 0,
			};
			return {
				document,
				state: {
					workspaceDir: "/workspace/project-a",
					projectId: "project-a",
					documents: [document],
					folders: [],
					assets: [],
				},
			};
		});
		useDocumentsStore.getState().hydrateWorkspaceState(
			[
				{ ...makeDocument("doc-a"), sortOrder: 0 },
				{ ...makeDocument("doc-b"), sortOrder: 1 },
				{ ...makeDocument("doc-c"), sortOrder: 2 },
			],
			[],
			"/workspace/project-a",
			"project-a",
		);

		useDocumentsStore.getState().moveDocument("doc-c", "doc-a", "before");

		await waitFor(() => expect(updateWorkspaceDocumentRecord).toHaveBeenCalledTimes(3));
		expect(updateWorkspaceDocumentRecord).toHaveBeenCalledWith(
			"doc-a",
			{ parentId: null, folderId: null, sortOrder: 1 },
			"project-a",
		);
		expect(updateWorkspaceDocumentRecord).toHaveBeenCalledWith(
			"doc-b",
			{ parentId: null, folderId: null, sortOrder: 2 },
			"project-a",
		);
		expect(updateWorkspaceDocumentRecord).toHaveBeenCalledWith(
			"doc-c",
			{ parentId: null, folderId: null, sortOrder: 0 },
			"project-a",
		);
		expect(updateWorkspaceState).not.toHaveBeenCalled();
	});

	it("ignores a stale document order success after a section image save hydrates newer markdown", async () => {
		const docA = { ...makeDocument("doc-a"), sortOrder: 0 };
		const docB = { ...makeDocument("doc-b"), sortOrder: 1 };
		const docC = {
			...makeDocument("doc-c"),
			content: [
				"# doc-c",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
			].join("\n"),
			sortOrder: 2,
		};
		const staleMovedDocuments = [
			{ ...docC, sortOrder: 0 },
			{ ...docA, sortOrder: 1 },
			{ ...docB, sortOrder: 2 },
		];
		const sectionSavedDocuments = [
			{
				...docC,
				content: [
					"# doc-c",
					"",
					"<!-- section-id: section_lin -->",
					"## 林书彤",
					"",
					"角色描述。",
					"",
					"![林书彤](</api/v1/media-assets/asset-lin/content>)",
				].join("\n"),
				isDirty: false,
				sortOrder: 0,
				version: 2,
			},
			{ ...docA, sortOrder: 1 },
			{ ...docB, sortOrder: 2 },
		];
		let releaseOrderSave!: () => void;
		let shouldPauseOrderSave = true;
		vi.mocked(updateWorkspaceDocumentRecord).mockImplementation(async (documentId) => {
			if (shouldPauseOrderSave) {
				shouldPauseOrderSave = false;
				await new Promise<void>((resolve) => {
					releaseOrderSave = resolve;
				});
			}
			const document = staleMovedDocuments.find((item) => item.id === documentId);
			if (!document) throw new Error(`missing test document ${documentId}`);
			return {
				document,
				state: {
					workspaceDir: "/workspace/project-a",
					projectId: "project-a",
					documents: staleMovedDocuments,
					folders: [],
					assets: [],
				},
			};
		});
		vi.mocked(updateWorkspaceDocumentSectionImage).mockResolvedValueOnce({
			document: sectionSavedDocuments[0],
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: sectionSavedDocuments,
				folders: [],
				assets: [],
			},
		});
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState([docA, docB, docC], [], "/workspace/project-a", "project-a");

		useDocumentsStore.getState().moveDocument("doc-c", "doc-a", "before");
		await waitFor(() => expect(updateWorkspaceDocumentRecord).toHaveBeenCalledTimes(1));
		const applied = useDocumentsStore.getState().toggleSectionImage(
			{
				blockId: "section_lin",
				documentId: "doc-c",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "林书彤",
			},
			{
				src: "/api/v1/media-assets/asset-lin/content",
				title: "林书彤",
			},
			true,
		);
		expect(applied).toBe(true);
		await waitFor(() => {
			expect(useDocumentsStore.getState().documents[0]?.content).toBe(
				sectionSavedDocuments[0]?.content,
			);
		});

		releaseOrderSave();
		await waitFor(() => expect(updateWorkspaceDocumentRecord).toHaveBeenCalledTimes(3));
		await Promise.resolve();
		await Promise.resolve();

		const state = useDocumentsStore.getState();
		expect(state.documents[0]?.id).toBe("doc-c");
		expect(state.documents[0]?.content).toBe(sectionSavedDocuments[0]?.content);
		expect(state.documents[0]?.version).toBe(2);
		expect(state.syncStatus).toBe("synced");
	});

	it("ignores a stale document order failure after a section image save hydrates newer markdown", async () => {
		const docA = { ...makeDocument("doc-a"), sortOrder: 0 };
		const docB = { ...makeDocument("doc-b"), sortOrder: 1 };
		const docC = {
			...makeDocument("doc-c"),
			content: [
				"# doc-c",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
			].join("\n"),
			sortOrder: 2,
		};
		const sectionSavedDocuments = [
			{
				...docC,
				content: [
					"# doc-c",
					"",
					"<!-- section-id: section_lin -->",
					"## 林书彤",
					"",
					"角色描述。",
					"",
					"![林书彤](</api/v1/media-assets/asset-lin/content>)",
				].join("\n"),
				isDirty: false,
				sortOrder: 0,
				version: 2,
			},
			{ ...docA, sortOrder: 1 },
			{ ...docB, sortOrder: 2 },
		];
		let rejectOrderSave!: (error: Error) => void;
		vi.mocked(updateWorkspaceDocumentRecord).mockReturnValueOnce(
			new Promise((_, reject) => {
				rejectOrderSave = reject;
			}),
		);
		vi.mocked(updateWorkspaceDocumentSectionImage).mockResolvedValueOnce({
			document: sectionSavedDocuments[0],
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: sectionSavedDocuments,
				folders: [],
				assets: [],
			},
		});
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState([docA, docB, docC], [], "/workspace/project-a", "project-a");

		useDocumentsStore.getState().moveDocument("doc-c", "doc-a", "before");
		await waitFor(() => expect(updateWorkspaceDocumentRecord).toHaveBeenCalledTimes(1));
		const applied = useDocumentsStore.getState().toggleSectionImage(
			{
				blockId: "section_lin",
				documentId: "doc-c",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "林书彤",
			},
			{
				src: "/api/v1/media-assets/asset-lin/content",
				title: "林书彤",
			},
			true,
		);
		expect(applied).toBe(true);
		await waitFor(() => {
			expect(useDocumentsStore.getState().documents[0]?.content).toBe(
				sectionSavedDocuments[0]?.content,
			);
		});

		rejectOrderSave(new Error("backend unavailable"));
		await Promise.resolve();
		await Promise.resolve();

		const state = useDocumentsStore.getState();
		expect(state.documents[0]?.id).toBe("doc-c");
		expect(state.documents[0]?.content).toBe(sectionSavedDocuments[0]?.content);
		expect(state.documents[0]?.version).toBe(2);
		expect(state.syncStatus).toBe("synced");
	});

	it("ignores a stale move-to-folder success after a section image save hydrates newer markdown", async () => {
		const folder = makeFolder("folder-a");
		const document = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
			].join("\n"),
		};
		const movedDocument = {
			...document,
			folderId: "folder-a",
			version: 2,
		};
		const sectionSavedDocument = {
			...movedDocument,
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
				"",
				"![林书彤](</api/v1/media-assets/asset-lin/content>)",
			].join("\n"),
			isDirty: false,
			version: 3,
		};
		let resolveMoveSave!: (
			value: Awaited<ReturnType<typeof updateWorkspaceDocumentRecord>>,
		) => void;
		vi.mocked(updateWorkspaceDocumentRecord).mockReturnValueOnce(
			new Promise((resolve) => {
				resolveMoveSave = resolve;
			}),
		);
		vi.mocked(updateWorkspaceDocumentSectionImage).mockResolvedValueOnce({
			document: sectionSavedDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [sectionSavedDocument],
				folders: [folder],
				assets: [],
			},
		});
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState([document], [], "/workspace/project-a", "project-a", [], [folder]);

		useDocumentsStore.getState().moveItemToFolder("document", "doc-a", "folder-a");
		await waitFor(() => expect(updateWorkspaceDocumentRecord).toHaveBeenCalledTimes(1));
		const applied = useDocumentsStore.getState().toggleSectionImage(
			{
				blockId: "section_lin",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "林书彤",
			},
			{
				src: "/api/v1/media-assets/asset-lin/content",
				title: "林书彤",
			},
			true,
		);
		expect(applied).toBe(true);
		await waitFor(() => {
			expect(useDocumentsStore.getState().documents[0]?.content).toBe(sectionSavedDocument.content);
		});

		resolveMoveSave({
			document: movedDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [movedDocument],
				folders: [folder],
				assets: [],
			},
		});
		await Promise.resolve();
		await Promise.resolve();

		const state = useDocumentsStore.getState();
		expect(state.documents[0]?.folderId).toBe("folder-a");
		expect(state.documents[0]?.content).toBe(sectionSavedDocument.content);
		expect(state.documents[0]?.version).toBe(3);
		expect(state.syncStatus).toBe("synced");
	});

	it("ignores a stale move-to-folder failure after a section image save hydrates newer markdown", async () => {
		const folder = makeFolder("folder-a");
		const document = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
			].join("\n"),
		};
		const sectionSavedDocument = {
			...document,
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
				"",
				"![林书彤](</api/v1/media-assets/asset-lin/content>)",
			].join("\n"),
			folderId: "folder-a",
			isDirty: false,
			version: 3,
		};
		let rejectMoveSave!: (error: Error) => void;
		vi.mocked(updateWorkspaceDocumentRecord).mockReturnValueOnce(
			new Promise((_, reject) => {
				rejectMoveSave = reject;
			}),
		);
		vi.mocked(updateWorkspaceDocumentSectionImage).mockResolvedValueOnce({
			document: sectionSavedDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [sectionSavedDocument],
				folders: [folder],
				assets: [],
			},
		});
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState([document], [], "/workspace/project-a", "project-a", [], [folder]);

		useDocumentsStore.getState().moveItemToFolder("document", "doc-a", "folder-a");
		await waitFor(() => expect(updateWorkspaceDocumentRecord).toHaveBeenCalledTimes(1));
		const applied = useDocumentsStore.getState().toggleSectionImage(
			{
				blockId: "section_lin",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "林书彤",
			},
			{
				src: "/api/v1/media-assets/asset-lin/content",
				title: "林书彤",
			},
			true,
		);
		expect(applied).toBe(true);
		await waitFor(() => {
			expect(useDocumentsStore.getState().documents[0]?.content).toBe(sectionSavedDocument.content);
		});

		rejectMoveSave(new Error("backend unavailable"));
		await Promise.resolve();
		await Promise.resolve();

		const state = useDocumentsStore.getState();
		expect(state.documents[0]?.folderId).toBe("folder-a");
		expect(state.documents[0]?.content).toBe(sectionSavedDocument.content);
		expect(state.documents[0]?.version).toBe(3);
		expect(state.syncStatus).toBe("synced");
	});

	it("moves text project assets into folders and persists the folder id", async () => {
		vi.mocked(updateProjectAsset).mockResolvedValue(makeAsset("asset-a", "folder-a"));
		vi.mocked(getWorkspaceDocuments).mockResolvedValue({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [],
			folders: [makeFolder("folder-a")],
			assets: [makeAsset("asset-a", "folder-a")],
		});
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState(
				[],
				[],
				"/workspace/project-a",
				"project-a",
				[makeAsset("asset-a")],
				[makeFolder("folder-a")],
			);

		useDocumentsStore.getState().moveItemToFolder("asset", "asset-a", "folder-a");

		expect(useDocumentsStore.getState().assets[0]?.folderId).toBe("folder-a");
		expect(updateProjectAsset).toHaveBeenCalledWith("project-a", "asset-a", {
			folderId: "folder-a",
		});

		await Promise.resolve();
		await Promise.resolve();
		expect(getWorkspaceDocuments).toHaveBeenCalledWith("project-a");
	});

	it("ignores a stale organize-into-chapter success after a section image save hydrates newer markdown", async () => {
		const document = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
			].join("\n"),
		};
		let releaseCreateFolder!: () => void;
		vi.mocked(createWorkspaceFolder).mockImplementation(async (payload) => {
			const createdFolderId = payload.id ?? "folder-generated";
			await new Promise<void>((resolve) => {
				releaseCreateFolder = resolve;
			});
			return {
				folder: makeFolder(createdFolderId, {
					name: payload.name,
					parentId: payload.parentId ?? null,
					sortOrder: payload.sortOrder,
				}),
				state: {
					workspaceDir: "/workspace/project-a",
					projectId: "project-a",
					documents: [document],
					folders: [
						makeFolder(createdFolderId, {
							name: payload.name,
							parentId: payload.parentId ?? null,
							sortOrder: payload.sortOrder,
						}),
					],
					assets: [],
				},
			};
		});
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState([document], [], "/workspace/project-a", "project-a");

		useDocumentsStore.getState().organizeIntoChapter();
		await waitFor(() => expect(createWorkspaceFolder).toHaveBeenCalledTimes(1));
		const folder = useDocumentsStore.getState().folders[0];
		const folderId = folder?.id ?? "";
		const organizedDocument = useDocumentsStore.getState().documents[0];
		expect(folderId).toBeTruthy();
		expect(organizedDocument?.folderId).toBe(folderId);
		const staleOrganizedDocument = organizedDocument
			? { ...organizedDocument, isDirty: false }
			: document;
		const sectionSavedDocument = {
			...staleOrganizedDocument,
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
				"",
				"![林书彤](</api/v1/media-assets/asset-lin/content>)",
			].join("\n"),
			isDirty: false,
			version: (staleOrganizedDocument?.version ?? 1) + 1,
		};
		vi.mocked(getWorkspaceDocuments).mockResolvedValue({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [staleOrganizedDocument],
			folders: folder ? [folder] : [],
			assets: [],
		});
		vi.mocked(updateWorkspaceDocumentSectionImage).mockResolvedValueOnce({
			document: sectionSavedDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [sectionSavedDocument],
				folders: folder ? [folder] : [],
				assets: [],
			},
		});

		const applied = useDocumentsStore.getState().toggleSectionImage(
			{
				blockId: "section_lin",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "林书彤",
			},
			{
				src: "/api/v1/media-assets/asset-lin/content",
				title: "林书彤",
			},
			true,
		);
		expect(applied).toBe(true);
		await waitFor(() => {
			expect(useDocumentsStore.getState().documents[0]?.content).toBe(sectionSavedDocument.content);
		});

		releaseCreateFolder();
		await waitFor(() => expect(getWorkspaceDocuments).toHaveBeenCalledWith("project-a"));
		await Promise.resolve();
		await Promise.resolve();

		const state = useDocumentsStore.getState();
		expect(state.documents[0]?.folderId).toBe(folderId);
		expect(state.documents[0]?.content).toBe(sectionSavedDocument.content);
		expect(state.documents[0]?.version).toBe(sectionSavedDocument.version);
		expect(state.syncStatus).toBe("synced");
	});

	it("ignores a stale organize-into-chapter failure after a section image save hydrates newer markdown", async () => {
		const document = {
			...makeDocument("doc-a"),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
			].join("\n"),
		};
		let rejectCreateFolder!: (error: Error) => void;
		vi.mocked(createWorkspaceFolder).mockReturnValueOnce(
			new Promise((_, reject) => {
				rejectCreateFolder = reject;
			}),
		);
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState([document], [], "/workspace/project-a", "project-a");

		useDocumentsStore.getState().organizeIntoChapter();
		await waitFor(() => expect(createWorkspaceFolder).toHaveBeenCalledTimes(1));
		const folder = useDocumentsStore.getState().folders[0];
		const folderId = folder?.id ?? "";
		const organizedDocument = useDocumentsStore.getState().documents[0];
		expect(folderId).toBeTruthy();
		expect(organizedDocument?.folderId).toBe(folderId);
		const sectionSavedDocument = {
			...(organizedDocument ?? document),
			content: [
				"# doc-a",
				"",
				"<!-- section-id: section_lin -->",
				"## 林书彤",
				"",
				"角色描述。",
				"",
				"![林书彤](</api/v1/media-assets/asset-lin/content>)",
			].join("\n"),
			isDirty: false,
			version: ((organizedDocument ?? document).version ?? 1) + 1,
		};
		vi.mocked(updateWorkspaceDocumentSectionImage).mockResolvedValueOnce({
			document: sectionSavedDocument,
			state: {
				workspaceDir: "/workspace/project-a",
				projectId: "project-a",
				documents: [sectionSavedDocument],
				folders: folder ? [folder] : [],
				assets: [],
			},
		});

		const applied = useDocumentsStore.getState().toggleSectionImage(
			{
				blockId: "section_lin",
				documentId: "doc-a",
				headingLevel: 2,
				headingOccurrence: 1,
				headingText: "林书彤",
			},
			{
				src: "/api/v1/media-assets/asset-lin/content",
				title: "林书彤",
			},
			true,
		);
		expect(applied).toBe(true);
		await waitFor(() => {
			expect(useDocumentsStore.getState().documents[0]?.content).toBe(sectionSavedDocument.content);
		});

		rejectCreateFolder(new Error("backend unavailable"));
		await Promise.resolve();
		await Promise.resolve();

		const state = useDocumentsStore.getState();
		expect(state.documents[0]?.folderId).toBe(folderId);
		expect(state.documents[0]?.content).toBe(sectionSavedDocument.content);
		expect(state.documents[0]?.version).toBe(sectionSavedDocument.version);
		expect(state.syncStatus).toBe("synced");
	});

	it("rolls back optimistic document operations when server persistence fails", async () => {
		vi.mocked(updateWorkspaceState).mockRejectedValueOnce(new Error("network failed"));
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState([makeDocument("doc-a")], [], "/workspace/project-a", "project-a");
		const before = useDocumentsStore.getState().documents[0];
		const operation: DocumentOperation = {
			id: "op-1",
			type: "insert_markdown",
			summary: "追加正文",
			target: { position: "append" },
			createdAt: "2026-05-31T00:00:00.000Z",
			payload: { markdown: "追加内容" },
		};

		const result = useDocumentsStore
			.getState()
			.applyOperations("doc-a", [operation], { source: "user", summary: "追加正文" });

		expect(result.applied).toBe(1);
		expect(useDocumentsStore.getState().documents[0]?.content).toContain("追加内容");

		await Promise.resolve();
		await Promise.resolve();

		const state = useDocumentsStore.getState();
		expect(state.documents[0]).toEqual(before);
		expect(state.operationLog).toEqual([]);
		expect(state.syncStatus).toBe("error");
		expect(state.syncMessage).toBe("后端保存文档操作失败");
	});
});
