package document

import (
	docs "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/documents"
	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

// MoveBlockContentResult describes the Markdown content updates for a block move.
type MoveBlockContentResult = docs.MoveBlockContentResult

// InsertDocumentBlockContent inserts a rendered block relative to an anchor block.
func InsertDocumentBlockContent(document mediamcp.WorkspaceDocument, anchorID string, position string, expectedBlockHash string, block mediamcp.DocumentBlockInput) (string, string, error) {
	return docs.InsertDocumentBlockContent(document, anchorID, position, expectedBlockHash, block)
}

// UpdateDocumentBlockContent replaces a block with rendered Markdown.
func UpdateDocumentBlockContent(document mediamcp.WorkspaceDocument, blockID string, expectedBlockHash string, block mediamcp.DocumentBlockInput) (string, string, error) {
	return docs.UpdateDocumentBlockContent(document, blockID, expectedBlockHash, block)
}

// PatchDocumentBlockAttrsContent applies supported attribute changes to a block.
func PatchDocumentBlockAttrsContent(document mediamcp.WorkspaceDocument, blockID string, expectedBlockHash string, attrs *mediamcp.DocumentBlockAttrs) (string, string, error) {
	return docs.PatchDocumentBlockAttrsContent(document, blockID, expectedBlockHash, attrs)
}

// DeleteDocumentBlockContent removes a block from a document.
func DeleteDocumentBlockContent(document mediamcp.WorkspaceDocument, blockID string, expectedBlockHash string) (string, string, error) {
	return docs.DeleteDocumentBlockContent(document, blockID, expectedBlockHash)
}

// MoveDocumentBlockContent computes the source and target Markdown after a block move.
func MoveDocumentBlockContent(
	sourceDocument mediamcp.WorkspaceDocument,
	targetDocument mediamcp.WorkspaceDocument,
	blockID string,
	expectedBlockHash string,
	anchor mediamcp.DocumentBlockAnchorInput,
) (MoveBlockContentResult, error) {
	return docs.MoveDocumentBlockContent(sourceDocument, targetDocument, blockID, expectedBlockHash, anchor)
}

// ReplaceDocumentSectionContent replaces a heading section. When newHeading is
// non-empty, it also renames the heading in the same content mutation.
func ReplaceDocumentSectionContent(document mediamcp.WorkspaceDocument, headingID string, newHeading string, blocks []mediamcp.DocumentBlockInput) (string, string, error) {
	return docs.ReplaceDocumentSectionContent(document, headingID, newHeading, blocks)
}

// ReorderDocumentSectionsContent reorders heading sections in a document.
func ReorderDocumentSectionsContent(document mediamcp.WorkspaceDocument, parentHeadingID *string, order []string) (string, error) {
	return docs.ReorderDocumentSectionsContent(document, parentHeadingID, order)
}

// ReplaceDocumentSelectionContent replaces a selected text range in a document.
func ReplaceDocumentSelectionContent(document mediamcp.WorkspaceDocument, selection mediamcp.DocumentRangeSelection, replacement string, expectedBlockHash string) (string, string, error) {
	return docs.ReplaceDocumentSelectionContent(document, selection, replacement, expectedBlockHash)
}

// AnnotateDocumentSelectionContent applies an inline mark to a selected text range.
func AnnotateDocumentSelectionContent(document mediamcp.WorkspaceDocument, selection mediamcp.DocumentRangeSelection, mark mediamcp.DocumentInlineMarkInput, op string, expectedBlockHash string) (string, string, error) {
	return docs.AnnotateDocumentSelectionContent(document, selection, mark, op, expectedBlockHash)
}

// InsertDocumentInlineContent inserts inline content at an offset inside a block.
func InsertDocumentInlineContent(document mediamcp.WorkspaceDocument, position mediamcp.DocumentOffsetPosition, content []mediamcp.DocumentInlineContentInput, expectedBlockHash string) (string, string, error) {
	return docs.InsertDocumentInlineContent(document, position, content, expectedBlockHash)
}

// ReorderDocumentSections reorders sibling markdown sections by heading ID.
func ReorderDocumentSections(content string, structure docs.Structure, parentHeadingID *string, order []string) (string, error) {
	return docs.ReorderDocumentSections(content, structure, parentHeadingID, order)
}

// DocumentBlockSiblings returns parent, previous sibling, and next sibling IDs.
func DocumentBlockSiblings(blocks []mediamcp.DocumentBlockNode, blockID string) (string, string, string) {
	return docs.DocumentBlockSiblings(blocks, blockID)
}
