package acp

import (
	"encoding/json"
	"strings"

	acp "github.com/coder/acp-go-sdk"
)

// PreferredPermissionOption chooses the least-persistent positive permission option.
func PreferredPermissionOption(options []acp.PermissionOption) *acp.PermissionOption {
	for _, kind := range []acp.PermissionOptionKind{
		acp.PermissionOptionKindAllowOnce,
		acp.PermissionOptionKindAllowAlways,
		acp.PermissionOptionKindRejectOnce,
		acp.PermissionOptionKindRejectAlways,
	} {
		for index := range options {
			if options[index].Kind == kind {
				return &options[index]
			}
		}
	}
	return nil
}

// SplitCommand splits an ACP command string into executable and args.
func SplitCommand(command string) (string, []string) {
	parts := strings.Fields(command)
	if len(parts) == 0 {
		return "codex-acp", nil
	}
	return parts[0], parts[1:]
}

// ImplementationLabel formats ACP implementation metadata.
func ImplementationLabel(implementation *acp.Implementation) string {
	if implementation == nil {
		return ""
	}
	if implementation.Version == "" {
		return implementation.Name
	}
	if implementation.Name == "" {
		return implementation.Version
	}
	return implementation.Name + "@" + implementation.Version
}

// OptionalInt dereferences an optional int for logging.
func OptionalInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

// ACPContentBlockText returns text or JSON representation for an ACP content block.
func ACPContentBlockText(content acp.ContentBlock) string {
	if content.Text != nil {
		return content.Text.Text
	}
	encoded, err := json.Marshal(content)
	if err != nil {
		return ""
	}
	return string(encoded)
}

func acpMessagePhaseFromMeta(meta map[string]any) AgentMessagePhase {
	codex, ok := meta["codex"].(map[string]any)
	if !ok {
		return ""
	}
	phase, _ := codex["phase"].(string)
	switch strings.TrimSpace(phase) {
	case "commentary":
		return "commentary"
	case "final_answer":
		return "final_answer"
	default:
		return ""
	}
}

// MarshalACPRawMessage marshals ACP raw payloads into JSON when present.
func MarshalACPRawMessage(value any) json.RawMessage {
	if value == nil {
		return nil
	}
	encoded, err := json.Marshal(value)
	if err != nil || string(encoded) == "null" {
		return nil
	}
	return encoded
}

// OptionalACPToolKind returns an optional ACP tool kind.
func OptionalACPToolKind(kind *acp.ToolKind) string {
	if kind == nil {
		return ""
	}
	return string(*kind)
}

// OptionalACPToolStatus returns an optional ACP tool status.
func OptionalACPToolStatus(status *acp.ToolCallStatus) string {
	if status == nil {
		return ""
	}
	return string(*status)
}

// InferACPToolKind returns an explicit ACP kind or derives one from common MCP tool names.
func InferACPToolKind(explicit string, title string) string {
	if strings.TrimSpace(explicit) != "" {
		return strings.TrimSpace(explicit)
	}
	normalized := strings.ToLower(strings.TrimSpace(title))
	normalized = strings.TrimPrefix(normalized, "tool:")
	normalized = strings.TrimSpace(normalized)
	if slash := strings.LastIndex(normalized, "/"); slash >= 0 {
		normalized = normalized[slash+1:]
	}
	if namespace := strings.LastIndex(normalized, "__"); namespace >= 0 {
		normalized = normalized[namespace+2:]
	}
	switch normalized {
	case "list_projects", "load_skill", "get_project_config", "list_comments", "get_comment":
		return "read"
	case "update_project_config", "mutate_comment":
		return "edit"
	default:
		return ""
	}
}

// MapACPPermissionToolCall maps the tool asking for permission to a compact event shape.
func MapACPPermissionToolCall(toolCall acp.ToolCallUpdate) *AgentACPToolCallSummary {
	summary := &AgentACPToolCallSummary{
		ID:     string(toolCall.ToolCallId),
		Kind:   OptionalACPToolKind(toolCall.Kind),
		Status: OptionalACPToolStatus(toolCall.Status),
	}
	if toolCall.Title != nil {
		summary.Title = strings.TrimSpace(*toolCall.Title)
	}
	if summary.ID == "" && summary.Title == "" && summary.Kind == "" && summary.Status == "" {
		return nil
	}
	return summary
}

// MapACPPermissionOptions maps ACP permission options to service events.
func MapACPPermissionOptions(options []acp.PermissionOption) []AgentACPPermissionOption {
	if len(options) == 0 {
		return nil
	}
	mapped := make([]AgentACPPermissionOption, 0, len(options))
	for _, option := range options {
		mapped = append(mapped, AgentACPPermissionOption{
			OptionID: string(option.OptionId),
			Kind:     string(option.Kind),
			Name:     option.Name,
		})
	}
	return mapped
}

// MapACPToolCallLocations maps ACP tool locations to service events.
func MapACPToolCallLocations(locations []acp.ToolCallLocation) []AgentACPLocation {
	if len(locations) == 0 {
		return nil
	}
	mapped := make([]AgentACPLocation, 0, len(locations))
	for _, location := range locations {
		if strings.TrimSpace(location.Path) == "" {
			continue
		}
		mapped = append(mapped, AgentACPLocation{
			Path: location.Path,
			Line: location.Line,
		})
	}
	return mapped
}

// MapACPToolCallContent maps ACP tool content blocks to service events.
func MapACPToolCallContent(content []acp.ToolCallContent) []AgentACPContentBlock {
	if len(content) == 0 {
		return nil
	}
	blocks := make([]AgentACPContentBlock, 0, len(content))
	for _, item := range content {
		switch {
		case item.Content != nil:
			blocks = append(blocks, AgentACPContentBlock{
				Type: "text",
				Text: ACPContentBlockText(item.Content.Content),
			})
		case item.Diff != nil:
			block := AgentACPContentBlock{
				Type:    "diff",
				Path:    item.Diff.Path,
				NewText: item.Diff.NewText,
			}
			if item.Diff.OldText != nil {
				block.OldText = *item.Diff.OldText
			}
			blocks = append(blocks, block)
		case item.Terminal != nil:
			blocks = append(blocks, AgentACPContentBlock{
				Type:       "terminal",
				Text:       item.Terminal.TerminalId,
				TerminalID: item.Terminal.TerminalId,
			})
		}
	}
	return blocks
}

// MapACPPlanEntries maps ACP plan entries to service events.
func MapACPPlanEntries(entries []acp.PlanEntry) []AgentACPPlanEntry {
	if len(entries) == 0 {
		return nil
	}
	plan := make([]AgentACPPlanEntry, 0, len(entries))
	for _, entry := range entries {
		plan = append(plan, AgentACPPlanEntry{
			Content:  entry.Content,
			Status:   string(entry.Status),
			Priority: string(entry.Priority),
		})
	}
	return plan
}

// FormatACPToolCall formats a tool call status message.
func FormatACPToolCall(title string, status string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "ACP 工具调用"
	}
	if status == "" {
		return "工具调用：" + title
	}
	return "工具调用：" + title + "（" + TranslateACPStatus(status) + "）"
}

// FormatACPPlan formats a plan update message.
func FormatACPPlan(entries []acp.PlanEntry) string {
	if len(entries) == 0 {
		return "ACP 计划已更新。"
	}
	parts := make([]string, 0, len(entries))
	for _, entry := range entries {
		parts = append(parts, strings.TrimSpace(entry.Content)+" ["+TranslateACPStatus(string(entry.Status))+"]")
	}
	return "计划：" + strings.Join(parts, "；")
}

// TranslateACPStatus translates known ACP statuses into Chinese labels.
func TranslateACPStatus(status string) string {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case "":
		return ""
	case "cancelled", "canceled", "cancel":
		return "已取消"
	case "accepted", "allow", "allowed", "approved", "selected":
		return "已允许"
	case "rejected", "deny", "denied":
		return "已拒绝"
	case "pending":
		return "等待中"
	case "running", "in_progress":
		return "运行中"
	case "completed", "complete", "done", "end_turn":
		return "已完成"
	case "failed", "error":
		return "失败"
	default:
		return status
	}
}
