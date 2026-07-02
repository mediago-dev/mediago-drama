import { createTextAnchor, findMarkdownBlockForAnchor } from "@/domains/documents/lib/operations";
import { isOverviewDocumentId } from "@/lib/overview/overview-template";
import type { DocumentActionContext, DocumentsActions } from "./action-types";
import {
	firstEditableDocumentId,
	normalizeDocuments,
	normalizeDocumentsForFolders,
	normalizeFolders,
} from "./helpers";
import type {
	DocumentSelection,
	DocumentsState,
	MarkdownDocument,
	PendingDocumentComment,
} from "./types";

type SyncActions = Pick<
	DocumentsActions,
	| "applyWorkspaceDelta"
	| "clearPendingComment"
	| "focusComment"
	| "hydrateWorkspaceDocuments"
	| "hydrateWorkspaceState"
	| "markWorkspaceSyncStatus"
	| "openPendingComment"
	| "prepareWorkspaceLoad"
	| "selectAsset"
	| "selectDocument"
	| "setSearchQuery"
	| "setSelection"
	| "setShowComments"
	| "toggleComments"
>;

export const createDocumentSyncActions = ({ get, set }: DocumentActionContext): SyncActions => ({
	applyWorkspaceDelta: ({ changedDocuments, removedDocumentIds, folders }) => {
		const removed = new Set(removedDocumentIds);
		const changedById = new Map(changedDocuments.map((document) => [document.id, document]));
		if (removed.size === 0 && changedById.size === 0 && !folders) return;
		set((state) => {
			const merged: MarkdownDocument[] = [];
			const seen = new Set<string>();
			for (const document of state.documents) {
				if (removed.has(document.id) && !document.isDirty) continue;
				seen.add(document.id);
				const incoming = changedById.get(document.id);
				merged.push(incoming ? mergeIncomingDocument(document, incoming) : document);
			}
			for (const document of changedDocuments) {
				if (!seen.has(document.id) && !removed.has(document.id)) {
					merged.push(document);
				}
			}

			const nextFolders = folders ? normalizeFolders(folders) : state.folders;
			const documents = normalizeDocumentsForFolders(normalizeDocuments(merged), nextFolders);
			const documentIds = new Set(documents.map((document) => document.id));
			const operationLog = state.operationLog.filter((entry) => documentIds.has(entry.documentId));

			const activeAssetId = nextActiveAssetId(state.assets, state.activeAssetId);
			const activeDocumentId = nextActiveDocumentId(
				documents,
				state.activeDocumentId,
				activeAssetId,
			);
			const transientState = preserveTransientDocumentState({
				activeAssetId,
				activeDocumentId,
				documents,
				projectId: state.projectId,
				state,
			});
			return {
				documents,
				folders: nextFolders,
				operationLog,
				activeDocumentId,
				activeAssetId,
				...transientState,
				...hydratedSyncState(documents, state, "已与后端文档库同步"),
			};
		});
	},
	focusComment: (activeCommentId) =>
		set({
			activeCommentId,
			showComments: activeCommentId ? true : get().showComments,
		}),
	hydrateWorkspaceState: (
		incomingDocuments,
		operationLog,
		workspaceDir,
		projectId = null,
		incomingAssets = [],
		incomingFolders = [],
	) => {
		const folders = normalizeFolders(incomingFolders);
		const folderIds = new Set(folders.map((folder) => folder.id));
		const assets = incomingAssets.map((asset) => ({
			...asset,
			folderId: asset.folderId && folderIds.has(asset.folderId) ? asset.folderId : null,
		}));
		set((state) => {
			const documents = normalizeDocumentsForFolders(
				normalizeDocuments(mergeWorkspaceDocuments(state, projectId ?? null, incomingDocuments)),
				folders,
			);
			const activeAssetId = nextActiveAssetId(assets, state.activeAssetId);
			const activeDocumentId = nextActiveDocumentId(
				documents,
				state.activeDocumentId,
				activeAssetId,
			);
			const transientState = preserveTransientDocumentState({
				activeAssetId,
				activeDocumentId,
				documents,
				projectId,
				state,
			});
			return {
				documents,
				folders,
				assets,
				operationLog,
				activeDocumentId,
				activeAssetId,
				...transientState,
				projectId,
				workspaceDir,
				...hydratedSyncState(documents, state, "已与后端工作区同步"),
			};
		});
	},
	hydrateWorkspaceDocuments: (payload) => {
		const folders = normalizeFolders(payload.folders);
		const folderIds = new Set(folders.map((folder) => folder.id));
		const assets = (payload.assets ?? []).map((asset) => ({
			...asset,
			folderId: asset.folderId && folderIds.has(asset.folderId) ? asset.folderId : null,
		}));
		set((state) => {
			const incomingProjectId = payload.projectId ?? state.projectId;
			const documents = normalizeDocumentsForFolders(
				normalizeDocuments(mergeWorkspaceDocuments(state, incomingProjectId, payload.documents)),
				folders,
			);
			const documentIds = new Set(documents.map((document) => document.id));
			const operationLog = state.operationLog.filter((entry) => documentIds.has(entry.documentId));
			const activeAssetId = nextActiveAssetId(assets, state.activeAssetId);
			const activeDocumentId = nextActiveDocumentId(
				documents,
				state.activeDocumentId,
				activeAssetId,
			);
			const transientState = preserveTransientDocumentState({
				activeAssetId,
				activeDocumentId,
				documents,
				projectId: incomingProjectId,
				state,
			});
			return {
				documents,
				folders,
				assets,
				operationLog,
				activeDocumentId,
				activeAssetId,
				...transientState,
				projectId: incomingProjectId,
				workspaceDir: payload.workspaceDir,
				...hydratedSyncState(documents, state, "已与后端文档库同步"),
			};
		});
	},
	markWorkspaceSyncStatus: (syncStatus, syncMessage) => set({ syncStatus, syncMessage }),
	openPendingComment: (comment) =>
		set({
			pendingComment: {
				...comment,
				selection: comment.selection.trim(),
			},
			showComments: true,
		}),
	prepareWorkspaceLoad: (syncMessage) =>
		set({
			documents: [],
			folders: [],
			assets: [],
			operationLog: [],
			activeDocumentId: "",
			activeAssetId: "",
			searchQuery: "",
			selection: null,
			pendingComment: null,
			showComments: false,
			activeCommentId: null,
			projectId: null,
			workspaceDir: "",
			syncStatus: "syncing",
			syncMessage,
		}),
	selectDocument: (activeDocumentId) =>
		set({
			activeDocumentId,
			activeAssetId: "",
			selection: null,
			pendingComment: null,
			activeCommentId: null,
		}),
	selectAsset: (activeAssetId) =>
		set({
			activeDocumentId: "",
			activeAssetId,
			selection: null,
			pendingComment: null,
			activeCommentId: null,
		}),
	clearPendingComment: () => set({ pendingComment: null }),
	setSearchQuery: (searchQuery) => set({ searchQuery }),
	setShowComments: (showComments) => set({ showComments }),
	setSelection: (documentId, text) => {
		const normalizedText = text.trim();
		const document = get().documents.find((item) => item.id === documentId);
		set({
			selection:
				normalizedText && document
					? {
							documentId,
							text: normalizedText,
							anchor: createTextAnchor(document.content, normalizedText),
							updatedAt: new Date().toISOString(),
						}
					: null,
		});
	},
	toggleComments: () => set((state) => ({ showComments: !state.showComments })),
});

/**
 * Hydrates report "synced" only when nothing is dirty; while unsaved edits
 * remain, the previous status (usually the save queue's "syncing"/"error")
 * keeps describing the truth.
 */
const hydratedSyncState = (
	documents: MarkdownDocument[],
	state: Pick<DocumentsState, "syncMessage" | "syncStatus">,
	message: string,
): Pick<DocumentsState, "syncMessage" | "syncStatus"> =>
	documents.some((document) => document.isDirty)
		? { syncStatus: state.syncStatus, syncMessage: state.syncMessage }
		: { syncStatus: "synced", syncMessage: message };

/**
 * Merge one incoming (backend) document into its local counterpart.
 *
 * - A dirty local copy always wins on content-bearing fields: unsaved edits are
 *   never overwritten by echoes of earlier saves or concurrent refetches. Only
 *   the version advances so the next save targets the current server version.
 * - A clean local copy accepts the incoming document unless it is stale, i.e.
 *   its version is older than what the server already confirmed to us.
 */
const mergeIncomingDocument = (
	local: MarkdownDocument,
	incoming: MarkdownDocument,
): MarkdownDocument => {
	if (local.isDirty) {
		return {
			...local,
			version: Math.max(local.version, incoming.version),
			filename: incoming.filename ?? local.filename,
		};
	}
	return incoming.version >= local.version ? incoming : local;
};

/**
 * Merge a full backend document list into the current store state.
 *
 * Dirty local documents that are missing from the incoming list are kept
 * (e.g. optimistic creations whose POST has not landed yet). Cross-project
 * hydrates skip merging entirely — the incoming list replaces the previous
 * project's documents.
 */
const mergeWorkspaceDocuments = (
	state: Pick<DocumentsState, "documents" | "projectId">,
	incomingProjectId: string | null,
	incomingDocuments: MarkdownDocument[],
): MarkdownDocument[] => {
	if (state.projectId !== incomingProjectId || state.documents.length === 0) {
		return incomingDocuments;
	}

	const localById = new Map(state.documents.map((document) => [document.id, document]));
	const merged = incomingDocuments.map((incoming) => {
		const local = localById.get(incoming.id);
		return local ? mergeIncomingDocument(local, incoming) : incoming;
	});
	const incomingIds = new Set(incomingDocuments.map((document) => document.id));
	for (const document of state.documents) {
		if (document.isDirty && !incomingIds.has(document.id)) {
			merged.push(document);
		}
	}
	return merged;
};

const nextActiveAssetId = (assets: { id: string }[], currentAssetId: string) =>
	assets.some((asset) => asset.id === currentAssetId) ? currentAssetId : "";

const nextActiveDocumentId = (
	documents: MarkdownDocument[],
	currentDocumentId: string,
	activeAssetId: string,
) => {
	if (activeAssetId) return "";
	return documents.some(
		(document) => document.id === currentDocumentId && !isOverviewDocumentId(document.id),
	)
		? currentDocumentId
		: firstEditableDocumentId(documents);
};

interface PreserveTransientDocumentStateInput {
	activeAssetId: string;
	activeDocumentId: string;
	documents: MarkdownDocument[];
	projectId: string | null;
	state: DocumentsState;
}

const preserveTransientDocumentState = ({
	activeAssetId,
	activeDocumentId,
	documents,
	projectId,
	state,
}: PreserveTransientDocumentStateInput): {
	activeCommentId: string | null;
	pendingComment: PendingDocumentComment | null;
	selection: DocumentSelection | null;
} => {
	if (activeAssetId || (state.projectId && projectId && state.projectId !== projectId)) {
		return {
			activeCommentId: null,
			pendingComment: null,
			selection: null,
		};
	}

	const activeDocument = documents.find((document) => document.id === activeDocumentId) ?? null;
	const activeCommentId =
		activeDocument && state.activeCommentId && hasComment(activeDocument, state.activeCommentId)
			? state.activeCommentId
			: null;
	const selection =
		activeDocument && isSelectionStillValid(activeDocument, state.selection)
			? state.selection
			: null;
	const pendingComment =
		activeDocument && isPendingCommentStillValid(activeDocument, state.pendingComment)
			? state.pendingComment
			: null;

	return {
		activeCommentId,
		pendingComment,
		selection,
	};
};

const hasComment = (document: MarkdownDocument, commentId: string) =>
	document.comments.some((comment) => comment.id === commentId && !comment.deletedAt);

const isSelectionStillValid = (document: MarkdownDocument, selection: DocumentSelection | null) =>
	Boolean(
		selection &&
		selection.documentId === document.id &&
		(findMarkdownBlockForAnchor(document.content, selection.anchor) ||
			findMarkdownBlockForAnchor(document.content, selection.text)),
	);

const isPendingCommentStillValid = (
	document: MarkdownDocument,
	pendingComment: PendingDocumentComment | null,
) =>
	Boolean(
		pendingComment &&
		pendingComment.documentId === document.id &&
		findMarkdownBlockForAnchor(document.content, pendingComment.selection),
	);
