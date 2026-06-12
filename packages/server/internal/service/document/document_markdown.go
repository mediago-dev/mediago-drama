package document

import (
	docs "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/documents"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

// RenderBlockInputs renders a list of structured block inputs as Markdown.
func RenderBlockInputs(blocks []mediamcp.DocumentBlockInput) string {
	return docs.RenderBlockInputs(blocks)
}

// RenderBlockInput renders one structured block input as Markdown.
func RenderBlockInput(block mediamcp.DocumentBlockInput) string {
	return docs.RenderBlockInput(block)
}

// RenderInlineReplacement renders flexible inline replacement input.
func RenderInlineReplacement(value mediamcp.DocumentInlineReplacement) string {
	return docs.RenderInlineReplacement(value)
}

// RenderInlineContents renders inline content inputs as Markdown text.
func RenderInlineContents(contents []mediamcp.DocumentInlineContentInput) string {
	return docs.RenderInlineContents(contents)
}

// ApplyInlineMark applies, removes, or toggles one inline mark.
func ApplyInlineMark(text string, mark mediamcp.DocumentInlineMarkInput, op string) string {
	return docs.ApplyInlineMark(text, mark, op)
}

// ReplaceTextInBlockMarkdown replaces a UTF-16 text range inside a block.
func ReplaceTextInBlockMarkdown(block mediamcp.DocumentBlockNode, textRange mediamcp.DocumentTextRange, replacement string) (string, error) {
	return docs.ReplaceTextInBlockMarkdown(block, textRange, replacement)
}

// EnsureExpectedBlockHash validates an optimistic block hash.
func EnsureExpectedBlockHash(block mediamcp.DocumentBlockNode, expected string) error {
	return docs.EnsureExpectedBlockHash(block, expected)
}

// ReplaceWorkspaceToolSelection replaces a selected text range inside content.
func ReplaceWorkspaceToolSelection(content string, structure docs.Structure, selection mediamcp.DocumentRangeSelection, replacement string, expectedBlockHash string) (string, error) {
	return docs.ReplaceWorkspaceToolSelection(content, structure, selection, replacement, expectedBlockHash)
}

// SelectionFromDocumentContent locates quote inside a document and returns a block-range selection.
func SelectionFromDocumentContent(content string, quote string) (*mediamcp.DocumentRangeSelection, error) {
	return docs.SelectionFromDocumentContent(content, quote)
}

// IsEmptyDocumentBlockInput reports whether a block input has no content.
func IsEmptyDocumentBlockInput(block mediamcp.DocumentBlockInput) bool {
	return docs.IsEmptyDocumentBlockInput(block)
}

// PatchBlockMarkdownAttrs patches Markdown syntax for supported block attrs.
func PatchBlockMarkdownAttrs(block mediamcp.DocumentBlockNode, attrs *mediamcp.DocumentBlockAttrs) (string, error) {
	return docs.PatchBlockMarkdownAttrs(block, attrs)
}

// InsertionLineIndex returns the line index for inserting around an anchor block.
func InsertionLineIndex(anchor mediamcp.DocumentBlockNode, position string) (int, error) {
	return docs.InsertionLineIndex(anchor, position)
}

// IncludeBoolDefault returns fallback when value is nil.
func IncludeBoolDefault(value *bool, fallback bool) bool {
	return docs.IncludeBoolDefault(value, fallback)
}
