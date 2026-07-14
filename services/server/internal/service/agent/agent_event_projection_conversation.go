package agent

import (
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
)

func ensureProjectedConversation(
	conversations map[string]AgentConversationRecord,
	event AgentEvent,
) (AgentConversationRecord, bool) {
	runID := strings.TrimSpace(firstNonEmpty(event.RunID, event.SessionID))
	if runID == "" {
		return AgentConversationRecord{}, false
	}
	if conversation, ok := conversations[runID]; ok {
		if conversation.CreatedAt == "" {
			conversation.CreatedAt = firstNonEmpty(event.CreatedAt, timestamp.NowRFC3339Nano())
		}
		return conversation, true
	}
	createdAt := firstNonEmpty(event.CreatedAt, timestamp.NowRFC3339Nano())
	conversation := AgentConversationRecord{
		RunID:     runID,
		Name:      DefaultAgentName,
		Status:    "running",
		Messages:  []AgentChatMessageRecord{},
		Children:  []string{},
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}
	conversations[runID] = conversation
	return conversation, true
}

func ensureProjectedUIConversation(
	conversations map[string]AgentConversationRecord,
	event AgentEvent,
) (AgentConversationRecord, bool) {
	if strings.TrimSpace(event.RunID) != "" || strings.TrimSpace(event.SessionID) != "" {
		return ensureProjectedConversation(conversations, event)
	}
	const standaloneUIRunID = "project-ui"
	if conversation, ok := conversations[standaloneUIRunID]; ok {
		if conversation.CreatedAt == "" {
			conversation.CreatedAt = firstNonEmpty(event.CreatedAt, timestamp.NowRFC3339Nano())
		}
		return conversation, true
	}
	createdAt := firstNonEmpty(event.CreatedAt, timestamp.NowRFC3339Nano())
	conversation := AgentConversationRecord{
		RunID:     standaloneUIRunID,
		Name:      "系统确认",
		Status:    "completed",
		Messages:  []AgentChatMessageRecord{},
		Children:  []string{},
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}
	conversations[standaloneUIRunID] = conversation
	return conversation, true
}

func appendProjectedAssistantDelta(conversation AgentConversationRecord, event AgentEvent) AgentConversationRecord {
	if event.Delta == "" {
		return conversation
	}
	if IsTerminalRunStatus(conversation.Status) {
		conversation.Status = "running"
	}
	streamingIndex := projectedStreamingMessageIndex(conversation, event)
	if streamingIndex < 0 && conversation.StreamingMessageID != "" {
		completeProjectedStreamingMessageByID(&conversation, conversation.StreamingMessageID)
	}
	if streamingIndex >= 0 {
		message := conversation.Messages[streamingIndex]
		message.Content += event.Delta
		message.Status = "streaming"
		conversation.Messages[streamingIndex] = applyProjectedMessageSemantics(message, event)
		conversation.StreamingMessageID = message.ID
		conversation.UpdatedAt = event.CreatedAt
		return conversation
	}

	streamingID := messageIDForEvent(event, "assistant-stream")
	message := applyProjectedMessageSemantics(AgentChatMessageRecord{
		ID:        streamingID,
		Role:      "assistant",
		Content:   event.Delta,
		Kind:      "message",
		CreatedAt: event.CreatedAt,
		Status:    "streaming",
	}, event)
	conversation.Messages = append(conversation.Messages, message)
	conversation.StreamingMessageID = streamingID
	conversation.UpdatedAt = event.CreatedAt
	return conversation
}

func completeProjectedAssistantMessage(conversation AgentConversationRecord, event AgentEvent) AgentConversationRecord {
	content := firstNonEmpty(event.Content, event.Message)
	streamingIndex := projectedStreamingMessageIndex(conversation, event)
	if streamingIndex >= 0 {
		if strings.TrimSpace(content) != "" && !shouldPreserveProjectedSegmentedContent(conversation, streamingIndex) {
			conversation.Messages[streamingIndex].Content = content
		}
		conversation.Messages[streamingIndex].Status = "complete"
		conversation.Messages[streamingIndex] = applyProjectedMessageSemantics(conversation.Messages[streamingIndex], event)
		if conversation.Messages[streamingIndex].ID == conversation.StreamingMessageID {
			conversation.StreamingMessageID = ""
		}
		conversation.UpdatedAt = event.CreatedAt
		return conversation
	}
	if strings.TrimSpace(content) == "" {
		return conversation
	}
	message := applyProjectedMessageSemantics(AgentChatMessageRecord{
		ID:        messageIDForEvent(event, "assistant"),
		Role:      "assistant",
		Content:   content,
		Kind:      "message",
		CreatedAt: event.CreatedAt,
		Status:    "complete",
	}, event)
	conversation.Messages = append(conversation.Messages, message)
	conversation.UpdatedAt = event.CreatedAt
	return conversation
}

func completeProjectedStreamingMessage(conversation AgentConversationRecord) AgentConversationRecord {
	if conversation.StreamingMessageID == "" {
		return conversation
	}
	completeProjectedStreamingMessageByID(&conversation, conversation.StreamingMessageID)
	conversation.StreamingMessageID = ""
	return conversation
}

func projectedStreamingMessageIndex(conversation AgentConversationRecord, event AgentEvent) int {
	itemID := strings.TrimSpace(event.ItemID)
	if itemID != "" {
		for index := len(conversation.Messages) - 1; index >= 0; index-- {
			message := conversation.Messages[index]
			if message.Role != "assistant" || message.Kind != "message" || message.ItemID != itemID {
				continue
			}
			if event.TurnID == "" || message.TurnID == "" || message.TurnID == event.TurnID {
				return index
			}
		}
		return -1
	}
	for index := len(conversation.Messages) - 1; index >= 0; index-- {
		if conversation.Messages[index].ID == conversation.StreamingMessageID {
			return index
		}
	}
	return -1
}

func completeProjectedStreamingMessageByID(conversation *AgentConversationRecord, messageID string) {
	for index := range conversation.Messages {
		if conversation.Messages[index].ID == messageID {
			conversation.Messages[index].Status = "complete"
			return
		}
	}
}

func shouldPreserveProjectedSegmentedContent(conversation AgentConversationRecord, streamingIndex int) bool {
	if streamingIndex < 0 {
		return false
	}
	lastUserIndex := -1
	for index, message := range conversation.Messages {
		if message.Role == "user" {
			lastUserIndex = index
		}
	}
	for index, message := range conversation.Messages {
		if index <= lastUserIndex || index >= streamingIndex {
			continue
		}
		if message.Role == "assistant" && message.Kind != "runtime" {
			return true
		}
	}
	return false
}

func appendProjectedTrace(
	conversations map[string]AgentConversationRecord,
	event AgentEvent,
	kind string,
	title string,
	content string,
	status string,
) {
	if strings.TrimSpace(content) == "" {
		return
	}
	conversation, ok := ensureProjectedConversation(conversations, event)
	if !ok {
		return
	}
	message := applyProjectedMessageSemantics(AgentChatMessageRecord{
		ID:        messageIDForEvent(event, kind),
		Role:      "assistant",
		Content:   content,
		Kind:      kind,
		Title:     title,
		CreatedAt: event.CreatedAt,
		Status:    status,
		Metadata:  metadataForProjectedMessage(title, content),
	}, event)
	conversation.Messages = append(conversation.Messages, message)
	conversation.UpdatedAt = event.CreatedAt
	conversations[conversation.RunID] = conversation
}

func appendProjectedActivity(activity *[]AgentChatActivityRecord, kind string, label string, detail string, createdAt string) {
	if strings.TrimSpace(detail) == "" {
		return
	}
	*activity = append(*activity, AgentChatActivityRecord{
		ID:        mustRandomID(kind),
		Kind:      kind,
		Label:     firstNonEmpty(label, "Agent 日志"),
		Detail:    detail,
		CreatedAt: createdAt,
	})
}

func messageIDForEvent(event AgentEvent, prefix string) string {
	if strings.TrimSpace(event.ID) == "" {
		return createProjectedMessageID(prefix, event.Sequence)
	}
	return prefix + "-" + event.ID
}

func createProjectedMessageID(prefix string, sequence int64) string {
	if sequence > 0 {
		return fmt.Sprintf("%s-event-%d", prefix, sequence)
	}
	return mustRandomID(prefix)
}
