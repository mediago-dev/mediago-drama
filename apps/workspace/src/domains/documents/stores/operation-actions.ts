import { updateWorkspaceState } from "@/domains/workspace/api/workspace";
import {
	enforceTemplateConstraints,
	type TemplateConstraintRejection,
} from "@/domains/documents/lib/constraints";
import {
	applyDocumentOperationsToDocument,
	createDocumentOperation,
	createTextAnchor,
	type DocumentOperation,
} from "@/domains/documents/lib/operations";
import { asOperationDocument, createId, rollbackSnapshot, snapshotDocument } from "./helpers";
import { scheduleDocumentSave } from "./document-save-queue";
import type { DocumentActionContext, DocumentsActions } from "./action-types";
import type { DocumentOperationLogEntry } from "./types";

type OperationActions = Pick<
	DocumentsActions,
	| "addComment"
	| "applyDocumentUpdate"
	| "applyOperations"
	| "deleteComment"
	| "resolveComment"
	| "undoLastOperation"
	| "updateComment"
>;

export const createDocumentOperationActions = ({
	dependencies,
	get,
	set,
}: DocumentActionContext): OperationActions => ({
	addComment: (documentId, anchorText, body) => {
		const trimmedBody = body.trim();
		if (!trimmedBody) return;

		const document = get().documents.find((item) => item.id === documentId);
		if (!document) return;
		const anchor = createTextAnchor(document.content, anchorText.trim() || document.title);
		get().applyOperations(
			documentId,
			[
				createDocumentOperation<DocumentOperation>({
					type: "add_comment",
					summary: "新增了一条文档批注。",
					target: { anchor },
					payload: { body: trimmedBody },
				}),
			],
			{
				source: "user",
				summary: "新增了一条文档批注。",
			},
		);
	},
	applyDocumentUpdate: (proposal) => {
		let scheduledDocumentId = "";
		set((state) => {
			const targetDocumentId = proposal.documentId || state.activeDocumentId;

			scheduledDocumentId = state.documents.some((document) => document.id === targetDocumentId)
				? targetDocumentId
				: "";
			const documents = state.documents.map((document) =>
				document.id === targetDocumentId
					? {
							...document,
							title: proposal.title ?? document.title,
							content: proposal.content ?? document.content,
							updatedAt: new Date().toISOString(),
							isDirty: true,
						}
					: document,
			);
			return { documents };
		});
		if (scheduledDocumentId) scheduleDocumentSave({ get, set }, scheduledDocumentId);
	},
	applyOperations: (documentId, operations, options) => {
		let applied = 0;
		let logEntryId: string | undefined;
		let rejected: TemplateConstraintRejection<DocumentOperation>[] = [];
		let persistMutation: (() => void) | null = null;

		set((state) => {
			let nextOperationLog = state.operationLog;
			const documents = state.documents.map((document) => {
				if (document.id !== documentId) return document;

				const constraintResult = enforceTemplateConstraints(document, operations);
				rejected = constraintResult.rejected;
				if (constraintResult.accepted.length === 0) return document;
				const before = snapshotDocument(document);
				const result = applyDocumentOperationsToDocument(
					asOperationDocument(document),
					constraintResult.accepted,
				);
				applied = result.applied;
				if (result.applied === 0) return document;

				// No isDirty here: this mutation persists itself through
				// updateWorkspaceState below, and the optimistic version bump
				// already shields the copy from stale backend echoes.
				const nextDocument = {
					...document,
					title: result.document.title,
					content: result.document.content,
					comments: result.document.comments,
					version: document.version + 1,
					updatedAt: new Date().toISOString(),
				};
				const after = snapshotDocument(nextDocument);
				const logEntry: DocumentOperationLogEntry = {
					id: createId("oplog"),
					documentId,
					operations: result.appliedOperations,
					summary: options?.summary ?? result.appliedOperations.at(-1)?.summary ?? "文档已更新。",
					source: options?.source ?? "agent",
					createdAt: new Date().toISOString(),
					before,
					after,
				};
				logEntryId = logEntry.id;
				nextOperationLog = [logEntry, ...nextOperationLog].slice(0, 80);
				return nextDocument;
			});

			if (applied > 0) {
				const capturedProjectId = state.projectId;
				const rollback = rollbackSnapshot(state);
				persistMutation = () => {
					void updateWorkspaceState(
						{
							documents,
							operationLog: nextOperationLog,
						},
						capturedProjectId,
					)
						.then((savedState) => {
							dependencies.hydrateWorkspaceStateForProject(savedState, capturedProjectId);
						})
						.catch(() => {
							dependencies.rollbackWorkspaceStateForProject(
								capturedProjectId,
								rollback,
								"后端保存文档操作失败",
							);
						});
				};
			}
			return { documents, operationLog: nextOperationLog };
		});

		runDeferredMutation(persistMutation);
		return { applied, logEntryId, rejected };
	},
	deleteComment: (documentId, commentId) => {
		get().applyOperations(
			documentId,
			[
				createDocumentOperation<DocumentOperation>({
					type: "delete_comment",
					summary: "已删除一条文档批注。",
					target: { commentId },
					payload: {},
				}),
			],
			{
				source: "user",
				summary: "已删除一条文档批注。",
			},
		);
		if (get().activeCommentId === commentId) {
			set({ activeCommentId: null });
		}
	},
	resolveComment: (documentId, commentId) => {
		get().applyOperations(
			documentId,
			[
				createDocumentOperation<DocumentOperation>({
					type: "resolve_comment",
					summary: "已解决一条文档批注。",
					target: { commentId },
					payload: {},
				}),
			],
			{
				source: "user",
				summary: "已解决一条文档批注。",
			},
		);
	},
	undoLastOperation: (documentId) => {
		let didUndo = false;
		let persistMutation: (() => void) | null = null;

		set((state) => {
			const targetDocumentId = documentId ?? state.activeDocumentId;
			const entry = state.operationLog.find(
				(item) => item.documentId === targetDocumentId && !item.undoneAt,
			);
			if (!entry) return state;

			// Persists via updateWorkspaceState below; see applyOperations for why
			// this must not set isDirty.
			const documents = state.documents.map((document) =>
				document.id === entry.documentId
					? {
							...document,
							title: entry.before.title,
							content: entry.before.content,
							comments: entry.before.comments,
							version: document.version + 1,
							updatedAt: new Date().toISOString(),
						}
					: document,
			);
			const operationLog = state.operationLog.map((item) =>
				item.id === entry.id ? { ...item, undoneAt: new Date().toISOString() } : item,
			);
			didUndo = true;
			const capturedProjectId = state.projectId;
			const rollback = rollbackSnapshot(state);
			persistMutation = () => {
				void updateWorkspaceState({ documents, operationLog }, capturedProjectId)
					.then((savedState) => {
						dependencies.hydrateWorkspaceStateForProject(savedState, capturedProjectId);
					})
					.catch(() => {
						dependencies.rollbackWorkspaceStateForProject(
							capturedProjectId,
							rollback,
							"后端撤销文档操作失败",
						);
					});
			};
			return { documents, operationLog };
		});

		runDeferredMutation(persistMutation);
		return didUndo;
	},
	updateComment: (documentId, commentId, body) => {
		const trimmedBody = body.trim();
		if (!trimmedBody) return;

		get().applyOperations(
			documentId,
			[
				createDocumentOperation<DocumentOperation>({
					type: "update_comment",
					summary: "已更新一条文档批注。",
					target: { commentId },
					payload: { body: trimmedBody },
				}),
			],
			{
				source: "user",
				summary: "已更新一条文档批注。",
			},
		);
	},
});

const runDeferredMutation = (mutation: (() => void) | null) => {
	if (mutation) mutation();
};
