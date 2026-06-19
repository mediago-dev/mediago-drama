package document

import (
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

// DocumentOperationsRequest asks the backend document-operation runtime for edits.
type DocumentOperationsRequest struct {
	Prompt        string                     `json:"prompt"`
	ProjectID     string                     `json:"projectId,omitempty"`
	AnchorText    string                     `json:"anchorText,omitempty"`
	Document      AgentDocumentContext       `json:"document"`
	SelectionText string                     `json:"selectionText,omitempty"`
	CommentID     string                     `json:"commentId,omitempty"`
	Comments      []mediamcp.DocumentComment `json:"comments,omitempty"`
}

// DocumentOperationsResponse contains proposed document operations.
type DocumentOperationsResponse struct {
	Message    string                    `json:"message"`
	Summary    string                    `json:"summary"`
	Operations []DocumentOperationRecord `json:"operations"`
	Runtime    DocumentOperationRuntime  `json:"runtime"`
}

// DocumentOperationRuntime describes the backend runtime used for document operations.
type DocumentOperationRuntime struct {
	Runtime    string `json:"runtime"`
	Fallback   bool   `json:"fallback"`
	Validated  bool   `json:"validated"`
	Diagnostic string `json:"diagnostic,omitempty"`
}

// DocumentOperationRecord is one operation proposal.
type DocumentOperationRecord struct {
	ID        string                  `json:"id"`
	Type      string                  `json:"type"`
	Summary   string                  `json:"summary"`
	Target    DocumentOperationTarget `json:"target"`
	Payload   map[string]any          `json:"payload"`
	CreatedAt string                  `json:"createdAt"`
}

// DocumentOperationTarget describes the operation target.
type DocumentOperationTarget struct {
	Anchor    *mediamcp.TextAnchor `json:"anchor,omitempty"`
	CommentID string               `json:"commentId,omitempty"`
	Heading   string               `json:"heading,omitempty"`
	Position  string               `json:"position,omitempty"`
}

// HasDocumentOperationWork reports whether the request contains meaningful work.
func HasDocumentOperationWork(request DocumentOperationsRequest) bool {
	if strings.TrimSpace(request.Prompt) != "" {
		return true
	}
	if strings.TrimSpace(request.SelectionText) != "" || strings.TrimSpace(request.AnchorText) != "" || strings.TrimSpace(request.CommentID) != "" {
		return true
	}
	for _, comment := range request.Comments {
		if !comment.Resolved {
			return true
		}
	}
	return false
}
