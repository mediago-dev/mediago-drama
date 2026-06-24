package document

import (
	"fmt"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

// ValidateTemplateDocumentContent rejects malformed Markdown for template-backed documents.
func ValidateTemplateDocumentContent(document mediamcp.WorkspaceDocument, content string) error {
	return validateTemplateDocumentContent(document, content)
}

func validateTemplateDocumentContent(_ mediamcp.WorkspaceDocument, content string) error {
	if err := ValidateMarkdownDocumentStructure(content); err != nil {
		return fmt.Errorf("文档结构校验失败：%w", err)
	}
	return nil
}
