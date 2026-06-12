package documents

import (
	"fmt"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"sort"
	"strings"
)

// MoveBlockContentResult describes the Markdown content updates for a block move.
type MoveBlockContentResult struct {
	SourceContent string
	TargetContent string
	BlockID       string
	SameDocument  bool
}

// InsertDocumentBlockContent inserts a rendered block relative to an anchor block.
func InsertDocumentBlockContent(document mediamcp.WorkspaceDocument, anchorID string, position string, expectedBlockHash string, block mediamcp.DocumentBlockInput) (string, string, error) {
	structure, err := ParseStructure(document.Content)
	if err != nil {
		return "", "", err
	}
	anchorID = strings.TrimSpace(anchorID)
	anchor, ok := structure.BlockByID[anchorID]
	if !ok {
		return "", "", fmt.Errorf("blockId not found: %s", anchorID)
	}
	if err := EnsureExpectedBlockHash(anchor, expectedBlockHash); err != nil {
		return "", "", err
	}
	lineIndex, err := InsertionLineIndex(anchor, position)
	if err != nil {
		return "", "", err
	}
	return InsertMarkdownAtLine(document.Content, lineIndex, RenderBlockInput(block)), anchor.ID, nil
}

// UpdateDocumentBlockContent replaces a block with rendered Markdown.
func UpdateDocumentBlockContent(document mediamcp.WorkspaceDocument, blockID string, expectedBlockHash string, block mediamcp.DocumentBlockInput) (string, string, error) {
	structure, err := ParseStructure(document.Content)
	if err != nil {
		return "", "", err
	}
	blockID = strings.TrimSpace(blockID)
	target, ok := structure.BlockByID[blockID]
	if !ok {
		return "", "", fmt.Errorf("blockId not found: %s", blockID)
	}
	if err := EnsureExpectedBlockHash(target, expectedBlockHash); err != nil {
		return "", "", err
	}
	return ReplaceMarkdownLineRange(document.Content, target.Range, RenderBlockInput(block)), target.ID, nil
}

// PatchDocumentBlockAttrsContent applies supported attribute changes to a block.
func PatchDocumentBlockAttrsContent(document mediamcp.WorkspaceDocument, blockID string, expectedBlockHash string, attrs *mediamcp.DocumentBlockAttrs) (string, string, error) {
	structure, err := ParseStructure(document.Content)
	if err != nil {
		return "", "", err
	}
	blockID = strings.TrimSpace(blockID)
	block, ok := structure.BlockByID[blockID]
	if !ok {
		return "", "", fmt.Errorf("blockId not found: %s", blockID)
	}
	if err := EnsureExpectedBlockHash(block, expectedBlockHash); err != nil {
		return "", "", err
	}
	nextMarkdown, err := PatchBlockMarkdownAttrs(block, attrs)
	if err != nil {
		return "", "", err
	}
	return ReplaceMarkdownLineRange(document.Content, block.Range, nextMarkdown), block.ID, nil
}

// DeleteDocumentBlockContent removes a block from a document.
func DeleteDocumentBlockContent(document mediamcp.WorkspaceDocument, blockID string, expectedBlockHash string) (string, string, error) {
	structure, err := ParseStructure(document.Content)
	if err != nil {
		return "", "", err
	}
	blockID = strings.TrimSpace(blockID)
	block, ok := structure.BlockByID[blockID]
	if !ok {
		return "", "", fmt.Errorf("blockId not found: %s", blockID)
	}
	if err := EnsureExpectedBlockHash(block, expectedBlockHash); err != nil {
		return "", "", err
	}
	return ReplaceMarkdownLineRange(document.Content, block.Range, ""), block.ID, nil
}

// MoveDocumentBlockContent computes the source and target Markdown after a block move.
func MoveDocumentBlockContent(
	sourceDocument mediamcp.WorkspaceDocument,
	targetDocument mediamcp.WorkspaceDocument,
	blockID string,
	expectedBlockHash string,
	anchor mediamcp.DocumentBlockAnchorInput,
) (MoveBlockContentResult, error) {
	sourceStructure, err := ParseStructure(sourceDocument.Content)
	if err != nil {
		return MoveBlockContentResult{}, err
	}
	blockID = strings.TrimSpace(blockID)
	block, ok := sourceStructure.BlockByID[blockID]
	if !ok {
		return MoveBlockContentResult{}, fmt.Errorf("blockId not found: %s", blockID)
	}
	if err := EnsureExpectedBlockHash(block, expectedBlockHash); err != nil {
		return MoveBlockContentResult{}, err
	}
	targetStructure, err := ParseStructure(targetDocument.Content)
	if err != nil {
		return MoveBlockContentResult{}, err
	}
	anchorID := strings.TrimSpace(anchor.BlockID)
	targetAnchor, ok := targetStructure.BlockByID[anchorID]
	if !ok {
		return MoveBlockContentResult{}, fmt.Errorf("blockId not found: %s", anchorID)
	}
	result := MoveBlockContentResult{BlockID: block.ID, SameDocument: sourceDocument.ID == targetDocument.ID}
	if result.SameDocument {
		withoutBlock := ReplaceMarkdownLineRange(sourceDocument.Content, block.Range, "")
		reparsed, _ := ParseStructure(withoutBlock)
		nextAnchor, ok := reparsed.BlockByID[targetAnchor.ID]
		if !ok {
			return MoveBlockContentResult{}, fmt.Errorf("target anchor drifted after removing block; re-read before retrying")
		}
		lineIndex, err := InsertionLineIndex(nextAnchor, anchor.Position)
		if err != nil {
			return MoveBlockContentResult{}, err
		}
		result.SourceContent = InsertMarkdownAtLine(withoutBlock, lineIndex, block.Markdown)
		result.TargetContent = result.SourceContent
		return result, nil
	}
	lineIndex, err := InsertionLineIndex(targetAnchor, anchor.Position)
	if err != nil {
		return MoveBlockContentResult{}, err
	}
	result.SourceContent = ReplaceMarkdownLineRange(sourceDocument.Content, block.Range, "")
	result.TargetContent = InsertMarkdownAtLine(targetDocument.Content, lineIndex, block.Markdown)
	return result, nil
}

// ReplaceDocumentSectionContent replaces a heading section. When newHeading is
// non-empty, it also renames the heading in the same content mutation.
func ReplaceDocumentSectionContent(document mediamcp.WorkspaceDocument, headingID string, newHeading string, blocks []mediamcp.DocumentBlockInput) (string, string, error) {
	structure, err := ParseStructure(document.Content)
	if err != nil {
		return "", "", err
	}
	headingID = strings.TrimSpace(headingID)
	heading, ok := structure.BlockByID[headingID]
	if !ok {
		return "", "", fmt.Errorf("blockId not found: %s", headingID)
	}
	if heading.Kind != "heading" {
		return "", "", fmt.Errorf("block %s is not a heading", heading.ID)
	}
	sectionRange := SectionLineRange(structure, heading)
	replacement := RenderBlockInputs(blocks)
	newHeading = strings.TrimSpace(newHeading)
	if newHeading == "" {
		replaceRange := mediamcp.DocumentLineRange{StartLine: heading.Range.EndLine + 1, EndLine: sectionRange.EndLine}
		return ReplaceMarkdownLineRange(document.Content, replaceRange, replacement), heading.ID, nil
	}
	sectionMarkdown := strings.Repeat("#", heading.Level) + " " + newHeading
	if strings.TrimSpace(replacement) != "" {
		sectionMarkdown += "\n" + strings.TrimRight(replacement, "\n")
	}
	return ReplaceMarkdownLineRange(document.Content, sectionRange, sectionMarkdown), heading.ID, nil
}

// ReorderDocumentSectionsContent reorders heading sections in a document.
func ReorderDocumentSectionsContent(document mediamcp.WorkspaceDocument, parentHeadingID *string, order []string) (string, error) {
	structure, err := ParseStructure(document.Content)
	if err != nil {
		return "", err
	}
	return ReorderDocumentSections(document.Content, structure, parentHeadingID, order)
}

// ReplaceDocumentSelectionContent replaces a selected text range in a document.
func ReplaceDocumentSelectionContent(document mediamcp.WorkspaceDocument, selection mediamcp.DocumentRangeSelection, replacement string, expectedBlockHash string) (string, string, error) {
	structure, err := ParseStructure(document.Content)
	if err != nil {
		return "", "", err
	}
	nextContent, err := ReplaceWorkspaceToolSelection(document.Content, structure, selection, replacement, expectedBlockHash)
	if err != nil {
		return "", "", err
	}
	return nextContent, strings.TrimSpace(selection.BlockID), nil
}

// AnnotateDocumentSelectionContent applies an inline mark to a selected text range.
func AnnotateDocumentSelectionContent(document mediamcp.WorkspaceDocument, selection mediamcp.DocumentRangeSelection, mark mediamcp.DocumentInlineMarkInput, op string, expectedBlockHash string) (string, string, error) {
	structure, err := ParseStructure(document.Content)
	if err != nil {
		return "", "", err
	}
	block, ok := structure.BlockByID[selection.BlockID]
	if !ok {
		return "", "", fmt.Errorf("blockId not found: %s", selection.BlockID)
	}
	if err := EnsureExpectedBlockHash(block, expectedBlockHash); err != nil {
		return "", "", err
	}
	selected, ok := SelectedUTF16Text(block.Text, selection.Range)
	if !ok {
		return "", "", fmt.Errorf("selection range is outside block %s", block.ID)
	}
	replacement := ApplyInlineMark(selected, mark, op)
	nextMarkdown, err := ReplaceTextInBlockMarkdown(block, selection.Range, replacement)
	if err != nil {
		return "", "", err
	}
	return ReplaceMarkdownLineRange(document.Content, block.Range, nextMarkdown), block.ID, nil
}

// InsertDocumentInlineContent inserts inline content at an offset inside a block.
func InsertDocumentInlineContent(document mediamcp.WorkspaceDocument, position mediamcp.DocumentOffsetPosition, content []mediamcp.DocumentInlineContentInput, expectedBlockHash string) (string, string, error) {
	selection := mediamcp.DocumentRangeSelection{
		BlockID: strings.TrimSpace(position.BlockID),
		Range:   mediamcp.DocumentTextRange{Start: position.Offset, End: position.Offset},
	}
	return ReplaceDocumentSelectionContent(document, selection, RenderInlineContents(content), expectedBlockHash)
}

// ReorderDocumentSections reorders sibling markdown sections by heading ID.
func ReorderDocumentSections(content string, structure Structure, parentHeadingID *string, order []string) (string, error) {
	if len(order) == 0 {
		return "", fmt.Errorf("order is required")
	}
	seen := map[string]bool{}
	sections := []mediamcp.DocumentBlockNode{}
	for _, id := range order {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return "", fmt.Errorf("order must contain unique heading ids")
		}
		seen[id] = true
		block, ok := structure.BlockByID[id]
		if !ok || block.Kind != "heading" {
			return "", fmt.Errorf("headingId not found: %s", id)
		}
		sections = append(sections, block)
	}
	level := sections[0].Level
	for _, section := range sections {
		if section.Level != level {
			return "", fmt.Errorf("all heading ids must be siblings with the same level")
		}
	}
	if parentHeadingID != nil && strings.TrimSpace(*parentHeadingID) != "" {
		parent, ok := structure.BlockByID[strings.TrimSpace(*parentHeadingID)]
		if !ok || parent.Kind != "heading" {
			return "", fmt.Errorf("parentHeadingId not found: %s", *parentHeadingID)
		}
		for _, section := range sections {
			if section.Range.StartLine <= parent.Range.StartLine || section.Level <= parent.Level {
				return "", fmt.Errorf("heading %s is not a child of parentHeadingId", section.ID)
			}
		}
	}
	type sectionChunk struct {
		id    string
		start int
		end   int
		lines []string
	}
	lines := SplitMarkdownLines(content)
	chunks := []sectionChunk{}
	for _, section := range sections {
		lineRange := SectionLineRange(structure, section)
		start := ClampInt(lineRange.StartLine-1, 0, len(lines))
		end := ClampInt(lineRange.EndLine, start, len(lines))
		chunks = append(chunks, sectionChunk{id: section.ID, start: start, end: end, lines: append([]string(nil), lines[start:end]...)})
	}
	sort.Slice(chunks, func(first int, second int) bool {
		return chunks[first].start < chunks[second].start
	})
	for index := 1; index < len(chunks); index++ {
		if chunks[index].start < chunks[index-1].end {
			return "", fmt.Errorf("sections overlap; re-read outline before retrying")
		}
	}
	regionStart := chunks[0].start
	regionEnd := chunks[len(chunks)-1].end
	chunkByID := map[string][]string{}
	for _, chunk := range chunks {
		chunkByID[chunk.id] = chunk.lines
	}
	reordered := []string{}
	for _, id := range order {
		reordered = append(reordered, chunkByID[id]...)
	}
	next := append([]string{}, lines[:regionStart]...)
	next = append(next, reordered...)
	next = append(next, lines[regionEnd:]...)
	return NormalizeEditedMarkdown(strings.Join(next, "\n")), nil
}
