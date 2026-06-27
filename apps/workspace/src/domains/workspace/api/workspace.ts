import httpClient from "@/shared/lib/http";
import { apiURL } from "@/shared/lib/api-base";
import { ManagedEventSource } from "@/shared/lib/sse/managed-event-source";
import type { Episode } from "@/domains/episode/lib/sample";
import type {
	CreateDocumentFolderRequest as GeneratedCreateDocumentFolderRequest,
	CreateWorkspaceDocumentRequest as GeneratedCreateWorkspaceDocumentRequest,
	DeleteDocumentFolderResponse as GeneratedDeleteDocumentFolderResponse,
	DeleteWorkspaceDocumentResponse as GeneratedDeleteWorkspaceDocumentResponse,
	DocumentFolderMutationResponse as GeneratedDocumentFolderMutationResponse,
	DocumentFoldersResponse,
	EpisodeTimelineStateResponse,
	UpdateDocumentFolderRequest as GeneratedUpdateDocumentFolderRequest,
	UpdateWorkspaceDocumentRequest as GeneratedUpdateWorkspaceDocumentRequest,
	WorkspaceDocumentsResponse,
	WorkspaceStateRequest as GeneratedWorkspaceStateRequest,
	WorkspaceStateResponse,
} from "@/api/types/documents";
import type {
	DocumentFolder,
	MarkdownDocument,
	DocumentOperationLogEntry,
} from "@/domains/documents/stores";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import type { AgentResourceType } from "@/domains/workspace/lib/workbench-route";
import { ErrorCode, type ApiError } from "@/types/api";

const projectAPIPath = (projectId: string | null | undefined, path: string) => {
	const id = projectId?.trim();
	if (!id) throw new Error("projectId is required");
	return `/projects/${encodeURIComponent(id)}${path}`;
};

export const workspaceStateKey = (projectId?: string | null) =>
	projectAPIPath(projectId, "/workspace/state");

export const workspaceDocumentsChangedEventType = "workspace.documents.changed";

export interface WorkspaceEventPayload {
	id?: string;
	type: string;
	projectId?: string;
	message?: string;
	createdAt?: string;
}

export type WorkspaceStatePayload = Omit<
	WorkspaceStateResponse,
	"assets" | "documents" | "folders" | "operationLog"
> & {
	documents: MarkdownDocument[];
	folders?: DocumentFolder[];
	assets?: ProjectAsset[];
	operationLog: DocumentOperationLogEntry[];
};

export type WorkspaceDocumentsPayload = Omit<
	WorkspaceDocumentsResponse,
	"assets" | "documents" | "folders"
> & {
	documents: MarkdownDocument[];
	folders?: DocumentFolder[];
	assets?: ProjectAsset[];
};

export type WorkspaceSectionStatus = "active" | "missing" | "detached" | "duplicated" | "deleted";

export interface WorkspaceSectionRecord {
	projectId?: string;
	sectionId: string;
	documentId?: string;
	type: string;
	subtype?: string;
	title?: string;
	metadataJson?: string;
	status: WorkspaceSectionStatus | (string & {});
	observedTitle?: string;
	headingLevel?: number;
	headingPath?: string;
	lineStart?: number;
	lineEnd?: number;
	contentHash?: string;
	createdAt?: string;
	updatedAt?: string;
	lastSeenAt?: string;
}

export interface WorkspaceSectionsPayload {
	projectId?: string;
	sections: WorkspaceSectionRecord[];
}

export interface WorkspaceDocumentResource {
	blockId: string;
	canGenerate: boolean;
	documentId: string;
	documentTitle: string;
	headingLevel: number;
	headingOccurrence: number;
	id: string;
	markdown: string;
	plainText?: string;
	prompt?: string;
	sectionId: string;
	sourceCategory: MarkdownDocument["category"];
	summary?: string;
	title: string;
	type: AgentResourceType;
}

export interface WorkspaceDocumentResourcesPayload {
	projectId?: string;
	resources: WorkspaceDocumentResource[];
}

export interface WorkspaceStoryboardVideoAsset {
	id: string;
	mimeType?: string;
	posterUrl?: string;
	sectionTitle: string;
	sourceLabel: string;
	src: string;
	title: string;
}

export interface WorkspaceStoryboardVideoReel {
	id: string;
	blockId: string;
	sectionId: string;
	title: string;
	headingLevel: number;
	headingOccurrence: number;
	markdown: string;
	plainText?: string;
	prompt?: string;
	canGenerate: boolean;
	videos: WorkspaceStoryboardVideoAsset[];
}

export interface WorkspaceStoryboardVideoDocumentGroup {
	documentId: string;
	documentTitle: string;
	reels: WorkspaceStoryboardVideoReel[];
}

export interface WorkspaceStoryboardVideoResourcesPayload {
	projectId?: string;
	groups: WorkspaceStoryboardVideoDocumentGroup[];
}

export type WorkspaceEpisodePayload = Omit<EpisodeTimelineStateResponse, "episode"> & {
	episode: Episode;
};

export interface WorkspaceResolvedEpisodePayload {
	workspaceDir: string;
	projectId?: string;
	documentId: string;
	episode: Episode;
	documentUpdatedAt?: string;
	persistedUpdatedAt?: string;
}

export interface ExportWorkspaceEpisodeJianyingDraftRequest {
	copyMedia?: boolean;
	draftName?: string;
	draftsRoot?: string;
	replaceExisting?: boolean;
}

export interface ExportWorkspaceEpisodeJianyingDraftResponse {
	draftName: string;
	draftPath: string;
	durationMicros: number;
	shotCount: number;
	skippedCount: number;
}

export type CreateWorkspaceDocumentRequest = Omit<
	GeneratedCreateWorkspaceDocumentRequest,
	"category" | "comments" | "folderId" | "parentId" | "workbenchDraft"
> & {
	category: MarkdownDocument["category"];
	parentId?: string | null;
	folderId?: string | null;
	comments?: MarkdownDocument["comments"];
	workbenchDraft?: MarkdownDocument["workbenchDraft"];
};

export type UpdateWorkspaceDocumentRequest = Omit<
	GeneratedUpdateWorkspaceDocumentRequest,
	"category" | "comments" | "folderId" | "parentId" | "workbenchDraft"
> & {
	category?: MarkdownDocument["category"];
	parentId?: string | null;
	folderId?: string | null;
	comments?: MarkdownDocument["comments"];
	workbenchDraft?: MarkdownDocument["workbenchDraft"];
};

export interface UpdateWorkspaceDocumentSectionMentionRequest {
	sectionId: string;
	reference: {
		documentId: string;
		blockId?: string;
		title: string;
		category?: string;
	};
	selected: boolean;
	expectedVersion?: number;
}

export interface WorkspaceDocumentMutationResponse {
	document: MarkdownDocument;
	state: WorkspaceDocumentsPayload;
}

export interface DocumentHistoryItem {
	hash: string;
	summary: string;
	message: string;
	projectId?: string;
	source?: string;
	operation?: string;
	documentIds: string[];
	paths: string[];
	createdAt: string;
}

export interface DocumentHistoryVersion {
	hash: string;
	parentHash?: string;
	documentId: string;
	title: string;
	category?: MarkdownDocument["category"];
	tags?: string[];
	content: string;
	path: string;
	createdAt: string;
}

export interface DocumentHistoryDiffLine {
	type: "context" | "added" | "removed";
	oldLine?: number;
	newLine?: number;
	text: string;
}

export interface DocumentHistoryDiff {
	documentId: string;
	from?: DocumentHistoryVersion | null;
	to: DocumentHistoryVersion;
	lines: DocumentHistoryDiffLine[];
}

export interface DocumentHistoryResponse {
	projectId: string;
	documentId: string;
	items: DocumentHistoryItem[];
}

export interface DocumentHistoryVersionResponse {
	projectId: string;
	documentId: string;
	version: DocumentHistoryVersion;
}

export interface DocumentHistoryDiffResponse {
	projectId: string;
	documentId: string;
	diff: DocumentHistoryDiff;
}

export interface RestoreDocumentHistoryResponse {
	document: MarkdownDocument;
	state: WorkspaceDocumentsPayload;
}

export type DeleteWorkspaceDocumentResponse = Omit<
	GeneratedDeleteWorkspaceDocumentResponse,
	"state"
> & {
	state: WorkspaceDocumentsPayload;
};

export type WorkspaceFoldersPayload = Omit<DocumentFoldersResponse, "folders"> & {
	folders: DocumentFolder[];
};

export type CreateWorkspaceFolderRequest = Omit<
	GeneratedCreateDocumentFolderRequest,
	"parentId"
> & {
	parentId?: string | null;
};

export type UpdateWorkspaceFolderRequest = Omit<
	GeneratedUpdateDocumentFolderRequest,
	"parentId"
> & {
	parentId?: string | null;
};

export type WorkspaceFolderMutationResponse = Omit<
	GeneratedDocumentFolderMutationResponse,
	"folder" | "state"
> & {
	folder: DocumentFolder;
	state: WorkspaceDocumentsPayload;
};

export type DeleteWorkspaceFolderResponse = Omit<GeneratedDeleteDocumentFolderResponse, "state"> & {
	state: WorkspaceDocumentsPayload;
};

export type WorkspaceStateRequest = Omit<
	GeneratedWorkspaceStateRequest,
	"documents" | "operationLog"
> & {
	documents: MarkdownDocument[];
	operationLog: DocumentOperationLogEntry[];
};

export const getWorkspaceState = async (projectId?: string | null) => {
	const response = await httpClient.get<WorkspaceStatePayload>(workspaceStateKey(projectId));
	return response.data;
};

export const createWorkspaceEventSource = (projectId?: string | null) =>
	new ManagedEventSource({
		url: () => workspaceEventSourceURL(projectId),
	});

export const updateWorkspaceState = async (
	payload: WorkspaceStateRequest,
	projectId?: string | null,
) => {
	const response = await httpClient.put<WorkspaceStatePayload>(
		workspaceStateKey(projectId),
		payload,
	);
	return response.data;
};

export const getWorkspaceDocuments = async (projectId?: string | null) => {
	const response = await httpClient.get<WorkspaceDocumentsPayload>(
		workspaceDocumentsKey(projectId),
	);
	return response.data;
};

export const getWorkspaceDocumentResources = async (projectId?: string | null) => {
	const response = await httpClient.get<WorkspaceDocumentResourcesPayload>(
		workspaceDocumentResourcesKey(projectId),
	);
	return response.data;
};

export const getWorkspaceStoryboardVideoResources = async (projectId?: string | null) => {
	const response = await httpClient.get<WorkspaceStoryboardVideoResourcesPayload>(
		workspaceStoryboardVideoResourcesKey(projectId),
	);
	return response.data;
};

export const getWorkspaceSections = async (projectId?: string | null) => {
	const response = await httpClient.get<WorkspaceSectionsPayload>(workspaceSectionsKey(projectId));
	return response.data;
};

export const reconcileWorkspaceSections = async (projectId?: string | null) => {
	const response = await httpClient.post<WorkspaceSectionsPayload>(
		`${workspaceSectionsKey(projectId)}/reconcile`,
	);
	return response.data;
};

export const createWorkspaceDocument = async (
	payload: CreateWorkspaceDocumentRequest,
	projectId?: string | null,
) => {
	const response = await httpClient.post<WorkspaceDocumentMutationResponse>(
		workspaceDocumentsKey(projectId),
		payload,
	);
	return response.data;
};

export const updateWorkspaceDocumentRecord = async (
	documentId: string,
	payload: UpdateWorkspaceDocumentRequest,
	projectId?: string | null,
) => {
	const response = await httpClient.patch<WorkspaceDocumentMutationResponse>(
		workspaceDocumentRecordKey(documentId, projectId),
		payload,
	);
	return response.data;
};

export const updateWorkspaceDocumentSectionMention = async (
	documentId: string,
	payload: UpdateWorkspaceDocumentSectionMentionRequest,
	projectId?: string | null,
) => {
	const response = await httpClient.patch<WorkspaceDocumentMutationResponse>(
		`${workspaceDocumentRecordKey(documentId, projectId)}/section-mention`,
		payload,
	);
	return response.data;
};

export const deleteWorkspaceDocumentRecord = async (
	documentId: string,
	projectId?: string | null,
) => {
	const response = await httpClient.delete<DeleteWorkspaceDocumentResponse>(
		workspaceDocumentRecordKey(documentId, projectId),
	);
	return response.data;
};

export const getWorkspaceDocumentHistory = async (
	documentId: string,
	projectId?: string | null,
	limit = 50,
) => {
	const response = await httpClient.get<DocumentHistoryResponse>(
		workspaceDocumentHistoryKey(documentId, projectId),
		{ params: { limit } },
	);
	return response.data;
};

export const getWorkspaceDocumentHistoryVersion = async (
	documentId: string,
	commitHash: string,
	projectId?: string | null,
) => {
	const response = await httpClient.get<DocumentHistoryVersionResponse>(
		workspaceDocumentHistoryVersionKey(documentId, commitHash, projectId),
	);
	return response.data;
};

export const getWorkspaceDocumentHistoryDiff = async (
	documentId: string,
	commitHash: string,
	projectId?: string | null,
	fromHash?: string | null,
) => {
	const params = fromHash ? { from: fromHash } : undefined;
	const response = await httpClient.get<DocumentHistoryDiffResponse>(
		workspaceDocumentHistoryDiffKey(documentId, commitHash, projectId),
		{ params },
	);
	return response.data;
};

export const restoreWorkspaceDocumentHistoryVersion = async (
	documentId: string,
	commitHash: string,
	projectId?: string | null,
) => {
	const response = await httpClient.post<RestoreDocumentHistoryResponse>(
		workspaceDocumentHistoryRestoreKey(documentId, commitHash, projectId),
	);
	return response.data;
};

export const getWorkspaceFolders = async (projectId?: string | null) => {
	const response = await httpClient.get<WorkspaceFoldersPayload>(workspaceFoldersKey(projectId));
	return response.data;
};

export const createWorkspaceFolder = async (
	payload: CreateWorkspaceFolderRequest,
	projectId?: string | null,
) => {
	const response = await httpClient.post<WorkspaceFolderMutationResponse>(
		workspaceFoldersKey(projectId),
		payload,
	);
	return response.data;
};

export const updateWorkspaceFolder = async (
	folderId: string,
	payload: UpdateWorkspaceFolderRequest,
	projectId?: string | null,
) => {
	const response = await httpClient.patch<WorkspaceFolderMutationResponse>(
		workspaceFolderRecordKey(folderId, projectId),
		payload,
	);
	return response.data;
};

export const deleteWorkspaceFolder = async (folderId: string, projectId?: string | null) => {
	const response = await httpClient.delete<DeleteWorkspaceFolderResponse>(
		workspaceFolderRecordKey(folderId, projectId),
	);
	return response.data;
};

export const getWorkspaceEpisode = async (documentId: string, projectId?: string | null) => {
	try {
		const response = await httpClient.get<WorkspaceEpisodePayload | null>(
			workspaceEpisodeKey(documentId, projectId),
		);
		return response.data;
	} catch (error) {
		if (isNotFoundError(error)) return null;
		throw error;
	}
};

export const getWorkspaceResolvedEpisode = async (
	documentId: string,
	projectId?: string | null,
) => {
	const response = await httpClient.get<WorkspaceResolvedEpisodePayload>(
		workspaceResolvedEpisodeKey(documentId, projectId),
	);
	return response.data;
};

export const updateWorkspaceEpisode = async (
	documentId: string,
	episode: Episode,
	projectId?: string | null,
) => {
	const response = await httpClient.put<WorkspaceEpisodePayload>(
		workspaceEpisodeKey(documentId, projectId),
		{ episode },
	);
	return response.data;
};

export const exportWorkspaceEpisodeJianyingDraft = async (
	documentId: string,
	payload: ExportWorkspaceEpisodeJianyingDraftRequest = {},
	projectId?: string | null,
) => {
	const response = await httpClient.post<ExportWorkspaceEpisodeJianyingDraftResponse>(
		workspaceEpisodeJianyingDraftKey(documentId, projectId),
		payload,
	);
	return response.data;
};

export const workspaceDocumentsKey = (projectId?: string | null) =>
	projectAPIPath(projectId, "/workspace/documents");

export const workspaceDocumentResourcesKey = (projectId?: string | null) =>
	projectAPIPath(projectId, "/workspace/resources");

export const workspaceStoryboardVideoResourcesKey = (projectId?: string | null) =>
	projectAPIPath(projectId, "/workspace/storyboard-video-resources");

export const workspaceSectionsKey = (projectId?: string | null) =>
	projectAPIPath(projectId, "/workspace/sections");

export const workspaceFoldersKey = (projectId?: string | null) =>
	projectAPIPath(projectId, "/workspace/folders");

const workspaceDocumentRecordKey = (documentId: string, projectId?: string | null) => {
	return projectAPIPath(projectId, `/workspace/documents/${encodeURIComponent(documentId)}`);
};

export const workspaceDocumentHistoryKey = (documentId: string, projectId?: string | null) =>
	`${workspaceDocumentRecordKey(documentId, projectId)}/history`;

const workspaceDocumentHistoryVersionKey = (
	documentId: string,
	commitHash: string,
	projectId?: string | null,
) => `${workspaceDocumentHistoryKey(documentId, projectId)}/${encodeURIComponent(commitHash)}`;

const workspaceDocumentHistoryDiffKey = (
	documentId: string,
	commitHash: string,
	projectId?: string | null,
) => `${workspaceDocumentHistoryVersionKey(documentId, commitHash, projectId)}/diff`;

const workspaceDocumentHistoryRestoreKey = (
	documentId: string,
	commitHash: string,
	projectId?: string | null,
) => `${workspaceDocumentHistoryVersionKey(documentId, commitHash, projectId)}/restore`;

const workspaceFolderRecordKey = (folderId: string, projectId?: string | null) => {
	return projectAPIPath(projectId, `/workspace/folders/${encodeURIComponent(folderId)}`);
};

export const workspaceEpisodeKey = (documentId: string, projectId?: string | null) => {
	return projectAPIPath(projectId, `/workspace/episodes/${encodeURIComponent(documentId)}`);
};

export const workspaceResolvedEpisodeKey = (documentId: string, projectId?: string | null) => {
	return `${workspaceEpisodeKey(documentId, projectId)}/resolved`;
};

export const workspaceEpisodePreviewStreamURL = (
	documentId: string,
	projectId?: string | null,
	version?: string,
) => {
	const path = projectAPIPath(
		projectId,
		`/workspace/episodes/${encodeURIComponent(documentId)}/preview.mp4`,
	);
	const query = version ? `?v=${encodeURIComponent(version)}` : "";
	return apiURL(path + query);
};

const workspaceEpisodeJianyingDraftKey = (documentId: string, projectId?: string | null) => {
	return `${workspaceEpisodeKey(documentId, projectId)}/jianying-draft`;
};

const workspaceEventSourceURL = (projectId?: string | null) => {
	return apiURL(projectAPIPath(projectId, "/workspace/events"));
};

const isNotFoundError = (error: unknown) =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	(error as ApiError).code === ErrorCode.NOT_FOUND;
