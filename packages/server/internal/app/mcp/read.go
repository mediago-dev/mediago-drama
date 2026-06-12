package mcp

import (
	"context"
	"errors"
	"fmt"

	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
	serviceskill "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/skill"
)

func (adapter *Adapter) getWorkspaceDocument(projectID string, documentID string) (mediamcp.WorkspaceDocument, error) {
	if adapter == nil || adapter.store == nil {
		return mediamcp.WorkspaceDocument{}, fmt.Errorf("workspace store is not configured")
	}
	projectID, err := adapter.normalizeProjectID(projectID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, err
	}
	document, err := adapter.store.RequireWorkspaceDocument(projectID, documentID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, err
	}
	if adapter.document != nil {
		adapter.document.rememberDocumentVersion(document)
	}
	return document, nil
}

func (adapter *Adapter) getWorkspaceDocumentBlock(
	projectID string,
	documentID string,
	blockID string,
) (mediamcp.WorkspaceDocument, mediamcp.DocumentBlockNode, error) {
	projectID, err := adapter.normalizeProjectID(projectID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, mediamcp.DocumentBlockNode{}, err
	}
	document, block, err := adapter.store.RequireWorkspaceDocumentBlock(projectID, documentID, blockID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, mediamcp.DocumentBlockNode{}, err
	}
	if adapter.document != nil {
		adapter.document.rememberDocumentVersion(document)
	}
	return document, block, nil
}

func (adapter *Adapter) LoadSkill(ctx context.Context, projectID string, input mediamcp.LoadSkillInput) (mediamcp.LoadSkillOutput, error) {
	_ = projectID
	registry := serviceskill.NewRegistry()
	item, err := registry.Get(ctx, input.Name)
	if err != nil {
		output := mediamcp.LoadSkillOutput{Name: input.Name}
		if errors.Is(err, serviceskill.ErrSkillNotFound) {
			if metas, listErr := registry.List(ctx); listErr == nil {
				output.Available = mcpSkillMetas(metas)
			}
		}
		return output, err
	}
	return mediamcp.LoadSkillOutput{Name: item.Name, Content: item.Content}, nil
}

func mcpSkillMetas(metas []serviceskill.SkillMeta) []mediamcp.SkillMeta {
	result := make([]mediamcp.SkillMeta, 0, len(metas))
	for _, meta := range metas {
		result = append(result, mediamcp.SkillMeta{
			Name:        meta.Name,
			Description: meta.Description,
			Source:      string(meta.Source),
			Hint:        meta.Hint,
		})
	}
	return result
}
