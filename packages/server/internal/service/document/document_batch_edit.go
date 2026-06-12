package document

import (
	"fmt"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

// ApplyBatchDocumentEditContent applies same-document structural edits in order without persisting intermediate states.
func ApplyBatchDocumentEditContent(
	document mediamcp.WorkspaceDocument,
	operations []BatchDocumentEditOperationInput,
) (string, string, error) {
	if len(operations) == 0 {
		return "", "", fmt.Errorf("operations is required")
	}
	current := document
	lastBlockID := ""
	for index, operation := range operations {
		nextContent, blockID, err := applyBatchDocumentEditOperation(current, operation)
		if err != nil {
			return "", "", fmt.Errorf("batch op %d (%s): %w", index+1, strings.TrimSpace(operation.Type), err)
		}
		current.Content = nextContent
		if blockID != "" {
			lastBlockID = blockID
		}
	}
	return current.Content, lastBlockID, nil
}

func applyBatchDocumentEditOperation(
	document mediamcp.WorkspaceDocument,
	operation BatchDocumentEditOperationInput,
) (string, string, error) {
	switch strings.TrimSpace(operation.Type) {
	case "insert_block":
		return InsertDocumentBlockContent(document, operation.Anchor.BlockID, operation.Anchor.Position, operation.ExpectedBlockHash, operation.Block)
	case "update_block":
		return UpdateDocumentBlockContent(document, operation.BlockID, operation.ExpectedBlockHash, operation.Block)
	case "patch_block_attrs":
		return PatchDocumentBlockAttrsContent(document, operation.BlockID, operation.ExpectedBlockHash, operation.Attrs)
	case "delete_block":
		return DeleteDocumentBlockContent(document, operation.BlockID, operation.ExpectedBlockHash)
	case "move_block":
		return applyBatchMoveBlockOperation(document, operation)
	case "replace_section":
		headingID := firstNonEmpty(operation.HeadingID, operation.BlockID)
		return ReplaceDocumentSectionContent(document, headingID, operation.NewHeading, operation.Blocks)
	case "reorder_sections":
		nextContent, err := ReorderDocumentSectionsContent(document, operation.ParentHeadingID, operation.Order)
		return nextContent, "", err
	case "replace_selection":
		return ReplaceDocumentSelectionContent(document, operation.Selection, RenderInlineReplacement(operation.Replacement), operation.ExpectedBlockHash)
	case "annotate_selection":
		return AnnotateDocumentSelectionContent(document, operation.Selection, operation.Mark, operation.Op, operation.ExpectedBlockHash)
	case "insert_inline":
		return InsertDocumentInlineContent(document, operation.Position, operation.Content, operation.ExpectedBlockHash)
	default:
		return "", "", fmt.Errorf("unsupported operation type %q", operation.Type)
	}
}

func applyBatchMoveBlockOperation(
	document mediamcp.WorkspaceDocument,
	operation BatchDocumentEditOperationInput,
) (string, string, error) {
	target := mediamcp.DocumentMoveBlockTargetInput{Anchor: operation.Anchor}
	if operation.Target != nil {
		target = *operation.Target
	}
	targetDocumentID := strings.TrimSpace(target.DocumentID)
	if targetDocumentID != "" && targetDocumentID != document.ID {
		return "", "", fmt.Errorf("batch_document_edit only supports same-document move_block")
	}
	move, err := MoveDocumentBlockContent(document, document, operation.BlockID, operation.ExpectedBlockHash, target.Anchor)
	if err != nil {
		return "", "", err
	}
	return move.SourceContent, move.BlockID, nil
}
