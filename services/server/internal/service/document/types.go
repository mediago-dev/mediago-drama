package document

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/documenthistory"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/model"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

type DocumentSnapshotRecord = model.DocumentSnapshotRecord
type DocumentOperationLogRecord = model.DocumentOperationLogRecord
type WorkspaceStateResponse = model.WorkspaceStateResponse
type WorkspaceStateRequest = model.WorkspaceStateRequest
type WorkspaceDocumentsResponse = model.WorkspaceDocumentsResponse
type WorkspaceDocumentResourcesResponse = model.WorkspaceDocumentResourcesResponse
type WorkspaceDocumentResourceRecord = model.WorkspaceDocumentResourceRecord
type DocumentFoldersResponse = model.DocumentFoldersResponse
type EpisodeTimelineStateResponse = model.EpisodeTimelineStateResponse
type EpisodeTimelineResolvedResponse = model.EpisodeTimelineResolvedResponse
type SaveEpisodeTimelineStateRequest = model.SaveEpisodeTimelineStateRequest
type CreateWorkspaceDocumentRequest = model.CreateWorkspaceDocumentRequest
type UpdateWorkspaceDocumentRequest = model.UpdateWorkspaceDocumentRequest
type WorkspaceSectionMedia = model.WorkspaceSectionMedia
type WorkspaceDocumentSectionMentionRequest = model.WorkspaceDocumentSectionMentionRequest
type WorkspaceSectionMentionReference = model.WorkspaceSectionMentionReference
type DeleteWorkspaceDocumentResponse = model.DeleteWorkspaceDocumentResponse
type CreateDocumentFolderRequest = model.CreateDocumentFolderRequest
type UpdateDocumentFolderRequest = model.UpdateDocumentFolderRequest
type DocumentFolderMutationResponse = model.DocumentFolderMutationResponse
type DeleteDocumentFolderResponse = model.DeleteDocumentFolderResponse
type DocumentToolApprovalRecord = model.DocumentToolApprovalRecord
type DocumentToolApprovalRequest = model.DocumentToolApprovalRequest
type DocumentToolApprovalDecisionRequest = model.DocumentToolApprovalDecisionRequest
type DocumentToolApprovalDecisionPayload = model.DocumentToolApprovalDecisionPayload
type DocumentToolApprovalConfig = model.DocumentToolApprovalConfig
type WorkspaceVersionConflictError = model.WorkspaceVersionConflictError
type CreateWorkspaceProjectRequest = model.CreateWorkspaceProjectRequest
type ProjectBrief = model.ProjectBrief
type ProjectBriefUpdateMask = model.ProjectBriefUpdateMask
type ProjectBriefPatch = model.ProjectBriefPatch
type ProjectBriefMutationResult = model.ProjectBriefMutationResult
type ProjectConfigMutationResult = model.ProjectConfigMutationResult

type AgentDocumentContext = agent.AgentDocumentContext
type AgentDocumentEditSnapshot = agent.AgentDocumentEditSnapshot
type AgentDocumentEditDelta = agent.AgentDocumentEditDelta
type DocumentEditEventContext = agent.DocumentEditEventContext
type AgentEvent = agent.AgentEvent

type workspaceDocumentMetadataResponse = mediamcp.ListDocumentsOutput
type workspaceProjectsResponse = mediamcp.ProjectList
type workspaceProjectRecord = mediamcp.Project
type workspaceProjectModel = domain.WorkspaceProjectModel
type createWorkspaceProjectRequest = model.CreateWorkspaceProjectRequest
type documentOperationLogRecord = model.DocumentOperationLogRecord
type workspaceStateResponse = model.WorkspaceStateResponse
type workspaceStateRequest = model.WorkspaceStateRequest
type workspaceDocumentsResponse = model.WorkspaceDocumentsResponse
type workspaceDocumentResourcesResponse = model.WorkspaceDocumentResourcesResponse
type workspaceDocumentResourceRecord = model.WorkspaceDocumentResourceRecord
type documentFoldersResponse = model.DocumentFoldersResponse
type episodeTimelineStateResponse = model.EpisodeTimelineStateResponse
type episodeTimelineResolvedResponse = model.EpisodeTimelineResolvedResponse
type saveEpisodeTimelineStateRequest = model.SaveEpisodeTimelineStateRequest
type createWorkspaceDocumentRequest = model.CreateWorkspaceDocumentRequest
type updateWorkspaceDocumentRequest = model.UpdateWorkspaceDocumentRequest
type workspaceSectionMedia = model.WorkspaceSectionMedia
type workspaceDocumentSectionMentionRequest = model.WorkspaceDocumentSectionMentionRequest
type workspaceSectionMentionReference = model.WorkspaceSectionMentionReference
type deleteWorkspaceDocumentResponse = model.DeleteWorkspaceDocumentResponse
type createDocumentFolderRequest = model.CreateDocumentFolderRequest
type updateDocumentFolderRequest = model.UpdateDocumentFolderRequest
type documentFolderMutationResponse = model.DocumentFolderMutationResponse
type deleteDocumentFolderResponse = model.DeleteDocumentFolderResponse
type documentToolApprovalRecord = model.DocumentToolApprovalRecord
type documentToolApprovalRequest = model.DocumentToolApprovalRequest
type documentEditStreamRecord = DocumentEditStreamRecord
type workspaceVersionConflictError = model.WorkspaceVersionConflictError

const OverviewDocumentID = model.OverviewDocumentID

var (
	IsWorkspaceVersionConflict              = model.IsWorkspaceVersionConflict
	ValidateDocumentCategory                = model.ValidateDocumentCategory
	ValidateRequiredDocumentCategory        = model.ValidateRequiredDocumentCategory
	ProjectBriefPatchToUpdate               = model.ProjectBriefPatchToUpdate
	DecodeProjectBriefJSON                  = model.DecodeProjectBriefJSON
	EncodeProjectBriefJSON                  = model.EncodeProjectBriefJSON
	NowProjectBriefTimestamp                = model.NowProjectBriefTimestamp
	IsOverviewDocumentID                    = model.IsOverviewDocumentID
	DefaultProjectOverviewMarkdown          = model.DefaultProjectOverviewMarkdown
	ProjectBriefOverviewMarkdown            = model.ProjectBriefOverviewMarkdown
	RenderOverviewProjectBriefPrompt        = model.RenderOverviewProjectBriefPrompt
	ExtractOverviewProjectBriefSection      = model.ExtractOverviewProjectBriefSection
	ReplaceOverviewProjectBriefSection      = model.ReplaceOverviewProjectBriefSection
	NormalizeProjectRecords                 = model.NormalizeProjectRecords
	WorkspaceProjectRecordsFromModels       = model.WorkspaceProjectRecordsFromModels
	NormalizeWorkspaceDocuments             = model.NormalizeWorkspaceDocuments
	NormalizeDocumentCategoryValue          = model.NormalizeDocumentCategoryValue
	NormalizeDocumentFolders                = model.NormalizeDocumentFolders
	NormalizeWorkbenchDraftRecord           = model.NormalizeWorkbenchDraftRecord
	NormalizedDocumentVersion               = model.NormalizedDocumentVersion
	UniqueWorkspaceDocumentID               = model.UniqueWorkspaceDocumentID
	WorkspaceDocumentIDExists               = model.WorkspaceDocumentIDExists
	FindWorkspaceDocumentByID               = model.FindWorkspaceDocumentByID
	FindWorkspaceDocumentIndexByID          = model.FindWorkspaceDocumentIndexByID
	WorkspaceDocumentVersionConflictMessage = model.WorkspaceDocumentVersionConflictMessage
	FindWorkspaceComment                    = model.FindWorkspaceComment
	WorkspaceDocumentsContainID             = model.WorkspaceDocumentsContainID
	CountRegularWorkspaceDocuments          = model.CountRegularWorkspaceDocuments
	RegularWorkspaceDocuments               = model.RegularWorkspaceDocuments
	WorkspaceDocumentsFromState             = model.WorkspaceDocumentsFromState
	ValidWorkspaceParentID                  = model.ValidWorkspaceParentID
	NextWorkspaceSortOrder                  = model.NextWorkspaceSortOrder
	MoveWorkspaceDocumentInTree             = model.MoveWorkspaceDocumentInTree
	CollectWorkspaceDocumentDescendantIDs   = model.CollectWorkspaceDocumentDescendantIDs
	NormalizeCommentRecords                 = model.NormalizeCommentRecords
	NormalizeCommentRecordsForDocument      = model.NormalizeCommentRecordsForDocument
	NormalizeDocumentTags                   = model.NormalizeDocumentTags
	BlankWorkspaceDocumentsForProject       = model.BlankWorkspaceDocumentsForProject
	MakeTextAnchor                          = model.MakeTextAnchor
	FallbackProjectName                     = model.FallbackProjectName
	DocumentOperationLogRecordsFromModels   = model.DocumentOperationLogRecordsFromModels
	DocumentOperationLogModelsFromRecords   = model.DocumentOperationLogModelsFromRecords
	SnapshotDocument                        = agent.SnapshotDocument
	EmptyDocumentEditSnapshot               = agent.EmptyDocumentEditSnapshot
	SameDocumentEditSnapshot                = agent.SameDocumentEditSnapshot
	DocumentSnapshotFromEditSnapshot        = agent.DocumentSnapshotFromEditSnapshot
	BuildDocumentEditEvent                  = agent.BuildDocumentEditEvent
	BuildDocumentEditFailedEvent            = agent.BuildDocumentEditFailedEvent
	NewDocumentEditOperationLogRecord       = agent.NewDocumentEditOperationLogRecord
	AgentOperationSource                    = agent.AgentOperationSource
	MustRandomID                            = shared.MustRandomID
	mustRandomID                            = shared.MustRandomID
	FirstNonEmpty                           = shared.FirstNonEmpty
	firstNonEmpty                           = shared.FirstNonEmpty
	CleanRelativeFilename                   = shared.CleanRelativeFilename
)

// ApprovalGate is the approval-facing surface consumed by document workflows.
type ApprovalGate interface {
	CreateDocumentToolApproval(projectID string, call model.DocumentToolApprovalRequest) (model.DocumentToolApprovalRecord, error)
	WaitForDocumentToolApproval(ctx context.Context, projectID string, approvalID string, interval time.Duration) (model.DocumentToolApprovalRecord, error)
}

// Service owns project and document state.
type Service struct {
	mu        sync.RWMutex
	dir       string
	workspace *repository.WorkspaceRepository
	sections  *repository.DocumentSectionRepository
	approvals ApprovalGate
	streams   *EditStreamService
	history   *documenthistory.Service
	initErr   error
}

// NewService returns a document service backed by a workspace repository.
func NewService(workspaceDir string, repo *repository.WorkspaceRepository, approvals ApprovalGate, initErr error, sectionRepos ...*repository.DocumentSectionRepository) *Service {
	store := &Service{
		dir:       shared.ResolveWorkspaceDir(workspaceDir),
		workspace: repo,
		approvals: approvals,
		history:   documenthistory.NewService(),
		initErr:   initErr,
	}
	if len(sectionRepos) > 0 {
		store.sections = sectionRepos[0]
	}
	if store.initErr == nil && store.workspace == nil {
		store.initErr = fmt.Errorf("workspace repository is nil")
	}
	return store
}

// SetDocumentSectionRepository replaces the section metadata dependency.
func (store *Service) SetDocumentSectionRepository(repo *repository.DocumentSectionRepository) {
	if store != nil {
		store.sections = repo
	}
}

// SetDocumentHistoryService replaces the document history dependency.
func (store *Service) SetDocumentHistoryService(history *documenthistory.Service) {
	if store != nil {
		store.history = history
	}
}

// SetApprovalGate sets the approval dependency after services are constructed.
func (store *Service) SetApprovalGate(approvals ApprovalGate) {
	if store != nil {
		store.approvals = approvals
	}
}

// SetEditStreamService sets the edit stream dependency after construction.
func (store *Service) SetEditStreamService(streams *EditStreamService) {
	if store != nil {
		store.streams = streams
	}
}

// Dir returns the workspace root.
func (store *Service) Dir() string {
	if store == nil {
		return ""
	}
	return store.dir
}

// InitErr returns initialization failure, if any.
func (store *Service) InitErr() error {
	if store == nil {
		return fmt.Errorf("document service is nil")
	}
	return store.initErr
}

func (store *Service) ensureProjectLayout(project workspaceProjectRecord) error {
	return shared.EnsureProjectLayout(store.dir, project)
}

func (store *Service) databasePath() string {
	return shared.WorkspacePathsFor(store.dir).DatabasePath()
}

func (store *Service) projectDir(projectID string) string {
	projectID = domain.CleanProjectID(projectID)
	paths := shared.WorkspacePathsFor(store.dir)
	if projectID == "" {
		return paths.Root
	}
	if store.workspace == nil {
		return ""
	}
	model, err := store.workspace.GetProject(projectID)
	if err == nil && strings.TrimSpace(model.ProjectDir) != "" {
		return shared.ResolveWorkspaceDir(model.ProjectDir)
	}
	return ""
}

// ProjectDir returns the external directory for a project record.
func (store *Service) ProjectDir(projectID string) (string, error) {
	if store.initErr != nil {
		return "", store.initErr
	}
	store.mu.RLock()
	defer store.mu.RUnlock()
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return shared.WorkspacePathsFor(store.dir).Root, nil
	}
	projectDir := store.projectDir(projectID)
	if projectDir == "" {
		return "", fmt.Errorf("project %s is not registered with projectDir", projectID)
	}
	return projectDir, nil
}

func (store *Service) metadataDir(projectID string) string {
	if domain.CleanProjectID(projectID) == "" {
		return shared.WorkspacePathsFor(store.dir).GlobalMetadataDir()
	}
	projectDir := store.projectDir(projectID)
	if projectDir == "" {
		return ""
	}
	return shared.ProjectMetadataDir(projectDir)
}

func (store *Service) documentsDir(projectID string) string {
	projectDir := store.projectDir(projectID)
	if projectDir == "" {
		return ""
	}
	return filepath.Join(projectDir, "work")
}

// EnsureProjectRecord ensures a project metadata record exists.
func (store *Service) EnsureProjectRecord(projectID string) error {
	if store.initErr != nil {
		return store.initErr
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.ensureProjectRecordUnlocked(projectID)
}

// CreateDocumentToolApproval creates a pending document tool approval.
func (store *Service) CreateDocumentToolApproval(projectID string, call model.DocumentToolApprovalRequest) (model.DocumentToolApprovalRecord, error) {
	if store == nil || store.approvals == nil {
		return model.DocumentToolApprovalRecord{}, fmt.Errorf("document tool approval store is not configured")
	}
	return store.approvals.CreateDocumentToolApproval(projectID, call)
}

// WaitForDocumentToolApproval waits for a document tool approval decision.
func (store *Service) WaitForDocumentToolApproval(ctx context.Context, projectID string, approvalID string, interval time.Duration) (model.DocumentToolApprovalRecord, error) {
	if store == nil || store.approvals == nil {
		return model.DocumentToolApprovalRecord{}, fmt.Errorf("document tool approval store is not configured")
	}
	return store.approvals.WaitForDocumentToolApproval(ctx, projectID, approvalID, interval)
}

// GetDocumentEditStream returns one edit stream.
func (store *Service) GetDocumentEditStream(projectID string, streamID string) (DocumentEditStreamRecord, bool, error) {
	if store == nil || store.streams == nil {
		return DocumentEditStreamRecord{}, false, fmt.Errorf("document edit stream service is not configured")
	}
	return store.streams.GetDocumentEditStream(projectID, streamID)
}

// SaveDocumentEditStream saves one edit stream.
func (store *Service) SaveDocumentEditStream(record DocumentEditStreamRecord) (DocumentEditStreamRecord, error) {
	if store == nil || store.streams == nil {
		return record, fmt.Errorf("document edit stream service is not configured")
	}
	return store.streams.SaveDocumentEditStream(record)
}

// EditStreamService persists in-progress streamed document edits.
type EditStreamService struct {
	mu      sync.RWMutex
	repo    *repository.DocumentEditStreamRepository
	initErr error
}

// NewEditStreamService returns an edit stream service backed by a repository.
func NewEditStreamService(repo *repository.DocumentEditStreamRepository, initErr error) *EditStreamService {
	store := &EditStreamService{repo: repo, initErr: initErr}
	if store.initErr == nil && store.repo == nil {
		store.initErr = fmt.Errorf("document edit stream repository is nil")
	}
	return store
}
