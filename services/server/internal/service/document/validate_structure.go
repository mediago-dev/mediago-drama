package document

import docs "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/documents"

// ValidateMarkdownDocumentStructure rejects document-wide Markdown shapes that tend to cause repair edits.
func ValidateMarkdownDocumentStructure(content string) error {
	return docs.ValidateMarkdownDocumentStructure(content)
}
