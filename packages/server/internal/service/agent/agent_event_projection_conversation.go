package agent

import (
	"fmt"
	"strings"

	"github.com/torchstellar-team/mediago-drama/packages/server/internal/platform/timestamp"
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
	if strings.TrimSpace(event.Delta) == "" {
		return conversation
	}
	if IsTerminalRunStatus(conversation.Status) {
		conversation.Status = "running"
	}
	streamingID := conversation.StreamingMessageID
	if streamingID == "" {
		streamingID = messageIDForEvent(event, "assistant-stream")
	}
	found := false
	for index := range conversation.Messages {
		if conversation.Messages[index].ID == streamingID {
			conversation.Messages[index].Content += event.Delta
			conversation.Messages[index].Status = "streaming"
			found = true
			break
		}
	}
	if !found {
		conversation.Messages = append(conversation.Messages, AgentChatMessageRecord{
			ID:        streamingID,
			Role:      "assistant",
			Content:   event.Delta,
			Kind:      "message",
			CreatedAt: event.CreatedAt,
			Status:    "streaming",
		})
	}
	conversation.StreamingMessageID = streamingID
	conversation.UpdatedAt = event.CreatedAt
	return conversation
}

func completeProjectedAssistantMessage(conversation AgentConversationRecord, id string, content string, createdAt string) AgentConversationRecord {
	if conversation.StreamingMessageID != "" {
		for index := range conversation.Messages {
			if conversation.Messages[index].ID == conversation.StreamingMessageID {
				if strings.TrimSpace(content) != "" && !shouldPreserveProjectedSegmentedContent(conversation, index) {
					conversation.Messages[index].Content = content
				}
				conversation.Messages[index].Status = "complete"
				conversation.StreamingMessageID = ""
				conversation.UpdatedAt = createdAt
				return conversation
			}
		}
	}
	if strings.TrimSpace(content) == "" {
		return conversation
	}
	conversation.Messages = append(conversation.Messages, AgentChatMessageRecord{
		ID:        id,
		Role:      "assistant",
		Content:   content,
		Kind:      "message",
		CreatedAt: createdAt,
		Status:    "complete",
	})
	conversation.UpdatedAt = createdAt
	return conversation
}

func completeProjectedStreamingMessage(conversation AgentConversationRecord) AgentConversationRecord {
	if conversation.StreamingMessageID == "" {
		return conversation
	}
	for index := range conversation.Messages {
		if conversation.Messages[index].ID == conversation.StreamingMessageID {
			conversation.Messages[index].Status = "complete"
			break
		}
	}
	conversation.StreamingMessageID = ""
	return conversation
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
	conversation.Messages = append(conversation.Messages, AgentChatMessageRecord{
		ID:        messageIDForEvent(event, kind),
		Role:      "assistant",
		Content:   content,
		Kind:      kind,
		Title:     title,
		CreatedAt: event.CreatedAt,
		Status:    status,
		Metadata:  metadataForProjectedMessage(title, content),
	})
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
