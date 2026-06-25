// Hand-written protocol contracts used by the workspace app.

export const agentDocumentToolNames = [
	"load_skill",
	"update_project_config",
	"list_comments",
	"get_comment",
	"mutate_comment",
] as const;

export type AgentDocumentToolName = (typeof agentDocumentToolNames)[number];

export const externalDocumentToolNames = [
	"list_projects",
	"load_skill",
	"list_comments",
	"get_comment",
	"mutate_comment",
] as const;

export type ExternalDocumentToolName = (typeof externalDocumentToolNames)[number];

export interface CommentAnchorInput {
	blockId: string;
	range?: DocumentTextRange | null;
	quote?: string;
}

export interface ListCommentsInput {
	documentId: string;
	blockId?: string;
	resolved?: boolean | null;
	includeReplies?: boolean | null;
}

export interface GetCommentInput {
	commentId: string;
	includeReplies?: boolean | null;
}

export interface MutateCommentInput {
	op: string;
	documentId?: string;
	anchor?: CommentAnchorInput;
	commentId?: string;
	parentCommentId?: string;
	body?: string;
	summary?: string;
}

export interface DocumentCommentThread {
	root: DocumentComment;
	replies?: DocumentComment[];
}

export interface CommentsToolOutput {
	threads: DocumentCommentThread[];
}

export interface CommentToolOutput {
	thread: DocumentCommentThread;
}

export interface CommentMutationOutput {
	thread: DocumentCommentThread;
	documentId: string;
	status: string;
	message: string;
}

export interface DocumentBlockAttrs {
	level?: number;
	language?: string;
	ordered?: boolean | null;
	src?: string;
	alt?: string;
}

export interface HeadingBlockAttrs {
	level?: number;
}

export interface CodeBlockAttrs {
	language?: string;
}

export interface ListBlockAttrs {
	ordered: boolean;
}

export interface LinkMarkAttrs {
	href?: string;
}

export interface MentionAttrs {
	id?: string;
	label?: string;
}

export interface AgentDocumentSelectionEvent {
	documentId: string;
	selection: DocumentRangeSelection;
	runId?: string;
	agentTag?: string;
}

export interface DocumentTextRange {
	start: number;
	end: number;
}

export interface DocumentLineRange {
	startLine: number;
	endLine: number;
}

export interface DocumentBlockNode {
	id: string;
	kind: string;
	level?: number;
	text?: string;
	markdown: string;
	attrs?: DocumentBlockAttrs | null;
	children?: DocumentBlockNode[];
	range: DocumentLineRange;
	hash: string;
}

export interface DocumentHeadingNode {
	id: string;
	text: string;
	level: number;
	range: DocumentLineRange;
	hash: string;
}

export interface DocumentStats {
	wordCount: number;
	blockCount: number;
	headingCount: number;
}

export interface TextAnchor {
	quote: string;
	contextBefore: string;
	contextAfter: string;
	range?: DocumentTextRange | null;
}

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
	kind: string;
	createdAt: string;
	updatedAt: string;
}

export interface WorkspaceDocument {
	id: string;
	title: string;
	filename?: string;
	content: string;
	category?: string;
	parentId?: string;
	folderId?: string;
	sortOrder: number;
	tags?: string[];
	updatedAt: string;
	isDirty: boolean;
	version: number;
	comments: DocumentComment[];
	workbenchDraft?: DocumentWorkbenchDraft | null;
}

export interface WorkspaceDocumentMetadata {
	id: string;
	title: string;
	category?: string;
	parentId?: string;
	folderId?: string;
	sortOrder: number;
	updatedAt?: string;
	isDirty?: boolean;
	version: number;
	tags?: string[];
}

export interface DocumentFolder {
	id: string;
	name: string;
	parentId?: string;
	sortOrder: number;
	createdAt?: string;
	updatedAt?: string;
}

export interface Project {
	id: string;
	name: string;
	description?: string;
	projectDir?: string;
	relativeDir?: string;
	documentCount?: number;
	createdAt?: string;
	updatedAt?: string;
}

export interface ProjectList {
	workspaceDir?: string;
	databasePath?: string;
	projects: Project[];
}

export interface ProjectOverviewConfig {
	categoryDefaults?: Record<string, string>;
}

export interface ProjectConfig {
	schemaVersion: number;
	projectId: string;
	name: string;
	description: string;
	overview: ProjectOverviewConfig;
	createdAt: string;
}

export interface ProjectOverviewConfigPatch {
	categoryDefaults?: Record<string, string> | null;
}

export interface ProjectConfigPatchInput {
	overview?: ProjectOverviewConfigPatch | null;
}

export interface ProjectConfigToolOutput {
	status: string;
	message: string;
	config: ProjectConfig;
}

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

export interface ProjectBriefPatchInput {
	medium?: string | null;
	genre?: string | null;
	pacing?: string | null;
	audience?: string | null;
	tone?: string | null;
	references?: string | null;
	notes?: string | null;
}

export interface ProjectBriefToolOutput {
	status: string;
	message: string;
	brief: ProjectBrief;
}

export interface GetProjectBriefInput {}

export interface ExternalGetProjectBriefInput {
	projectId: string;
}

export interface ExternalProjectBriefPatchInput extends ProjectBriefPatchInput {
	projectId: string;
}

export interface ListDocumentsOutput {
	workspaceDir?: string;
	projectId?: string;
	documents: WorkspaceDocumentMetadata[];
	folders?: DocumentFolder[];
}

export interface DocumentRangeSelection {
	blockId: string;
	range: DocumentTextRange;
	quote?: string;
}

export interface DocumentOffsetPosition {
	blockId: string;
	offset: number;
}

export interface DocumentBlockAnchorInput {
	blockId: string;
	position: string;
}

export interface DocumentMoveBlockTargetInput {
	documentId?: string;
	anchor: DocumentBlockAnchorInput;
}

export interface DocumentBlockInput {
	kind?: string;
	level?: number;
	text?: string;
	markdown?: string;
	attrs?: DocumentBlockAttrs | null;
	children?: DocumentBlockInput[];
}

export interface DocumentInlineMarkInput {
	kind: string;
	attrs?: LinkMarkAttrs | null;
}

export interface DocumentInlineContentInput {
	type: string;
	text?: string;
	marks?: DocumentInlineMarkInput[];
	attrs?: MentionAttrs | null;
}

export type DocumentInlineReplacement = string | DocumentInlineContentInput[];

export interface GetDocumentInput {
	documentId: string;
	includeComments?: boolean | null;
	includeDraft?: boolean;
}

export interface GetDocumentOutput {
	id: string;
	title: string;
	category?: string;
	parentId?: string;
	sortOrder: number;
	tags?: string[];
	version: number;
	updatedAt: string;
	structure: DocumentBlockNode[];
	outline: DocumentHeadingNode[];
	stats: DocumentStats;
	comments?: DocumentCommentThread[];
	workbenchDraft?: DocumentWorkbenchDraft | null;
}

export interface GetDocumentOutlineInput {
	documentId: string;
	maxLevel?: number;
}

export interface GetDocumentOutlineOutput {
	documentId: string;
	version: number;
	outline: DocumentHeadingNode[];
}

export interface GetDocumentBlockInput {
	documentId: string;
	blockId: string;
	includeChildren?: boolean | null;
}

export interface GetDocumentBlockOutput {
	block: DocumentBlockNode;
	parentId?: string;
	prevSiblingId?: string;
	nextSiblingId?: string;
}

export interface GetDocumentSectionInput {
	documentId: string;
	headingId: string;
}

export interface GetDocumentSectionOutput {
	heading: DocumentHeadingNode;
	blocks: DocumentBlockNode[];
}

export interface BatchGetDocumentsInput {
	documentIds: string[];
	includeComments?: boolean | null;
	asStructure?: boolean | null;
}

export interface BatchGetDocumentsOutput {
	documents: GetDocumentOutput[];
}

export interface WorkspaceSnapshotOutput {
	projectId?: string;
	activeDocumentId?: string;
	selection?: DocumentRangeSelection | null;
	openDocumentIds: string[];
	documents: WorkspaceDocumentMetadata[];
}

export interface LegacyWorkspaceSnapshotOutput {
	projectId?: string;
	activeDocumentId?: string;
	selectionText?: string;
	documents: WorkspaceDocumentMetadata[];
}

export interface LoadSkillInput {
	name: string;
}

export interface SkillMeta {
	name: string;
	description: string;
	source?: string;
	hint?: Record<string, string>;
}

export interface LoadSkillOutput {
	name: string;
	content: string;
	available?: SkillMeta[];
}

export interface ListDocumentsInput {}

export interface WorkspaceSnapshotInput {}

export interface ExternalListProjectsInput {}

export interface ExternalListCommentsInput {
	projectId: string;
	documentId: string;
	blockId?: string;
	resolved?: boolean | null;
	includeReplies?: boolean | null;
}

export interface ExternalMutateCommentInput {
	projectId: string;
	op: string;
	documentId?: string;
	anchor?: CommentAnchorInput;
	commentId?: string;
	parentCommentId?: string;
	body?: string;
	summary?: string;
}

export interface ExternalGetCommentInput {
	projectId: string;
	commentId: string;
	includeReplies?: boolean | null;
}
