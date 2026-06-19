package workspace

import (
	"context"
	"time"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	cliservice "github.com/mediago-dev/mediago-drama/services/server/internal/service"
	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	servicedocument "github.com/mediago-dev/mediago-drama/services/server/internal/service/document"
	serviceshared "github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

type workspaceStateResponse = servicedocument.WorkspaceStateResponse
type workspaceStateRequest = servicedocument.WorkspaceStateRequest
type workspaceDocumentsResponse = servicedocument.WorkspaceDocumentsResponse
type documentFoldersResponse = servicedocument.DocumentFoldersResponse
type episodeTimelineStateResponse = servicedocument.EpisodeTimelineStateResponse
type saveEpisodeTimelineStateRequest = servicedocument.SaveEpisodeTimelineStateRequest
type workspaceDocumentMetadataResponse = mediamcp.ListDocumentsOutput
type workspaceProjectsResponse = mediamcp.ProjectList
type workspaceProjectRecord = mediamcp.Project
type createWorkspaceProjectRequest = servicedocument.CreateWorkspaceProjectRequest
type createWorkspaceDocumentRequest = servicedocument.CreateWorkspaceDocumentRequest
type updateWorkspaceDocumentRequest = servicedocument.UpdateWorkspaceDocumentRequest
type deleteWorkspaceDocumentResponse = servicedocument.DeleteWorkspaceDocumentResponse
type documentHistoryResponse = servicedocument.DocumentHistoryResponse
type documentHistoryVersionResponse = servicedocument.DocumentHistoryVersionResponse
type documentHistoryDiffResponse = servicedocument.DocumentHistoryDiffResponse
type documentHistoryRestoreResponse = servicedocument.DocumentHistoryRestoreResponse
type createDocumentFolderRequest = servicedocument.CreateDocumentFolderRequest
type updateDocumentFolderRequest = servicedocument.UpdateDocumentFolderRequest
type documentFolderMutationResponse = servicedocument.DocumentFolderMutationResponse
type deleteDocumentFolderResponse = servicedocument.DeleteDocumentFolderResponse
type documentOperationLogRecord = servicedocument.DocumentOperationLogRecord
type documentToolApprovalRecord = servicedocument.DocumentToolApprovalRecord
type documentEditStreamRecord = servicedocument.DocumentEditStreamRecord
type workspaceDocumentMetadataMutationResult = servicedocument.WorkspaceDocumentMetadataMutationResult
type workspaceDocumentContentMutationResult = servicedocument.WorkspaceDocumentContentMutationResult
type workspaceDocumentMoveResult = servicedocument.WorkspaceDocumentMoveResult
type approvedDocumentDeleteResult = servicedocument.ApprovedDocumentDeleteResult
type streamDocumentEditInput = servicedocument.StreamDocumentEditInput
type streamDocumentEditRuntime = servicedocument.StreamDocumentEditRuntime
type preparedDocumentEditStream = servicedocument.PreparedDocumentEditStream
type projectBrief = servicedocument.ProjectBrief
type projectBriefUpdateMask = servicedocument.ProjectBriefUpdateMask
type projectBriefMutationResult = servicedocument.ProjectBriefMutationResult
type agentChatStateResponse = serviceagent.AgentChatStateResponse
type agentChatAppendRequest = serviceagent.AgentChatAppendRequest
type agentEvent = serviceagent.AgentEvent

// WorkspaceStateService wraps the service workspace state with CLI app setup.
type WorkspaceStateService struct {
	*cliservice.WorkspaceStateService
	dir     string
	initErr error
}

// NewStateService returns an initialized workspace state service.
func NewStateService(workspaceDir string) *WorkspaceStateService {
	dir := serviceshared.ResolveWorkspaceDir(workspaceDir)
	store := newStateServiceWithRepositories(dir)
	return &WorkspaceStateService{
		WorkspaceStateService: store,
		dir:                   store.Dir(),
		initErr:               store.InitErr(),
	}
}

func newStateServiceWithRepositories(workspaceDir string) *cliservice.WorkspaceStateService {
	dir := serviceshared.ResolveWorkspaceDir(workspaceDir)
	if err := serviceshared.EnsureWorkspaceLayout(dir); err != nil {
		return cliservice.NewWorkspaceStateServiceFromRepositories(dir, cliservice.WorkspaceStateRepositories{}, err)
	}

	repos, err := repository.OpenWorkspaceRepositories(serviceshared.WorkspacePathsFor(dir).DatabasePath())
	if err != nil {
		return cliservice.NewWorkspaceStateServiceFromRepositories(dir, cliservice.WorkspaceStateRepositories{}, err)
	}
	return cliservice.NewWorkspaceStateServiceFromRepositories(dir, repos, nil)
}

// ResolveWorkspaceDir returns the local MediaGo Drama workspace root used by the server.
func ResolveWorkspaceDir(workspaceDir string) string {
	return serviceshared.ResolveWorkspaceDir(workspaceDir)
}

// Dir returns the resolved workspace directory.
func (store *WorkspaceStateService) Dir() string {
	return store.dir
}

// InitErr returns any initialization error captured while creating the store.
func (store *WorkspaceStateService) InitErr() error {
	return store.initErr
}

// Close releases buffered workspace resources.
func (store *WorkspaceStateService) Close() error {
	if store == nil || store.WorkspaceStateService == nil {
		return nil
	}
	return store.WorkspaceStateService.Close()
}

// StateService returns the underlying workspace state service.
func (store *WorkspaceStateService) StateService() *cliservice.WorkspaceStateService {
	if store.WorkspaceStateService == nil {
		store.WorkspaceStateService = newStateServiceWithRepositories(store.dir)
		store.dir = store.WorkspaceStateService.Dir()
		store.initErr = store.WorkspaceStateService.InitErr()
	}
	return store.WorkspaceStateService
}

// AgentSessionRepository returns the persistent session repository.
func (store *WorkspaceStateService) AgentSessionRepository() *repository.AgentSessionRepository {
	return store.StateService().AgentSessionRepository()
}

// EnsureWorkspaceLayout creates required workspace directories and defaults.
func (store *WorkspaceStateService) EnsureWorkspaceLayout() error {
	return serviceshared.EnsureWorkspaceLayout(store.dir)
}

// DatabasePath returns the workspace database path.
func (store *WorkspaceStateService) DatabasePath() string {
	return serviceshared.WorkspacePathsFor(store.dir).DatabasePath()
}

// LibraryGeneratedDir returns the generated media assets directory.
func (store *WorkspaceStateService) LibraryGeneratedDir() string {
	return serviceshared.WorkspacePathsFor(store.dir).LibraryGeneratedDir()
}

// LoadWorkspaceState returns complete project workspace state.
func (store *WorkspaceStateService) LoadWorkspaceState(projectID string) (workspaceStateResponse, error) {
	return store.load(projectID)
}

func (store *WorkspaceStateService) load(projectID string) (workspaceStateResponse, error) {
	return store.StateService().Documents.LoadWorkspaceState(projectID)
}

// SaveWorkspaceState replaces complete project workspace state.
func (store *WorkspaceStateService) SaveWorkspaceState(projectID string, request workspaceStateRequest) (workspaceStateResponse, error) {
	return store.save(projectID, request)
}

func (store *WorkspaceStateService) save(projectID string, request workspaceStateRequest) (workspaceStateResponse, error) {
	return store.StateService().Documents.SaveWorkspaceState(projectID, request)
}

// LoadAgentChat returns the chat projection for a project/session.
func (store *WorkspaceStateService) LoadAgentChat(projectID string, sessionID string) (agentChatStateResponse, error) {
	return store.loadAgentChat(projectID, sessionID)
}

func (store *WorkspaceStateService) loadAgentChat(projectID string, sessionIDs ...string) (agentChatStateResponse, error) {
	sessionID := ""
	if len(sessionIDs) > 0 {
		sessionID = sessionIDs[0]
	}
	return store.StateService().Chat.LoadAgentChat(projectID, sessionID)
}

// AppendAgentMessages appends user-visible agent chat messages.
func (store *WorkspaceStateService) AppendAgentMessages(projectID string, request agentChatAppendRequest) (agentChatStateResponse, error) {
	return store.appendAgentMessages(projectID, request)
}

func (store *WorkspaceStateService) appendAgentMessages(projectID string, request agentChatAppendRequest) (agentChatStateResponse, error) {
	return store.StateService().Chat.AppendAgentMessages(projectID, request)
}

// ClearAgentChat clears the project chat projection.
func (store *WorkspaceStateService) ClearAgentChat(projectID string) (agentChatStateResponse, error) {
	return store.clearAgentChat(projectID)
}

func (store *WorkspaceStateService) clearAgentChat(projectID string) (agentChatStateResponse, error) {
	return store.StateService().Chat.ClearAgentChat(projectID)
}

// AppendAgentEvent persists an agent event and updates projections.
func (store *WorkspaceStateService) AppendAgentEvent(event agentEvent) (agentEvent, error) {
	return store.appendAgentEvent(event)
}

func (store *WorkspaceStateService) appendAgentEvent(event agentEvent) (agentEvent, error) {
	return store.StateService().Chat.AppendAgentEvent(event)
}

// LoadAgentEvents loads replayable agent events.
func (store *WorkspaceStateService) LoadAgentEvents(projectID string, sessionID string, afterSequence int64, limit int) ([]agentEvent, error) {
	return store.loadAgentEvents(projectID, sessionID, afterSequence, limit)
}

func (store *WorkspaceStateService) loadAgentEvents(projectID string, sessionID string, afterSequence int64, limit int) ([]agentEvent, error) {
	return store.StateService().Chat.LoadAgentEvents(projectID, sessionID, afterSequence, limit)
}

// ListProjects lists workspace projects.
func (store *WorkspaceStateService) ListProjects() (workspaceProjectsResponse, error) {
	return store.listProjects()
}

func (store *WorkspaceStateService) listProjects() (workspaceProjectsResponse, error) {
	return store.StateService().Documents.ListProjects()
}

// ListProjectsByStatus lists workspace projects filtered by lifecycle status.
func (store *WorkspaceStateService) ListProjectsByStatus(status string) (workspaceProjectsResponse, error) {
	return store.StateService().Documents.ListProjectsByStatus(status)
}

// CreateProject creates a workspace project.
func (store *WorkspaceStateService) CreateProject(id string, request createWorkspaceProjectRequest) (workspaceProjectRecord, error) {
	return store.createProject(id, request)
}

func (store *WorkspaceStateService) createProject(id string, request createWorkspaceProjectRequest) (workspaceProjectRecord, error) {
	return store.StateService().Documents.CreateProject(id, request)
}

// DeleteProject deletes a workspace project.
func (store *WorkspaceStateService) DeleteProject(projectID string) (workspaceProjectRecord, bool, error) {
	return store.deleteProject(projectID)
}

func (store *WorkspaceStateService) deleteProject(projectID string) (workspaceProjectRecord, bool, error) {
	return store.StateService().Documents.DeleteProject(projectID)
}

// ArchiveProject archives a workspace project.
func (store *WorkspaceStateService) ArchiveProject(projectID string) (workspaceProjectRecord, bool, error) {
	return store.StateService().Documents.ArchiveProject(projectID)
}

// RestoreProject restores an archived or trashed workspace project.
func (store *WorkspaceStateService) RestoreProject(projectID string) (workspaceProjectRecord, bool, error) {
	return store.StateService().Documents.RestoreProject(projectID)
}

// PermanentlyDeleteProject permanently deletes a trashed project.
func (store *WorkspaceStateService) PermanentlyDeleteProject(projectID string) (workspaceProjectRecord, bool, error) {
	return store.StateService().Documents.PermanentlyDeleteProject(projectID)
}

// ListWorkspaceDocuments lists project documents.
func (store *WorkspaceStateService) ListWorkspaceDocuments(projectID string) (workspaceDocumentsResponse, error) {
	return store.listDocuments(projectID)
}

func (store *WorkspaceStateService) listDocuments(projectID string) (workspaceDocumentsResponse, error) {
	return store.StateService().Documents.ListWorkspaceDocuments(projectID)
}

// SyncLocalMarkdownFiles imports local file and folder changes for a project.
func (store *WorkspaceStateService) SyncLocalMarkdownFiles(projectID string) (bool, error) {
	return store.StateService().Documents.SyncLocalMarkdownFiles(projectID)
}

// ListDocumentFolders lists project document folders.
func (store *WorkspaceStateService) ListDocumentFolders(projectID string) (documentFoldersResponse, error) {
	return store.StateService().Documents.ListDocumentFolders(projectID)
}

// CreateDocumentFolder creates a project document folder.
func (store *WorkspaceStateService) CreateDocumentFolder(projectID string, request createDocumentFolderRequest) (documentFolderMutationResponse, error) {
	return store.StateService().Documents.CreateDocumentFolder(projectID, request)
}

// UpdateDocumentFolder updates a project document folder.
func (store *WorkspaceStateService) UpdateDocumentFolder(projectID string, folderID string, request updateDocumentFolderRequest) (documentFolderMutationResponse, error) {
	return store.StateService().Documents.UpdateDocumentFolder(projectID, folderID, request)
}

// DeleteDocumentFolder deletes a project document folder.
func (store *WorkspaceStateService) DeleteDocumentFolder(projectID string, folderID string) (deleteDocumentFolderResponse, error) {
	return store.StateService().Documents.DeleteDocumentFolder(projectID, folderID)
}

// ListDocumentMetadata lists document metadata for MCP read tools.
func (store *WorkspaceStateService) ListDocumentMetadata(projectID string) (workspaceDocumentMetadataResponse, error) {
	return store.listDocumentMetadata(projectID)
}

func (store *WorkspaceStateService) listDocumentMetadata(projectID string) (workspaceDocumentMetadataResponse, error) {
	return store.StateService().Documents.ListDocumentMetadata(projectID)
}

// GetWorkspaceDocument returns one workspace document by ID.
func (store *WorkspaceStateService) GetWorkspaceDocument(projectID string, documentID string) (mediamcp.WorkspaceDocument, bool, error) {
	return store.getDocument(projectID, documentID)
}

func (store *WorkspaceStateService) getDocument(projectID string, documentID string) (mediamcp.WorkspaceDocument, bool, error) {
	return store.StateService().Documents.GetWorkspaceDocument(projectID, documentID)
}

// GetEpisodeTimelineState returns persisted episode timeline state.
func (store *WorkspaceStateService) GetEpisodeTimelineState(projectID string, documentID string) (episodeTimelineStateResponse, bool, error) {
	return store.StateService().Documents.GetEpisodeTimelineState(projectID, documentID)
}

// SaveEpisodeTimelineState persists episode timeline state.
func (store *WorkspaceStateService) SaveEpisodeTimelineState(projectID string, documentID string, request saveEpisodeTimelineStateRequest) (episodeTimelineStateResponse, error) {
	return store.StateService().Documents.SaveEpisodeTimelineState(projectID, documentID, request)
}

// RequireWorkspaceDocument returns one workspace document or a not-found error.
func (store *WorkspaceStateService) RequireWorkspaceDocument(projectID string, documentID string) (mediamcp.WorkspaceDocument, error) {
	return store.StateService().Documents.RequireWorkspaceDocument(projectID, documentID)
}

// RequireWorkspaceDocumentBlock returns one workspace document block or a not-found error.
func (store *WorkspaceStateService) RequireWorkspaceDocumentBlock(projectID string, documentID string, blockID string) (mediamcp.WorkspaceDocument, mediamcp.DocumentBlockNode, error) {
	return store.StateService().Documents.RequireWorkspaceDocumentBlock(projectID, documentID, blockID)
}

// CreateWorkspaceDocument creates a document in a project.
func (store *WorkspaceStateService) CreateWorkspaceDocument(projectID string, request createWorkspaceDocumentRequest) (mediamcp.WorkspaceDocument, workspaceDocumentsResponse, error) {
	return store.createDocument(projectID, request)
}

func (store *WorkspaceStateService) createDocument(projectID string, request createWorkspaceDocumentRequest) (mediamcp.WorkspaceDocument, workspaceDocumentsResponse, error) {
	return store.StateService().Documents.CreateWorkspaceDocument(projectID, request)
}

// CreateWorkspaceDocumentFromInput creates a document from MCP input.
func (store *WorkspaceStateService) CreateWorkspaceDocumentFromInput(projectID string, input servicedocument.CreateDocumentInput) (mediamcp.WorkspaceDocument, error) {
	return store.StateService().Documents.CreateWorkspaceDocumentFromInput(projectID, input)
}

// UpdateWorkspaceDocument updates a document in a project.
func (store *WorkspaceStateService) UpdateWorkspaceDocument(projectID string, documentID string, request updateWorkspaceDocumentRequest) (mediamcp.WorkspaceDocument, workspaceDocumentsResponse, error) {
	return store.updateDocument(projectID, documentID, request)
}

func (store *WorkspaceStateService) updateDocument(projectID string, documentID string, request updateWorkspaceDocumentRequest) (mediamcp.WorkspaceDocument, workspaceDocumentsResponse, error) {
	return store.StateService().Documents.UpdateWorkspaceDocument(projectID, documentID, request)
}

// ListDocumentHistory lists recent version-control entries for one document.
func (store *WorkspaceStateService) ListDocumentHistory(projectID string, documentID string, limit int) (documentHistoryResponse, error) {
	return store.StateService().Documents.ListDocumentHistory(projectID, documentID, limit)
}

// GetDocumentHistoryVersion returns one historical version of a document.
func (store *WorkspaceStateService) GetDocumentHistoryVersion(projectID string, documentID string, commitHash string) (documentHistoryVersionResponse, error) {
	return store.StateService().Documents.GetDocumentHistoryVersion(projectID, documentID, commitHash)
}

// GetDocumentHistoryDiff returns a line diff for one document version.
func (store *WorkspaceStateService) GetDocumentHistoryDiff(projectID string, documentID string, commitHash string, fromHash string) (documentHistoryDiffResponse, error) {
	return store.StateService().Documents.GetDocumentHistoryDiff(projectID, documentID, commitHash, fromHash)
}

// RestoreDocumentHistoryVersion restores a historical document version.
func (store *WorkspaceStateService) RestoreDocumentHistoryVersion(projectID string, documentID string, commitHash string) (documentHistoryRestoreResponse, error) {
	return store.StateService().Documents.RestoreDocumentHistoryVersion(projectID, documentID, commitHash)
}

// MoveWorkspaceDocument moves a document in the workspace tree.
func (store *WorkspaceStateService) MoveWorkspaceDocument(projectID string, documentID string, targetDocumentID string, position string, expectedVersion int) (mediamcp.WorkspaceDocument, workspaceDocumentsResponse, error) {
	return store.moveDocument(projectID, documentID, targetDocumentID, position, expectedVersion)
}

func (store *WorkspaceStateService) moveDocument(projectID string, documentID string, targetDocumentID string, position string, expectedVersion int) (mediamcp.WorkspaceDocument, workspaceDocumentsResponse, error) {
	return store.StateService().Documents.MoveWorkspaceDocument(projectID, documentID, targetDocumentID, position, expectedVersion)
}

// MoveWorkspaceDocumentWithSnapshot moves a document and returns before/after data.
func (store *WorkspaceStateService) MoveWorkspaceDocumentWithSnapshot(projectID string, input servicedocument.MoveDocumentInput, expectedVersion int) (workspaceDocumentMoveResult, error) {
	return store.StateService().Documents.MoveWorkspaceDocumentWithSnapshot(projectID, input, expectedVersion)
}

// DeleteWorkspaceDocument deletes a document.
func (store *WorkspaceStateService) DeleteWorkspaceDocument(projectID string, documentID string) (deleteWorkspaceDocumentResponse, error) {
	return store.StateService().Documents.DeleteWorkspaceDocument(projectID, documentID)
}

// DeleteWorkspaceDocumentWithExpectedVersion deletes a document with a version guard.
func (store *WorkspaceStateService) DeleteWorkspaceDocumentWithExpectedVersion(projectID string, documentID string, expectedVersion int) (deleteWorkspaceDocumentResponse, error) {
	return store.StateService().Documents.DeleteWorkspaceDocumentWithExpectedVersion(projectID, documentID, expectedVersion)
}

// DeleteWorkspaceDocumentAfterApproval waits for approval before deleting a document.
func (store *WorkspaceStateService) DeleteWorkspaceDocumentAfterApproval(ctx context.Context, projectID string, call servicedocument.DocumentToolApprovalRequest, expectedVersion int, interval time.Duration) (approvedDocumentDeleteResult, error) {
	return store.StateService().Documents.DeleteWorkspaceDocumentAfterApproval(ctx, projectID, call, expectedVersion, interval)
}

// AppendDocumentOperationLog appends one document operation record.
func (store *WorkspaceStateService) AppendDocumentOperationLog(projectID string, record documentOperationLogRecord) error {
	return store.appendDocumentOperationLog(projectID, record)
}

func (store *WorkspaceStateService) appendDocumentOperationLog(projectID string, record documentOperationLogRecord) error {
	return store.StateService().Documents.AppendDocumentOperationLog(projectID, record)
}

// ListPendingDocumentToolApprovals lists pending document tool approvals.
func (store *WorkspaceStateService) ListPendingDocumentToolApprovals(projectID string) ([]documentToolApprovalRecord, error) {
	return store.listPendingDocumentToolApprovals(projectID)
}

func (store *WorkspaceStateService) listPendingDocumentToolApprovals(projectID string) ([]documentToolApprovalRecord, error) {
	return store.StateService().Approvals.ListPendingDocumentToolApprovals(projectID)
}

// CreateDocumentToolApproval creates a pending document tool approval.
func (store *WorkspaceStateService) CreateDocumentToolApproval(projectID string, call servicedocument.DocumentToolApprovalRequest) (documentToolApprovalRecord, error) {
	return store.createDocumentToolApproval(projectID, call)
}

func (store *WorkspaceStateService) createDocumentToolApproval(projectID string, call servicedocument.DocumentToolApprovalRequest) (documentToolApprovalRecord, error) {
	return store.StateService().Approvals.CreateDocumentToolApproval(projectID, call)
}

// DecideDocumentToolApproval applies a document tool approval decision.
func (store *WorkspaceStateService) DecideDocumentToolApproval(projectID string, approvalID string, decision string, payload *servicedocument.DocumentToolApprovalDecisionPayload) (documentToolApprovalRecord, error) {
	return store.decideDocumentToolApproval(projectID, approvalID, decision, payload)
}

func (store *WorkspaceStateService) decideDocumentToolApproval(projectID string, approvalID string, decision string, payload *servicedocument.DocumentToolApprovalDecisionPayload) (documentToolApprovalRecord, error) {
	return store.StateService().Approvals.DecideDocumentToolApproval(projectID, approvalID, decision, payload)
}

// WaitForDocumentToolApproval waits for a document tool approval decision.
func (store *WorkspaceStateService) WaitForDocumentToolApproval(ctx context.Context, projectID string, approvalID string, interval time.Duration) (documentToolApprovalRecord, error) {
	return store.waitForDocumentToolApproval(ctx, projectID, approvalID, interval)
}

func (store *WorkspaceStateService) waitForDocumentToolApproval(ctx context.Context, projectID string, approvalID string, interval time.Duration) (documentToolApprovalRecord, error) {
	return store.StateService().Approvals.WaitForDocumentToolApproval(ctx, projectID, approvalID, interval)
}

// GetDocumentEditStream returns one in-progress document edit stream.
func (store *WorkspaceStateService) GetDocumentEditStream(projectID string, streamID string) (documentEditStreamRecord, bool, error) {
	return store.getDocumentEditStream(projectID, streamID)
}

func (store *WorkspaceStateService) getDocumentEditStream(projectID string, streamID string) (documentEditStreamRecord, bool, error) {
	return store.StateService().Documents.GetDocumentEditStream(projectID, streamID)
}

// SaveDocumentEditStream persists an in-progress document edit stream.
func (store *WorkspaceStateService) SaveDocumentEditStream(record documentEditStreamRecord) (documentEditStreamRecord, error) {
	return store.saveDocumentEditStream(record)
}

func (store *WorkspaceStateService) saveDocumentEditStream(record documentEditStreamRecord) (documentEditStreamRecord, error) {
	return store.StateService().Documents.SaveDocumentEditStream(record)
}

// SetWorkspaceDocumentTitle updates a document title.
func (store *WorkspaceStateService) SetWorkspaceDocumentTitle(projectID string, input servicedocument.SetDocumentTitleInput, expectedVersion int) (workspaceDocumentMetadataMutationResult, error) {
	return store.StateService().Documents.SetWorkspaceDocumentTitle(projectID, input, expectedVersion)
}

// SetWorkspaceDocumentCategory updates a document category.
func (store *WorkspaceStateService) SetWorkspaceDocumentCategory(projectID string, input servicedocument.SetDocumentCategoryInput, expectedVersion int) (workspaceDocumentMetadataMutationResult, error) {
	return store.StateService().Documents.SetWorkspaceDocumentCategory(projectID, input, expectedVersion)
}

// SetWorkspaceDocumentParent updates a document parent.
func (store *WorkspaceStateService) SetWorkspaceDocumentParent(projectID string, input servicedocument.SetDocumentParentInput, expectedVersion int) (workspaceDocumentMetadataMutationResult, error) {
	return store.StateService().Documents.SetWorkspaceDocumentParent(projectID, input, expectedVersion)
}

// SetWorkspaceDocumentTags updates document tags.
func (store *WorkspaceStateService) SetWorkspaceDocumentTags(projectID string, input servicedocument.SetDocumentTagsInput, expectedVersion int) (workspaceDocumentMetadataMutationResult, error) {
	return store.StateService().Documents.SetWorkspaceDocumentTags(projectID, input, expectedVersion)
}

// InsertWorkspaceDocumentBlock inserts one document block.
func (store *WorkspaceStateService) InsertWorkspaceDocumentBlock(projectID string, input servicedocument.InsertBlockInput, expectedVersion int) (workspaceDocumentContentMutationResult, error) {
	return store.StateService().Documents.InsertWorkspaceDocumentBlock(projectID, input, expectedVersion)
}

// UpdateWorkspaceDocumentBlock updates one document block.
func (store *WorkspaceStateService) UpdateWorkspaceDocumentBlock(projectID string, input servicedocument.UpdateBlockInput, expectedVersion int) (workspaceDocumentContentMutationResult, error) {
	return store.StateService().Documents.UpdateWorkspaceDocumentBlock(projectID, input, expectedVersion)
}

// PatchWorkspaceDocumentBlockAttrs patches one document block's attributes.
func (store *WorkspaceStateService) PatchWorkspaceDocumentBlockAttrs(projectID string, input servicedocument.PatchBlockAttrsInput, expectedVersion int) (workspaceDocumentContentMutationResult, error) {
	return store.StateService().Documents.PatchWorkspaceDocumentBlockAttrs(projectID, input, expectedVersion)
}

// DeleteWorkspaceDocumentBlock deletes one document block.
func (store *WorkspaceStateService) DeleteWorkspaceDocumentBlock(projectID string, input servicedocument.DeleteBlockInput, expectedVersion int) (workspaceDocumentContentMutationResult, error) {
	return store.StateService().Documents.DeleteWorkspaceDocumentBlock(projectID, input, expectedVersion)
}

// MoveWorkspaceDocumentBlock moves one document block.
func (store *WorkspaceStateService) MoveWorkspaceDocumentBlock(projectID string, input servicedocument.MoveBlockInput, expectedVersion int) ([]workspaceDocumentContentMutationResult, error) {
	return store.StateService().Documents.MoveWorkspaceDocumentBlock(projectID, input, expectedVersion)
}

// ReplaceWorkspaceDocumentSection replaces one document section.
func (store *WorkspaceStateService) ReplaceWorkspaceDocumentSection(projectID string, input servicedocument.ReplaceSectionInput, expectedVersion int) (workspaceDocumentContentMutationResult, error) {
	return store.StateService().Documents.ReplaceWorkspaceDocumentSection(projectID, input, expectedVersion)
}

// ReorderWorkspaceDocumentSections reorders sibling document sections.
func (store *WorkspaceStateService) ReorderWorkspaceDocumentSections(projectID string, input servicedocument.ReorderSectionsInput, expectedVersion int) (workspaceDocumentContentMutationResult, error) {
	return store.StateService().Documents.ReorderWorkspaceDocumentSections(projectID, input, expectedVersion)
}

// ReplaceWorkspaceDocumentSelection replaces a document text selection.
func (store *WorkspaceStateService) ReplaceWorkspaceDocumentSelection(projectID string, input servicedocument.ReplaceSelectionInput, expectedVersion int) (workspaceDocumentContentMutationResult, error) {
	return store.StateService().Documents.ReplaceWorkspaceDocumentSelection(projectID, input, expectedVersion)
}

// AnnotateWorkspaceDocumentSelection toggles or applies a mark to a text selection.
func (store *WorkspaceStateService) AnnotateWorkspaceDocumentSelection(projectID string, input servicedocument.AnnotateSelectionInput, expectedVersion int) (workspaceDocumentContentMutationResult, error) {
	return store.StateService().Documents.AnnotateWorkspaceDocumentSelection(projectID, input, expectedVersion)
}

// InsertWorkspaceDocumentInline inserts inline content into a document.
func (store *WorkspaceStateService) InsertWorkspaceDocumentInline(projectID string, input servicedocument.InsertInlineInput, expectedVersion int) (workspaceDocumentContentMutationResult, error) {
	return store.StateService().Documents.InsertWorkspaceDocumentInline(projectID, input, expectedVersion)
}

// BatchWorkspaceDocumentEdit applies several same-document edits as one version.
func (store *WorkspaceStateService) BatchWorkspaceDocumentEdit(projectID string, input servicedocument.BatchDocumentEditInput, expectedVersion int) ([]workspaceDocumentContentMutationResult, error) {
	return store.StateService().Documents.BatchWorkspaceDocumentEdit(projectID, input, expectedVersion)
}

// PatchWorkspaceDocumentContent applies text patches to a document.
func (store *WorkspaceStateService) PatchWorkspaceDocumentContent(projectID string, input servicedocument.DocumentPatchEditInput, expectedVersion int) (workspaceDocumentContentMutationResult, error) {
	return store.StateService().Documents.PatchWorkspaceDocumentContent(projectID, input, expectedVersion)
}

// PrepareDocumentEditStream starts or resumes a streamed document edit.
func (store *WorkspaceStateService) PrepareDocumentEditStream(runtime streamDocumentEditRuntime, input streamDocumentEditInput) (preparedDocumentEditStream, error) {
	return store.StateService().Documents.PrepareDocumentEditStream(runtime, input)
}

// ApplyDocumentEditStreamChunk applies a streamed document edit chunk.
func (store *WorkspaceStateService) ApplyDocumentEditStreamChunk(projectID string, record documentEditStreamRecord, input streamDocumentEditInput) (documentEditStreamRecord, mediamcp.WorkspaceDocument, error) {
	return store.StateService().Documents.ApplyDocumentEditStreamChunk(projectID, record, input)
}

// FinalizeDocumentEditStream completes a streamed document edit.
func (store *WorkspaceStateService) FinalizeDocumentEditStream(record documentEditStreamRecord) (documentEditStreamRecord, error) {
	return store.StateService().Documents.FinalizeDocumentEditStream(record)
}

// FindWorkspaceDocumentComment finds a comment and its document.
func (store *WorkspaceStateService) FindWorkspaceDocumentComment(projectID string, commentID string) (mediamcp.WorkspaceDocument, mediamcp.DocumentComment, error) {
	return store.StateService().Documents.FindWorkspaceDocumentComment(projectID, commentID)
}

// UpdateWorkspaceDocumentComments replaces a document's comments.
func (store *WorkspaceStateService) UpdateWorkspaceDocumentComments(projectID string, document mediamcp.WorkspaceDocument, comments []mediamcp.DocumentComment, focusCommentID string) (mediamcp.WorkspaceDocument, mediamcp.DocumentCommentThread, error) {
	return store.StateService().Documents.UpdateWorkspaceDocumentComments(projectID, document, comments, focusCommentID)
}

// LoadProjectBrief loads a project's creative brief.
func (store *WorkspaceStateService) LoadProjectBrief(projectID string) (projectBrief, error) {
	return store.StateService().Documents.LoadProjectBrief(projectID)
}

// SaveProjectBrief saves a project's creative brief.
func (store *WorkspaceStateService) SaveProjectBrief(projectID string, brief projectBrief, mask projectBriefUpdateMask) (projectBrief, error) {
	return store.StateService().Documents.SaveProjectBrief(projectID, brief, mask)
}

// SaveProjectBriefPatchInput applies a protocol project brief patch.
func (store *WorkspaceStateService) SaveProjectBriefPatchInput(projectID string, input mediamcp.ProjectBriefPatchInput) (projectBriefMutationResult, error) {
	return store.StateService().Documents.SaveProjectBriefPatchInput(projectID, input)
}

// LoadProjectConfig loads project.media.json for a project.
func (store *WorkspaceStateService) LoadProjectConfig(projectID string) (mediamcp.ProjectConfig, error) {
	return store.StateService().Documents.LoadProjectConfig(projectID)
}

// SaveProjectConfigPatchInput applies a sparse project.media.json patch.
func (store *WorkspaceStateService) SaveProjectConfigPatchInput(projectID string, input mediamcp.ProjectConfigPatchInput) (servicedocument.ProjectConfigMutationResult, error) {
	return store.StateService().Documents.SaveProjectConfigPatchInput(projectID, input)
}
