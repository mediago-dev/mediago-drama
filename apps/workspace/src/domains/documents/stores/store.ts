import {
	type WorkspaceDocumentsPayload,
	type WorkspaceStatePayload,
} from "@/domains/workspace/api/workspace";
import { createStore } from "@/shared/lib/utils";
import { createDocumentActions } from "./actions";
import { editableDocuments } from "./helpers";
import type { DocumentRollbackSnapshot } from "./action-types";
import type {
	DocumentComment,
	DocumentOperationLogEntry,
	DocumentsState,
	MarkdownDocument,
} from "./types";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";

const initialDocuments: MarkdownDocument[] = [];
const initialAssets: ProjectAsset[] = [];
const initialFolders: DocumentsState["folders"] = [];
const initialOperationLog: DocumentOperationLogEntry[] = [];

const isCurrentProject = (capturedProjectId: string | null) =>
	useDocumentsStore.getState().projectId === capturedProjectId;

const hydrateWorkspaceStateForProject = (
	savedState: WorkspaceStatePayload,
	capturedProjectId: string | null,
) => {
	const current = useDocumentsStore.getState();
	if (current.projectId !== capturedProjectId) return;

	current.hydrateWorkspaceState(
		savedState.documents,
		savedState.operationLog,
		savedState.workspaceDir,
		savedState.projectId ?? capturedProjectId,
		savedState.assets,
		savedState.folders,
	);
};

const hydrateWorkspaceDocumentsForProject = (
	savedState: WorkspaceDocumentsPayload,
	capturedProjectId: string | null,
) => {
	const current = useDocumentsStore.getState();
	if (current.projectId !== capturedProjectId) return;

	current.hydrateWorkspaceDocuments(savedState);
};

const markWorkspaceSyncErrorForProject = (capturedProjectId: string | null, message: string) => {
	if (!isCurrentProject(capturedProjectId)) return;
	useDocumentsStore.getState().markWorkspaceSyncStatus("error", message);
};

const rollbackWorkspaceStateForProject = (
	capturedProjectId: string | null,
	snapshot: DocumentRollbackSnapshot,
	message: string,
) => {
	if (!isCurrentProject(capturedProjectId)) return;
	useDocumentsStore.setState({
		...snapshot,
		syncStatus: "error",
		syncMessage: message,
	});
};

export const useDocumentsStore = createStore<DocumentsState>(
	(set, get) => ({
		documents: initialDocuments,
		folders: initialFolders,
		assets: initialAssets,
		operationLog: initialOperationLog,
		activeDocumentId: initialDocuments[0]?.id ?? "",
		activeAssetId: "",
		searchQuery: "",
		selection: null,
		pendingComment: null,
		showComments: false,
		activeCommentId: null,
		projectId: null,
		workspaceDir: "",
		syncStatus: "idle",
		syncMessage: "等待后端数据",
		...createDocumentActions({
			set,
			get,
			dependencies: {
				hydrateWorkspaceDocumentsForProject,
				hydrateWorkspaceStateForProject,
				markWorkspaceSyncErrorForProject,
				rollbackWorkspaceStateForProject,
			},
		}),
	}),
	"documentsStore",
);

export const selectActiveDocument = () => {
	const { documents, activeDocumentId } = useDocumentsStore.getState();
	return (
		documents.find((document) => document.id === activeDocumentId) ??
		editableDocuments(documents)[0] ??
		documents[0] ??
		null
	);
};

export const selectActiveDocumentOpenComments = (() => {
	let lastDocumentId = "";
	let lastComments: DocumentComment[] | null = null;
	let lastOpenComments: DocumentComment[] = [];

	return (state: DocumentsState) => {
		const activeDocumentId = state.activeDocumentId;
		const activeDocument = state.documents.find((document) => document.id === activeDocumentId);
		const comments = activeDocument?.comments ?? null;
		if (activeDocumentId === lastDocumentId && comments === lastComments) {
			return lastOpenComments;
		}

		lastDocumentId = activeDocumentId;
		lastComments = comments;
		lastOpenComments = comments?.filter((comment) => !comment.resolved) ?? [];
		return lastOpenComments;
	};
})();
