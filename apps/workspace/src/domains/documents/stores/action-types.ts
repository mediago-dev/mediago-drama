import type {
	WorkspaceDocumentsPayload,
	WorkspaceStatePayload,
} from "@/domains/workspace/api/workspace";
import type { StateCreator } from "zustand";
import type { DocumentsState } from "./types";

type DocumentsStateKey =
	| "documents"
	| "folders"
	| "assets"
	| "operationLog"
	| "activeDocumentId"
	| "activeAssetId"
	| "searchQuery"
	| "selection"
	| "pendingComment"
	| "showComments"
	| "activeCommentId"
	| "projectId"
	| "workspaceDir"
	| "syncStatus"
	| "syncMessage";

export type DocumentsActions = Omit<DocumentsState, DocumentsStateKey>;
export type DocumentsSet = Parameters<StateCreator<DocumentsState>>[0];
export type DocumentsGet = Parameters<StateCreator<DocumentsState>>[1];
export type DocumentRollbackSnapshot = Pick<
	DocumentsState,
	| "activeCommentId"
	| "activeAssetId"
	| "activeDocumentId"
	| "assets"
	| "documents"
	| "folders"
	| "operationLog"
	| "pendingComment"
	| "searchQuery"
	| "selection"
	| "showComments"
	| "syncMessage"
	| "syncStatus"
>;

export interface DocumentActionDependencies {
	hydrateWorkspaceDocumentsForProject: (
		savedState: WorkspaceDocumentsPayload,
		capturedProjectId: string | null,
	) => void;
	hydrateWorkspaceStateForProject: (
		savedState: WorkspaceStatePayload,
		capturedProjectId: string | null,
	) => void;
	markWorkspaceSyncErrorForProject: (capturedProjectId: string | null, message: string) => void;
	rollbackWorkspaceStateForProject: (
		capturedProjectId: string | null,
		snapshot: DocumentRollbackSnapshot,
		message: string,
	) => void;
}

export interface DocumentActionContext {
	dependencies: DocumentActionDependencies;
	get: DocumentsGet;
	set: DocumentsSet;
}
