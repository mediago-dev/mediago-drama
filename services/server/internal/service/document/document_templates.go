package document

import (
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/model"
)

const referenceDocumentCategory = model.ReferenceDocumentCategory

// IsBusinessTemplateCategory reports whether a category is backed by a creative document template.
func IsBusinessTemplateCategory(category string) bool {
	return isCreatableTemplateCategory(strings.TrimSpace(category))
}

func normalizeCreateDocumentRequest(request createWorkspaceDocumentRequest) (createWorkspaceDocumentRequest, error) {
	request.Category = NormalizeDocumentCategoryValue(request.Category)
	if err := ValidateDocumentCategory(request.Category); err != nil {
		return request, err
	}
	if request.Category == "" {
		request.Category = referenceDocumentCategory
		return request, nil
	}
	if request.Category == referenceDocumentCategory {
		return request, nil
	}

	if strings.TrimSpace(request.Content) == "" {
		return request, nil
	}
	if err := ValidateTemplateDocumentContent(mediamcp.WorkspaceDocument{Category: request.Category}, request.Content); err != nil {
		return request, err
	}
	return request, nil
}

func isCreatableTemplateCategory(category string) bool {
	switch category {
	case "screenplay", "character", "scene", "prop", "storyboard":
		return true
	default:
		return false
	}
}
