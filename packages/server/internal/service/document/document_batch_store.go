package document

import (
	"fmt"
	"strings"

	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/platform/timestamp"
)

func (store *Service) batchWorkspaceDocumentEdit(
	projectID string,
	input BatchDocumentEditInput,
	expectedVersion int,
) ([]WorkspaceDocumentContentMutationResult, error) {
	if store.initErr != nil {
		return nil, store.initErr
	}
	store.mu.Lock()
	defer store.mu.Unlock()

	state, err := store.loadUnlocked(projectID)
	if err != nil {
		return nil, err
	}
	primaryDocumentID := strings.TrimSpace(input.DocumentID)
	if primaryDocumentID == "" {
		return nil, fmt.Errorf("documentId is required")
	}
	checkedVersions := map[string]int{}
	if err := checkBatchDocumentVersion(state.Documents, primaryDocumentID, expectedVersionPtr(expectedVersion), true, checkedVersions); err != nil {
		return nil, err
	}
	currentDocuments := append([]mediamcp.WorkspaceDocument(nil), state.Documents...)
	beforeByID := map[string]mediamcp.WorkspaceDocument{}
	changedIDs := []string{}
	markChanged := func(before mediamcp.WorkspaceDocument) {
		if _, ok := beforeByID[before.ID]; ok {
			return
		}
		beforeByID[before.ID] = before
		changedIDs = append(changedIDs, before.ID)
	}

	for index, operation := range input.Operations {
		sourceDocumentID := firstNonEmpty(operation.DocumentID, primaryDocumentID)
		if sourceDocumentID != primaryDocumentID || operation.ExpectedVersion != nil {
			if err := checkBatchDocumentVersion(currentDocuments, sourceDocumentID, operation.ExpectedVersion, sourceDocumentID != primaryDocumentID, checkedVersions); err != nil {
				return nil, fmt.Errorf("batch op %d (%s): %w", index+1, strings.TrimSpace(operation.Type), err)
			}
		}
		sourceIndex := FindWorkspaceDocumentIndexByID(currentDocuments, sourceDocumentID)
		if sourceIndex < 0 {
			return nil, fmt.Errorf("batch op %d (%s): document not found: %s", index+1, strings.TrimSpace(operation.Type), sourceDocumentID)
		}
		source := currentDocuments[sourceIndex]
		if strings.TrimSpace(operation.Type) == "move_block" {
			target := mediamcp.DocumentMoveBlockTargetInput{Anchor: operation.Anchor}
			if operation.Target != nil {
				target = *operation.Target
			}
			targetDocumentID := firstNonEmpty(target.DocumentID, source.ID)
			if targetDocumentID != source.ID {
				if err := checkBatchDocumentVersion(currentDocuments, targetDocumentID, operation.TargetExpectedVersion, targetDocumentID != primaryDocumentID, checkedVersions); err != nil {
					return nil, fmt.Errorf("batch op %d (%s): %w", index+1, strings.TrimSpace(operation.Type), err)
				}
				targetIndex := FindWorkspaceDocumentIndexByID(currentDocuments, targetDocumentID)
				if targetIndex < 0 {
					return nil, fmt.Errorf("batch op %d (%s): target document not found: %s", index+1, strings.TrimSpace(operation.Type), targetDocumentID)
				}
				targetDocument := currentDocuments[targetIndex]
				move, err := MoveDocumentBlockContent(source, targetDocument, operation.BlockID, operation.ExpectedBlockHash, target.Anchor)
				if err != nil {
					return nil, fmt.Errorf("batch op %d (%s): %w", index+1, strings.TrimSpace(operation.Type), err)
				}
				markChanged(state.Documents[sourceIndex])
				markChanged(state.Documents[targetIndex])
				source.Content = move.SourceContent
				targetDocument.Content = move.TargetContent
				currentDocuments[sourceIndex] = source
				currentDocuments[targetIndex] = targetDocument
				continue
			}
		}
		nextContent, _, err := applyBatchDocumentEditOperation(source, operation)
		if err != nil {
			return nil, fmt.Errorf("batch op %d (%s): %w", index+1, strings.TrimSpace(operation.Type), err)
		}
		markChanged(state.Documents[sourceIndex])
		source.Content = nextContent
		currentDocuments[sourceIndex] = source
	}
	if len(changedIDs) == 0 {
		return nil, fmt.Errorf("batch_document_edit did not update any document")
	}

	now := timestamp.NowRFC3339Nano()
	for _, documentID := range changedIDs {
		index := FindWorkspaceDocumentIndexByID(currentDocuments, documentID)
		if index < 0 {
			return nil, fmt.Errorf("changed document not found: %s", documentID)
		}
		before := beforeByID[documentID]
		document := currentDocuments[index]
		if err := ValidateTemplateDocumentContent(before, document.Content); err != nil {
			return nil, err
		}
		document.UpdatedAt = now
		document.Version = NormalizedDocumentVersion(before.Version) + 1
		document.IsDirty = false
		document.Comments = NormalizeCommentRecordsForDocument(document.ID, document.Content, document.Comments)
		currentDocuments[index] = document
	}

	savedState, err := store.saveUnlocked(projectID, workspaceStateRequest{
		Documents:    currentDocuments,
		OperationLog: state.OperationLog,
	})
	if err != nil {
		return nil, err
	}

	mutations := make([]WorkspaceDocumentContentMutationResult, 0, len(changedIDs))
	for _, documentID := range changedIDs {
		document, ok := FindWorkspaceDocumentByID(savedState.Documents, documentID)
		if !ok {
			return nil, fmt.Errorf("saved changed document not found: %s", documentID)
		}
		mutations = append(mutations, WorkspaceDocumentContentMutationResult{
			Before:   beforeByID[documentID],
			Document: document,
			Op:       "batch_document_edit",
		})
	}
	return mutations, nil
}

func checkBatchDocumentVersion(
	documents []mediamcp.WorkspaceDocument,
	documentID string,
	expectedVersion *int,
	required bool,
	checked map[string]int,
) error {
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return fmt.Errorf("documentId is required")
	}
	if expectedVersion == nil {
		if required {
			return fmt.Errorf("expectedVersion is required for document %s", documentID)
		}
		return nil
	}
	if checkedValue, ok := checked[documentID]; ok {
		if checkedValue != *expectedVersion {
			return fmt.Errorf("document %s has conflicting expectedVersion values %d and %d", documentID, checkedValue, *expectedVersion)
		}
		return nil
	}
	document, ok := FindWorkspaceDocumentByID(documents, documentID)
	if !ok {
		return fmt.Errorf("document not found: %s", documentID)
	}
	document.Version = NormalizedDocumentVersion(document.Version)
	if *expectedVersion != document.Version {
		return WorkspaceVersionConflictError{
			DocumentID: document.ID,
			Expected:   *expectedVersion,
			Current:    document.Version,
		}
	}
	checked[documentID] = *expectedVersion
	return nil
}
