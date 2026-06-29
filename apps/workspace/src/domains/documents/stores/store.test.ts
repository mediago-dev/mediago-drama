import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useSWR, { mutate as mutateSWR } from "swr";
import {
	createWorkspaceDocument,
	createWorkspaceEventSource,
	createWorkspaceFolder,
	getWorkspaceDocuments,
	getWorkspaceFolders,
	getWorkspaceState,
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
	getWorkspaceFolders: vi.fn(),
	getWorkspaceState: vi.fn(),
	updateWorkspaceFolder: vi.fn(),
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
	emit: (type: string, data?: string) => void;
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
		emit: (type: string, data = "") => {
			for (const listener of listeners.get(type) ?? []) {
				listener({ data, lastEventId: "" } as MessageEvent);
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
		vi.mocked(getWorkspaceFolders).mockReset();
		vi.mocked(getWorkspaceState).mockReset();
		vi.mocked(updateProjectAsset).mockReset();
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

	it("creates a typed document with initial content", async () => {
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

		const document = useDocumentsStore.getState().createDocument({
			category: "character",
			content: "<!-- section-id: section_test -->\n## 测试角色\n",
		});

		expect(document?.content).toBe("<!-- section-id: section_test -->\n## 测试角色\n");
		await waitFor(() =>
			expect(createWorkspaceDocument).toHaveBeenCalledWith(
				expect.objectContaining({
					category: "character",
					content: "<!-- section-id: section_test -->\n## 测试角色\n",
				}),
				"project-a",
			),
		);
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

	it("applies an incremental delta from a documents.changed event without a full reload", async () => {
		vi.stubGlobal("EventSource", class {});
		const source = createFakeWorkspaceEventSource();
		vi.mocked(createWorkspaceEventSource).mockReturnValue(source);
		vi.mocked(useSWR).mockReturnValue({
			data: undefined,
			error: undefined,
			isLoading: false,
		} as ReturnType<typeof useSWR>);
		vi.mocked(getWorkspaceDocuments).mockResolvedValue({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [{ ...makeDocument("doc-a"), content: "# updated a\n", version: 3 }],
			folders: [],
			assets: [],
		});

		useDocumentsStore
			.getState()
			.hydrateWorkspaceState(
				[makeDocument("doc-a"), makeDocument("doc-b")],
				[],
				"/workspace/project-a",
				"project-a",
				[],
				[],
			);

		render(React.createElement(DocumentStateSync, { projectId: "project-a" }));
		source.emit(
			"workspace.documents.changed",
			JSON.stringify({
				type: "workspace.documents.changed",
				projectId: "project-a",
				changedDocumentIds: ["doc-a"],
			}),
		);

		await waitFor(() => {
			expect(
				useDocumentsStore.getState().documents.find((document) => document.id === "doc-a")?.content,
			).toBe("# updated a\n");
		});
		expect(getWorkspaceDocuments).toHaveBeenCalledWith("project-a", ["doc-a"]);
		expect(getWorkspaceState).not.toHaveBeenCalled();
		// Untouched document stays intact.
		expect(
			useDocumentsStore
				.getState()
				.documents.map((document) => document.id)
				.sort(),
		).toEqual(["doc-a", "doc-b"]);
	});

	it("does a full reload when a documents.changed event requests it", async () => {
		vi.stubGlobal("EventSource", class {});
		const source = createFakeWorkspaceEventSource();
		vi.mocked(createWorkspaceEventSource).mockReturnValue(source);
		vi.mocked(useSWR).mockReturnValue({
			data: undefined,
			error: undefined,
			isLoading: false,
		} as ReturnType<typeof useSWR>);
		vi.mocked(getWorkspaceState).mockResolvedValue({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [makeDocument("doc-reloaded")],
			folders: [],
			assets: [],
			operationLog: [],
		});

		render(React.createElement(DocumentStateSync, { projectId: "project-a" }));
		source.emit(
			"workspace.documents.changed",
			JSON.stringify({
				type: "workspace.documents.changed",
				projectId: "project-a",
				fullReload: true,
			}),
		);

		await waitFor(() => {
			expect(getWorkspaceState).toHaveBeenCalledWith("project-a");
		});
		expect(getWorkspaceDocuments).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(useDocumentsStore.getState().documents.map((document) => document.id)).toEqual([
				"doc-reloaded",
			]);
		});
	});

	it("applyWorkspaceDelta upserts and removes documents while preserving dirty edits", () => {
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState(
				[makeDocument("doc-a"), makeDocument("doc-b"), makeDocument("doc-c")],
				[makeLogEntry("doc-c")],
				"/workspace/project-a",
				"project-a",
				[],
				[],
			);
		// doc-b has unsaved local edits; doc-c is the active document.
		useDocumentsStore.setState((current) => ({
			documents: current.documents.map((document) =>
				document.id === "doc-b"
					? { ...document, content: "# local edit\n", isDirty: true }
					: document,
			),
		}));
		useDocumentsStore.getState().selectDocument("doc-c");

		useDocumentsStore.getState().applyWorkspaceDelta({
			changedDocuments: [
				{ ...makeDocument("doc-a"), content: "# server a\n", version: 4 },
				{ ...makeDocument("doc-b"), content: "# server b\n", version: 9 },
				makeDocument("doc-d"),
			],
			removedDocumentIds: ["doc-c"],
		});

		const state = useDocumentsStore.getState();
		const byId = new Map(state.documents.map((document) => [document.id, document]));
		expect([...byId.keys()].sort()).toEqual(["doc-a", "doc-b", "doc-d"]);
		expect(byId.get("doc-a")?.content).toBe("# server a\n");
		// Dirty local edit is preserved, server copy ignored until saved.
		expect(byId.get("doc-b")?.content).toBe("# local edit\n");
		expect(byId.get("doc-b")?.isDirty).toBe(true);
		expect(byId.has("doc-d")).toBe(true);
		// Active document was removed, so it falls back to a remaining document.
		expect(state.activeDocumentId).not.toBe("doc-c");
		expect(byId.has(state.activeDocumentId)).toBe(true);
		// Operation log entries for removed documents are dropped.
		expect(state.operationLog.some((entry) => entry.documentId === "doc-c")).toBe(false);
	});

	it("applyWorkspaceDelta refreshes the folder tree only when folders are provided", () => {
		useDocumentsStore
			.getState()
			.hydrateWorkspaceState(
				[makeDocument("doc-a")],
				[],
				"/workspace/project-a",
				"project-a",
				[],
				[makeFolder("folder-old")],
			);

		// No folders in the delta → tree unchanged.
		useDocumentsStore.getState().applyWorkspaceDelta({
			changedDocuments: [{ ...makeDocument("doc-a"), content: "# changed\n" }],
			removedDocumentIds: [],
		});
		expect(useDocumentsStore.getState().folders.map((folder) => folder.id)).toEqual(["folder-old"]);

		// Folders provided → tree replaced.
		useDocumentsStore.getState().applyWorkspaceDelta({
			changedDocuments: [],
			removedDocumentIds: [],
			folders: [makeFolder("folder-new")],
		});
		expect(useDocumentsStore.getState().folders.map((folder) => folder.id)).toEqual(["folder-new"]);
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
