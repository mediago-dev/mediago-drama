package agent

import (
	"encoding/json"
	"fmt"
	"reflect"
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

func TestProjectAgentEventKeepsUserMessageDisplayMetadata(t *testing.T) {
	conversations := map[string]AgentConversationRecord{}
	activity := []AgentChatActivityRecord{}
	event := AgentEvent{
		ID:        "event-1",
		SessionID: "session-1",
		RunID:     "run-1",
		Type:      "agent.user.message",
		Message:   "理解一下这个文本，帮我进行剧本写作",
		CreatedAt: "2026-07-08T10:00:00Z",
		Metadata: map[string]any{
			"displaySegments": []any{
				map[string]any{"type": "skill", "name": "screenplay-writer", "title": "剧本写作"},
				map[string]any{"type": "text", "text": " 理解一下这个文本"},
			},
			"displayAttachments": []any{
				map[string]any{"kind": "file", "name": "开局欺诈师.txt"},
			},
		},
	}

	ProjectAgentEvent(event, conversations, &activity)

	conversation := conversations["run-1"]
	if len(conversation.Messages) != 1 {
		t.Fatalf("messages = %d, want 1", len(conversation.Messages))
	}
	message := conversation.Messages[0]
	if message.Content != event.Message {
		t.Fatalf("content = %q, want display prompt", message.Content)
	}
	segments, ok := message.Metadata["displaySegments"].([]any)
	if !ok || len(segments) != 2 {
		t.Fatalf("displaySegments = %#v, want 2 entries", message.Metadata["displaySegments"])
	}
	attachments, ok := message.Metadata["displayAttachments"].([]any)
	if !ok || len(attachments) != 1 {
		t.Fatalf("displayAttachments = %#v, want 1 entry", message.Metadata["displayAttachments"])
	}
}

func TestProjectAgentEventMarksFailedAndCancelledConversationsTerminal(t *testing.T) {
	tests := []struct {
		name       string
		eventType  string
		wantStatus string
	}{
		{name: "failed", eventType: "agent.run.failed", wantStatus: "failed"},
		{name: "cancelled", eventType: "agent.run.cancelled", wantStatus: "cancelled"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			conversations := map[string]AgentConversationRecord{
				"run-1": {
					RunID:              "run-1",
					Status:             "running",
					StreamingMessageID: "assistant-stream",
					Messages: []AgentChatMessageRecord{
						{
							ID:      "assistant-stream",
							Role:    "assistant",
							Content: "处理中",
							Kind:    "message",
							Status:  "streaming",
						},
					},
					CreatedAt: "2026-07-13T00:00:00Z",
					UpdatedAt: "2026-07-13T00:00:01Z",
				},
			}
			activity := []AgentChatActivityRecord{}

			ProjectAgentEvent(AgentEvent{
				ID:        "event-terminal",
				SessionID: "session-1",
				RunID:     "run-1",
				Type:      test.eventType,
				Message:   "运行已结束",
				CreatedAt: "2026-07-13T00:00:02Z",
			}, conversations, &activity)

			conversation := conversations["run-1"]
			if conversation.Status != test.wantStatus {
				t.Fatalf("status = %q, want %q", conversation.Status, test.wantStatus)
			}
			if conversation.StreamingMessageID != "" {
				t.Fatalf("streaming message id = %q, want empty", conversation.StreamingMessageID)
			}
			if conversation.Messages[0].Status != "complete" {
				t.Fatalf("streaming message status = %q, want complete", conversation.Messages[0].Status)
			}
			if len(conversation.Messages) != 2 || conversation.Messages[1].Kind != "runtime" {
				t.Fatalf("messages = %#v, want terminal runtime trace", conversation.Messages)
			}
		})
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

func TestProjectAgentEventPreservesTurnItemAndPhase(t *testing.T) {
	conversations := map[string]AgentConversationRecord{}
	activity := []AgentChatActivityRecord{}

	ProjectAgentEvent(AgentEvent{
		ID:        "event-user",
		SessionID: "session-1",
		RunID:     "run-1",
		Type:      "agent.user.message",
		Message:   "更新 README",
		CreatedAt: "2026-07-14T10:00:00Z",
	}, conversations, &activity)
	ProjectAgentEvent(AgentEvent{
		ID:        "event-tool-start",
		SessionID: "session-1",
		RunID:     "run-1",
		Type:      "agent.acp",
		Message:   "正在更新 README",
		CreatedAt: "2026-07-14T10:00:01Z",
		ACP: &AgentACPEvent{
			Kind:       "toolCall",
			ToolCallID: "call-edit",
			Title:      "更新 README",
			Status:     "in_progress",
		},
	}, conversations, &activity)
	ProjectAgentEvent(AgentEvent{
		ID:        "event-tool-done",
		SessionID: "session-1",
		RunID:     "run-1",
		Type:      "agent.acp",
		Message:   "README 已更新",
		CreatedAt: "2026-07-14T10:00:02Z",
		ACP: &AgentACPEvent{
			Kind:       "toolCallUpdate",
			ToolCallID: "call-edit",
			Title:      "更新 README",
			Status:     "completed",
		},
	}, conversations, &activity)
	ProjectAgentEvent(AgentEvent{
		ID:        "event-final",
		SessionID: "session-1",
		RunID:     "run-1",
		Type:      "agent.message.completed",
		Content:   "README 已更新。",
		CreatedAt: "2026-07-14T10:00:03Z",
	}, conversations, &activity)

	messages := conversations["run-1"].Messages
	if len(messages) != 3 {
		t.Fatalf("messages = %#v, want user, tool, and final answer", messages)
	}
	tool := messages[1]
	if tool.TurnID != "run-1" || tool.ItemID != "call-edit" || tool.Phase != AgentMessagePhaseCommentary {
		t.Fatalf("tool semantics = %#v, want stable commentary item", tool)
	}
	final := messages[2]
	if final.TurnID != "run-1" || final.ItemID != "event-final" || final.Phase != AgentMessagePhaseFinalAnswer {
		t.Fatalf("final semantics = %#v, want final-answer item", final)
	}
}

func TestProjectAgentEventReplaysExplicitStreamingSemantics(t *testing.T) {
	events := []AgentEvent{
		{
			ID:        "event-delta-1",
			SessionID: "session-1",
			RunID:     "run-1",
			TurnID:    "turn-explicit",
			ItemID:    "message-explicit",
			Phase:     AgentMessagePhaseCommentary,
			Type:      "agent.message.delta",
			Delta:     "正在处理",
			CreatedAt: "2026-07-14T10:00:00Z",
		},
		{
			ID:        "event-delta-2",
			SessionID: "session-1",
			RunID:     "run-1",
			TurnID:    "turn-explicit",
			ItemID:    "message-explicit",
			Phase:     AgentMessagePhaseCommentary,
			Type:      "agent.message.delta",
			Delta:     "中",
			CreatedAt: "2026-07-14T10:00:01Z",
		},
		{
			ID:        "event-completed",
			SessionID: "session-1",
			RunID:     "run-1",
			TurnID:    "turn-explicit",
			ItemID:    "message-explicit",
			Phase:     AgentMessagePhaseFinalAnswer,
			Type:      "agent.message.completed",
			Content:   "处理完成。",
			CreatedAt: "2026-07-14T10:00:02Z",
		},
	}

	project := func() AgentConversationRecord {
		conversations := map[string]AgentConversationRecord{}
		activity := []AgentChatActivityRecord{}
		for _, event := range events {
			ProjectAgentEvent(event, conversations, &activity)
		}
		return conversations["run-1"]
	}

	first := project()
	replayed := project()
	if len(first.Messages) != 1 || len(replayed.Messages) != 1 {
		t.Fatalf("messages after projection/replay = %#v / %#v, want one streamed item", first.Messages, replayed.Messages)
	}
	message := first.Messages[0]
	if message.Content != "处理完成。" || message.Status != "complete" {
		t.Fatalf("message = %#v, want exact completed content", message)
	}
	if message.TurnID != "turn-explicit" || message.ItemID != "message-explicit" || message.Phase != AgentMessagePhaseFinalAnswer {
		t.Fatalf("message semantics = %#v, want explicit completed identity", message)
	}
	if !reflect.DeepEqual(replayed.Messages[0], message) {
		t.Fatalf("replayed message = %#v, want deterministic %#v", replayed.Messages[0], message)
	}
}

func TestProjectAgentEventPromotesStreamingItemOnlyOnCompletion(t *testing.T) {
	conversations := map[string]AgentConversationRecord{}
	activity := []AgentChatActivityRecord{}
	delta := AgentEvent{
		ID:        "event-delta",
		SessionID: "session-1",
		RunID:     "run-1",
		ItemID:    "message-1",
		Type:      "agent.message.delta",
		Delta:     "最终回复",
		CreatedAt: "2026-07-14T10:00:00Z",
	}

	ProjectAgentEvent(delta, conversations, &activity)
	messages := conversations["run-1"].Messages
	if len(messages) != 1 || messages[0].Phase != AgentMessagePhaseCommentary || messages[0].Status != "streaming" {
		t.Fatalf("messages after delta = %#v, want running commentary item", messages)
	}

	ProjectAgentEvent(AgentEvent{
		ID:        "event-completed",
		SessionID: "session-1",
		RunID:     "run-1",
		ItemID:    "message-1",
		Type:      "agent.message.completed",
		Content:   "最终回复。",
		CreatedAt: "2026-07-14T10:00:01Z",
	}, conversations, &activity)
	messages = conversations["run-1"].Messages
	if len(messages) != 1 {
		t.Fatalf("messages after completion = %#v, want same item promoted in place", messages)
	}
	message := messages[0]
	if message.ItemID != "message-1" || message.Phase != AgentMessagePhaseFinalAnswer || message.Status != "complete" || message.Content != "最终回复。" {
		t.Fatalf("message after completion = %#v, want final-answer phase transition", message)
	}
}

func TestProjectAgentEventKeepsCommentaryAndFinalStreamingItemsSeparate(t *testing.T) {
	conversations := map[string]AgentConversationRecord{}
	activity := []AgentChatActivityRecord{}
	events := []AgentEvent{
		{
			ID:        "event-commentary",
			SessionID: "session-1",
			RunID:     "run-1",
			TurnID:    "run-1",
			ItemID:    "message-commentary",
			Phase:     AgentMessagePhaseCommentary,
			Type:      "agent.message.delta",
			Delta:     "我先检查工具。",
			CreatedAt: "2026-07-15T00:00:00Z",
		},
		{
			ID:        "event-final",
			SessionID: "session-1",
			RunID:     "run-1",
			TurnID:    "run-1",
			ItemID:    "message-final",
			Phase:     AgentMessagePhaseFinalAnswer,
			Type:      "agent.message.delta",
			Delta:     "最终工具清单。",
			CreatedAt: "2026-07-15T00:00:01Z",
		},
		{
			ID:        "event-completed",
			SessionID: "session-1",
			RunID:     "run-1",
			TurnID:    "run-1",
			ItemID:    "message-final",
			Phase:     AgentMessagePhaseFinalAnswer,
			Type:      "agent.message.completed",
			Content:   "最终工具清单。",
			CreatedAt: "2026-07-15T00:00:02Z",
		},
	}

	for _, event := range events {
		ProjectAgentEvent(event, conversations, &activity)
	}

	messages := conversations["run-1"].Messages
	if len(messages) != 2 {
		t.Fatalf("messages = %#v, want separate commentary and final items", messages)
	}
	commentary := messages[0]
	if commentary.ItemID != "message-commentary" || commentary.Phase != AgentMessagePhaseCommentary || commentary.Content != "我先检查工具。" || commentary.Status != "complete" {
		t.Fatalf("commentary = %#v, want completed commentary item", commentary)
	}
	final := messages[1]
	if final.ItemID != "message-final" || final.Phase != AgentMessagePhaseFinalAnswer || final.Content != "最终工具清单。" || final.Status != "complete" {
		t.Fatalf("final = %#v, want completed final-answer item", final)
	}
}

func TestProjectAgentEventPreservesWhitespaceOnlyStreamingDelta(t *testing.T) {
	conversations := map[string]AgentConversationRecord{}
	activity := []AgentChatActivityRecord{}
	deltas := []string{"第一行", "\n\n", "第二行"}

	for index, delta := range deltas {
		ProjectAgentEvent(AgentEvent{
			ID:        fmt.Sprintf("event-delta-%d", index),
			SessionID: "session-1",
			RunID:     "run-1",
			TurnID:    "run-1",
			ItemID:    "message-final",
			Phase:     AgentMessagePhaseFinalAnswer,
			Type:      "agent.message.delta",
			Delta:     delta,
			CreatedAt: "2026-07-15T00:00:00Z",
		}, conversations, &activity)
	}

	messages := conversations["run-1"].Messages
	if len(messages) != 1 {
		t.Fatalf("messages = %#v, want one streamed item", messages)
	}
	if messages[0].Content != "第一行\n\n第二行" {
		t.Fatalf("content = %q, want whitespace-only delta preserved", messages[0].Content)
	}
}
