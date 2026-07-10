package agent

import (
	"fmt"
	"sort"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
)

// NormalizeAgentChatMessages normalizes persisted chat messages for API output.
func NormalizeAgentChatMessages(messages []AgentChatMessageRecord) []AgentChatMessageRecord {
	const maxMessages = 300
	now := timestamp.NowRFC3339Nano()
	if len(messages) > maxMessages {
		messages = messages[len(messages)-maxMessages:]
	}

	normalized := make([]AgentChatMessageRecord, 0, len(messages))
	for index, message := range messages {
		message.ID = strings.TrimSpace(message.ID)
		if message.ID == "" {
			message.ID = fmt.Sprintf("agent-message-%d", index+1)
		}
		message.Role = strings.TrimSpace(message.Role)
		if message.Role != "user" && message.Role != "assistant" {
			message.Role = "assistant"
		}
		message.Kind = strings.TrimSpace(message.Kind)
		if message.Kind == "" {
			message.Kind = "message"
		}
		message.Status = strings.TrimSpace(message.Status)
		if message.Status == "" || message.Status == "streaming" {
			message.Status = "complete"
		}
		message.CreatedAt = strings.TrimSpace(message.CreatedAt)
		if message.CreatedAt == "" {
			message.CreatedAt = now
		}
		normalized = append(normalized, message)
	}
	return normalized
}

// NormalizeAgentChatActivity normalizes projected chat activity for API output.
func NormalizeAgentChatActivity(activity []AgentChatActivityRecord) []AgentChatActivityRecord {
	const maxActivityItems = 200
	now := timestamp.NowRFC3339Nano()
	if len(activity) > maxActivityItems {
		activity = activity[:maxActivityItems]
	}

	normalized := make([]AgentChatActivityRecord, 0, len(activity))
	for index, item := range activity {
		item.ID = strings.TrimSpace(item.ID)
		if item.ID == "" {
			item.ID = fmt.Sprintf("agent-activity-%d", index+1)
		}
		item.Kind = strings.TrimSpace(item.Kind)
		if item.Kind == "" {
			item.Kind = "runtime"
		}
		item.Label = strings.TrimSpace(item.Label)
		if item.Label == "" {
			item.Label = "Agent 日志"
		}
		item.CreatedAt = strings.TrimSpace(item.CreatedAt)
		if item.CreatedAt == "" {
			item.CreatedAt = now
		}
		normalized = append(normalized, item)
	}
	return normalized
}

// NormalizeAgentEventForPersistence fills stable event fields before storage.
func NormalizeAgentEventForPersistence(event AgentEvent) AgentEvent {
	event.ID = strings.TrimSpace(event.ID)
	if event.ID == "" {
		event.ID = mustRandomID("event")
	}
	event.ProjectID = domain.CleanProjectID(event.ProjectID)
	event.SessionID = strings.TrimSpace(event.SessionID)
	event.RunID = strings.TrimSpace(event.RunID)
	event.Type = strings.TrimSpace(event.Type)
	if event.Type == "" {
		event.Type = "agent.activity"
	}
	event.CreatedAt = strings.TrimSpace(event.CreatedAt)
	if event.CreatedAt == "" {
		event.CreatedAt = timestamp.NowRFC3339Nano()
	}
	return event
}

// AttachConversationChildren normalizes legacy conversation child arrays.
func AttachConversationChildren(conversations map[string]AgentConversationRecord) {
	for runID, conversation := range conversations {
		conversation.Children = nil
		conversations[runID] = conversation
	}
}

// FlattenConversationMessages returns messages from all conversations.
func FlattenConversationMessages(conversations map[string]AgentConversationRecord) []AgentChatMessageRecord {
	messages := []AgentChatMessageRecord{}
	for _, conversation := range OrderedConversationRecords(conversations) {
		messages = append(messages, conversation.Messages...)
	}
	return messages
}

// OrderedConversationRecords returns conversations in stable chronological order.
func OrderedConversationRecords(conversations map[string]AgentConversationRecord) []AgentConversationRecord {
	records := make([]AgentConversationRecord, 0, len(conversations))
	for _, conversation := range conversations {
		records = append(records, conversation)
	}
	sort.SliceStable(records, func(left, right int) bool {
		leftTime := firstNonEmpty(records[left].CreatedAt, records[left].UpdatedAt)
		rightTime := firstNonEmpty(records[right].CreatedAt, records[right].UpdatedAt)
		if leftTime != rightTime {
			return leftTime < rightTime
		}
		return records[left].RunID < records[right].RunID
	})
	return records
}

// HasRunningConversation reports whether any conversation is still active.
func HasRunningConversation(conversations map[string]AgentConversationRecord) bool {
	for _, conversation := range conversations {
		if !IsTerminalRunStatus(conversation.Status) {
			return true
		}
	}
	return false
}

// ProjectAgentEvent projects an agent event into chat conversations and activity.
func ProjectAgentEvent(
	event AgentEvent,
	conversations map[string]AgentConversationRecord,
	activity *[]AgentChatActivityRecord,
) {
	switch event.Type {
	case "agent.user.message":
		if conversation, ok := ensureProjectedConversation(conversations, event); ok {
			if conversation.Prompt == "" {
				conversation.Prompt = event.Message
			}
			conversation.Messages = append(conversation.Messages, AgentChatMessageRecord{
				ID:        messageIDForEvent(event, "user"),
				Role:      "user",
				Content:   event.Message,
				Kind:      "message",
				CreatedAt: event.CreatedAt,
				Status:    "complete",
				Metadata:  event.Metadata,
			})
			conversation.UpdatedAt = event.CreatedAt
			conversations[conversation.RunID] = conversation
		}
	case "agent.message.delta":
		if conversation, ok := ensureProjectedConversation(conversations, event); ok {
			conversation = appendProjectedAssistantDelta(conversation, event)
			conversations[conversation.RunID] = conversation
		}
	case "agent.message.completed":
		if conversation, ok := ensureProjectedConversation(conversations, event); ok {
			conversation = completeProjectedAssistantMessage(
				conversation,
				messageIDForEvent(event, "assistant"),
				firstNonEmpty(event.Content, event.Message),
				event.CreatedAt,
			)
			conversations[conversation.RunID] = conversation
		}
	case AgentUIEventType:
		if event.A2UI == nil && event.Form == nil {
			return
		}
		if conversation, ok := ensureProjectedUIConversation(conversations, event); ok {
			conversation = completeProjectedStreamingMessage(conversation)
			metadata := map[string]any{"runId": event.RunID}
			if event.A2UI != nil {
				metadata["a2ui"] = event.A2UI
			}
			if event.Form != nil {
				metadata["form"] = event.Form
			}
			conversation.Messages = append(conversation.Messages, AgentChatMessageRecord{
				ID:        messageIDForEvent(event, "ui"),
				Role:      "assistant",
				Content:   firstNonEmpty(event.Message, "Agent 已生成交互界面。"),
				Kind:      "message",
				CreatedAt: event.CreatedAt,
				Status:    "complete",
				Metadata:  metadata,
			})
			conversation.UpdatedAt = event.CreatedAt
			conversations[conversation.RunID] = conversation
		}
	case "agent.activity":
		label, detail := splitAgentActivityMessage(event.Message)
		activityKind := "tool"
		if isRuntimeAgentActivity(label, detail) {
			activityKind = "runtime"
		}
		appendProjectedActivity(activity, activityKind, label, detail, event.CreatedAt)
		if conversation, ok := ensureProjectedConversation(conversations, event); ok {
			conversation.Messages = append(conversation.Messages, AgentChatMessageRecord{
				ID:        messageIDForEvent(event, "activity"),
				Role:      "assistant",
				Content:   detail,
				Kind:      agentMessageKindFromActivity(activityKind, label, detail),
				Title:     label,
				CreatedAt: event.CreatedAt,
				Status:    "complete",
				Metadata:  metadataForProjectedMessage(label, detail),
			})
			conversation.UpdatedAt = event.CreatedAt
			conversations[conversation.RunID] = conversation
		}
	case "agent.acp":
		projectACPEvent(event, conversations, activity)
	case "agent.patch.proposed":
		summary := "Agent 已生成文档更新方案。"
		if event.DocumentProposal != nil && strings.TrimSpace(event.DocumentProposal.Summary) != "" {
			summary = event.DocumentProposal.Summary
		}
		appendProjectedActivity(activity, "patch", "文档方案", summary, event.CreatedAt)
		appendProjectedTrace(conversations, event, "patch", "文档方案", summary, "complete")
	case "agent.document.edit.completed":
		summary := "流式编辑已完成。"
		if event.DocumentEdit != nil {
			summary = firstNonEmpty(event.DocumentEdit.Summary, summary)
		}
		appendProjectedActivity(activity, "patch", "文档已更新", summary, event.CreatedAt)
		appendProjectedTrace(conversations, event, "patch", "文档已更新", summary, "complete")
	case "agent.document.edit.failed":
		summary := firstNonEmpty(event.Message, "流式编辑失败。")
		if event.DocumentEdit != nil {
			summary = firstNonEmpty(event.DocumentEdit.Summary, summary)
		}
		appendProjectedActivity(activity, "runtime", "流式编辑失败", summary, event.CreatedAt)
		appendProjectedTrace(conversations, event, "runtime", "流式编辑失败", summary, "error")
	case "agent.run.failed":
		appendProjectedActivity(activity, "runtime", "运行失败", event.Message, event.CreatedAt)
		appendProjectedTrace(conversations, event, "runtime", "运行失败", event.Message, "error")
	case "agent.run.cancelled":
		appendProjectedActivity(activity, "runtime", "运行已终止", event.Message, event.CreatedAt)
		appendProjectedTrace(conversations, event, "runtime", "运行已终止", event.Message, "error")
	case "agent.run.completed":
		if conversation, ok := ensureProjectedConversation(conversations, event); ok {
			conversation = completeProjectedStreamingMessage(conversation)
			conversation.Status = "completed"
			conversation.UpdatedAt = event.CreatedAt
			conversations[conversation.RunID] = conversation
		}
	}
}
