import type { DocumentActionContext, DocumentsActions } from "./action-types";
import { createDocumentMutationActions } from "./document-actions";
import { createFolderActions } from "./folder-actions";
import { createDocumentOperationActions } from "./operation-actions";
import { createDocumentSyncActions } from "./sync-actions";

export const createDocumentActions = (context: DocumentActionContext): DocumentsActions => ({
	...createDocumentOperationActions(context),
	...createDocumentMutationActions(context),
	...createFolderActions(context),
	...createDocumentSyncActions(context),
});
