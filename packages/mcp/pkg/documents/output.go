package documents

import (
	"fmt"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

// NormalizeDocumentTags trims, deduplicates, and drops empty document tags.
func NormalizeDocumentTags(tags []string) []string {
	normalized := []string{}
	seen := map[string]bool{}
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || seen[tag] {
			continue
		}
		seen[tag] = true
		normalized = append(normalized, tag)
	}
	return normalized
}

// NormalizedDocumentVersion returns a positive document version.
func NormalizedDocumentVersion(version int) int {
	if version <= 0 {
		return 1
	}
	return version
}

// IncludeBoolDefault returns fallback when value is nil.
func IncludeBoolDefault(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

// StructuredDocumentOutput builds a structure-first document output payload.
func StructuredDocumentOutput(document mediamcp.WorkspaceDocument, includeComments bool, includeDraft bool) (mediamcp.GetDocumentOutput, error) {
	structure, err := ParseStructure(document.Content)
	if err != nil {
		return mediamcp.GetDocumentOutput{}, err
	}
	var draft *mediamcp.DocumentWorkbenchDraft
	if includeDraft {
		draft = document.WorkbenchDraft
	}
	output := mediamcp.GetDocumentOutput{
		ID:             document.ID,
		Title:          document.Title,
		Category:       document.Category,
		ParentID:       document.ParentID,
		SortOrder:      document.SortOrder,
		Tags:           NormalizeDocumentTags(document.Tags),
		Version:        NormalizedDocumentVersion(document.Version),
		UpdatedAt:      document.UpdatedAt,
		Structure:      structure.Blocks,
		Outline:        structure.Outline,
		Stats:          structure.Stats,
		WorkbenchDraft: draft,
	}
	if includeComments {
		output.Comments = BuildCommentThreads(document.Comments, true)
	}
	return output, nil
}

// WorkspaceSnapshotOutput builds a structure-light workspace snapshot payload.
func WorkspaceSnapshotOutput(
	metadata mediamcp.ListDocumentsOutput,
	activeDocumentID string,
	selection *mediamcp.DocumentRangeSelection,
) mediamcp.WorkspaceSnapshotOutput {
	openDocumentIDs := []string{}
	activeDocumentID = strings.TrimSpace(activeDocumentID)
	if activeDocumentID != "" {
		openDocumentIDs = append(openDocumentIDs, activeDocumentID)
	}
	return mediamcp.WorkspaceSnapshotOutput{
		ProjectID:        metadata.ProjectID,
		ActiveDocumentID: activeDocumentID,
		Selection:        selection,
		OpenDocumentIDs:  openDocumentIDs,
		Documents:        metadata.Documents,
	}
}

// LegacyWorkspaceSnapshotOutput builds the legacy workspace snapshot payload.
func LegacyWorkspaceSnapshotOutput(
	metadata mediamcp.ListDocumentsOutput,
	activeDocumentID string,
	selectionText string,
) mediamcp.LegacyWorkspaceSnapshotOutput {
	return mediamcp.LegacyWorkspaceSnapshotOutput{
		ProjectID:        metadata.ProjectID,
		ActiveDocumentID: strings.TrimSpace(activeDocumentID),
		SelectionText:    strings.TrimSpace(selectionText),
		Documents:        metadata.Documents,
	}
}

// ValidateDocumentSelection validates a document text range selection.
func ValidateDocumentSelection(document mediamcp.WorkspaceDocument, selection mediamcp.DocumentRangeSelection) error {
	block, err := DocumentBlockNode(document, selection.BlockID)
	if err != nil {
		return err
	}
	if _, ok := SelectedUTF16Text(block.Text, selection.Range); !ok {
		return fmt.Errorf("selection range is outside block %s", block.ID)
	}
	return nil
}

// DocumentBlockNode returns one parsed document block by ID.
func DocumentBlockNode(document mediamcp.WorkspaceDocument, blockID string) (mediamcp.DocumentBlockNode, error) {
	structure, err := ParseStructure(document.Content)
	if err != nil {
		return mediamcp.DocumentBlockNode{}, err
	}
	blockID = strings.TrimSpace(blockID)
	block, ok := structure.BlockByID[blockID]
	if !ok {
		return mediamcp.DocumentBlockNode{}, fmt.Errorf("blockId not found: %s", blockID)
	}
	return block, nil
}

// DocumentOutlineOutput builds the heading outline response for a document.
func DocumentOutlineOutput(document mediamcp.WorkspaceDocument, maxLevel int) (mediamcp.GetDocumentOutlineOutput, error) {
	structure, err := ParseStructure(document.Content)
	if err != nil {
		return mediamcp.GetDocumentOutlineOutput{}, err
	}
	if maxLevel <= 0 {
		maxLevel = 4
	}
	outline := []mediamcp.DocumentHeadingNode{}
	for _, heading := range structure.Outline {
		if heading.Level <= maxLevel {
			outline = append(outline, heading)
		}
	}
	return mediamcp.GetDocumentOutlineOutput{DocumentID: document.ID, Version: document.Version, Outline: outline}, nil
}

// DocumentBlockSiblings returns parent, previous sibling, and next sibling IDs.
func DocumentBlockSiblings(blocks []mediamcp.DocumentBlockNode, blockID string) (string, string, string) {
	for index, block := range blocks {
		if block.ID == blockID {
			prevID := ""
			nextID := ""
			if index > 0 {
				prevID = blocks[index-1].ID
			}
			if index+1 < len(blocks) {
				nextID = blocks[index+1].ID
			}
			return "", prevID, nextID
		}
		if parentID, prevID, nextID := DocumentBlockSiblings(block.Children, blockID); parentID != "" || prevID != "" || nextID != "" {
			if parentID == "" {
				parentID = block.ID
			}
			return parentID, prevID, nextID
		}
	}
	return "", "", ""
}

// DocumentBlockOutput builds the block response for a document block ID.
func DocumentBlockOutput(document mediamcp.WorkspaceDocument, blockID string, includeChildren bool) (mediamcp.GetDocumentBlockOutput, error) {
	structure, err := ParseStructure(document.Content)
	if err != nil {
		return mediamcp.GetDocumentBlockOutput{}, err
	}
	blockID = strings.TrimSpace(blockID)
	block, ok := structure.BlockByID[blockID]
	if !ok {
		return mediamcp.GetDocumentBlockOutput{}, fmt.Errorf("blockId not found: %s", blockID)
	}
	if !includeChildren {
		block.Children = nil
	}
	parentID, prevID, nextID := DocumentBlockSiblings(structure.Blocks, block.ID)
	return mediamcp.GetDocumentBlockOutput{Block: block, ParentID: parentID, PrevSiblingID: prevID, NextSiblingID: nextID}, nil
}

// DocumentSectionOutput builds the section response under a heading block.
func DocumentSectionOutput(document mediamcp.WorkspaceDocument, headingID string) (mediamcp.GetDocumentSectionOutput, error) {
	structure, err := ParseStructure(document.Content)
	if err != nil {
		return mediamcp.GetDocumentSectionOutput{}, err
	}
	headingID = strings.TrimSpace(headingID)
	block, ok := structure.BlockByID[headingID]
	if !ok {
		return mediamcp.GetDocumentSectionOutput{}, fmt.Errorf("blockId not found: %s", headingID)
	}
	if block.Kind != "heading" {
		return mediamcp.GetDocumentSectionOutput{}, fmt.Errorf("block %s is not a heading", headingID)
	}
	sectionRange := SectionLineRange(structure, block)
	blocks := []mediamcp.DocumentBlockNode{}
	for _, candidate := range FlattenBlocks(structure.Blocks) {
		if candidate.ID == block.ID {
			continue
		}
		if candidate.Range.StartLine > block.Range.StartLine && candidate.Range.EndLine <= sectionRange.EndLine {
			blocks = append(blocks, candidate)
		}
	}
	return mediamcp.GetDocumentSectionOutput{
		Heading: mediamcp.DocumentHeadingNode{ID: block.ID, Text: block.Text, Level: block.Level, Range: block.Range, Hash: block.Hash},
		Blocks:  blocks,
	}, nil
}
