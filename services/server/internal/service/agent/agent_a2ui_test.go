package agent

import (
	"encoding/json"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/service/model"
)

func TestBuildAgentPermissionA2UIIncludesDecisionContext(t *testing.T) {
	payload := BuildAgentPermissionA2UI(AgentACPPermissionRequest{
		RequestID: "permission-1",
		ToolCall:  &AgentACPToolCallSummary{Title: "写入 README", Kind: "edit"},
		Options: []AgentACPPermissionOption{
			{OptionID: "allow-once", Kind: "allow_once", Name: "Yes, proceed"},
			{
				OptionID: "allow-always",
				Kind:     "allow_always",
				Name:     "Yes, and don't ask again for commands that start with `/bin/zsh -lc tmp=\"$(mktemp)\" && iconv -f GB18030 -t UTF-8`",
			},
			{OptionID: "reject", Kind: "reject_once", Name: "No, and tell Codex what to do differently"},
		},
	})
	if payload == nil {
		t.Fatal("payload is nil")
	}
	if payload.Version != "v0.9" || payload.SurfaceID != "agent-permission-permission-1" {
		t.Fatalf("payload = %#v, want v0.9 permission surface", payload)
	}

	messages := decodeA2UIMessages(t, payload)
	components := messages[1]["updateComponents"].(map[string]any)["components"].([]any)
	button := findA2UIComponent(t, components, "permission-option-allow-once")
	action := button["action"].(map[string]any)["event"].(map[string]any)
	if action["name"] != AgentA2UIActionAgentPermission {
		t.Fatalf("action name = %#v, want %s", action["name"], AgentA2UIActionAgentPermission)
	}
	context := action["context"].(map[string]any)
	if context["kind"] != "agent_permission" || context["requestId"] != "permission-1" || context["optionId"] != "allow-once" {
		t.Fatalf("context = %#v, want permission decision context", context)
	}

	if label := findA2UIComponent(t, components, "permission-option-label-allow-once")["text"]; label != "允许一次" {
		t.Fatalf("allow once label = %#v, want compact Chinese label", label)
	}
	if label := findA2UIComponent(t, components, "permission-option-label-allow-always")["text"]; label != "始终允许" {
		t.Fatalf("allow always label = %#v, want compact Chinese label", label)
	}
	if label := findA2UIComponent(t, components, "permission-option-label-reject")["text"]; label != "拒绝" {
		t.Fatalf("reject label = %#v, want compact Chinese label", label)
	}
}

func TestBuildDocumentToolApprovalA2UIIncludesDecisionContext(t *testing.T) {
	payload := BuildDocumentToolApprovalA2UI(model.DocumentToolApprovalRecord{
		ID:         "approval-1",
		ProjectID:  "project-1",
		DocumentID: "doc-1",
		Title:      "删除文档",
		Summary:    "请求删除文档。",
		Request: model.DocumentToolApprovalRequest{
			DocumentID: "doc-1",
		},
	})
	if payload == nil {
		t.Fatal("payload is nil")
	}

	messages := decodeA2UIMessages(t, payload)
	components := messages[1]["updateComponents"].(map[string]any)["components"].([]any)
	button := findA2UIComponent(t, components, "approve")
	action := button["action"].(map[string]any)["event"].(map[string]any)
	if action["name"] != AgentA2UIActionDocumentToolApproval {
		t.Fatalf("action name = %#v, want %s", action["name"], AgentA2UIActionDocumentToolApproval)
	}
	context := action["context"].(map[string]any)
	if context["kind"] != "document_tool_approval" || context["approvalId"] != "approval-1" || context["decision"] != "approved" {
		t.Fatalf("context = %#v, want document approval context", context)
	}
}

func decodeA2UIMessages(t *testing.T, payload *AgentA2UIPayload) []map[string]any {
	t.Helper()
	var messages []map[string]any
	if err := json.Unmarshal(payload.Messages, &messages); err != nil {
		t.Fatalf("unmarshalling A2UI messages: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("messages = %d, want 2", len(messages))
	}
	return messages
}

func findA2UIComponent(t *testing.T, components []any, id string) map[string]any {
	t.Helper()
	for _, component := range components {
		value, ok := component.(map[string]any)
		if ok && value["id"] == id {
			return value
		}
	}
	t.Fatalf("component %q not found in %#v", id, components)
	return nil
}
