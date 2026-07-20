package generation

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptlibrary"
)

// resolveGenerationPromptReferences replaces opaque prompt IDs with their
// server-side bodies immediately before use. Imported prompt bodies therefore
// never need to cross the management or renderer API boundary.
func (workflow *GenerationService) resolveGenerationPromptReferences(
	ctx context.Context,
	payload *generationMessageRequest,
) (int, error) {
	if payload == nil {
		return http.StatusBadRequest, fmt.Errorf("缺少生成请求")
	}
	for index := range payload.PromptSupplements {
		item := &payload.PromptSupplements[index]
		entry, resolved, err := workflow.resolvePromptReference(ctx, item.ReferenceID, item.ReferencePrompt)
		if err != nil {
			return http.StatusBadRequest, fmt.Errorf("解析补充提示词 %q: %w", strings.TrimSpace(item.ReferenceID), err)
		}
		if !resolved {
			continue
		}
		item.ReferenceID = entry.ID
		item.ReferenceName = entry.Name
		item.ReferencePrompt = entry.Prompt
		payload.SourceRefs = appendPromptEntrySourceRef(payload.SourceRefs, entry)
	}
	if optimization := payload.PromptOptimization; optimization != nil {
		entry, resolved, err := workflow.resolvePromptReference(
			ctx,
			optimization.ReferenceID,
			optimization.ReferencePrompt,
		)
		if err != nil {
			return http.StatusBadRequest, fmt.Errorf("解析优化提示词 %q: %w", strings.TrimSpace(optimization.ReferenceID), err)
		}
		if resolved {
			optimization.ReferenceID = entry.ID
			optimization.ReferenceName = entry.Name
			optimization.ReferencePrompt = entry.Prompt
			payload.SourceRefs = appendPromptEntrySourceRef(payload.SourceRefs, entry)
		}
	}
	return http.StatusOK, nil
}

func (workflow *GenerationService) resolvePromptReference(
	ctx context.Context,
	referenceID string,
	referencePrompt string,
) (promptlibrary.PromptEntry, bool, error) {
	referenceID = strings.TrimSpace(referenceID)
	if referenceID == "" {
		return promptlibrary.PromptEntry{}, false, nil
	}
	if workflow == nil || workflow.stylePrompts == nil {
		if strings.TrimSpace(referencePrompt) != "" {
			return promptlibrary.PromptEntry{}, false, nil
		}
		return promptlibrary.PromptEntry{}, false, fmt.Errorf("提示词库不可用")
	}
	source, ok := workflow.stylePrompts.(interface {
		Get(context.Context, string) (promptlibrary.PromptEntry, error)
	})
	if !ok {
		if strings.TrimSpace(referencePrompt) != "" {
			return promptlibrary.PromptEntry{}, false, nil
		}
		return promptlibrary.PromptEntry{}, false, fmt.Errorf("提示词库不可用")
	}
	entry, err := source.Get(ctx, referenceID)
	if err != nil {
		return promptlibrary.PromptEntry{}, false, err
	}
	if strings.TrimSpace(entry.Prompt) == "" {
		return promptlibrary.PromptEntry{}, false, fmt.Errorf("提示词内容为空")
	}
	return entry, true, nil
}

func appendPromptEntrySourceRef(refs []ContentSourceRef, entry promptlibrary.PromptEntry) []ContentSourceRef {
	packageID := strings.TrimSpace(entry.SourcePackageID)
	releaseID := strings.TrimSpace(entry.SourceReleaseID)
	if packageID == "" || releaseID == "" {
		return refs
	}
	return append(refs, ContentSourceRef{PackageID: packageID, ReleaseID: releaseID})
}
