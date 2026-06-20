package document

import (
	"fmt"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/documenthistory"
)

type DocumentHistoryItem = documenthistory.HistoryItem
type DocumentHistoryVersion = documenthistory.DocumentVersion
type DocumentHistoryDiff = documenthistory.DocumentDiff
type DocumentHistoryDiffLine = documenthistory.DiffLine

// DocumentHistoryResponse is returned by the document history list endpoint.
type DocumentHistoryResponse struct {
	ProjectID  string                `json:"projectId"`
	DocumentID string                `json:"documentId"`
	Items      []DocumentHistoryItem `json:"items"`
}

// DocumentHistoryVersionResponse is returned for one historical document version.
type DocumentHistoryVersionResponse struct {
	ProjectID  string                 `json:"projectId"`
	DocumentID string                 `json:"documentId"`
	Version    DocumentHistoryVersion `json:"version"`
}

// DocumentHistoryDiffResponse is returned for a historical document diff.
type DocumentHistoryDiffResponse struct {
	ProjectID  string              `json:"projectId"`
	DocumentID string              `json:"documentId"`
	Diff       DocumentHistoryDiff `json:"diff"`
}

// DocumentHistoryRestoreResponse is returned after restoring a historical document version.
type DocumentHistoryRestoreResponse struct {
	Document mediamcp.WorkspaceDocument `json:"document"`
	State    WorkspaceDocumentsResponse `json:"state"`
}

// ListDocumentHistory returns recent history entries for one document.
func (store *Service) ListDocumentHistory(projectID string, documentID string, limit int) (DocumentHistoryResponse, error) {
	projectID, projectDir, workDir, err := store.documentHistoryContext(projectID)
	if err != nil {
		return DocumentHistoryResponse{}, err
	}
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return DocumentHistoryResponse{}, repository.ErrRecordNotFound
	}
	if _, err := store.RequireWorkspaceDocument(projectID, documentID); err != nil {
		return DocumentHistoryResponse{}, err
	}
	items, err := store.history.ListDocumentHistory(projectDir, workDir, documentID, limit)
	if err != nil {
		return DocumentHistoryResponse{}, err
	}
	return DocumentHistoryResponse{
		ProjectID:  projectID,
		DocumentID: documentID,
		Items:      items,
	}, nil
}

// GetDocumentHistoryVersion returns one historical version of a document.
func (store *Service) GetDocumentHistoryVersion(projectID string, documentID string, commitHash string) (DocumentHistoryVersionResponse, error) {
	projectID, projectDir, workDir, err := store.documentHistoryContext(projectID)
	if err != nil {
		return DocumentHistoryVersionResponse{}, err
	}
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return DocumentHistoryVersionResponse{}, repository.ErrRecordNotFound
	}
	if _, err := store.RequireWorkspaceDocument(projectID, documentID); err != nil {
		return DocumentHistoryVersionResponse{}, err
	}
	version, ok, err := store.history.GetDocumentVersion(projectDir, workDir, documentID, commitHash)
	if err != nil {
		return DocumentHistoryVersionResponse{}, err
	}
	if !ok {
		return DocumentHistoryVersionResponse{}, repository.ErrRecordNotFound
	}
	return DocumentHistoryVersionResponse{
		ProjectID:  projectID,
		DocumentID: documentID,
		Version:    version,
	}, nil
}

// GetDocumentHistoryDiff returns the line diff for one historical document version.
func (store *Service) GetDocumentHistoryDiff(projectID string, documentID string, commitHash string, fromHash string) (DocumentHistoryDiffResponse, error) {
	projectID, projectDir, workDir, err := store.documentHistoryContext(projectID)
	if err != nil {
		return DocumentHistoryDiffResponse{}, err
	}
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return DocumentHistoryDiffResponse{}, repository.ErrRecordNotFound
	}
	if _, err := store.RequireWorkspaceDocument(projectID, documentID); err != nil {
		return DocumentHistoryDiffResponse{}, err
	}
	diff, ok, err := store.history.DiffDocumentVersion(projectDir, workDir, documentID, commitHash, fromHash)
	if err != nil {
		return DocumentHistoryDiffResponse{}, err
	}
	if !ok {
		return DocumentHistoryDiffResponse{}, repository.ErrRecordNotFound
	}
	return DocumentHistoryDiffResponse{
		ProjectID:  projectID,
		DocumentID: documentID,
		Diff:       diff,
	}, nil
}

// RestoreDocumentHistoryVersion restores one historical document version and records the restore as a new commit.
func (store *Service) RestoreDocumentHistoryVersion(projectID string, documentID string, commitHash string) (DocumentHistoryRestoreResponse, error) {
	version, err := store.GetDocumentHistoryVersion(projectID, documentID, commitHash)
	if err != nil {
		return DocumentHistoryRestoreResponse{}, err
	}
	clean := false
	title := strings.TrimSpace(version.Version.Title)
	content := version.Version.Content
	request := UpdateWorkspaceDocumentRequest{
		Content: &content,
		IsDirty: &clean,
	}
	if title != "" {
		request.Title = &title
	}
	if category := NormalizeDocumentCategoryValue(version.Version.Category); category != "" && ValidateDocumentCategory(category) == nil {
		request.Category = &category
	}
	if version.Version.Tags != nil {
		tags := NormalizeDocumentTags(version.Version.Tags)
		request.Tags = &tags
	}
	document, state, err := store.UpdateWorkspaceDocument(version.ProjectID, version.DocumentID, request)
	if err != nil {
		return DocumentHistoryRestoreResponse{}, err
	}
	return DocumentHistoryRestoreResponse{
		Document: document,
		State:    state,
	}, nil
}

func (store *Service) documentHistoryContext(projectID string) (string, string, string, error) {
	if store == nil {
		return "", "", "", fmt.Errorf("document service is nil")
	}
	if store.initErr != nil {
		return "", "", "", store.initErr
	}
	if store.history == nil {
		return "", "", "", fmt.Errorf("document history service is not configured")
	}
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return "", "", "", repository.ErrRecordNotFound
	}
	projectDir := store.projectDir(projectID)
	workDir := store.documentsDir(projectID)
	if projectDir == "" || workDir == "" {
		return "", "", "", repository.ErrRecordNotFound
	}
	return projectID, projectDir, workDir, nil
}
