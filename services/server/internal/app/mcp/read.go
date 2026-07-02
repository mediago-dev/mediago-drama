package mcp

import (
	"context"
	"errors"
	"fmt"
	"strings"

	instructiontemplates "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/templates"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"
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
	registry := adapter.skillRegistry
	if registry == nil {
		registry = serviceskill.NewRegistry()
	}
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
	content := item.Content
	var template *mediamcp.DocumentTemplate
	if strings.TrimSpace(item.TemplateID) != "" {
		resolved, err := instructiontemplates.TemplateByID(ctx, item.TemplateID)
		if err != nil {
			return mediamcp.LoadSkillOutput{Name: item.Name}, err
		}
		template = mcpDocumentTemplate(resolved)
		content = appendDocumentStructureRules(content, resolved)
	}
	return mediamcp.LoadSkillOutput{Name: item.Name, Content: content, Template: template}, nil
}

func appendDocumentStructureRules(content string, template instructiontemplates.Template) string {
	content = strings.TrimSpace(content)
	body := strings.TrimSpace(template.Body)
	if body == "" {
		return normalizeMCPContent(content)
	}
	sections := []string{}
	if content != "" {
		sections = append(sections, content)
	}
	sections = append(sections, strings.Join([]string{
		"## 系统内置文档结构规则（内部）",
		"",
		"新建或填写本类型文档时，必须遵守下面的内部结构规则。结构规则由 MediaGo Drama 内置管理；编辑 Skill 时不要改写、删除或复述这些规则。",
		"",
		"```markdown",
		body,
		"```",
	}, "\n"))
	return normalizeMCPContent(strings.Join(sections, "\n\n"))
}

func mcpDocumentTemplate(template instructiontemplates.Template) *mediamcp.DocumentTemplate {
	return &mediamcp.DocumentTemplate{
		ID:               template.ID,
		Name:             template.Name,
		Description:      template.Description,
		DocumentCategory: template.DocumentCategory,
	}
}

func normalizeMCPContent(content string) string {
	content = strings.TrimSpace(strings.ReplaceAll(content, "\r\n", "\n"))
	if content == "" {
		return ""
	}
	return content + "\n"
}

func mcpSkillMetas(metas []serviceskill.SkillMeta) []mediamcp.SkillMeta {
	result := make([]mediamcp.SkillMeta, 0, len(metas))
	for _, meta := range metas {
		result = append(result, mediamcp.SkillMeta{
			Name:        meta.Name,
			Description: meta.Description,
			Source:      string(meta.Source),
			TemplateID:  meta.TemplateID,
			Hint:        meta.Hint,
		})
	}
	return result
}
