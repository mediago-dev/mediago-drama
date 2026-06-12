package agent

import (
	"encoding/json"
	"strings"
)

func splitAgentActivityMessage(message string) (string, string) {
	trimmed := strings.TrimSpace(message)
	separator := strings.IndexAny(trimmed, "：:")
	if separator > 0 && separator < 18 {
		separatorLen := 1
		if strings.HasPrefix(trimmed[separator:], "：") {
			separatorLen = len("：")
		}
		return strings.TrimSpace(trimmed[:separator]), strings.TrimSpace(trimmed[separator+separatorLen:])
	}
	return "Agent 动作", trimmed
}

func agentMessageKindFromActivity(kind string, label string, detail string) string {
	text := strings.ToLower(label + " " + detail)
	if strings.Contains(text, "思考") || strings.Contains(text, "thought") || strings.Contains(text, "reasoning") {
		return "thought"
	}
	if strings.Contains(text, "计划") || strings.Contains(text, "plan") {
		return "plan"
	}
	if strings.Contains(text, "读取文件") || strings.Contains(text, "已写入文件") || strings.Contains(text, "read file") || strings.Contains(text, "write file") {
		return "file"
	}
	if kind == "runtime" || kind == "patch" {
		return kind
	}
	return "tool"
}

func metadataForProjectedMessage(label string, detail string) map[string]any {
	if strings.TrimSpace(label) == "" && strings.TrimSpace(detail) == "" {
		return nil
	}
	return map[string]any{
		"toolName":     label,
		"outputResult": detail,
	}
}

func isRuntimeAgentActivity(label string, detail string) bool {
	text := strings.ToLower(label + " " + detail)
	runtimeMarkers := []string{
		"acp",
		"mcp",
		"会话",
		"运行时",
		"停止原因",
		"stderr",
		"旧会话",
		"恢复失败",
		"载入失败",
		"刷新 mediago_drama",
	}
	for _, marker := range runtimeMarkers {
		if strings.Contains(text, marker) {
			return true
		}
	}
	return false
}

func mergeMetadata(base map[string]any, patch map[string]any) map[string]any {
	metadata := map[string]any{}
	for key, value := range base {
		if !isEmptyMetadataValue(value) {
			metadata[key] = value
		}
	}
	for key, value := range patch {
		if !isEmptyMetadataValue(value) {
			metadata[key] = value
		}
	}
	if len(metadata) == 0 {
		return nil
	}
	return metadata
}

func isEmptyMetadataValue(value any) bool {
	switch typed := value.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(typed) == ""
	case json.RawMessage:
		return len(typed) == 0
	case []AgentACPContentBlock:
		return len(typed) == 0
	case []AgentACPLocation:
		return len(typed) == 0
	case []AgentACPPlanEntry:
		return len(typed) == 0
	default:
		return false
	}
}

func metadataString(metadata map[string]any, key string) string {
	if metadata == nil {
		return ""
	}
	value, ok := metadata[key]
	if !ok {
		return ""
	}
	if typed, ok := value.(string); ok {
		return strings.TrimSpace(typed)
	}
	return ""
}

func metadataBool(metadata map[string]any, key string) bool {
	if metadata == nil {
		return false
	}
	value, ok := metadata[key]
	if !ok {
		return false
	}
	if typed, ok := value.(bool); ok {
		return typed
	}
	return false
}

func metadataRawMessage(metadata map[string]any, key string) json.RawMessage {
	if metadata == nil {
		return nil
	}
	switch typed := metadata[key].(type) {
	case json.RawMessage:
		return typed
	case []byte:
		return json.RawMessage(typed)
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		return json.RawMessage(strconvQuoteJSON(typed))
	default:
		if typed == nil {
			return nil
		}
		payload, err := json.Marshal(typed)
		if err != nil {
			return nil
		}
		return payload
	}
}

func metadataACPContentBlocks(metadata map[string]any, key string) []AgentACPContentBlock {
	if metadata == nil {
		return nil
	}
	if blocks, ok := metadata[key].([]AgentACPContentBlock); ok {
		return blocks
	}
	return nil
}

func metadataACPLocations(metadata map[string]any, key string) []AgentACPLocation {
	if metadata == nil {
		return nil
	}
	if locations, ok := metadata[key].([]AgentACPLocation); ok {
		return locations
	}
	return nil
}

func firstNonEmptyRawMessage(values ...json.RawMessage) json.RawMessage {
	for _, value := range values {
		if len(value) > 0 && strings.TrimSpace(string(value)) != "" && string(value) != "null" {
			return value
		}
	}
	return nil
}

func strconvQuoteJSON(value string) []byte {
	payload, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return payload
}
