import type { WorkspaceDocumentsPayload } from "@/domains/workspace/api/workspace";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import type { TemplateConstraintRejection } from "@/domains/documents/lib/constraints";
import type {
	MarkdownSectionIdentity,
	MarkdownSectionMentionReference,
} from "@/domains/documents/lib/editor-registry";
import type { DocumentOperation, TextAnchor } from "@/domains/documents/lib/operations";
import type { DocumentRangeSelection, DocumentTextRange } from "@/api/types/document-tools";

export interface DocumentComment {
	id: string;
	documentId?: string;
	blockId?: string;
	anchorText: string;
	anchor: TextAnchor;
	body: string;
	authorId?: string;
	parentCommentId?: string;
	createdAt: string;
	updatedAt?: string;
	resolved: boolean;
	resolvedBy?: string;
	resolvedAt?: string;
	deletedAt?: string;
}

export interface DocumentWorkbenchDraft {
	id: string;
	documentId: string;
	title: string;
	kind: "episode";
	createdAt: string;
	updatedAt: string;
}

export const referenceDocumentCategory = "reference" as const;
export const legacySourceMaterialDocumentCategory = "source-material" as const;
export const overviewDocumentCategory = "overview" as const;

export type DocumentCategory =
	| "screenplay"
	| "character"
	| "scene"
	| "prop"
	| "storyboard"
	| typeof referenceDocumentCategory
	| typeof overviewDocumentCategory;

export interface MarkdownDocument {
	id: string;
	title: string;
	/** Actual on-disk markdown filename (relative to the work dir), provided by the backend. */
	filename?: string;
	content: string;
	category?: DocumentCategory;
	parentId: string | null;
	folderId?: string | null;
	sortOrder: number;
	tags?: string[];
	version: number;
	updatedAt: string;
	isDirty: boolean;
	comments: DocumentComment[];
	workbenchDraft: DocumentWorkbenchDraft | null;
}

export interface DocumentFolder {
	id: string;
	name: string;
	parentId: string | null;
	sortOrder: number;
	createdAt: string;
	updatedAt: string;
}

export interface DocumentProposal {
	documentId: string;
	title?: string;
	content?: string;
	summary?: string;
}

/**
 * An incremental workspace update applied on top of the current store state.
 * `changedDocuments` are upserted (dirty local copies are preserved),
 * `removedDocumentIds` are dropped, and `folders` replaces the tree only when the
 * folder structure changed.
 */
export interface WorkspaceDocumentsDelta {
	changedDocuments: MarkdownDocument[];
	removedDocumentIds: string[];
	folders?: DocumentFolder[];
}

export interface DocumentSelection {
	documentId: string;
	text: string;
	anchor: TextAnchor;
	structured?: DocumentRangeSelection;
	updatedAt: string;
}

export interface PendingDocumentComment {
	documentId: string;
	selection: string;
	y: number;
	x: number;
}

export interface DocumentSnapshot {
	title: string;
	content: string;
	comments: DocumentComment[];
}

export interface DocumentOperationLogEntry {
	id: string;
	documentId: string;
	operations: DocumentOperation[];
	summary: string;
	source: DocumentOperationSource;
	createdAt: string;
	before: DocumentSnapshot;
	after: DocumentSnapshot;
	undoneAt?: string;
}

export type DocumentOperationSource = "agent" | `agent:${string}` | "user" | "workbench";

export interface DocumentInlinePosition {
	blockId: string;
	offset: number;
}

export interface StreamingDocumentEdit {
	documentId?: string;
	anchorText?: string;
	blockId?: string;
	op?: string;
	range?: DocumentTextRange;
	title?: string;
	parentId?: string | null;
	sortOrder?: number;
	mode?: "append" | "replace" | string;
	delta?: string;
	content?: string;
	summary?: string;
	status?: "streaming" | "checkpoint" | "completed" | "failed" | string;
	updatedAt?: string;
	runId?: string;
	agentTag?: string;
}

export type DocumentMovePosition = "before" | "after" | "inside";

export type FolderMovePosition = "before" | "after" | "inside";

export type WorkspaceDocumentSyncStatus = "idle" | "syncing" | "synced" | "error";

export interface CreateDocumentOptions {
	category: DocumentCategory;
	content?: string;
	parentId?: string | null;
	folderId?: string | null;
	title?: string;
}

export interface DocumentsState {
	documents: MarkdownDocument[];
	folders: DocumentFolder[];
	assets: ProjectAsset[];
	operationLog: DocumentOperationLogEntry[];
	activeDocumentId: string;
	activeAssetId: string;
	searchQuery: string;
	selection: DocumentSelection | null;
	pendingComment: PendingDocumentComment | null;
	showComments: boolean;
	activeCommentId: string | null;
	projectId: string | null;
	workspaceDir: string;
	syncStatus: WorkspaceDocumentSyncStatus;
	syncMessage: string;
	addComment: (documentId: string, anchorText: string, body: string) => void;
	applyDocumentUpdate: (proposal: DocumentProposal) => void;
	applyWorkspaceDelta: (delta: WorkspaceDocumentsDelta) => void;
	applyOperations: (
		documentId: string,
		operations: DocumentOperation[],
		options?: {
			source?: DocumentOperationLogEntry["source"];
			summary?: string;
		},
	) => {
		applied: number;
		logEntryId?: string;
		rejected: TemplateConstraintRejection<DocumentOperation>[];
	};
	applyStreamingDocumentEdit: (edit: StreamingDocumentEdit) => void;
	convertDocumentToWorkbenchDraft: (documentId: string) => DocumentWorkbenchDraft | null;
	createDocument: (options: CreateDocumentOptions) => MarkdownDocument | null;
	createFolder: (name: string, parentId?: string | null) => DocumentFolder | null;
	deleteComment: (documentId: string, commentId: string) => void;
	deleteDocument: (id: string) => void;
	deleteFolder: (id: string) => void;
	focusComment: (commentId: string | null) => void;
	hydrateWorkspaceState: (
		documents: MarkdownDocument[],
		operationLog: DocumentOperationLogEntry[],
		workspaceDir: string,
		projectId?: string | null,
		assets?: ProjectAsset[],
		folders?: DocumentFolder[],
	) => void;
	hydrateWorkspaceDocuments: (payload: WorkspaceDocumentsPayload) => void;
	markWorkspaceSyncStatus: (status: WorkspaceDocumentSyncStatus, message: string) => void;
	markDocumentSaved: (id: string) => void;
	moveDocument: (
		documentId: string,
		targetDocumentId: string,
		position: DocumentMovePosition,
	) => void;
	moveFolder: (
		folderId: string,
		targetFolderId: string | null,
		position?: FolderMovePosition,
	) => void;
	moveItemToFolder: (kind: "document" | "asset", id: string, folderId: string | null) => void;
	openPendingComment: (comment: PendingDocumentComment) => void;
	organizeIntoChapter: () => void;
	prepareWorkspaceLoad: (message: string) => void;
	renameDocument: (id: string, title: string) => void;
	renameFolder: (id: string, name: string) => void;
	resolveComment: (documentId: string, commentId: string) => void;
	selectDocument: (id: string) => void;
	selectAsset: (id: string) => void;
	setDocumentCategory: (id: string, category: DocumentCategory) => void;
	clearPendingComment: () => void;
	setSearchQuery: (query: string) => void;
	setShowComments: (showComments: boolean) => void;
	setSelection: (documentId: string, text: string) => void;
	toggleComments: () => void;
	toggleSectionMention: (
		section: MarkdownSectionIdentity,
		reference: MarkdownSectionMentionReference,
		selected: boolean,
	) => boolean;
	undoLastOperation: (documentId?: string) => boolean;
	updateComment: (documentId: string, commentId: string, body: string) => void;
	updateDocumentContent: (id: string, content: string) => void;
}
