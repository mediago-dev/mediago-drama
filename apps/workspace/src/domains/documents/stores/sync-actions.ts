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
				if (removed.has(document.id)) continue;
				seen.add(document.id);
				const incoming = changedById.get(document.id);
				// Never overwrite unsaved local edits; keep the dirty copy until it is saved.
				merged.push(incoming && !document.isDirty ? incoming : document);
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
				syncStatus: "synced",
				syncMessage: "已与后端文档库同步",
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
		const documents = normalizeDocumentsForFolders(normalizeDocuments(incomingDocuments), folders);
		const folderIds = new Set(folders.map((folder) => folder.id));
		const assets = incomingAssets.map((asset) => ({
			...asset,
			folderId: asset.folderId && folderIds.has(asset.folderId) ? asset.folderId : null,
		}));
		set((state) => {
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
				syncStatus: "synced",
				syncMessage: "已与后端工作区同步",
			};
		});
	},
	hydrateWorkspaceDocuments: (payload) => {
		const folders = normalizeFolders(payload.folders);
		const documents = normalizeDocumentsForFolders(normalizeDocuments(payload.documents), folders);
		const folderIds = new Set(folders.map((folder) => folder.id));
		const assets = (payload.assets ?? []).map((asset) => ({
			...asset,
			folderId: asset.folderId && folderIds.has(asset.folderId) ? asset.folderId : null,
		}));
		const documentIds = new Set(documents.map((document) => document.id));
		const operationLog = get().operationLog.filter((entry) => documentIds.has(entry.documentId));
		set((state) => {
			const activeAssetId = nextActiveAssetId(assets, state.activeAssetId);
			const activeDocumentId = nextActiveDocumentId(
				documents,
				state.activeDocumentId,
				activeAssetId,
			);
			const projectId = payload.projectId ?? state.projectId;
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
				workspaceDir: payload.workspaceDir,
				syncStatus: "synced",
				syncMessage: "已与后端文档库同步",
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
