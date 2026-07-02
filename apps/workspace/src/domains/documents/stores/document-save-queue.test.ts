import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import {
	getWorkspaceDocuments,
	updateWorkspaceDocumentRecord,
} from "@/domains/workspace/api/workspace";
import {
	resetDocumentSaveQueueForTests,
	setDocumentSaveBackgroundRetryDelayForTests,
	setDocumentSaveRetryDelayForTests,
} from "./document-save-queue";
import { useDocumentsStore } from "./store";
import type { MarkdownDocument } from "./types";

vi.mock("@/domains/workspace/api/workspace", () => ({
	createWorkspaceDocument: vi.fn(),
	createWorkspaceEventSource: vi.fn(),
	createWorkspaceFolder: vi.fn(),
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

const makeDocument = (id: string, version = 1): MarkdownDocument => ({
	id,
	title: id,
	content: `# ${id}\n`,
	category: "screenplay",
	parentId: null,
	sortOrder: 0,
	version,
	updatedAt: "2026-07-01T00:00:00.000Z",
	isDirty: false,
	comments: [],
	workbenchDraft: null,
});

const hydrateProject = (documents: MarkdownDocument[]) => {
	useDocumentsStore
		.getState()
		.hydrateWorkspaceState(documents, [], "/workspace/project-a", "project-a");
};

const storeDocument = (id: string) =>
	useDocumentsStore.getState().documents.find((document) => document.id === id);

interface RecordedSave {
	documentId: string;
	payload: Parameters<typeof updateWorkspaceDocumentRecord>[1];
	resolve: (document: MarkdownDocument) => void;
	reject: (error: unknown) => void;
}

/** Queue-controlled mock: each PATCH parks until the test settles it. */
const installManualSaveMock = () => {
	const calls: RecordedSave[] = [];
	vi.mocked(updateWorkspaceDocumentRecord).mockImplementation(
		(documentId, payload) =>
			new Promise((resolve, reject) => {
				calls.push({
					documentId,
					payload,
					resolve: (document) =>
						resolve({
							document,
							state: {
								workspaceDir: "/workspace/project-a",
								projectId: "project-a",
								documents: [document],
							},
						}),
					reject,
				});
			}),
	);
	return calls;
};

describe("document save queue", () => {
	beforeEach(() => {
		vi.mocked(updateWorkspaceDocumentRecord).mockReset();
		vi.mocked(getWorkspaceDocuments).mockReset();
		resetDocumentSaveQueueForTests();
		setDocumentSaveRetryDelayForTests(1);
		useDocumentsStore.getState().prepareWorkspaceLoad("reset");
	});

	it("serializes saves per document and coalesces edits made while a save is in flight", async () => {
		const calls = installManualSaveMock();
		hydrateProject([makeDocument("doc-a")]);

		useDocumentsStore.getState().updateDocumentContent("doc-a", "# doc-a\n\n第一段。\n");
		useDocumentsStore.getState().updateDocumentContent("doc-a", "# doc-a\n\n第一段。第二段。\n");
		useDocumentsStore.getState().updateDocumentContent("doc-a", "# doc-a\n\n最终稿。\n");

		// Only one request in flight regardless of how many edits arrived.
		expect(calls).toHaveLength(1);
		expect(calls[0].payload).toMatchObject({
			content: "# doc-a\n\n第一段。\n",
			expectedVersion: 1,
		});

		calls[0].resolve({ ...makeDocument("doc-a", 2), content: "# doc-a\n\n第一段。\n" });

		// The acknowledgement notices newer local edits and sends exactly one
		// follow-up with the latest content, based on the confirmed version.
		await waitFor(() => expect(calls).toHaveLength(2));
		expect(calls[1].payload).toMatchObject({
			content: "# doc-a\n\n最终稿。\n",
			expectedVersion: 2,
		});
		expect(storeDocument("doc-a")).toMatchObject({ isDirty: true, version: 2 });

		calls[1].resolve({ ...makeDocument("doc-a", 3), content: "# doc-a\n\n最终稿。\n" });

		await waitFor(() =>
			expect(storeDocument("doc-a")).toMatchObject({
				content: "# doc-a\n\n最终稿。\n",
				isDirty: false,
				version: 3,
			}),
		);
		expect(calls).toHaveLength(2);
		expect(useDocumentsStore.getState().syncStatus).toBe("synced");
	});

	it("recovers from a version conflict by rebasing onto the server version without dropping local text", async () => {
		const calls = installManualSaveMock();
		vi.mocked(getWorkspaceDocuments).mockResolvedValue({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [{ ...makeDocument("doc-a", 7), content: "# 服务端更新过的内容\n" }],
		});
		hydrateProject([makeDocument("doc-a")]);

		useDocumentsStore.getState().updateDocumentContent("doc-a", "# doc-a\n\n用户刚输入的内容。\n");
		expect(calls[0].payload).toMatchObject({ expectedVersion: 1 });

		// Backend rejects: someone advanced the server version behind our back.
		calls[0].reject({ code: 409, message: "版本冲突" });

		// The queue refetches the server version and retries with local content
		// intact — no rollback of what the user typed.
		await waitFor(() => expect(calls).toHaveLength(2));
		expect(calls[1].payload).toMatchObject({
			content: "# doc-a\n\n用户刚输入的内容。\n",
			expectedVersion: 7,
		});
		expect(storeDocument("doc-a")?.content).toBe("# doc-a\n\n用户刚输入的内容。\n");

		calls[1].resolve({ ...makeDocument("doc-a", 8), content: "# doc-a\n\n用户刚输入的内容。\n" });

		await waitFor(() =>
			expect(storeDocument("doc-a")).toMatchObject({
				content: "# doc-a\n\n用户刚输入的内容。\n",
				isDirty: false,
				version: 8,
			}),
		);
	});

	it("keeps local content and the dirty flag when saving fails repeatedly", async () => {
		vi.mocked(updateWorkspaceDocumentRecord).mockRejectedValue({ code: 0, message: "网络错误" });
		hydrateProject([makeDocument("doc-a")]);

		useDocumentsStore.getState().updateDocumentContent("doc-a", "# doc-a\n\n不能丢的内容。\n");

		await waitFor(() => expect(useDocumentsStore.getState().syncStatus).toBe("error"));
		expect(storeDocument("doc-a")).toMatchObject({
			content: "# doc-a\n\n不能丢的内容。\n",
			isDirty: true,
			version: 1,
		});
	});

	it("retries failed dirty saves in the background without requiring more typing", async () => {
		vi.mocked(updateWorkspaceDocumentRecord).mockRejectedValue({ code: 0, message: "网络错误" });
		setDocumentSaveBackgroundRetryDelayForTests(200);
		hydrateProject([makeDocument("doc-a")]);

		useDocumentsStore.getState().updateDocumentContent("doc-a", "# doc-a\n\n后台重试保存。\n");

		await waitFor(() => expect(updateWorkspaceDocumentRecord).toHaveBeenCalledTimes(3));
		expect(useDocumentsStore.getState().syncStatus).toBe("error");
		expect(storeDocument("doc-a")).toMatchObject({
			content: "# doc-a\n\n后台重试保存。\n",
			isDirty: true,
			version: 1,
		});

		vi.mocked(updateWorkspaceDocumentRecord).mockImplementation(async (documentId, payload) => {
			const document = {
				...makeDocument(documentId, 2),
				content: (payload.content as string) ?? "",
			};
			return {
				document,
				state: {
					workspaceDir: "/workspace/project-a",
					projectId: "project-a",
					documents: [document],
				},
			};
		});

		await waitFor(() => expect(updateWorkspaceDocumentRecord).toHaveBeenCalledTimes(4));
		await waitFor(() =>
			expect(storeDocument("doc-a")).toMatchObject({
				content: "# doc-a\n\n后台重试保存。\n",
				isDirty: false,
				version: 2,
			}),
		);
		expect(useDocumentsStore.getState().syncStatus).toBe("synced");
	});

	it("retries transient failures and completes the save once the backend recovers", async () => {
		vi.mocked(updateWorkspaceDocumentRecord)
			.mockRejectedValueOnce({ code: 0, message: "网络错误" })
			.mockImplementation(async (documentId, payload) => {
				const document = {
					...makeDocument(documentId, 2),
					content: (payload.content as string) ?? "",
				};
				return {
					document,
					state: {
						workspaceDir: "/workspace/project-a",
						projectId: "project-a",
						documents: [document],
					},
				};
			});
		hydrateProject([makeDocument("doc-a")]);

		useDocumentsStore.getState().updateDocumentContent("doc-a", "# doc-a\n\n重试后保存。\n");

		await waitFor(() =>
			expect(storeDocument("doc-a")).toMatchObject({
				content: "# doc-a\n\n重试后保存。\n",
				isDirty: false,
				version: 2,
			}),
		);
		expect(useDocumentsStore.getState().syncStatus).toBe("synced");
	});

	it("ignores stale backend echoes for clean documents instead of reverting saved content", async () => {
		hydrateProject([{ ...makeDocument("doc-a", 3), content: "# 已保存的新内容\n" }]);

		useDocumentsStore.getState().applyWorkspaceDelta({
			changedDocuments: [{ ...makeDocument("doc-a", 2), content: "# 早先写入的旧内容\n" }],
			removedDocumentIds: [],
		});

		expect(storeDocument("doc-a")).toMatchObject({
			content: "# 已保存的新内容\n",
			version: 3,
		});
	});

	it("keeps dirty documents intact when a mutation response hydrates the whole document list", () => {
		hydrateProject([makeDocument("doc-a"), makeDocument("doc-b")]);
		vi.mocked(updateWorkspaceDocumentRecord).mockImplementation(
			() => new Promise(() => {}), // keep doc-a's save永远在途，保持 dirty
		);
		useDocumentsStore.getState().updateDocumentContent("doc-a", "# doc-a\n\n正在输入……\n");

		// e.g. moving doc-b (or any other mutation) completes and hydrates the
		// backend's full document list, which does not know doc-a's edits yet.
		useDocumentsStore.getState().hydrateWorkspaceDocuments({
			workspaceDir: "/workspace/project-a",
			projectId: "project-a",
			documents: [makeDocument("doc-a"), { ...makeDocument("doc-b"), sortOrder: 5, version: 2 }],
		});

		expect(storeDocument("doc-a")).toMatchObject({
			content: "# doc-a\n\n正在输入……\n",
			isDirty: true,
		});
		expect(storeDocument("doc-b")).toMatchObject({ sortOrder: 5, version: 2 });
	});
});
