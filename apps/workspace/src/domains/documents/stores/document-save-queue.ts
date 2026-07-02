import {
	getWorkspaceDocuments,
	updateWorkspaceDocumentRecord,
} from "@/domains/workspace/api/workspace";
import type { ApiError } from "@/types/api";
import type { DocumentsGet, DocumentsSet } from "./action-types";
import type { MarkdownDocument } from "./types";

/**
 * Serialized per-document autosave queue.
 *
 * Invariants:
 * - At most one PATCH is in flight per document, so requests can never arrive
 *   out of order and race each other into spurious version conflicts.
 * - `document.version` in the store always holds the last server-confirmed
 *   version (the save base); local edits never bump it optimistically.
 * - `isDirty` is only cleared after the server acknowledged the exact content
 *   that is still current — never on a timer, never optimistically.
 * - Failures keep the local copy and the dirty flag; the user's typed content
 *   is never rolled back to an older snapshot.
 */

interface DocumentSaveTask {
	running: boolean;
	rerun: boolean;
	retryTimer: ReturnType<typeof setTimeout> | null;
}

export interface DocumentSaveQueueContext {
	get: DocumentsGet;
	set: DocumentsSet;
}

const saveTasks = new Map<string, DocumentSaveTask>();

const maxSaveAttemptsPerBurst = 3;
let saveRetryDelayMs = 2000;
let saveBackgroundRetryDelayMs = 10000;

/** Test hook: shrink the transient-failure retry delay so specs stay fast. */
export const setDocumentSaveRetryDelayForTests = (delayMs: number) => {
	saveRetryDelayMs = delayMs;
};

/** Test hook: shrink the background retry delay so specs stay fast. */
export const setDocumentSaveBackgroundRetryDelayForTests = (delayMs: number) => {
	saveBackgroundRetryDelayMs = delayMs;
};

/** Test hook: forget all in-memory queue state between specs. */
export const resetDocumentSaveQueueForTests = () => {
	for (const task of saveTasks.values()) {
		if (task.retryTimer) clearTimeout(task.retryTimer);
	}
	saveTasks.clear();
	saveRetryDelayMs = 2000;
	saveBackgroundRetryDelayMs = 10000;
};

/**
 * Request persistence of a document's current store state. Coalesces bursts of
 * edits: if a save is already in flight the queue re-reads the latest content
 * once the in-flight request settles.
 */
export const scheduleDocumentSave = (context: DocumentSaveQueueContext, documentId: string) => {
	const task = saveTasks.get(documentId) ?? { running: false, rerun: false, retryTimer: null };
	saveTasks.set(documentId, task);
	if (task.retryTimer) {
		clearTimeout(task.retryTimer);
		task.retryTimer = null;
	}
	if (task.running) {
		task.rerun = true;
		return;
	}
	task.running = true;
	void runDocumentSaveLoop(context, documentId, task).finally(() => {
		task.running = false;
		if (task.rerun) {
			task.rerun = false;
			scheduleDocumentSave(context, documentId);
		}
	});
};

const runDocumentSaveLoop = async (
	context: DocumentSaveQueueContext,
	documentId: string,
	task: DocumentSaveTask,
) => {
	let attempts = 0;
	while (true) {
		task.rerun = false;
		const state = context.get();
		const projectId = state.projectId;
		const document = state.documents.find((item) => item.id === documentId);
		if (!document || !document.isDirty || !projectId) return;

		try {
			const { document: saved } = await updateWorkspaceDocumentRecord(
				documentId,
				{
					title: document.title,
					content: document.content,
					parentId: document.parentId,
					folderId: document.folderId,
					sortOrder: document.sortOrder,
					category: document.category,
					comments: document.comments,
					workbenchDraft: document.workbenchDraft,
					isDirty: false,
					expectedVersion: document.version,
				},
				projectId,
			);
			attempts = 0;
			acknowledgeDocumentSave(context, documentId, projectId, document, saved);
		} catch (error) {
			attempts += 1;
			if (isVersionConflictError(error)) {
				// Someone else advanced the server version (echo of an unversioned
				// write, agent edit, external file change). Local content wins:
				// rebase onto the current server version and retry; document
				// history keeps the overwritten server copy recoverable.
				const rebased =
					attempts < maxSaveAttemptsPerBurst &&
					(await rebaseDocumentVersionFromServer(context, documentId, projectId));
				if (!rebased) {
					markSaveFailed(context, projectId, "文档保存冲突，本地修改已保留，稍后自动重试");
					scheduleBackgroundRetry(context, documentId, task);
					return;
				}
				continue;
			}
			if (attempts >= maxSaveAttemptsPerBurst) {
				markSaveFailed(context, projectId, "文档保存失败，本地修改已保留，稍后自动重试");
				scheduleBackgroundRetry(context, documentId, task);
				return;
			}
			await sleep(saveRetryDelayMs);
		}
	}
};

/**
 * Adopt the server-confirmed version. The dirty flag is cleared only when the
 * store still holds exactly the content that was sent; otherwise the newer
 * local edits stay dirty and the loop immediately saves them next.
 */
export const acknowledgeDocumentSave = (
	context: DocumentSaveQueueContext,
	documentId: string,
	projectId: string,
	sent: MarkdownDocument,
	saved: MarkdownDocument,
) => {
	context.set((state) => {
		if (state.projectId !== projectId) return state;
		let allClean = true;
		const documents = state.documents.map((document) => {
			if (document.id !== documentId) {
				if (document.isDirty) allClean = false;
				return document;
			}
			const unchangedSinceSend =
				document.content === sent.content &&
				document.title === sent.title &&
				document.parentId === sent.parentId &&
				document.folderId === sent.folderId &&
				document.sortOrder === sent.sortOrder &&
				document.category === sent.category &&
				document.comments === sent.comments &&
				document.workbenchDraft === sent.workbenchDraft;
			if (!unchangedSinceSend) allClean = false;
			return {
				...document,
				version: saved.version,
				updatedAt: saved.updatedAt || document.updatedAt,
				filename: saved.filename ?? document.filename,
				isDirty: !unchangedSinceSend,
			};
		});
		return allClean
			? { documents, syncStatus: "synced", syncMessage: "文档已保存" }
			: { documents };
	});
};

const scheduleBackgroundRetry = (
	context: DocumentSaveQueueContext,
	documentId: string,
	task: DocumentSaveTask,
) => {
	if (task.retryTimer) return;
	task.retryTimer = setTimeout(() => {
		task.retryTimer = null;
		scheduleDocumentSave(context, documentId);
	}, saveBackgroundRetryDelayMs);
};

/**
 * After a version conflict, fetch the server's current version for the
 * document and adopt it as the new save base while keeping local content.
 */
const rebaseDocumentVersionFromServer = async (
	context: DocumentSaveQueueContext,
	documentId: string,
	projectId: string,
) => {
	try {
		const payload = await getWorkspaceDocuments(projectId, [documentId]);
		const serverDocument = payload.documents.find((item) => item.id === documentId);
		if (!serverDocument) return false;
		context.set((state) => {
			if (state.projectId !== projectId) return state;
			return {
				documents: state.documents.map((document) =>
					document.id === documentId ? { ...document, version: serverDocument.version } : document,
				),
			};
		});
		return true;
	} catch {
		return false;
	}
};

const markSaveFailed = (context: DocumentSaveQueueContext, projectId: string, message: string) => {
	const state = context.get();
	if (state.projectId !== projectId) return;
	state.markWorkspaceSyncStatus("error", message);
};

const isVersionConflictError = (error: unknown) =>
	typeof error === "object" && error !== null && (error as ApiError).code === 409;

const sleep = (delayMs: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, delayMs);
	});
