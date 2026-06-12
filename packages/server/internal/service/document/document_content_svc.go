package document

import (
	"fmt"
	"strings"

	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

// WorkspaceDocumentContentMutationResult contains the before/after state for a document content mutation.
type WorkspaceDocumentContentMutationResult struct {
	Before   mediamcp.WorkspaceDocument
	Document mediamcp.WorkspaceDocument
	BlockID  string
	Op       string
}

// WorkspaceDocumentMetadataMutationResult contains the before/after state for a document metadata mutation.
type WorkspaceDocumentMetadataMutationResult struct {
	Before   mediamcp.WorkspaceDocument
	Document mediamcp.WorkspaceDocument
}

// WorkspaceDocumentMoveResult contains the before/after state for a document move.
type WorkspaceDocumentMoveResult struct {
	Before   mediamcp.WorkspaceDocument
	Document mediamcp.WorkspaceDocument
}

func expectedVersionPtr(expectedVersion int) *int {
	return &expectedVersion
}

// CreateWorkspaceDocumentFromInput creates a workspace document from MCP input.
func (store *Service) CreateWorkspaceDocumentFromInput(projectID string, input CreateDocumentInput) (mediamcp.WorkspaceDocument, error) {
	if err := ValidateDocumentCategory(input.Category); err != nil {
		return mediamcp.WorkspaceDocument{}, err
	}
	parentID := input.ParentDocumentID
	if parentID != nil {
		trimmed := strings.TrimSpace(*parentID)
		parentID = &trimmed
	}
	request, err := normalizeCreateDocumentRequest(CreateWorkspaceDocumentRequest{
		Title:    input.Title,
		Content:  RenderBlockInputs(input.InitialBlocks),
		Category: input.Category,
		ParentID: parentID,
		Tags:     input.Tags,
	})
	if err != nil {
		return mediamcp.WorkspaceDocument{}, err
	}
	document, _, err := store.CreateWorkspaceDocument(projectID, request)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, err
	}
	return document, nil
}

// MoveWorkspaceDocumentWithSnapshot moves a document and returns before/after snapshots.
func (store *Service) MoveWorkspaceDocumentWithSnapshot(projectID string, input MoveDocumentInput, expectedVersion int) (WorkspaceDocumentMoveResult, error) {
	documentID := strings.TrimSpace(input.DocumentID)
	before, err := store.RequireWorkspaceDocument(projectID, documentID)
	if err != nil {
		return WorkspaceDocumentMoveResult{}, err
	}
	targetDocumentID := strings.TrimSpace(input.TargetDocumentID)
	position := strings.TrimSpace(input.Position)
	if position == "" {
		position = "inside"
	}
	document, _, err := store.MoveWorkspaceDocument(projectID, documentID, targetDocumentID, position, expectedVersion)
	if err != nil {
		return WorkspaceDocumentMoveResult{}, err
	}
	return WorkspaceDocumentMoveResult{Before: before, Document: document}, nil
}

// SetWorkspaceDocumentTitle updates a document title from MCP input.
func (store *Service) SetWorkspaceDocumentTitle(projectID string, input SetDocumentTitleInput, expectedVersion int) (WorkspaceDocumentMetadataMutationResult, error) {
	title := strings.TrimSpace(input.Title)
	if title == "" {
		return WorkspaceDocumentMetadataMutationResult{}, fmt.Errorf("title is required")
	}
	before, document, err := store.UpdateWorkspaceDocumentMetadata(projectID, input.DocumentID, UpdateWorkspaceDocumentRequest{
		Title:           &title,
		ExpectedVersion: expectedVersionPtr(expectedVersion),
	})
	if err != nil {
		return WorkspaceDocumentMetadataMutationResult{}, err
	}
	return WorkspaceDocumentMetadataMutationResult{Before: before, Document: document}, nil
}

// SetWorkspaceDocumentCategory updates a document category from MCP input.
func (store *Service) SetWorkspaceDocumentCategory(projectID string, input SetDocumentCategoryInput, expectedVersion int) (WorkspaceDocumentMetadataMutationResult, error) {
	category := strings.TrimSpace(input.Category)
	if err := ValidateDocumentCategory(category); err != nil {
		return WorkspaceDocumentMetadataMutationResult{}, err
	}
	before, document, err := store.UpdateWorkspaceDocumentMetadata(projectID, input.DocumentID, UpdateWorkspaceDocumentRequest{
		Category:        &category,
		ExpectedVersion: expectedVersionPtr(expectedVersion),
	})
	if err != nil {
		return WorkspaceDocumentMetadataMutationResult{}, err
	}
	return WorkspaceDocumentMetadataMutationResult{Before: before, Document: document}, nil
}

// SetWorkspaceDocumentParent updates a document parent/sort order from MCP input.
func (store *Service) SetWorkspaceDocumentParent(projectID string, input SetDocumentParentInput, expectedVersion int) (WorkspaceDocumentMetadataMutationResult, error) {
	parentID := input.ParentDocumentID
	if parentID != nil {
		trimmed := strings.TrimSpace(*parentID)
		parentID = &trimmed
	}
	before, document, err := store.UpdateWorkspaceDocumentMetadata(projectID, input.DocumentID, UpdateWorkspaceDocumentRequest{
		ParentID:        parentID,
		SortOrder:       input.SortOrder,
		ExpectedVersion: expectedVersionPtr(expectedVersion),
	})
	if err != nil {
		return WorkspaceDocumentMetadataMutationResult{}, err
	}
	return WorkspaceDocumentMetadataMutationResult{Before: before, Document: document}, nil
}

// SetWorkspaceDocumentTags replaces document tags from MCP input.
func (store *Service) SetWorkspaceDocumentTags(projectID string, input SetDocumentTagsInput, expectedVersion int) (WorkspaceDocumentMetadataMutationResult, error) {
	tags := NormalizeDocumentTags(input.Tags)
	before, document, err := store.UpdateWorkspaceDocumentMetadata(projectID, input.DocumentID, UpdateWorkspaceDocumentRequest{
		Tags:            &tags,
		ExpectedVersion: expectedVersionPtr(expectedVersion),
	})
	if err != nil {
		return WorkspaceDocumentMetadataMutationResult{}, err
	}
	return WorkspaceDocumentMetadataMutationResult{Before: before, Document: document}, nil
}

func (store *Service) mutateWorkspaceDocumentContent(
	projectID string,
	documentID string,
	expectedVersion int,
	op string,
	mutate func(mediamcp.WorkspaceDocument) (string, string, error),
) (WorkspaceDocumentContentMutationResult, error) {
	before, err := store.RequireWorkspaceDocument(projectID, documentID)
	if err != nil {
		return WorkspaceDocumentContentMutationResult{}, err
	}
	nextContent, blockID, err := mutate(before)
	if err != nil {
		return WorkspaceDocumentContentMutationResult{}, err
	}
	document, err := store.UpdateWorkspaceDocumentContent(projectID, before, nextContent, expectedVersion)
	if err != nil {
		return WorkspaceDocumentContentMutationResult{}, err
	}
	return WorkspaceDocumentContentMutationResult{
		Before:   before,
		Document: document,
		BlockID:  blockID,
		Op:       op,
	}, nil
}

// InsertWorkspaceDocumentBlock inserts a structured block and persists the document.
func (store *Service) InsertWorkspaceDocumentBlock(projectID string, input InsertBlockInput, expectedVersion int) (WorkspaceDocumentContentMutationResult, error) {
	return store.mutateWorkspaceDocumentContent(projectID, input.DocumentID, expectedVersion, "insert", func(document mediamcp.WorkspaceDocument) (string, string, error) {
		return InsertDocumentBlockContent(document, input.Anchor.BlockID, input.Anchor.Position, input.ExpectedBlockHash, input.Block)
	})
}

// UpdateWorkspaceDocumentBlock replaces a block and persists the document.
func (store *Service) UpdateWorkspaceDocumentBlock(projectID string, input UpdateBlockInput, expectedVersion int) (WorkspaceDocumentContentMutationResult, error) {
	return store.mutateWorkspaceDocumentContent(projectID, input.DocumentID, expectedVersion, "replace", func(document mediamcp.WorkspaceDocument) (string, string, error) {
		return UpdateDocumentBlockContent(document, input.BlockID, input.ExpectedBlockHash, input.Block)
	})
}

// PatchWorkspaceDocumentBlockAttrs patches block attributes and persists the document.
func (store *Service) PatchWorkspaceDocumentBlockAttrs(projectID string, input PatchBlockAttrsInput, expectedVersion int) (WorkspaceDocumentContentMutationResult, error) {
	return store.mutateWorkspaceDocumentContent(projectID, input.DocumentID, expectedVersion, "patch_attrs", func(document mediamcp.WorkspaceDocument) (string, string, error) {
		return PatchDocumentBlockAttrsContent(document, input.BlockID, input.ExpectedBlockHash, input.Attrs)
	})
}

// DeleteWorkspaceDocumentBlock deletes a block and persists the document.
func (store *Service) DeleteWorkspaceDocumentBlock(projectID string, input DeleteBlockInput, expectedVersion int) (WorkspaceDocumentContentMutationResult, error) {
	return store.mutateWorkspaceDocumentContent(projectID, input.DocumentID, expectedVersion, "delete", func(document mediamcp.WorkspaceDocument) (string, string, error) {
		return DeleteDocumentBlockContent(document, input.BlockID, input.ExpectedBlockHash)
	})
}

// MoveWorkspaceDocumentBlock moves a block within or across documents and persists the result.
func (store *Service) MoveWorkspaceDocumentBlock(projectID string, input MoveBlockInput, expectedVersion int) ([]WorkspaceDocumentContentMutationResult, error) {
	sourceDocument, err := store.RequireWorkspaceDocument(projectID, input.DocumentID)
	if err != nil {
		return nil, err
	}
	targetDocumentID := firstNonEmpty(strings.TrimSpace(input.Target.DocumentID), sourceDocument.ID)
	if targetDocumentID != sourceDocument.ID {
		batchInput := BatchDocumentEditInput{
			DocumentID:      sourceDocument.ID,
			ExpectedVersion: expectedVersion,
			Operations: []BatchDocumentEditOperationInput{
				{
					Type:                  "move_block",
					BlockID:               input.BlockID,
					ExpectedBlockHash:     input.ExpectedBlockHash,
					Target:                &input.Target,
					TargetExpectedVersion: input.TargetExpectedVersion,
				},
			},
			Summary: input.Summary,
		}
		return store.batchWorkspaceDocumentEdit(projectID, batchInput, expectedVersion)
	}

	move, err := MoveDocumentBlockContent(sourceDocument, sourceDocument, input.BlockID, input.ExpectedBlockHash, input.Target.Anchor)
	if err != nil {
		return nil, err
	}
	document, err := store.UpdateWorkspaceDocumentContent(projectID, sourceDocument, move.SourceContent, expectedVersion)
	if err != nil {
		return nil, err
	}
	return []WorkspaceDocumentContentMutationResult{{
		Before:   sourceDocument,
		Document: document,
		BlockID:  move.BlockID,
		Op:       "move",
	}}, nil
}

// ReplaceWorkspaceDocumentSection replaces a heading section and persists the document.
func (store *Service) ReplaceWorkspaceDocumentSection(projectID string, input ReplaceSectionInput, expectedVersion int) (WorkspaceDocumentContentMutationResult, error) {
	return store.mutateWorkspaceDocumentContent(projectID, input.DocumentID, expectedVersion, "replace_section", func(document mediamcp.WorkspaceDocument) (string, string, error) {
		return ReplaceDocumentSectionContent(document, input.HeadingID, input.NewHeading, input.Blocks)
	})
}

// ReorderWorkspaceDocumentSections reorders heading sections and persists the document.
func (store *Service) ReorderWorkspaceDocumentSections(projectID string, input ReorderSectionsInput, expectedVersion int) (WorkspaceDocumentContentMutationResult, error) {
	return store.mutateWorkspaceDocumentContent(projectID, input.DocumentID, expectedVersion, "reorder_sections", func(document mediamcp.WorkspaceDocument) (string, string, error) {
		nextContent, err := ReorderDocumentSectionsContent(document, input.ParentHeadingID, input.Order)
		return nextContent, "", err
	})
}

// ReplaceWorkspaceDocumentSelection replaces a selected range and persists the document.
func (store *Service) ReplaceWorkspaceDocumentSelection(projectID string, input ReplaceSelectionInput, expectedVersion int) (WorkspaceDocumentContentMutationResult, error) {
	return store.mutateWorkspaceDocumentContent(projectID, input.DocumentID, expectedVersion, "replace_selection", func(document mediamcp.WorkspaceDocument) (string, string, error) {
		return ReplaceDocumentSelectionContent(document, input.Selection, RenderInlineReplacement(input.Replacement), input.ExpectedBlockHash)
	})
}

// AnnotateWorkspaceDocumentSelection applies a mark to a selected range and persists the document.
func (store *Service) AnnotateWorkspaceDocumentSelection(projectID string, input AnnotateSelectionInput, expectedVersion int) (WorkspaceDocumentContentMutationResult, error) {
	return store.mutateWorkspaceDocumentContent(projectID, input.DocumentID, expectedVersion, "annotate", func(document mediamcp.WorkspaceDocument) (string, string, error) {
		return AnnotateDocumentSelectionContent(document, input.Selection, input.Mark, input.Op, input.ExpectedBlockHash)
	})
}

// InsertWorkspaceDocumentInline inserts inline content and persists the document.
func (store *Service) InsertWorkspaceDocumentInline(projectID string, input InsertInlineInput, expectedVersion int) (WorkspaceDocumentContentMutationResult, error) {
	return store.mutateWorkspaceDocumentContent(projectID, input.DocumentID, expectedVersion, "insert_inline", func(document mediamcp.WorkspaceDocument) (string, string, error) {
		return InsertDocumentInlineContent(document, input.Position, input.Content, input.ExpectedBlockHash)
	})
}

// BatchWorkspaceDocumentEdit applies several same-document edits and persists them as one version.
func (store *Service) PatchWorkspaceDocumentContent(projectID string, input DocumentPatchEditInput, expectedVersion int) (WorkspaceDocumentContentMutationResult, error) {
	return store.mutateWorkspaceDocumentContent(projectID, input.DocumentID, expectedVersion, "document_patch_edit", func(document mediamcp.WorkspaceDocument) (string, string, error) {
		nextContent, err := ApplyDocumentPatchEditContent(document.Content, input.Patches)
		return nextContent, "", err
	})
}

func (store *Service) BatchWorkspaceDocumentEdit(projectID string, input BatchDocumentEditInput, expectedVersion int) ([]WorkspaceDocumentContentMutationResult, error) {
	mutations, err := store.batchWorkspaceDocumentEdit(projectID, input, expectedVersion)
	if err != nil {
		return nil, err
	}
	return mutations, nil
}
