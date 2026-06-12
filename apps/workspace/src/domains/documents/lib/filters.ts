import { isOverviewDocumentId } from "@/lib/overview/overview-template";
import type { DocumentComment, MarkdownDocument } from "@/domains/documents/stores";

export const isOpenComment = (comment: Pick<DocumentComment, "resolved">) => !comment.resolved;

export const isResolvedComment = (comment: Pick<DocumentComment, "resolved">) => comment.resolved;

export const getOpenComments = <T extends Pick<DocumentComment, "resolved">>(comments: T[]) =>
	comments.filter(isOpenComment);

export const getResolvedComments = <T extends Pick<DocumentComment, "resolved">>(comments: T[]) =>
	comments.filter(isResolvedComment);

export const findFirstOpenComment = <T extends Pick<DocumentComment, "resolved">>(comments: T[]) =>
	comments.find(isOpenComment) ?? null;

export const findDocumentById = <T extends { id: string }>(
	documents: T[],
	documentId?: string | null,
) => (documentId ? (documents.find((document) => document.id === documentId) ?? null) : null);

export const selectDocumentById = <T extends { id: string }>(
	documents: T[],
	documentId?: string | null,
) => findDocumentById(documents, documentId) ?? documents[0] ?? null;

export const getEditableDocuments = <T extends { id: string }>(documents: T[]) =>
	documents.filter((document) => !isOverviewDocumentId(document.id));

export const selectEditableDocument = <T extends { id: string }>(
	documents: T[],
	documentId?: string | null,
) => selectDocumentById(getEditableDocuments(documents), documentId);

export const firstEditableDocumentId = (documents: MarkdownDocument[]) =>
	getEditableDocuments(documents)[0]?.id ?? "";

export const isStoryboardWorkbenchDocument = (
	document: Pick<MarkdownDocument, "category" | "workbenchDraft">,
) => document.category === "storyboard" && Boolean(document.workbenchDraft);

export const selectStoryboardWorkbenchDocument = (
	documents: MarkdownDocument[],
	activeDocumentId?: string | null,
) =>
	documents.find(
		(document) => document.id === activeDocumentId && isStoryboardWorkbenchDocument(document),
	) ??
	documents.find(isStoryboardWorkbenchDocument) ??
	null;

export const getProjectScopedDocuments = <T>(
	documents: T[],
	loadedProjectId: string | null | undefined,
	projectId: string | null | undefined,
) => (loadedProjectId === projectId ? documents : []);
