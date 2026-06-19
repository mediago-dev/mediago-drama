package document

import (
	"fmt"
	"strings"

	docs "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/documents"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

// StreamDocumentEditInput is the legacy stream_document_edit operation shape.
type StreamDocumentEditInput = docs.StreamDocumentEditInput

// StreamDocumentEditRuntime carries per-run metadata for persisted edit streams.
type StreamDocumentEditRuntime struct {
	ProjectID        string
	RunID            string
	CanWriteDocument func(documentID string) error
}

// PreparedDocumentEditStream is the service result for starting or resuming a stream.
type PreparedDocumentEditStream struct {
	Record   DocumentEditStreamRecord
	Document mediamcp.WorkspaceDocument
	Started  bool
}

// NormalizeStreamDocumentEditInput cleans stream edit input and fills IDs.
func NormalizeStreamDocumentEditInput(input StreamDocumentEditInput) StreamDocumentEditInput {
	input = docs.NormalizeStreamDocumentEditInput(input)
	if input.StreamID == "" {
		input.StreamID = MustRandomID("stream")
	}
	return input
}

// ValidateStreamDocumentEditInput validates common stream edit input rules.
func ValidateStreamDocumentEditInput(input StreamDocumentEditInput) error {
	return docs.ValidateStreamDocumentEditInput(input)
}

// PrepareDocumentEditStream starts or resumes a persisted document edit stream.
func (store *Service) PrepareDocumentEditStream(
	runtime StreamDocumentEditRuntime,
	input StreamDocumentEditInput,
) (PreparedDocumentEditStream, error) {
	projectID := domain.CleanProjectID(runtime.ProjectID)
	if existing, ok, err := store.GetDocumentEditStream(projectID, input.StreamID); err != nil {
		return PreparedDocumentEditStream{}, err
	} else if ok {
		if err := requireDocumentWrite(runtime, existing.DocumentID); err != nil {
			return PreparedDocumentEditStream{}, err
		}
		document, err := store.RequireWorkspaceDocument(projectID, existing.DocumentID)
		if err != nil {
			return PreparedDocumentEditStream{}, err
		}
		if err := ValidateExistingDocumentEditStream(existing, input); err != nil {
			return PreparedDocumentEditStream{}, err
		}
		return PreparedDocumentEditStream{Record: existing, Document: document}, nil
	}

	if err := ValidateNewDocumentEditStreamInput(input); err != nil {
		return PreparedDocumentEditStream{}, err
	}
	if input.Mode != "create" {
		if err := requireDocumentWrite(runtime, input.DocumentID); err != nil {
			return PreparedDocumentEditStream{}, err
		}
	}

	var document mediamcp.WorkspaceDocument
	var before AgentDocumentEditSnapshot
	var err error
	switch input.Mode {
	case "create":
		request, err := StreamDocumentCreateRequest(input)
		if err != nil {
			return PreparedDocumentEditStream{}, err
		}
		document, _, err = store.CreateWorkspaceDocument(projectID, request)
		if err != nil {
			return PreparedDocumentEditStream{}, err
		}
		before = EmptyDocumentEditSnapshot(document.ID)
	case "append", "replace_block", "replace_document":
		document, err = store.RequireWorkspaceDocument(projectID, input.DocumentID)
		if err != nil {
			return PreparedDocumentEditStream{}, err
		}
		if err := ValidateStreamDocumentVersion(input, document); err != nil {
			return PreparedDocumentEditStream{}, err
		}
		before = SnapshotDocument(document)
	default:
		return PreparedDocumentEditStream{}, fmt.Errorf("unsupported stream_document_edit mode: %s", input.Mode)
	}

	record := NewDocumentEditStreamRecord(projectID, runtime.RunID, input, document, before)
	record, err = store.SaveDocumentEditStream(record)
	if err != nil {
		return PreparedDocumentEditStream{}, err
	}
	return PreparedDocumentEditStream{Record: record, Document: document, Started: true}, nil
}

// ApplyDocumentEditStreamChunk persists a stream buffer chunk and returns updated state.
func (store *Service) ApplyDocumentEditStreamChunk(
	projectID string,
	record DocumentEditStreamRecord,
	input StreamDocumentEditInput,
) (DocumentEditStreamRecord, mediamcp.WorkspaceDocument, error) {
	projectID = domain.CleanProjectID(projectID)
	document, err := store.RequireWorkspaceDocument(projectID, record.DocumentID)
	if err != nil {
		return record, mediamcp.WorkspaceDocument{}, err
	}

	update, err := StreamDocumentUpdateRequest(document.Content, record, input)
	if err != nil {
		return record, mediamcp.WorkspaceDocument{}, err
	}
	if update.Content != nil {
		if err := ValidateTemplateDocumentContent(document, *update.Content); err != nil {
			return record, mediamcp.WorkspaceDocument{}, err
		}
	}
	document, _, err = store.UpdateWorkspaceDocument(projectID, document.ID, update)
	if err != nil {
		return record, mediamcp.WorkspaceDocument{}, err
	}
	record = UpdateDocumentEditStreamAfterChunk(record, document)
	record, err = store.SaveDocumentEditStream(record)
	if err != nil {
		return record, mediamcp.WorkspaceDocument{}, err
	}
	return record, document, nil
}

// FinalizeDocumentEditStream marks a stream completed and persists it.
func (store *Service) FinalizeDocumentEditStream(record DocumentEditStreamRecord) (DocumentEditStreamRecord, error) {
	record = CompleteDocumentEditStreamRecord(record)
	return store.SaveDocumentEditStream(record)
}

func requireDocumentWrite(runtime StreamDocumentEditRuntime, documentID string) error {
	if runtime.CanWriteDocument == nil {
		return nil
	}
	return runtime.CanWriteDocument(documentID)
}

// ValidateExistingDocumentEditStream validates a continued stream edit.
func ValidateExistingDocumentEditStream(record DocumentEditStreamRecord, input StreamDocumentEditInput) error {
	if record.Status == "completed" && !input.Finalize {
		return fmt.Errorf("stream %s is already completed", input.StreamID)
	}
	return nil
}

// ValidateNewDocumentEditStreamInput validates the first call for a stream edit.
func ValidateNewDocumentEditStreamInput(input StreamDocumentEditInput) error {
	if input.Mode != "create" && input.DocumentID == "" {
		return fmt.Errorf("documentId is required unless mode is create")
	}
	if input.Mode == "replace_block" && input.AnchorText == "" {
		return fmt.Errorf("anchorText is required for replace_block")
	}
	switch input.Mode {
	case "create", "append", "replace_block", "replace_document":
		return nil
	default:
		return fmt.Errorf("unsupported stream_document_edit mode: %s", input.Mode)
	}
}

// StreamDocumentCreateRequest builds the document create request for a create stream.
func StreamDocumentCreateRequest(input StreamDocumentEditInput) (CreateWorkspaceDocumentRequest, error) {
	if err := ValidateDocumentCategory(input.Category); err != nil {
		return CreateWorkspaceDocumentRequest{}, err
	}
	category := strings.TrimSpace(input.Category)
	if category == "" {
		category = sourceMaterialCategory
	}
	return CreateWorkspaceDocumentRequest{
		ID:       input.DocumentID,
		Title:    firstNonEmpty(input.Title, "生成中文档"),
		Content:  "",
		Category: category,
		ParentID: input.ParentDocumentID,
	}, nil
}

// ValidateStreamDocumentVersion validates the optimistic version for a new stream.
func ValidateStreamDocumentVersion(input StreamDocumentEditInput, document mediamcp.WorkspaceDocument) error {
	if input.ExpectedVersion == nil {
		return nil
	}
	current := NormalizedDocumentVersion(document.Version)
	if current == *input.ExpectedVersion {
		return nil
	}
	return WorkspaceVersionConflictError{
		DocumentID: document.ID,
		Expected:   *input.ExpectedVersion,
		Current:    current,
	}
}

// NewDocumentEditStreamRecord builds the first persisted record for a stream edit.
func NewDocumentEditStreamRecord(
	projectID string,
	runID string,
	input StreamDocumentEditInput,
	document mediamcp.WorkspaceDocument,
	before AgentDocumentEditSnapshot,
) DocumentEditStreamRecord {
	return DocumentEditStreamRecord{
		ProjectID:   projectID,
		StreamID:    input.StreamID,
		DocumentID:  document.ID,
		Mode:        input.Mode,
		AnchorText:  input.AnchorText,
		Title:       firstNonEmpty(input.Title, document.Title),
		ParentID:    document.ParentID,
		BaseVersion: NormalizedDocumentVersion(document.Version),
		Status:      "streaming",
		RunID:       runID,
		Before:      before,
	}
}

// StreamDocumentUpdateRequest builds the document update for the current stream buffer.
func StreamDocumentUpdateRequest(
	currentContent string,
	record DocumentEditStreamRecord,
	input StreamDocumentEditInput,
) (UpdateWorkspaceDocumentRequest, error) {
	nextContent, err := ApplyDocumentEditStreamBuffer(currentContent, record.Before, record.Mode, record.AnchorText, record.Buffer)
	if err != nil {
		return UpdateWorkspaceDocumentRequest{}, err
	}
	update := UpdateWorkspaceDocumentRequest{Content: &nextContent}
	if input.Title != "" {
		title := input.Title
		update.Title = &title
	}
	clean := false
	update.IsDirty = &clean
	return update, nil
}

// UpdateDocumentEditStreamAfterChunk updates a stream record after applying a chunk.
func UpdateDocumentEditStreamAfterChunk(record DocumentEditStreamRecord, document mediamcp.WorkspaceDocument) DocumentEditStreamRecord {
	record.DocumentID = document.ID
	record.Title = document.Title
	record.BaseVersion = NormalizedDocumentVersion(record.BaseVersion)
	record.Status = "streaming"
	return record
}

// CompleteDocumentEditStreamRecord marks a stream record as completed.
func CompleteDocumentEditStreamRecord(record DocumentEditStreamRecord) DocumentEditStreamRecord {
	record.Status = "completed"
	return record
}

// StreamEditEventMode maps stream edit modes to document edit event modes.
func StreamEditEventMode(mode string) string {
	return docs.StreamEditEventMode(mode)
}

// ApplyDocumentEditStreamBuffer returns the document content after applying a stream buffer.
func ApplyDocumentEditStreamBuffer(currentContent string, before AgentDocumentEditSnapshot, mode string, anchorText string, buffer string) (string, error) {
	switch mode {
	case "create", "replace_document":
		return buffer, nil
	case "append":
		return before.Content + buffer, nil
	case "replace_block":
		nextContent, replaced := docs.ReplaceMarkdownBlockForAnchor(before.Content, anchorText, buffer)
		if !replaced {
			return "", fmt.Errorf("无法定位锚定文本所在块：%s", anchorText)
		}
		return nextContent, nil
	default:
		return currentContent, fmt.Errorf("unsupported stream mode: %s", mode)
	}
}
