package agent

import (
	"fmt"
	"strings"
)

// NormalizeAgentEventSemantics fills additive turn, item, and phase fields for
// both newly emitted events and legacy events read from persistence. Explicit
// protocol fields always take precedence over inferred values.
func NormalizeAgentEventSemantics(event AgentEvent) AgentEvent {
	event.TurnID = strings.TrimSpace(event.TurnID)
	event.ItemID = strings.TrimSpace(event.ItemID)
	event.Phase = AgentMessagePhase(strings.TrimSpace(string(event.Phase)))

	if event.TurnID == "" {
		event.TurnID = strings.TrimSpace(firstNonEmpty(event.RunID, event.SessionID))
	}
	if event.ItemID == "" {
		event.ItemID = inferredAgentEventItemID(event)
	}
	if event.Phase == "" {
		event.Phase = inferredAgentEventPhase(event)
	}
	return event
}

func inferredAgentEventItemID(event AgentEvent) string {
	if event.ACP != nil {
		switch strings.TrimSpace(event.ACP.Kind) {
		case "toolCall", "toolCallUpdate", ACPRuntimeLogKind:
			if toolCallID := strings.TrimSpace(event.ACP.ToolCallID); toolCallID != "" {
				return toolCallID
			}
		case "plan":
			if event.TurnID != "" {
				return event.TurnID + ":plan"
			}
		}
	}
	if eventID := strings.TrimSpace(event.ID); eventID != "" {
		return eventID
	}
	if event.Sequence > 0 {
		return fmt.Sprintf("event-%d", event.Sequence)
	}
	return ""
}

func inferredAgentEventPhase(event AgentEvent) AgentMessagePhase {
	switch strings.TrimSpace(event.Type) {
	case "agent.message.delta":
		return AgentMessagePhaseCommentary
	case "agent.message.completed":
		return AgentMessagePhaseFinalAnswer
	case "agent.activity",
		"agent.acp",
		"agent.patch.proposed",
		"agent.document.edit.started",
		"agent.document.edit.delta",
		"agent.document.edit.checkpoint",
		"agent.document.edit.completed",
		"agent.document.edit.failed",
		"agent.run.failed",
		"agent.run.cancelled":
		return AgentMessagePhaseCommentary
	default:
		return ""
	}
}

func applyProjectedMessageSemantics(message AgentChatMessageRecord, event AgentEvent) AgentChatMessageRecord {
	if message.TurnID == "" {
		message.TurnID = event.TurnID
	}
	if message.ItemID == "" {
		message.ItemID = firstNonEmpty(event.ItemID, message.ID)
	}
	if event.Phase != "" {
		message.Phase = event.Phase
	}
	return message
}
