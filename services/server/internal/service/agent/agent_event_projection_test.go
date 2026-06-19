package agent

import (
	"encoding/json"
	"testing"
)

func TestProjectAgentEventIgnoresTimestampToolTitle(t *testing.T) {
	conversations := map[string]AgentConversationRecord{}
	activity := []AgentChatActivityRecord{}
	event := AgentEvent{
		ID:        "event-1",
		SessionID: "session-1",
		RunID:     "run-1",
		Type:      "agent.acp",
		Message:   "工具调用：2026-05-24T19:57:40.005581Z（失败）",
		CreatedAt: "2026-05-24T19:57:40Z",
		ACP: &AgentACPEvent{
			Kind:       "toolCallUpdate",
			ToolCallID: "2026-05-24T19:57:40.005581Z",
			Title:      "2026-05-24T19:57:40.005581Z",
			Status:     "failed",
			Content: []AgentACPContentBlock{
				{Type: "text", Text: "failed to run tool"},
			},
		},
	}

	ProjectAgentEvent(event, conversations, &activity)

	conversation := conversations["run-1"]
	if len(conversation.Messages) != 1 {
		t.Fatalf("messages = %d, want 1", len(conversation.Messages))
	}
	message := conversation.Messages[0]
	if message.Title != "工具调用" {
		t.Fatalf("title = %q, want generic fallback", message.Title)
	}
	if got := metadataString(message.Metadata, "toolName"); got != "工具调用" {
		t.Fatalf("metadata toolName = %q, want generic fallback", got)
	}
	if got := metadataString(message.Metadata, "toolCallId"); got != "2026-05-24T19:57:40.005581Z" {
		t.Fatalf("metadata toolCallId = %q, want original id", got)
	}
}

func TestProjectAgentEventInfersMCPToolKindWhenACPKindIsOther(t *testing.T) {
	conversations := map[string]AgentConversationRecord{}
	activity := []AgentChatActivityRecord{}
	event := AgentEvent{
		ID:        "event-1",
		SessionID: "session-1",
		RunID:     "run-1",
		Type:      "agent.acp",
		Message:   "工具调用：Tool: mediago_drama/mutate_comment（完成）",
		CreatedAt: "2026-05-24T19:57:40Z",
		ACP: &AgentACPEvent{
			Kind:       "toolCall",
			ToolCallID: "call-edit",
			ToolKind:   "other",
			Title:      "Tool: mediago_drama/mutate_comment",
			Status:     "completed",
		},
	}

	ProjectAgentEvent(event, conversations, &activity)

	conversation := conversations["run-1"]
	if len(conversation.Messages) != 1 {
		t.Fatalf("messages = %d, want 1", len(conversation.Messages))
	}
	if got := metadataString(conversation.Messages[0].Metadata, "acpKind"); got != "edit" {
		t.Fatalf("metadata acpKind = %q, want edit", got)
	}
}

func TestProjectAgentEventProjectsA2UIMessage(t *testing.T) {
	conversations := map[string]AgentConversationRecord{}
	activity := []AgentChatActivityRecord{}
	event := AgentEvent{
		ID:        "event-ui",
		SessionID: "session-1",
		RunID:     "run-1",
		Type:      AgentUIEventType,
		Message:   "请选择处理方式。",
		CreatedAt: "2026-06-08T09:43:13Z",
		A2UI: &AgentA2UIPayload{
			Version:   "v0.9",
			SurfaceID: "attachment",
			Messages:  json.RawMessage(`[{"version":"v0.9","createSurface":{"surfaceId":"attachment","catalogId":"basic"}}]`),
		},
	}

	ProjectAgentEvent(event, conversations, &activity)

	conversation := conversations["run-1"]
	if len(conversation.Messages) != 1 {
		t.Fatalf("messages = %d, want 1", len(conversation.Messages))
	}
	message := conversation.Messages[0]
	if message.Kind != "message" || message.Role != "assistant" {
		t.Fatalf("message = %#v, want assistant message", message)
	}
	payload, ok := message.Metadata["a2ui"].(*AgentA2UIPayload)
	if !ok {
		t.Fatalf("metadata = %#v, want A2UI payload", message.Metadata)
	}
	if payload.SurfaceID != "attachment" {
		t.Fatalf("surfaceId = %q, want attachment", payload.SurfaceID)
	}
}

func TestProjectAgentEventProjectsA2UIMessageWithoutRunID(t *testing.T) {
	conversations := map[string]AgentConversationRecord{}
	activity := []AgentChatActivityRecord{}
	event := AgentEvent{
		ID:        "event-ui",
		ProjectID: "project-1",
		Type:      AgentUIEventType,
		Message:   "需要确认危险操作",
		CreatedAt: "2026-06-08T09:43:13Z",
		A2UI: &AgentA2UIPayload{
			Version:   "v0.9",
			SurfaceID: "approval",
			Messages:  json.RawMessage(`[{"version":"v0.9","createSurface":{"surfaceId":"approval","catalogId":"basic"}}]`),
		},
	}

	ProjectAgentEvent(event, conversations, &activity)

	conversation := conversations["project-ui"]
	if conversation.RunID != "project-ui" || conversation.Status != "completed" {
		t.Fatalf("conversation = %#v, want completed project-ui conversation", conversation)
	}
	if len(conversation.Messages) != 1 || conversation.Messages[0].Metadata["a2ui"] == nil {
		t.Fatalf("messages = %#v, want projected A2UI message", conversation.Messages)
	}
}

func TestProjectAgentEventProjectsRuntimeLogKind(t *testing.T) {
	conversations := map[string]AgentConversationRecord{}
	activity := []AgentChatActivityRecord{}
	logText := "ERROR codex_core::session::session: failed to load skill /tmp/example/.agents/skills/test-runner-1.0.0/SKILL.md: missing YAML frontmatter delimited by ---"
	event := AgentEvent{
		ID:        "event-runtime-log",
		SessionID: "session-1",
		RunID:     "run-1",
		Type:      "agent.acp",
		Message:   logText,
		CreatedAt: "2026-06-03T09:43:13Z",
		ACP: &AgentACPEvent{
			Kind:       ACPRuntimeLogKind,
			ToolCallID: "runtime-call",
			Status:     "failed",
			Content: []AgentACPContentBlock{
				{Type: "text", Text: logText},
			},
		},
	}

	ProjectAgentEvent(event, conversations, &activity)

	conversation := conversations["run-1"]
	if len(conversation.Messages) != 1 {
		t.Fatalf("messages = %#v, want one runtime log", conversation.Messages)
	}
	message := conversation.Messages[0]
	if message.Kind != "runtime" || message.Title != "运行日志" || message.Status != "error" {
		t.Fatalf("message = %#v, want visible runtime log", message)
	}
	if !metadataBool(message.Metadata, "runtimeLog") {
		t.Fatalf("metadata = %#v, want runtimeLog=true", message.Metadata)
	}
	if got := metadataString(message.Metadata, "toolCallId"); got != "runtime-call" {
		t.Fatalf("toolCallId = %q, want runtime-call", got)
	}
	blocks := metadataACPContentBlocks(message.Metadata, "outputBlocks")
	if len(blocks) != 1 || blocks[0].Text != logText {
		t.Fatalf("outputBlocks = %#v, want runtime log text", blocks)
	}
}

func TestProjectAgentEventProjectsLegacyRuntimeLogToolUpdate(t *testing.T) {
	conversations := map[string]AgentConversationRecord{}
	activity := []AgentChatActivityRecord{}
	logText := "2026-06-03T09:43:13Z ERROR codex_core::session::session: failed to load skill /tmp/example/.agents/skills/test-runner-1.0.0/SKILL.md: missing YAML frontmatter delimited by ---"
	event := AgentEvent{
		ID:        "event-legacy-runtime-log",
		SessionID: "session-1",
		RunID:     "run-1",
		Type:      "agent.acp",
		Message:   "工具调用：2026-06-03T09:43:13Z（失败）",
		CreatedAt: "2026-06-03T09:43:13Z",
		ACP: &AgentACPEvent{
			Kind:       "toolCallUpdate",
			ToolCallID: "2026-06-03T09:43:13Z",
			ToolKind:   "other",
			Title:      "工具调用",
			Status:     "failed",
			Content: []AgentACPContentBlock{
				{Type: "text", Text: logText},
			},
		},
	}

	ProjectAgentEvent(event, conversations, &activity)

	conversation := conversations["run-1"]
	if len(conversation.Messages) != 1 {
		t.Fatalf("messages = %#v, want one runtime log", conversation.Messages)
	}
	message := conversation.Messages[0]
	if message.Kind != "runtime" || !metadataBool(message.Metadata, "runtimeLog") {
		t.Fatalf("message = %#v, want legacy tool update projected as runtime log", message)
	}
}
