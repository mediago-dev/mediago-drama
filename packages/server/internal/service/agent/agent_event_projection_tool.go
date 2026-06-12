package agent

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/service/shared"
)

func measureProjectedACPOutput(blocks []AgentACPContentBlock, rawOutput json.RawMessage) (int, int) {
	parts := make([]string, 0, len(blocks)+1)
	for _, block := range blocks {
		text := ""
		if block.Type == "diff" {
			text = strings.Join([]string{block.OldText, block.NewText}, "\n")
		} else {
			text = firstNonEmpty(block.Text, block.TerminalID)
		}
		if strings.TrimSpace(text) != "" {
			parts = append(parts, text)
		}
	}
	if len(rawOutput) > 0 {
		parts = append(parts, string(rawOutput))
	}
	text := strings.Join(parts, "\n")
	if text == "" {
		return 0, 0
	}
	return len([]byte(text)), len(regexp.MustCompile(`\r\n|\r|\n`).Split(text, -1))
}

func projectedDurationMs(startedAt string, finishedAt string, status string, previous any) any {
	if status != "completed" && status != "failed" {
		return previous
	}
	start, startErr := timestamp.ParseRFC3339Nano(startedAt)
	finish, finishErr := timestamp.ParseRFC3339Nano(finishedAt)
	if startErr != nil || finishErr != nil {
		return previous
	}
	duration := finish.Sub(start).Milliseconds()
	if duration < 0 {
		return int64(0)
	}
	return duration
}

func projectedACPToolSummary(status string, lines int, bytes int) string {
	parts := []string{}
	if strings.TrimSpace(status) != "" {
		parts = append(parts, "状态："+status)
	}
	if lines > 0 {
		parts = append(parts, fmt.Sprintf("%d lines", lines))
	}
	if bytes > 0 {
		parts = append(parts, formatProjectedByteCount(bytes))
	}
	return strings.Join(parts, " · ")
}

func formatProjectedByteCount(bytes int) string {
	if bytes < 1024 {
		return fmt.Sprintf("%d B", bytes)
	}
	value := float64(bytes) / 1024
	if bytes < 10*1024 {
		return fmt.Sprintf("%.1f KB", value)
	}
	return fmt.Sprintf("%.0f KB", value)
}

func projectedMessageStatusFromToolStatus(status string) string {
	switch status {
	case "failed":
		return "error"
	case "pending", "in_progress":
		return "streaming"
	default:
		return "complete"
	}
}

func nonTerminalProjectedRunStatus(status string) string {
	if IsTerminalRunStatus(NormalizeRunStatus(status)) || strings.TrimSpace(status) == "" {
		return "running"
	}
	return status
}

func findProjectedCurrentTurnPlanIndex(messages []AgentChatMessageRecord) int {
	lastUserIndex := -1
	for index, message := range messages {
		if message.Role == "user" {
			lastUserIndex = index
		}
	}
	for index := len(messages) - 1; index > lastUserIndex; index-- {
		if messages[index].Kind == "plan" {
			return index
		}
	}
	return -1
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func displayACPToolTitle(title string, toolCallID string) string {
	title = strings.TrimSpace(title)
	if title == "" || title == strings.TrimSpace(toolCallID) || isDefaultACPToolTitle(title) || looksLikeTimestampTitle(title) {
		return ""
	}
	return title
}

func isDefaultACPToolTitle(title string) bool {
	switch strings.TrimSpace(title) {
	case "工具调用", "ACP 工具调用", "tool call", "tool_call":
		return true
	default:
		return false
	}
}

func looksLikeTimestampTitle(title string) bool {
	return regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}`).MatchString(strings.TrimSpace(title))
}

func inferProjectedACPToolKind(title string) string {
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

func projectedACPToolKind(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" && trimmed != "other" {
			return trimmed
		}
	}
	for _, value := range values {
		if strings.TrimSpace(value) == "other" {
			return "other"
		}
	}
	return "other"
}

var mustRandomID = shared.MustRandomID
