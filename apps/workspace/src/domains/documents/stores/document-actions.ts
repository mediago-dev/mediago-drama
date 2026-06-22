import {
	createWorkspaceDocument,
	deleteWorkspaceDocumentRecord,
	updateWorkspaceDocumentSectionImage,
	updateWorkspaceDocumentSectionMedia,
	updateWorkspaceDocumentSectionMention,
	updateWorkspaceDocumentRecord,
} from "@/domains/workspace/api/workspace";
import { isOverviewDocumentId } from "@/lib/overview/overview-template";
import type { DocumentActionContext, DocumentsActions } from "./action-types";
import {
	collectDescendantIds,
	createUntitledDocument,
	createWorkbenchDraft,
	firstEditableDocumentId,
	isCurrentWorkspaceMutationSnapshot,
	isDocumentCategory,
	moveDocumentInTree,
	nextSortOrder,
	normalizeDocuments,
	rollbackSnapshot,
	streamingDocumentContent,
	validParentId,
} from "./helpers";
import type { DocumentWorkbenchDraft, MarkdownDocument } from "./types";
import type { WorkspaceMutationSnapshot } from "./helpers";

type DocumentMutationActions = Pick<
	DocumentsActions,
	| "applyStreamingDocumentEdit"
	| "convertDocumentToWorkbenchDraft"
	| "createDocument"
	| "deleteDocument"
	| "markDocumentSaved"
	| "moveDocument"
	| "renameDocument"
	| "setDocumentCategory"
	| "toggleSectionImage"
	| "toggleSectionMedia"
	| "toggleSectionMention"
	| "updateDocumentContent"
>;

export const createDocumentMutationActions = ({
	dependencies,
	get,
	set,
}: DocumentActionContext): DocumentMutationActions => ({
	applyStreamingDocumentEdit: (edit) => {
		const documentId = edit.documentId?.trim();
		if (!documentId) return;

		set((state) => {
			const updatedAt = edit.updatedAt || new Date().toISOString();
			const existing = state.documents.find((document) => document.id === documentId);
			const title = edit.title?.trim() || existing?.title || "生成中文档";
			const content = streamingDocumentContent(existing?.content ?? "", title, edit);
			const parentId =
				edit.parentId === undefined
					? (existing?.parentId ?? null)
					: validParentId(state.documents, edit.parentId, documentId);
			const sortOrder =
				Number.isFinite(edit.sortOrder) && edit.sortOrder !== undefined
					? edit.sortOrder
					: (existing?.sortOrder ?? nextSortOrder(state.documents, parentId));
			const statusMessage =
				edit.status === "completed"
					? `已完成《${title}》的流式编辑`
					: edit.summary || `正在流式编辑《${title}》`;

			const nextDocument: MarkdownDocument = {
				id: documentId,
				title,
				content,
				category: existing?.category,
				parentId,
				folderId: existing?.folderId ?? null,
				sortOrder,
				version: existing ? existing.version + 1 : 1,
				updatedAt,
				isDirty: false,
				comments: existing?.comments ?? [],
				workbenchDraft: existing?.workbenchDraft ?? null,
			};
			const documents = normalizeDocuments(
				existing
					? state.documents.map((document) =>
							document.id === documentId ? nextDocument : document,
						)
					: [...state.documents, nextDocument],
			);

			return {
				documents,
				activeDocumentId: state.activeDocumentId || documentId,
				searchQuery: existing ? state.searchQuery : "",
				syncStatus: edit.status === "completed" ? "synced" : "syncing",
				syncMessage: statusMessage,
			};
		});
	},
	convertDocumentToWorkbenchDraft: (documentId) => {
		let draft: DocumentWorkbenchDraft | null = null;
		let persistMutation: (() => void) | null = null;
		set((state) => {
			const document = state.documents.find((item) => item.id === documentId);
			if (!document) return state;
			if (document.category !== "storyboard") return state;
			draft = document.workbenchDraft ?? createWorkbenchDraft(document);
			if (document.workbenchDraft) return state;

			const documents = state.documents.map((item) =>
				item.id === documentId
					? {
							...item,
							workbenchDraft: draft,
							version: item.version + 1,
							updatedAt: new Date().toISOString(),
						}
					: item,
			);
			const capturedProjectId = state.projectId;
			const rollback = rollbackSnapshot(state);
			persistMutation = () => {
				void updateWorkspaceDocumentRecord(
					documentId,
					{
						workbenchDraft: draft,
					},
					capturedProjectId,
				)
					.then(({ state: savedState }) => {
						dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
					})
					.catch(() => {
						dependencies.rollbackWorkspaceStateForProject(
							capturedProjectId,
							rollback,
							"后端创建剪辑台草稿失败",
						);
					});
			};

			return {
				documents,
				syncStatus: "syncing",
				syncMessage: "正在创建剪辑台草稿",
			};
		});

		runDeferredMutation(persistMutation);
		return draft;
	},
	createDocument: ({ category, parentId = null, folderId = null, title }) => {
		let createdDocument: MarkdownDocument | null = null;
		let persistMutation: (() => void) | null = null;
		set((state) => {
			if (!isDocumentCategory(category)) return state;
			const safeParentId = validParentId(state.documents, parentId);
			const safeFolderId = state.folders.some((folder) => folder.id === folderId) ? folderId : null;
			const document = createUntitledDocument(
				{ category, parentId: safeParentId, folderId: safeFolderId, title },
				nextSortOrder(state.documents, safeParentId),
			);
			createdDocument = document;
			const documents = [...state.documents, document];
			const capturedProjectId = state.projectId;
			const rollback = rollbackSnapshot(state);
			persistMutation = () => {
				void createWorkspaceDocument(
					{
						id: document.id,
						title: document.title,
						content: document.content,
						parentId: document.parentId,
						folderId: document.folderId,
						sortOrder: document.sortOrder,
						category: document.category,
						comments: document.comments,
					},
					capturedProjectId,
				)
					.then(({ state: savedState }) => {
						dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
					})
					.catch(() => {
						dependencies.rollbackWorkspaceStateForProject(
							capturedProjectId,
							rollback,
							"后端创建文档失败",
						);
					});
			};
			return {
				documents,
				activeDocumentId: document.id,
				searchQuery: "",
			};
		});
		runDeferredMutation(persistMutation);
		return createdDocument;
	},
	deleteDocument: (id) => {
		let persistMutation: (() => void) | null = null;
		set((state) => {
			if (isOverviewDocumentId(id)) return state;

			const deletedIds = collectDescendantIds(state.documents, id);
			const documents = state.documents.filter((document) => !deletedIds.has(document.id));
			const activeDocumentId = deletedIds.has(state.activeDocumentId)
				? firstEditableDocumentId(documents)
				: state.activeDocumentId;
			const operationLog = state.operationLog.filter((entry) => !deletedIds.has(entry.documentId));
			const capturedProjectId = state.projectId;
			const rollback = rollbackSnapshot(state);
			persistMutation = () => {
				void deleteWorkspaceDocumentRecord(id, capturedProjectId)
					.then(({ state: savedState }) => {
						dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
					})
					.catch(() => {
						dependencies.rollbackWorkspaceStateForProject(
							capturedProjectId,
							rollback,
							"后端删除文档失败",
						);
					});
			};

			return {
				documents,
				operationLog,
				activeDocumentId,
			};
		});
		runDeferredMutation(persistMutation);
	},
	markDocumentSaved: (id) => {
		let persistMutation: (() => void) | null = null;
		set((state) => {
			const documents = state.documents.map((document) =>
				document.id === id ? { ...document, isDirty: false } : document,
			);
			const document = documents.find((item) => item.id === id);
			if (document) {
				const capturedProjectId = state.projectId;
				const rollback = rollbackSnapshot(state);
				persistMutation = () => {
					void updateWorkspaceDocumentRecord(
						id,
						{
							title: document.title,
							content: document.content,
							parentId: document.parentId,
							folderId: document.folderId,
							sortOrder: document.sortOrder,
							isDirty: false,
							category: document.category,
							comments: document.comments,
							workbenchDraft: document.workbenchDraft,
						},
						capturedProjectId,
					)
						.then(({ state: savedState }) => {
							if (!isCurrentDocumentSaveSnapshot(get(), id, document, capturedProjectId)) {
								return;
							}
							dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
						})
						.catch(() => {
							if (!isCurrentDocumentSaveSnapshot(get(), id, document, capturedProjectId)) {
								return;
							}
							dependencies.rollbackWorkspaceStateForProject(
								capturedProjectId,
								rollback,
								"后端保存文档失败",
							);
						});
				};
			}
			return { documents };
		});
		runDeferredMutation(persistMutation);
	},
	moveDocument: (documentId, targetDocumentId, position) => {
		let persistMutation: (() => void) | null = null;
		set((state) => {
			const result = moveDocumentInTree(state.documents, documentId, targetDocumentId, position);
			if (!result.changed) return state;

			const documents = normalizeDocuments(result.documents);
			const previousDocumentsById = new Map(
				state.documents.map((document) => [document.id, document]),
			);
			const changedDocuments = documents.filter((document) => {
				const previous = previousDocumentsById.get(document.id);
				return (
					previous &&
					((previous.parentId ?? null) !== (document.parentId ?? null) ||
						(previous.folderId ?? null) !== (document.folderId ?? null) ||
						previous.sortOrder !== document.sortOrder)
				);
			});
			const capturedProjectId = state.projectId;
			const rollback = rollbackSnapshot(state);
			const expectedSnapshot: WorkspaceMutationSnapshot = {
				assets: state.assets,
				documents,
				folders: state.folders,
			};
			if (changedDocuments.length > 0) {
				persistMutation = () => {
					void persistDocumentOrder(
						changedDocuments,
						expectedSnapshot,
						capturedProjectId,
						rollback,
						dependencies,
						get,
					);
				};
			}

			return {
				documents,
				syncStatus: "syncing",
				syncMessage: "正在保存文档顺序",
			};
		});
		runDeferredMutation(persistMutation);
	},
	renameDocument: (id, title) => {
		const nextTitle = title.trimStart();
		set((state) => {
			const documents = state.documents.map((document) =>
				document.id === id
					? {
							...document,
							title: nextTitle,
							version: document.version + 1,
							updatedAt: new Date().toISOString(),
							isDirty: true,
						}
					: document,
			);
			return { documents };
		});
	},
	setDocumentCategory: (id, category) => {
		if (!isDocumentCategory(category) || category === "overview") return;

		let persistMutation: (() => void) | null = null;
		set((state) => {
			const current = state.documents.find((document) => document.id === id);
			if (!current || isOverviewDocumentId(current.id) || current.category === category) {
				return state;
			}

			const documents = state.documents.map((document) =>
				document.id === id
					? {
							...document,
							category,
							version: document.version + 1,
							updatedAt: new Date().toISOString(),
						}
					: document,
			);
			const capturedProjectId = state.projectId;
			const rollback = rollbackSnapshot(state);
			persistMutation = () => {
				void updateWorkspaceDocumentRecord(id, { category }, capturedProjectId)
					.then(({ state: savedState }) => {
						dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
					})
					.catch(() => {
						dependencies.rollbackWorkspaceStateForProject(
							capturedProjectId,
							rollback,
							"后端变更文档类型失败",
						);
					});
			};

			return {
				documents: normalizeDocuments(documents),
				syncStatus: "syncing",
				syncMessage: "正在变更文档类型",
			};
		});
		runDeferredMutation(persistMutation);
	},
	toggleSectionImage: (section, image, selected) => {
		if (!isWritableSectionID(section.blockId)) return false;

		let applied = false;
		let persistMutation: (() => void) | null = null;
		set((state) => {
			const existingDocument = state.documents.find(
				(document) => document.id === section.documentId,
			);
			if (!existingDocument) return state;

			applied = true;
			const documentId = existingDocument.id;
			const capturedProjectId = state.projectId;

			persistMutation = () => {
				void updateWorkspaceDocumentSectionImage(
					documentId,
					{
						sectionId: section.blockId,
						image,
						selected,
					},
					capturedProjectId,
				)
					.then(({ state: savedState }) => {
						const latest = get();
						if (latest.projectId !== capturedProjectId) return;

						dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
					})
					.catch(() => {
						dependencies.markWorkspaceSyncErrorForProject(
							capturedProjectId,
							"后端保存 section 图片失败",
						);
					});
			};

			return {
				syncStatus: "syncing",
				syncMessage: "正在保存 section 图片",
			};
		});
		runDeferredMutation(persistMutation);
		return applied;
	},
	toggleSectionMedia: (section, media, selected) => {
		if (!isWritableSectionID(section.blockId)) return false;

		let applied = false;
		let persistMutation: (() => void) | null = null;
		set((state) => {
			const existingDocument = state.documents.find(
				(document) => document.id === section.documentId,
			);
			if (!existingDocument) return state;

			applied = true;
			const documentId = existingDocument.id;
			const capturedProjectId = state.projectId;

			persistMutation = () => {
				void updateWorkspaceDocumentSectionMedia(
					documentId,
					{
						sectionId: section.blockId,
						media,
						selected,
					},
					capturedProjectId,
				)
					.then(({ state: savedState }) => {
						const latest = get();
						if (latest.projectId !== capturedProjectId) return;

						dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
					})
					.catch(() => {
						dependencies.markWorkspaceSyncErrorForProject(
							capturedProjectId,
							"后端保存 section media 失败",
						);
					});
			};

			return {
				syncStatus: "syncing",
				syncMessage: "正在保存 section media",
			};
		});
		runDeferredMutation(persistMutation);
		return applied;
	},
	toggleSectionMention: (section, reference, selected) => {
		if (!isWritableSectionID(section.blockId)) return false;

		let applied = false;
		let persistMutation: (() => void) | null = null;
		set((state) => {
			const existingDocument = state.documents.find(
				(document) => document.id === section.documentId,
			);
			if (!existingDocument) return state;

			applied = true;
			const documentId = existingDocument.id;
			const capturedProjectId = state.projectId;

			persistMutation = () => {
				void updateWorkspaceDocumentSectionMention(
					documentId,
					{
						sectionId: section.blockId,
						reference,
						selected,
					},
					capturedProjectId,
				)
					.then(({ state: savedState }) => {
						const latest = get();
						if (latest.projectId !== capturedProjectId) return;

						dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
					})
					.catch(() => {
						dependencies.markWorkspaceSyncErrorForProject(
							capturedProjectId,
							"后端保存 section 引用失败",
						);
					});
			};

			return {
				syncStatus: "syncing",
				syncMessage: "正在保存 section 引用",
			};
		});
		runDeferredMutation(persistMutation);
		return applied;
	},
	updateDocumentContent: (id, content) => {
		let persistMutation: (() => void) | null = null;
		set((state) => {
			const existingDocument = state.documents.find((document) => document.id === id);
			if (!existingDocument || existingDocument.content === content) return state;

			const capturedProjectId = state.projectId;
			const rollback = rollbackSnapshot(state);
			const expectedVersion = existingDocument.version;
			const updatedAt = new Date().toISOString();
			let didUpdate = false;
			const documents = state.documents.map((document) => {
				if (document.id !== id || document.content === content) return document;
				didUpdate = true;
				return {
					...document,
					content,
					version: document.version + 1,
					updatedAt,
					isDirty: true,
				};
			});
			if (!didUpdate) return state;

			persistMutation = () => {
				void updateWorkspaceDocumentRecord(id, { content, expectedVersion }, capturedProjectId)
					.then(({ state: savedState }) => {
						const latest = get();
						const latestDocument = latest.documents.find((document) => document.id === id);
						if (latest.projectId !== capturedProjectId || latestDocument?.content !== content) {
							return;
						}

						dependencies.hydrateWorkspaceDocumentsForProject(savedState, capturedProjectId);
					})
					.catch(() => {
						const latest = get();
						const latestDocument = latest.documents.find((document) => document.id === id);
						if (latest.projectId !== capturedProjectId || latestDocument?.content !== content) {
							dependencies.markWorkspaceSyncErrorForProject(
								capturedProjectId,
								"后端保存文档内容失败",
							);
							return;
						}

						dependencies.rollbackWorkspaceStateForProject(
							capturedProjectId,
							rollback,
							"后端保存文档内容失败",
						);
					});
			};

			return {
				documents,
				syncStatus: "syncing",
				syncMessage: "正在保存文档内容",
			};
		});
		runDeferredMutation(persistMutation);
	},
});

const isWritableSectionID = (sectionID: string) =>
	/^section_[A-Za-z0-9_-]+$/.test(sectionID) || /^section-[A-Za-z0-9]+$/.test(sectionID);

const isCurrentDocumentSaveSnapshot = (
	state: ReturnType<DocumentActionContext["get"]>,
	documentId: string,
	snapshot: MarkdownDocument,
	projectId: string | null,
) => {
	if (state.projectId !== projectId) return false;

	const current = state.documents.find((document) => document.id === documentId);
	if (!current) return false;

	return (
		current.version === snapshot.version &&
		current.title === snapshot.title &&
		current.content === snapshot.content &&
		current.parentId === snapshot.parentId &&
		current.folderId === snapshot.folderId &&
		current.sortOrder === snapshot.sortOrder &&
		current.category === snapshot.category &&
		current.workbenchDraft === snapshot.workbenchDraft &&
		current.comments === snapshot.comments
	);
};

const runDeferredMutation = (mutation: (() => void) | null) => {
	if (mutation) mutation();
};

const persistDocumentOrder = async (
	documents: MarkdownDocument[],
	expectedSnapshot: WorkspaceMutationSnapshot,
	projectId: string | null,
	rollback: ReturnType<typeof rollbackSnapshot>,
	dependencies: DocumentActionContext["dependencies"],
	get: DocumentActionContext["get"],
) => {
	try {
		let savedState: Awaited<ReturnType<typeof updateWorkspaceDocumentRecord>>["state"] | null =
			null;
		for (const document of documents) {
			const response = await updateWorkspaceDocumentRecord(
				document.id,
				{
					parentId: document.parentId,
					folderId: document.folderId,
					sortOrder: document.sortOrder,
				},
				projectId,
			);
			savedState = response.state;
		}
		if (savedState) {
			if (!isCurrentWorkspaceMutationSnapshot(get(), projectId, expectedSnapshot)) return;
			dependencies.hydrateWorkspaceDocumentsForProject(savedState, projectId);
		}
	} catch {
		if (!isCurrentWorkspaceMutationSnapshot(get(), projectId, expectedSnapshot)) return;
		dependencies.rollbackWorkspaceStateForProject(projectId, rollback, "后端保存文档顺序失败");
	}
};
