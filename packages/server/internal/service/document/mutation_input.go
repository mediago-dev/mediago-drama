package document

import mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"

// MoveDocumentInput moves one document relative to another document.
type MoveDocumentInput struct {
	DocumentID       string `json:"documentId"`
	TargetDocumentID string `json:"targetDocumentId"`
	Position         string `json:"position"`
	Summary          string `json:"summary,omitempty"`
	ExpectedVersion  int    `json:"expectedVersion"`
}

// SetDocumentTitleInput updates a document title.
type SetDocumentTitleInput struct {
	DocumentID      string `json:"documentId"`
	Title           string `json:"title"`
	ExpectedVersion int    `json:"expectedVersion"`
	Summary         string `json:"summary,omitempty"`
}

// SetDocumentCategoryInput updates a document category.
type SetDocumentCategoryInput struct {
	DocumentID      string `json:"documentId"`
	Category        string `json:"category"`
	ExpectedVersion int    `json:"expectedVersion"`
	Summary         string `json:"summary,omitempty"`
}

// SetDocumentParentInput updates a document parent and optional sort order.
type SetDocumentParentInput struct {
	DocumentID       string  `json:"documentId"`
	ParentDocumentID *string `json:"parentDocumentId"`
	SortOrder        *int    `json:"sortOrder,omitempty"`
	ExpectedVersion  int     `json:"expectedVersion"`
	Summary          string  `json:"summary,omitempty"`
}

// SetDocumentTagsInput replaces a document tag list.
type SetDocumentTagsInput struct {
	DocumentID      string   `json:"documentId"`
	Tags            []string `json:"tags"`
	ExpectedVersion int      `json:"expectedVersion"`
	Summary         string   `json:"summary,omitempty"`
}

// CreateDocumentInput creates a workspace document from structured blocks.
type CreateDocumentInput struct {
	Title            string                        `json:"title"`
	Category         string                        `json:"category,omitempty"`
	ParentDocumentID *string                       `json:"parentDocumentId,omitempty"`
	InitialBlocks    []mediamcp.DocumentBlockInput `json:"initialBlocks,omitempty"`
	Tags             []string                      `json:"tags,omitempty"`
	Summary          string                        `json:"summary,omitempty"`
}

// InsertBlockInput inserts one block near an anchor block.
type InsertBlockInput struct {
	DocumentID        string                            `json:"documentId"`
	Anchor            mediamcp.DocumentBlockAnchorInput `json:"anchor"`
	Block             mediamcp.DocumentBlockInput       `json:"block"`
	ExpectedBlockHash string                            `json:"expectedBlockHash"`
	ExpectedVersion   int                               `json:"expectedVersion"`
	Summary           string                            `json:"summary,omitempty"`
}

// UpdateBlockInput replaces one block.
type UpdateBlockInput struct {
	DocumentID        string                      `json:"documentId"`
	BlockID           string                      `json:"blockId"`
	Block             mediamcp.DocumentBlockInput `json:"block"`
	ExpectedBlockHash string                      `json:"expectedBlockHash"`
	ExpectedVersion   int                         `json:"expectedVersion"`
	Summary           string                      `json:"summary,omitempty"`
}

// PatchBlockAttrsInput updates attributes on one block.
type PatchBlockAttrsInput struct {
	DocumentID        string                       `json:"documentId"`
	BlockID           string                       `json:"blockId"`
	Attrs             *mediamcp.DocumentBlockAttrs `json:"attrs"`
	ExpectedBlockHash string                       `json:"expectedBlockHash"`
	ExpectedVersion   int                          `json:"expectedVersion"`
	Summary           string                       `json:"summary,omitempty"`
}

// DeleteBlockInput deletes one block.
type DeleteBlockInput struct {
	DocumentID        string `json:"documentId"`
	BlockID           string `json:"blockId"`
	ExpectedBlockHash string `json:"expectedBlockHash"`
	ExpectedVersion   int    `json:"expectedVersion"`
	Summary           string `json:"summary,omitempty"`
}

// MoveBlockInput moves one block within or across documents.
type MoveBlockInput struct {
	DocumentID            string                                `json:"documentId"`
	BlockID               string                                `json:"blockId"`
	Target                mediamcp.DocumentMoveBlockTargetInput `json:"target"`
	ExpectedBlockHash     string                                `json:"expectedBlockHash"`
	ExpectedVersion       int                                   `json:"expectedVersion"`
	TargetExpectedVersion *int                                  `json:"targetExpectedVersion,omitempty"`
	Summary               string                                `json:"summary,omitempty"`
}

// ReplaceSectionInput replaces blocks under one heading.
type ReplaceSectionInput struct {
	DocumentID      string                        `json:"documentId"`
	HeadingID       string                        `json:"headingId"`
	NewHeading      string                        `json:"newHeading,omitempty"`
	Blocks          []mediamcp.DocumentBlockInput `json:"blocks"`
	ExpectedVersion int                           `json:"expectedVersion"`
	Summary         string                        `json:"summary,omitempty"`
}

// ReorderSectionsInput reorders sibling heading sections.
type ReorderSectionsInput struct {
	DocumentID      string   `json:"documentId"`
	ParentHeadingID *string  `json:"parentHeadingId,omitempty"`
	Order           []string `json:"order"`
	ExpectedVersion int      `json:"expectedVersion"`
	Summary         string   `json:"summary,omitempty"`
}

// ReplaceSelectionInput replaces a structured text range.
type ReplaceSelectionInput struct {
	DocumentID        string                             `json:"documentId"`
	Selection         mediamcp.DocumentRangeSelection    `json:"selection"`
	Replacement       mediamcp.DocumentInlineReplacement `json:"replacement"`
	ExpectedBlockHash string                             `json:"expectedBlockHash"`
	ExpectedVersion   int                                `json:"expectedVersion"`
	Summary           string                             `json:"summary,omitempty"`
}

// AnnotateSelectionInput adds, removes, or toggles a mark over a range.
type AnnotateSelectionInput struct {
	DocumentID        string                           `json:"documentId"`
	Selection         mediamcp.DocumentRangeSelection  `json:"selection"`
	Mark              mediamcp.DocumentInlineMarkInput `json:"mark"`
	Op                string                           `json:"op"`
	ExpectedBlockHash string                           `json:"expectedBlockHash"`
	ExpectedVersion   int                              `json:"expectedVersion"`
	Summary           string                           `json:"summary,omitempty"`
}

// InsertInlineInput inserts inline content at a block offset.
type InsertInlineInput struct {
	DocumentID        string                                `json:"documentId"`
	Position          mediamcp.DocumentOffsetPosition       `json:"position"`
	Content           []mediamcp.DocumentInlineContentInput `json:"content"`
	ExpectedBlockHash string                                `json:"expectedBlockHash"`
	ExpectedVersion   int                                   `json:"expectedVersion"`
	Summary           string                                `json:"summary,omitempty"`
}

// BatchDocumentEditOperationInput is one operation in a batch edit request.
type BatchDocumentEditOperationInput struct {
	Type                  string                                 `json:"type"`
	DocumentID            string                                 `json:"documentId,omitempty"`
	ExpectedVersion       *int                                   `json:"expectedVersion,omitempty"`
	BlockID               string                                 `json:"blockId,omitempty"`
	Anchor                mediamcp.DocumentBlockAnchorInput      `json:"anchor,omitempty"`
	Block                 mediamcp.DocumentBlockInput            `json:"block,omitempty"`
	Attrs                 *mediamcp.DocumentBlockAttrs           `json:"attrs,omitempty"`
	ExpectedBlockHash     string                                 `json:"expectedBlockHash,omitempty"`
	Target                *mediamcp.DocumentMoveBlockTargetInput `json:"target,omitempty"`
	TargetExpectedVersion *int                                   `json:"targetExpectedVersion,omitempty"`
	HeadingID             string                                 `json:"headingId,omitempty"`
	NewHeading            string                                 `json:"newHeading,omitempty"`
	Blocks                []mediamcp.DocumentBlockInput          `json:"blocks,omitempty"`
	ParentHeadingID       *string                                `json:"parentHeadingId,omitempty"`
	Order                 []string                               `json:"order,omitempty"`
	Selection             mediamcp.DocumentRangeSelection        `json:"selection,omitempty"`
	Replacement           mediamcp.DocumentInlineReplacement     `json:"replacement,omitempty"`
	Mark                  mediamcp.DocumentInlineMarkInput       `json:"mark,omitempty"`
	Op                    string                                 `json:"op,omitempty"`
	Position              mediamcp.DocumentOffsetPosition        `json:"position,omitempty"`
	Content               []mediamcp.DocumentInlineContentInput  `json:"content,omitempty"`
}

// BatchDocumentEditInput applies several document edits atomically.
type BatchDocumentEditInput struct {
	DocumentID      string                            `json:"documentId"`
	ExpectedVersion int                               `json:"expectedVersion"`
	Operations      []BatchDocumentEditOperationInput `json:"operations"`
	Summary         string                            `json:"summary,omitempty"`
}

// DocumentPatchEditPatchInput is one text patch in a document patch edit.
type DocumentPatchEditPatchInput struct {
	Op          string                     `json:"op"`
	Range       mediamcp.DocumentTextRange `json:"range"`
	Replacement string                     `json:"replacement"`
}

// DocumentPatchEditInput applies UTF-16 text patches to a document.
type DocumentPatchEditInput struct {
	DocumentID      string                        `json:"documentId"`
	ExpectedVersion int                           `json:"expectedVersion"`
	Patches         []DocumentPatchEditPatchInput `json:"patches"`
	Summary         string                        `json:"summary,omitempty"`
}
