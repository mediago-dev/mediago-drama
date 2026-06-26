package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

// DocumentSnapshotRecord captures a document before or after an operation.
type DocumentSnapshotRecord struct {
	Title    string                     `json:"title"`
	Content  string                     `json:"content"`
	Comments []mediamcp.DocumentComment `json:"comments"`
}

// DocumentOperationLogRecord records a document mutation.
type DocumentOperationLogRecord struct {
	ID         string                 `json:"id"`
	DocumentID string                 `json:"documentId"`
	Operations []map[string]any       `json:"operations"`
	Summary    string                 `json:"summary"`
	Source     string                 `json:"source"`
	CreatedAt  string                 `json:"createdAt"`
	Before     DocumentSnapshotRecord `json:"before"`
	After      DocumentSnapshotRecord `json:"after"`
	UndoneAt   string                 `json:"undoneAt,omitempty"`
}

// WorkspaceStateResponse is the full workspace state payload.
type WorkspaceStateResponse struct {
	WorkspaceDir string                       `json:"workspaceDir"`
	ProjectID    string                       `json:"projectId,omitempty"`
	Documents    []mediamcp.WorkspaceDocument `json:"documents"`
	Folders      []mediamcp.DocumentFolder    `json:"folders,omitempty"`
	Assets       []ProjectAssetRecord         `json:"assets,omitempty"`
	OperationLog []DocumentOperationLogRecord `json:"operationLog"`
}

// WorkspaceStateRequest replaces workspace documents and operation history.
type WorkspaceStateRequest struct {
	Documents    []mediamcp.WorkspaceDocument `json:"documents"`
	OperationLog []DocumentOperationLogRecord `json:"operationLog"`
}

// WorkspaceDocumentsResponse is the document list payload for a workspace project.
type WorkspaceDocumentsResponse struct {
	WorkspaceDir string                       `json:"workspaceDir"`
	ProjectID    string                       `json:"projectId,omitempty"`
	Documents    []mediamcp.WorkspaceDocument `json:"documents"`
	Folders      []mediamcp.DocumentFolder    `json:"folders,omitempty"`
	Assets       []ProjectAssetRecord         `json:"assets,omitempty"`
}

// WorkspaceDocumentResourcesResponse is the parsed document resource payload.
type WorkspaceDocumentResourcesResponse struct {
	ProjectID string                            `json:"projectId,omitempty"`
	Resources []WorkspaceDocumentResourceRecord `json:"resources"`
}

// WorkspaceDocumentResourceRecord describes one resource parsed from a document section.
type WorkspaceDocumentResourceRecord struct {
	ID                string `json:"id"`
	Type              string `json:"type"`
	Title             string `json:"title"`
	Summary           string `json:"summary,omitempty"`
	Prompt            string `json:"prompt,omitempty"`
	DocumentID        string `json:"documentId"`
	DocumentTitle     string `json:"documentTitle"`
	SectionID         string `json:"sectionId"`
	BlockID           string `json:"blockId"`
	HeadingLevel      int    `json:"headingLevel"`
	HeadingOccurrence int    `json:"headingOccurrence"`
	Markdown          string `json:"markdown"`
	PlainText         string `json:"plainText,omitempty"`
	CanGenerate       bool   `json:"canGenerate"`
	SourceCategory    string `json:"sourceCategory"`
}

// EpisodeTimelineStateResponse is the persisted editing timeline for a document.
type EpisodeTimelineStateResponse struct {
	WorkspaceDir string          `json:"workspaceDir"`
	ProjectID    string          `json:"projectId,omitempty"`
	DocumentID   string          `json:"documentId"`
	Episode      json.RawMessage `json:"episode"`
	CreatedAt    string          `json:"createdAt"`
	UpdatedAt    string          `json:"updatedAt"`
}

// SaveEpisodeTimelineStateRequest saves an editing timeline for a document.
type SaveEpisodeTimelineStateRequest struct {
	Episode json.RawMessage `json:"episode"`
}

// CreateWorkspaceDocumentRequest creates a workspace document.
type CreateWorkspaceDocumentRequest struct {
	ID             string                           `json:"id,omitempty"`
	Title          string                           `json:"title"`
	Content        string                           `json:"content,omitempty"`
	Category       string                           `json:"category,omitempty"`
	ParentID       *string                          `json:"parentId,omitempty"`
	FolderID       *string                          `json:"folderId,omitempty"`
	SortOrder      *int                             `json:"sortOrder,omitempty"`
	Tags           []string                         `json:"tags,omitempty"`
	Comments       []mediamcp.DocumentComment       `json:"comments,omitempty"`
	WorkbenchDraft *mediamcp.DocumentWorkbenchDraft `json:"workbenchDraft,omitempty"`
	// ReplaceSameSlot overwrites an existing document occupying the same slot
	// (category + normalized title) instead of creating a duplicate. Set by the
	// agent/generation path only; intentionally not bound from HTTP requests so manual
	// document creation always produces a fresh record.
	ReplaceSameSlot bool `json:"-"`
}

// UpdateWorkspaceDocumentRequest updates a workspace document.
type UpdateWorkspaceDocumentRequest struct {
	Title           *string                          `json:"title,omitempty"`
	Content         *string                          `json:"content,omitempty"`
	Category        *string                          `json:"category,omitempty"`
	ParentID        *string                          `json:"parentId,omitempty"`
	FolderID        *string                          `json:"folderId,omitempty"`
	SortOrder       *int                             `json:"sortOrder,omitempty"`
	Tags            *[]string                        `json:"tags,omitempty"`
	IsDirty         *bool                            `json:"isDirty,omitempty"`
	Comments        *[]mediamcp.DocumentComment      `json:"comments,omitempty"`
	WorkbenchDraft  *mediamcp.DocumentWorkbenchDraft `json:"workbenchDraft,omitempty"`
	ExpectedVersion *int                             `json:"expectedVersion,omitempty"`
}

// WorkspaceSectionMedia describes generated media parsed from a document section.
type WorkspaceSectionMedia struct {
	Kind  string `json:"kind"`
	Src   string `json:"src"`
	Title string `json:"title,omitempty"`
}

// WorkspaceDocumentSectionMentionRequest updates a mention attached to a document section.
type WorkspaceDocumentSectionMentionRequest struct {
	SectionID       string                           `json:"sectionId"`
	Reference       WorkspaceSectionMentionReference `json:"reference"`
	Selected        bool                             `json:"selected"`
	ExpectedVersion *int                             `json:"expectedVersion,omitempty"`
}

// WorkspaceSectionMentionReference describes a document reference mention.
type WorkspaceSectionMentionReference struct {
	DocumentID string `json:"documentId"`
	BlockID    string `json:"blockId,omitempty"`
	Title      string `json:"title"`
	Category   string `json:"category,omitempty"`
}

// DeleteWorkspaceDocumentResponse contains IDs deleted by a document delete operation.
type DeleteWorkspaceDocumentResponse struct {
	DeletedIDs []string                   `json:"deletedIds"`
	State      WorkspaceDocumentsResponse `json:"state"`
}

// CreateDocumentFolderRequest creates a persisted document folder.
type CreateDocumentFolderRequest struct {
	ID        string  `json:"id,omitempty"`
	Name      string  `json:"name"`
	ParentID  *string `json:"parentId,omitempty"`
	SortOrder *int    `json:"sortOrder,omitempty"`
}

// UpdateDocumentFolderRequest updates a persisted document folder.
type UpdateDocumentFolderRequest struct {
	Name      *string `json:"name,omitempty"`
	ParentID  *string `json:"parentId,omitempty"`
	SortOrder *int    `json:"sortOrder,omitempty"`
}

// DocumentFoldersResponse is the project folder list payload.
type DocumentFoldersResponse struct {
	WorkspaceDir string                    `json:"workspaceDir"`
	ProjectID    string                    `json:"projectId,omitempty"`
	Folders      []mediamcp.DocumentFolder `json:"folders"`
}

// DocumentFolderMutationResponse is returned after a folder create or update.
type DocumentFolderMutationResponse struct {
	Folder mediamcp.DocumentFolder    `json:"folder"`
	State  WorkspaceDocumentsResponse `json:"state"`
}

// DeleteDocumentFolderResponse is returned after deleting a folder.
type DeleteDocumentFolderResponse struct {
	DeletedID string                     `json:"deletedId"`
	State     WorkspaceDocumentsResponse `json:"state"`
}

// DocumentToolApprovalRecord is a pending or decided document tool approval.
type DocumentToolApprovalRecord struct {
	ID              string                      `json:"id"`
	ProjectID       string                      `json:"projectId,omitempty"`
	ToolName        string                      `json:"toolName"`
	DocumentID      string                      `json:"documentId,omitempty"`
	Title           string                      `json:"title,omitempty"`
	Summary         string                      `json:"summary,omitempty"`
	Status          string                      `json:"status"`
	Request         DocumentToolApprovalRequest `json:"request"`
	DecisionPayload map[string]any              `json:"decisionPayload,omitempty"`
	CreatedAt       string                      `json:"createdAt"`
	DecidedAt       string                      `json:"decidedAt,omitempty"`
}

// DocumentToolApprovalRequest is the persisted request summary for a dangerous document action.
type DocumentToolApprovalRequest struct {
	ID         string `json:"id,omitempty"`
	Name       string `json:"name"`
	DocumentID string `json:"documentId,omitempty"`
	Title      string `json:"title,omitempty"`
	Summary    string `json:"summary,omitempty"`
}

// DocumentToolApprovalDecisionRequest decides a pending document tool approval.
type DocumentToolApprovalDecisionRequest struct {
	ProjectID string                               `json:"projectId,omitempty"`
	Decision  string                               `json:"decision"`
	Payload   *DocumentToolApprovalDecisionPayload `json:"payload,omitempty"`
}

// DocumentToolApprovalDecisionPayload carries typed approval decision options.
type DocumentToolApprovalDecisionPayload struct {
	Config *DocumentToolApprovalConfig `json:"config,omitempty"`
}

// DocumentToolApprovalConfig configures an approved document tool action.
type DocumentToolApprovalConfig struct {
	Prompt string `json:"prompt,omitempty"`
	// SaveSourceMaterial is the existing approval flag for saving raw attachments to the asset library.
	SaveSourceMaterial bool `json:"saveSourceMaterial,omitempty"`
}

const (
	ReferenceDocumentCategory            = "reference"
	LegacySourceMaterialDocumentCategory = "source-material"
)

// WorkspaceVersionConflictError reports an optimistic locking conflict.
type WorkspaceVersionConflictError struct {
	DocumentID string
	Expected   int
	Current    int
}

// Error formats a version conflict for API and MCP clients.
func (err WorkspaceVersionConflictError) Error() string {
	return fmt.Sprintf(
		"document %s was modified by another agent (expected version %d, current %d); re-read before retrying",
		err.DocumentID,
		err.Expected,
		err.Current,
	)
}

// IsWorkspaceVersionConflict reports whether an error is an optimistic locking conflict.
func IsWorkspaceVersionConflict(err error) bool {
	var conflict WorkspaceVersionConflictError
	return errors.As(err, &conflict)
}

// ValidateDocumentCategory validates optional document categories.
func ValidateDocumentCategory(category string) error {
	category = NormalizeDocumentCategoryValue(category)
	if category == "" {
		return nil
	}
	switch category {
	case "screenplay", "character", "scene", "prop", "storyboard", ReferenceDocumentCategory:
		return nil
	default:
		return fmt.Errorf("unsupported document category: %s", category)
	}
}

// NormalizeDocumentCategoryValue maps legacy category values to their current names.
func NormalizeDocumentCategoryValue(category string) string {
	category = strings.ToLower(strings.TrimSpace(category))
	if category == LegacySourceMaterialDocumentCategory {
		return ReferenceDocumentCategory
	}
	return category
}

// ValidateRequiredDocumentCategory validates required document categories.
func ValidateRequiredDocumentCategory(category string) error {
	category = NormalizeDocumentCategoryValue(category)
	if category == "" {
		return fmt.Errorf("document category is required")
	}
	return ValidateDocumentCategory(category)
}
