import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useSWR, { mutate as mutateSWR } from "swr";
import {
	createWorkspaceDocument,
	createWorkspaceEventSource,
	getWorkspaceDocuments,
	getWorkspaceState,
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
		vi.mocked(getWorkspaceDocuments).mockReset();
		vi.mocked(getWorkspaceState).mockReset();
		vi.mocked(updateProjectAsset).mockReset();
		vi.mocked(updateWorkspaceDocumentRecord).mockReset();
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
