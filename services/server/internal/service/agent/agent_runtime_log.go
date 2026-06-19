package agent

import (
	"encoding/json"
	"strings"
)

const ACPRuntimeLogKind = "runtimeLog"

var acpRuntimeLogMarkers = []string{
	"codex_core::session",
	"failed to load skill",
	"missing yaml frontmatter",
	"/.agents/skills/",
	"error codex_core",
}

// IsACPRuntimeLogEvent reports whether an ACP event should be presented as runtime output.
func IsACPRuntimeLogEvent(acp AgentACPEvent) bool {
	if strings.TrimSpace(acp.Kind) == ACPRuntimeLogKind {
		return true
	}
	return IsACPToolRuntimeLog(acp)
}

// IsACPToolRuntimeLog conservatively detects ACP tool updates that are process runtime logs.
func IsACPToolRuntimeLog(acp AgentACPEvent) bool {
	if acp.Kind != "toolCall" && acp.Kind != "toolCallUpdate" {
		return false
	}
	toolKind := strings.TrimSpace(acp.ToolKind)
	if toolKind != "" && toolKind != "other" {
		return false
	}
	if displayACPToolTitle(acp.Title, acp.ToolCallID) != "" {
		return false
	}
	if len(acp.Locations) > 0 {
		return false
	}
	if len(firstNonEmptyRawMessage(acp.RawInput)) > 0 {
		return false
	}
	for _, block := range acp.Content {
		if block.Type == "diff" {
			return false
		}
	}
	text := normalizeRuntimeLogText(ACPRuntimeLogText(acp))
	if text == "" {
		return false
	}
	for _, marker := range acpRuntimeLogMarkers {
		if strings.Contains(text, marker) {
			return true
		}
	}
	return false
}

// ACPRuntimeLogText returns the human-readable text carried by an ACP runtime log event.
func ACPRuntimeLogText(acp AgentACPEvent) string {
	parts := make([]string, 0, len(acp.Content)+1)
	for _, block := range acp.Content {
		switch block.Type {
		case "diff":
			text := strings.TrimSpace(strings.Join([]string{block.OldText, block.NewText}, "\n"))
			if text != "" {
				parts = append(parts, text)
			}
		default:
			text := strings.TrimSpace(firstNonEmpty(block.Text, block.TerminalID))
			if text != "" {
				parts = append(parts, text)
			}
		}
	}
	if text := strings.TrimSpace(rawMessageRuntimeLogText(acp.RawOutput)); text != "" {
		parts = append(parts, text)
	}
	return strings.Join(parts, "\n")
}

func normalizeRuntimeLogText(text string) string {
	text = strings.ToLower(stripANSIEscapeSequences(text))
	text = strings.Join(strings.Fields(text), " ")
	return text
}

func stripANSIEscapeSequences(text string) string {
	var builder strings.Builder
	for index := 0; index < len(text); index++ {
		if text[index] != 0x1b || index+1 >= len(text) || text[index+1] != '[' {
			builder.WriteByte(text[index])
			continue
		}
		index += 2
		for index < len(text) {
			char := text[index]
			if (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') {
				break
			}
			index++
		}
	}
	return builder.String()
}

func rawMessageRuntimeLogText(raw json.RawMessage) string {
	if len(firstNonEmptyRawMessage(raw)) == 0 {
		return ""
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return string(raw)
	}
	return runtimeLogTextFromValue(decoded)
}

func runtimeLogTextFromValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := strings.TrimSpace(runtimeLogTextFromValue(item)); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	case map[string]any:
		fields := []string{
			"formatted_output",
			"aggregated_output",
			"stdout",
			"stderr",
			"error",
			"message",
			"text",
		}
		parts := make([]string, 0, len(fields))
		for _, field := range fields {
			if text := strings.TrimSpace(runtimeLogTextFromValue(typed[field])); text != "" {
				parts = append(parts, text)
			}
		}
		if len(parts) > 0 {
			return strings.Join(parts, "\n")
		}
		encoded, err := json.Marshal(typed)
		if err != nil {
			return ""
		}
		return string(encoded)
	default:
		if value == nil {
			return ""
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return ""
		}
		return string(encoded)
	}
}
