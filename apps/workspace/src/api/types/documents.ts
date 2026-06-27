// Hand-written frontend API contracts mirrored by the Go workspace DTOs.

import type {
	DocumentComment,
	DocumentFolder,
	DocumentWorkbenchDraft,
	WorkspaceDocument,
} from "@/api/types/document-tools";

import type { ProjectConfig } from "@/domains/projects/api/projects";

export interface ProjectBrief {
	medium: string;
	genre: string;
	pacing: string;
	audience: string;
	tone: string;
	references: string;
	notes: string;
	updatedAt: string;
}

export interface ProjectBriefPatch {
	medium?: string;
	genre?: string;
	pacing?: string;
	audience?: string;
	tone?: string;
	references?: string;
	notes?: string;
}

export interface CreateWorkspaceProjectRequest {
	name: string;
	description: string;
	projectDir: string;
}

export interface ProjectAssetRecord {
	id: string;
	projectId: string;
	kind: string;
	filename: string;
	mimeType: string;
	sizeBytes: number;
	url: string;
	parentId?: string;
	folderId?: string;
	sortOrder: number;
	createdAt: string;
	updatedAt: string;
	downloadPath?: string;
}

export interface ProjectConfigMutationResult {
	config: ProjectConfig;
	changed: boolean;
}

export interface DocumentSnapshotRecord {
	title: string;
	content: string;
	comments: DocumentComment[];
}

export interface DocumentOperationLogRecord {
	id: string;
	documentId: string;
	operations: Record<string, unknown>[];
	summary: string;
	source: string;
	createdAt: string;
	before: DocumentSnapshotRecord;
	after: DocumentSnapshotRecord;
	undoneAt?: string;
}

export interface WorkspaceStateResponse {
	workspaceDir: string;
	projectId?: string;
	documents: WorkspaceDocument[];
	folders?: DocumentFolder[];
	assets?: ProjectAssetRecord[];
	operationLog: DocumentOperationLogRecord[];
}

export interface WorkspaceStateRequest {
	documents: WorkspaceDocument[];
	operationLog: DocumentOperationLogRecord[];
}

export interface WorkspaceDocumentsResponse {
	workspaceDir: string;
	projectId?: string;
	documents: WorkspaceDocument[];
	folders?: DocumentFolder[];
	assets?: ProjectAssetRecord[];
}

export interface EpisodeTimelineStateResponse {
	workspaceDir: string;
	projectId?: string;
	documentId: string;
	episode: unknown;
	createdAt: string;
	updatedAt: string;
}

export interface SaveEpisodeTimelineStateRequest {
	episode: unknown;
}

export interface CreateWorkspaceDocumentRequest {
	id?: string;
	title: string;
	content?: string;
	category?: string;
	parentId?: string;
	folderId?: string;
	sortOrder?: number;
	tags?: string[];
	comments?: DocumentComment[];
	workbenchDraft?: DocumentWorkbenchDraft;
}

export interface UpdateWorkspaceDocumentRequest {
	title?: string;
	content?: string;
	category?: string;
	parentId?: string;
	folderId?: string;
	sortOrder?: number;
	tags?: string[];
	isDirty?: boolean;
	comments?: DocumentComment[];
	workbenchDraft?: DocumentWorkbenchDraft;
	expectedVersion?: number;
}

export interface DeleteWorkspaceDocumentResponse {
	deletedIds: string[];
	state: WorkspaceDocumentsResponse;
}

export interface CreateDocumentFolderRequest {
	id?: string;
	name: string;
	parentId?: string;
	sortOrder?: number;
}

export interface UpdateDocumentFolderRequest {
	name?: string;
	parentId?: string;
	sortOrder?: number;
}

export interface DocumentFoldersResponse {
	workspaceDir: string;
	projectId?: string;
	folders: DocumentFolder[];
}

export interface DocumentFolderMutationResponse {
	folder: DocumentFolder;
	state: WorkspaceDocumentsResponse;
}

export interface DeleteDocumentFolderResponse {
	deletedId: string;
	state: WorkspaceDocumentsResponse;
}

export interface DocumentToolApprovalRecord {
	id: string;
	projectId?: string;
	toolName: string;
	documentId?: string;
	title?: string;
	summary?: string;
	status: string;
	request: DocumentToolApprovalRequest;
	decisionPayload?: Record<string, unknown>;
	createdAt: string;
	decidedAt?: string;
}

export interface DocumentToolApprovalRequest {
	id?: string;
	name: string;
	documentId?: string;
	title?: string;
	summary?: string;
}

export interface DocumentToolApprovalDecisionRequest {
	projectId?: string;
	decision: string;
	payload?: DocumentToolApprovalDecisionPayload;
}

export interface DocumentToolApprovalDecisionPayload {
	config?: DocumentToolApprovalConfig;
}

export interface DocumentToolApprovalConfig {
	prompt?: string;
	saveSourceMaterial?: boolean;
}
