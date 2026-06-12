package agent

import (
	"encoding/json"
	"strings"

	"github.com/torchstellar-team/mediago-drama/packages/server/internal/service/model"
)

const (
	agentA2UIVersion        = "v0.9"
	agentA2UIBasicCatalogID = "https://a2ui.org/specification/v0_9/basic_catalog.json"

	AgentA2UIActionAgentPermission      = "agent.permission.decide"
	AgentA2UIActionDocumentToolApproval = "document_tool_approval.decide"
)

// BuildAgentPermissionA2UI builds the deterministic UI surface for ACP
// permission decisions.
func BuildAgentPermissionA2UI(request AgentACPPermissionRequest) *AgentA2UIPayload {
	surfaceID := "agent-permission-" + strings.TrimSpace(request.RequestID)
	if strings.TrimSpace(request.RequestID) == "" {
		surfaceID = "agent-permission"
	}
	title := "需要确认工具权限"
	toolTitle := "ACP 工具调用"
	toolKind := ""
	if request.ToolCall != nil {
		toolTitle = firstNonEmpty(request.ToolCall.Title, request.ToolCall.ID, request.ToolCall.Kind, toolTitle)
		toolKind = request.ToolCall.Kind
	}

	children := []string{"title", "summary"}
	components := []map[string]any{
		a2uiText("title", title, "h5"),
		a2uiText("summary", "智能体请求执行："+toolTitle, "body"),
	}
	if strings.TrimSpace(toolKind) != "" {
		children = append(children, "detail")
		components = append(components, a2uiText("detail", "工具类型："+toolKind, "caption"))
	}

	actionChildren := make([]string, 0, len(request.Options))
	for index, option := range request.Options {
		optionID := strings.TrimSpace(option.OptionID)
		if optionID == "" {
			continue
		}
		labelID := "permission-option-label-" + optionID
		buttonID := "permission-option-" + optionID
		actionChildren = append(actionChildren, buttonID)
		components = append(components,
			a2uiText(labelID, a2uiPermissionOptionLabel(option), "body"),
			a2uiButton(
				buttonID,
				labelID,
				a2uiButtonVariantForPermission(option),
				AgentA2UIActionAgentPermission,
				map[string]any{
					"kind":      "agent_permission",
					"requestId": request.RequestID,
					"optionId":  optionID,
				},
			),
		)
		if index >= 4 {
			break
		}
	}
	if len(actionChildren) > 0 {
		children = append(children, "actions")
		components = append(components, a2uiRow("actions", actionChildren))
	}

	components = append([]map[string]any{a2uiColumn("root", children)}, components...)
	return newA2UIPayload(surfaceID, components)
}

// BuildDocumentToolApprovalA2UI builds the deterministic UI surface for
// dangerous document tool confirmations.
func BuildDocumentToolApprovalA2UI(approval model.DocumentToolApprovalRecord) *AgentA2UIPayload {
	surfaceID := "document-tool-approval-" + strings.TrimSpace(approval.ID)
	if strings.TrimSpace(approval.ID) == "" {
		surfaceID = "document-tool-approval"
	}
	title := firstNonEmpty(approval.Title, "需要确认危险操作")
	document := firstNonEmpty(approval.DocumentID, approval.Request.DocumentID, "目标文档")
	summary := firstNonEmpty(approval.Summary, approval.Request.Summary, "智能体请求执行可能破坏文档内容的操作。")

	components := []map[string]any{
		a2uiColumn("root", []string{"title", "summary", "document", "actions"}),
		a2uiText("title", title, "h5"),
		a2uiText("summary", summary, "body"),
		a2uiText("document", "文档："+document, "caption"),
		a2uiRow("actions", []string{"reject", "approve"}),
		a2uiText("reject-label", "拒绝", "body"),
		a2uiText("approve-label", "确认执行", "body"),
		a2uiButton(
			"reject",
			"reject-label",
			"default",
			AgentA2UIActionDocumentToolApproval,
			map[string]any{
				"kind":       "document_tool_approval",
				"projectId":  approval.ProjectID,
				"approvalId": approval.ID,
				"decision":   "rejected",
			},
		),
		a2uiButton(
			"approve",
			"approve-label",
			"primary",
			AgentA2UIActionDocumentToolApproval,
			map[string]any{
				"kind":       "document_tool_approval",
				"projectId":  approval.ProjectID,
				"approvalId": approval.ID,
				"decision":   "approved",
			},
		),
	}
	return newA2UIPayload(surfaceID, components)
}

func newA2UIPayload(surfaceID string, components []map[string]any) *AgentA2UIPayload {
	messages := []map[string]any{
		{
			"version": agentA2UIVersion,
			"createSurface": map[string]any{
				"surfaceId": surfaceID,
				"catalogId": agentA2UIBasicCatalogID,
			},
		},
		{
			"version": agentA2UIVersion,
			"updateComponents": map[string]any{
				"surfaceId":  surfaceID,
				"components": components,
			},
		},
	}
	raw, err := json.Marshal(messages)
	if err != nil {
		return nil
	}
	return &AgentA2UIPayload{
		Version:   agentA2UIVersion,
		SurfaceID: surfaceID,
		Messages:  raw,
	}
}

func a2uiColumn(id string, children []string) map[string]any {
	return map[string]any{
		"id":        id,
		"component": "Column",
		"children":  children,
		"align":     "stretch",
	}
}

func a2uiRow(id string, children []string) map[string]any {
	return map[string]any{
		"id":        id,
		"component": "Row",
		"children":  children,
		"justify":   "end",
		"align":     "center",
	}
}

func a2uiText(id string, text string, variant string) map[string]any {
	component := map[string]any{
		"id":        id,
		"component": "Text",
		"text":      text,
	}
	if strings.TrimSpace(variant) != "" {
		component["variant"] = variant
	}
	return component
}

func a2uiButton(id string, child string, variant string, eventName string, context map[string]any) map[string]any {
	button := map[string]any{
		"id":        id,
		"component": "Button",
		"child":     child,
		"action": map[string]any{
			"event": map[string]any{
				"name":    eventName,
				"context": context,
			},
		},
	}
	if strings.TrimSpace(variant) != "" {
		button["variant"] = variant
	}
	return button
}

func a2uiButtonVariantForPermission(option AgentACPPermissionOption) string {
	kind := strings.ToLower(strings.TrimSpace(option.Kind))
	if strings.Contains(kind, "allow") {
		return "primary"
	}
	if strings.Contains(kind, "reject") {
		return "borderless"
	}
	return "default"
}

func a2uiPermissionOptionLabel(option AgentACPPermissionOption) string {
	kind := strings.ToLower(strings.TrimSpace(option.Kind))
	switch {
	case strings.Contains(kind, "allow") && a2uiPermissionKindIsPersistent(kind):
		return "始终允许"
	case strings.Contains(kind, "allow"):
		return "允许一次"
	case strings.Contains(kind, "reject") && a2uiPermissionKindIsPersistent(kind):
		return "始终拒绝"
	case strings.Contains(kind, "reject"):
		return "拒绝"
	}

	name := strings.TrimSpace(option.Name)
	if name != "" && len([]rune(name)) <= 12 {
		return name
	}
	return firstNonEmpty(option.Kind, option.OptionID, "选择")
}

func a2uiPermissionKindIsPersistent(kind string) bool {
	return strings.Contains(kind, "always") ||
		strings.Contains(kind, "permanent") ||
		strings.Contains(kind, "forever")
}
