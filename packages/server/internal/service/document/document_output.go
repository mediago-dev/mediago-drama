package document

import (
	docs "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/documents"
	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

// StructuredDocumentOutput builds a structure-first document output payload.
func StructuredDocumentOutput(document mediamcp.WorkspaceDocument, includeComments bool, includeDraft bool) (mediamcp.GetDocumentOutput, error) {
	return docs.StructuredDocumentOutput(document, includeComments, includeDraft)
}

// WorkspaceSnapshotOutput builds a structure-light workspace snapshot payload.
func WorkspaceSnapshotOutput(
	metadata mediamcp.ListDocumentsOutput,
	activeDocumentID string,
	selection *mediamcp.DocumentRangeSelection,
) mediamcp.WorkspaceSnapshotOutput {
	return docs.WorkspaceSnapshotOutput(metadata, activeDocumentID, selection)
}

// LegacyWorkspaceSnapshotOutput builds the legacy workspace snapshot payload.
func LegacyWorkspaceSnapshotOutput(
	metadata mediamcp.ListDocumentsOutput,
	activeDocumentID string,
	selectionText string,
) mediamcp.LegacyWorkspaceSnapshotOutput {
	return docs.LegacyWorkspaceSnapshotOutput(metadata, activeDocumentID, selectionText)
}

// ValidateDocumentSelection validates a document text range selection.
func ValidateDocumentSelection(document mediamcp.WorkspaceDocument, selection mediamcp.DocumentRangeSelection) error {
	return docs.ValidateDocumentSelection(document, selection)
}

// DocumentBlockNode returns one parsed document block by ID.
func DocumentBlockNode(document mediamcp.WorkspaceDocument, blockID string) (mediamcp.DocumentBlockNode, error) {
	return docs.DocumentBlockNode(document, blockID)
}

// DocumentOutlineOutput builds the heading outline response for a document.
func DocumentOutlineOutput(document mediamcp.WorkspaceDocument, maxLevel int) (mediamcp.GetDocumentOutlineOutput, error) {
	return docs.DocumentOutlineOutput(document, maxLevel)
}

// DocumentBlockOutput builds the block response for a document block ID.
func DocumentBlockOutput(document mediamcp.WorkspaceDocument, blockID string, includeChildren bool) (mediamcp.GetDocumentBlockOutput, error) {
	return docs.DocumentBlockOutput(document, blockID, includeChildren)
}

// DocumentSectionOutput builds the section response under a heading block.
func DocumentSectionOutput(document mediamcp.WorkspaceDocument, headingID string) (mediamcp.GetDocumentSectionOutput, error) {
	return docs.DocumentSectionOutput(document, headingID)
}
