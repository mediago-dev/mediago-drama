import { isOverviewDocumentId } from "@/lib/overview/overview-template";
import {
	firstEditableDocumentId as firstEditableDocumentIdFromFilters,
	getEditableDocuments,
} from "@/domains/documents/lib/filters";
import {
	createTextAnchor,
	type OperationDocumentLike,
	type TextAnchor,
} from "@/domains/documents/lib/operations";
import type { DocumentRollbackSnapshot } from "./action-types";
import {
	legacySourceMaterialDocumentCategory,
	overviewDocumentCategory,
	referenceDocumentCategory,
} from "./types";
import type {
	CreateDocumentOptions,
	DocumentCategory,
	DocumentComment,
	DocumentFolder,
	DocumentMovePosition,
	DocumentSnapshot,
	DocumentWorkbenchDraft,
	DocumentsState,
	MarkdownDocument,
	StreamingDocumentEdit,
} from "./types";

export const createId = (prefix: string) =>
	`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const defaultDocumentTitles: Record<DocumentCategory, string> = {
	screenplay: "新剧本",
	character: "新角色",
	scene: "新场景",
	prop: "新道具",
	storyboard: "新分镜",
	[referenceDocumentCategory]: "新资料",
	[overviewDocumentCategory]: "项目概览",
};

export const defaultTitleForCategory = (category: DocumentCategory) =>
	defaultDocumentTitles[category] ?? "新文档";

const documentCategories = new Set<DocumentCategory>([
	"screenplay",
	"character",
	"scene",
	"prop",
	"storyboard",
	referenceDocumentCategory,
	overviewDocumentCategory,
]);

export const isDocumentCategory = (value: string | undefined): value is DocumentCategory =>
	Boolean(value && documentCategories.has(value as DocumentCategory));

export const normalizeDocumentCategoryValue = (
	value: string | null | undefined,
): DocumentCategory | undefined => {
	const category = value?.trim();
	if (!category) return undefined;
	if (category === legacySourceMaterialDocumentCategory) return referenceDocumentCategory;
	return isDocumentCategory(category) ? category : undefined;
};

export const createUntitledDocument = (
	options: CreateDocumentOptions,
	sortOrder = 0,
): MarkdownDocument => ({
	id: `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	title: options.title?.trim() || defaultTitleForCategory(options.category),
	content: "",
	category: options.category,
	parentId: options.parentId ?? null,
	folderId: options.folderId ?? null,
	sortOrder,
	tags: [],
	version: 1,
	updatedAt: new Date().toISOString(),
	isDirty: true,
	comments: [],
	workbenchDraft: null,
});

export const normalizeDocuments = (documents: MarkdownDocument[]): MarkdownDocument[] => {
	const normalized = documents.map((document, index) => ({
		...document,
		category: normalizeDocumentCategory(document),
		parentId: document.parentId?.trim() || null,
		folderId: document.folderId?.trim() || null,
		sortOrder: Number.isFinite(document.sortOrder) ? document.sortOrder : index,
		tags: normalizeDocumentTags(document.tags),
		version: normalizeDocumentVersion(document.version),
		comments: Array.isArray(document.comments)
			? document.comments.map((comment) => normalizeComment(document.content, comment))
			: [],
		workbenchDraft: normalizeWorkbenchDraft(document),
	}));
	const ids = new Set(normalized.map((document) => document.id));

	return normalized.map((document) => ({
		...document,
		parentId:
			document.parentId && document.parentId !== document.id && ids.has(document.parentId)
				? document.parentId
				: null,
	}));
};

export const createUntitledFolder = (
	name: string,
	parentId: string | null,
	sortOrder = 0,
): DocumentFolder => {
	const now = new Date().toISOString();
	return {
		id: createId("folder"),
		name: name.trim() || "未命名文件夹",
		parentId,
		sortOrder,
		createdAt: now,
		updatedAt: now,
	};
};

export const normalizeFolders = (folders: DocumentFolder[] | undefined): DocumentFolder[] => {
	const seen = new Set<string>();
	const normalized = (folders ?? [])
		.map((folder, index) => {
			const id = folder.id?.trim();
			if (!id || seen.has(id)) return null;
			seen.add(id);
			const updatedAt = folder.updatedAt?.trim() || folder.createdAt || new Date().toISOString();
			return {
				id,
				name: folder.name?.trim() || "未命名文件夹",
				parentId: folder.parentId?.trim() || null,
				sortOrder: Number.isFinite(folder.sortOrder) ? folder.sortOrder : index,
				createdAt: folder.createdAt?.trim() || updatedAt,
				updatedAt,
			} satisfies DocumentFolder;
		})
		.filter((folder): folder is DocumentFolder => Boolean(folder));
	const ids = new Set(normalized.map((folder) => folder.id));
	const parentById = new Map(normalized.map((folder) => [folder.id, folder.parentId]));

	return normalized.map((folder) => {
		let parentId = folder.parentId;
		if (!parentId || parentId === folder.id || !ids.has(parentId)) {
			parentId = null;
		} else {
			const visited = new Set([folder.id]);
			let cursor: string | null = parentId;
			while (cursor) {
				if (visited.has(cursor)) {
					parentId = null;
					break;
				}
				visited.add(cursor);
				cursor = parentById.get(cursor) ?? null;
			}
		}
		return { ...folder, parentId };
	});
};

const normalizeDocumentVersion = (version: number | undefined) =>
	Number.isFinite(version) && version !== undefined && version > 0 ? Math.floor(version) : 1;

export const normalizeDocumentTags = (tags: string[] | undefined) =>
	Array.from(new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean)));

const normalizeDocumentCategory = (document: MarkdownDocument): DocumentCategory =>
	isOverviewDocumentId(document.id)
		? overviewDocumentCategory
		: (normalizeDocumentCategoryValue(document.category) ?? referenceDocumentCategory);

const normalizeComment = (
	content: string,
	comment: DocumentComment | (Omit<DocumentComment, "anchor"> & { anchor?: TextAnchor }),
): DocumentComment => ({
	...comment,
	anchor: comment.anchor ?? createTextAnchor(content, comment.anchorText),
	updatedAt: comment.updatedAt ?? comment.createdAt,
});

const normalizeWorkbenchDraft = (
	document: MarkdownDocument & { workbenchDraft?: Partial<DocumentWorkbenchDraft> | null },
): DocumentWorkbenchDraft | null => {
	const draft = document.workbenchDraft;
	if (!draft) return null;

	const documentId = document.id;
	const updatedAt = draft.updatedAt?.trim() || document.updatedAt || new Date().toISOString();
	const title = draft.title?.trim() || `${document.title || "未命名"} · 剪辑草稿`;
	return {
		id: draft.id?.trim() || `draft-${documentId}`,
		documentId,
		title,
		kind: "episode",
		createdAt: draft.createdAt?.trim() || updatedAt,
		updatedAt,
	};
};

export const createWorkbenchDraft = (document: MarkdownDocument): DocumentWorkbenchDraft => {
	const now = new Date().toISOString();
	return {
		id: createId("draft"),
		documentId: document.id,
		title: `${document.title || "未命名"} · 剪辑草稿`,
		kind: "episode",
		createdAt: now,
		updatedAt: now,
	};
};

export const uniqueDocumentId = (documents: MarkdownDocument[], requestedId?: string) => {
	const trimmed = requestedId?.trim();
	const exists = (id: string) => documents.some((document) => document.id === id);
	if (trimmed && !exists(trimmed)) return trimmed;

	let nextId = createId("doc");
	while (exists(nextId)) {
		nextId = createId("doc");
	}
	return nextId;
};

export const validParentId = (
	documents: MarkdownDocument[],
	parentId: string | null | undefined,
	documentId?: string,
) => {
	const trimmed = parentId?.trim();
	if (!trimmed || trimmed === documentId) return null;
	if (!documents.some((document) => document.id === trimmed)) return null;
	if (documentId && collectDescendantIds(documents, documentId).has(trimmed)) return null;
	return trimmed;
};

export const validFolderId = (
	folders: DocumentFolder[],
	folderId: string | null | undefined,
	currentFolderId?: string,
) => {
	const trimmed = folderId?.trim();
	if (!trimmed || trimmed === currentFolderId) return null;
	if (!folders.some((folder) => folder.id === trimmed)) return null;
	if (currentFolderId && collectFolderDescendantIds(folders, currentFolderId).has(trimmed)) {
		return null;
	}
	return trimmed;
};

export const normalizeDocumentsForFolders = (
	documents: MarkdownDocument[],
	folders: DocumentFolder[],
) => {
	const folderIds = new Set(folders.map((folder) => folder.id));
	return documents.map((document) => ({
		...document,
		folderId: document.folderId && folderIds.has(document.folderId) ? document.folderId : null,
	}));
};

export const nextFolderSortOrder = (folders: DocumentFolder[], parentId: string | null) => {
	const siblingOrders = folders
		.filter((folder) => (folder.parentId ?? null) === parentId)
		.map((folder) => folder.sortOrder);
	return siblingOrders.length > 0 ? Math.max(...siblingOrders) + 1 : 0;
};

export const collectFolderDescendantIds = (folders: DocumentFolder[], folderId: string) => {
	const collected = new Set<string>();
	const visit = (id: string) => {
		if (collected.has(id)) return;
		collected.add(id);
		for (const child of folders.filter((folder) => folder.parentId === id)) {
			visit(child.id);
		}
	};
	visit(folderId);
	return collected;
};

export const streamingDocumentContent = (
	currentContent: string,
	title: string,
	edit: StreamingDocumentEdit,
) => {
	if (edit.mode === "append") return `${currentContent}${edit.delta ?? ""}`;
	if (edit.mode === "replace") return edit.content ?? edit.delta ?? currentContent;
	if (edit.content !== undefined) return edit.content;
	if (edit.delta !== undefined) return `${currentContent}${edit.delta}`;
	return currentContent || `# ${title}\n\n`;
};

export const nextSortOrder = (documents: MarkdownDocument[], parentId: string | null) => {
	const siblingOrders = documents
		.filter(
			(document) => !isOverviewDocumentId(document.id) && (document.parentId ?? null) === parentId,
		)
		.map((document) => document.sortOrder);
	return siblingOrders.length > 0 ? Math.max(...siblingOrders) + 1 : 0;
};

export const moveDocumentInTree = (
	documents: MarkdownDocument[],
	documentId: string,
	targetDocumentId: string,
	position: DocumentMovePosition,
) => {
	if (documentId === targetDocumentId) return { documents, changed: false };

	const source = documents.find((document) => document.id === documentId);
	const target = documents.find((document) => document.id === targetDocumentId);
	if (!source || !target) return { documents, changed: false };

	const sourceDescendants = collectDescendantIds(documents, source.id);
	if (sourceDescendants.has(target.id)) return { documents, changed: false };

	const nextParentId = position === "inside" ? target.id : (target.parentId ?? null);
	if (sourceDescendants.has(nextParentId ?? "")) return { documents, changed: false };

	const withoutSource = documents.filter((document) => document.id !== source.id);
	const siblings = withoutSource
		.filter((document) => (document.parentId ?? null) === nextParentId)
		.sort(compareDocumentsForTree);
	const targetSiblingIndex = siblings.findIndex((document) => document.id === target.id);
	const insertIndex =
		position === "inside"
			? siblings.length
			: position === "before"
				? Math.max(targetSiblingIndex, 0)
				: Math.min(Math.max(targetSiblingIndex + 1, 0), siblings.length);
	const movedDocument: MarkdownDocument = {
		...source,
		parentId: nextParentId,
		version: source.version + 1,
		updatedAt: new Date().toISOString(),
	};
	const nextSiblings = [
		...siblings.slice(0, insertIndex),
		movedDocument,
		...siblings.slice(insertIndex),
	].map((document, sortOrder) => ({
		...document,
		parentId: nextParentId,
		sortOrder,
		version: document.id === source.id ? document.version : document.version + 1,
	}));
	const updates = new Map(nextSiblings.map((document) => [document.id, document]));
	const nextDocuments = documents.map((document) => updates.get(document.id) ?? document);
	const changed = nextDocuments.some(
		(document, index) =>
			document.parentId !== documents[index]?.parentId ||
			document.sortOrder !== documents[index]?.sortOrder,
	);

	return {
		documents: nextDocuments,
		changed,
	};
};

export const collectDescendantIds = (documents: MarkdownDocument[], documentId: string) => {
	const collected = new Set<string>();
	const visit = (id: string) => {
		if (collected.has(id)) return;
		collected.add(id);
		for (const child of documents.filter((document) => document.parentId === id)) {
			visit(child.id);
		}
	};
	visit(documentId);
	return collected;
};

const compareDocumentsForTree = (first: MarkdownDocument, second: MarkdownDocument) =>
	first.sortOrder - second.sortOrder || first.title.localeCompare(second.title, "zh-CN");

export const editableDocuments = getEditableDocuments;

export const firstEditableDocumentId = firstEditableDocumentIdFromFilters;

export const asOperationDocument = (document: MarkdownDocument): OperationDocumentLike => ({
	title: document.title,
	content: document.content,
	comments: document.comments,
});

export const rollbackSnapshot = (state: DocumentsState): DocumentRollbackSnapshot => ({
	activeCommentId: state.activeCommentId,
	activeAssetId: state.activeAssetId,
	activeDocumentId: state.activeDocumentId,
	assets: state.assets,
	documents: state.documents,
	folders: state.folders,
	operationLog: state.operationLog,
	pendingComment: state.pendingComment,
	searchQuery: state.searchQuery,
	selection: state.selection,
	showComments: state.showComments,
	syncMessage: state.syncMessage,
	syncStatus: state.syncStatus,
});

export const snapshotDocument = (document: MarkdownDocument): DocumentSnapshot => ({
	title: document.title,
	content: document.content,
	comments: document.comments.map((comment) => ({
		...comment,
		anchor: { ...comment.anchor },
	})),
});
