package acp

import (
	"context"

	acp "github.com/coder/acp-go-sdk"
)

func (client *acpClient) SessionUpdate(_ context.Context, params acp.SessionNotification) error {
	if !client.acceptingSessionUpdates() {
		acpLog().Debug("acp session update ignored outside prompt", client.logAttrs("update", "replay_or_resume")...)
		client.rawLog.logSessionUpdate(params, &agentEvent{
			Type:    "agent.acp.ignored",
			Message: "replay_or_resume",
		})
		return nil
	}

	update := params.Update
	if delay, isFirst := client.recordUpdateMetrics(sessionUpdateKind(update)); isFirst {
		acpLog().Info(
			"acp first session update",
			client.logAttrs("update", sessionUpdateKind(update), "delay_ms", delay.Milliseconds())...,
		)
	}
	var normalized *agentEvent
	defer func() {
		client.rawLog.logSessionUpdate(params, normalized)
	}()
	switch {
	case update.AgentMessageChunk != nil:
		if text := ACPContentBlockText(update.AgentMessageChunk.Content); text != "" {
			acpLog().Debug("acp session update", client.logAttrs("update", "agent_message_chunk", "chunk_len", len(text), "buffered", true)...)
			client.flushThoughts()
			client.appendMessage(text)
			event := agentEvent{
				Type:    "agent.message.delta",
				Message: TruncateAgentMessage(text),
				Delta:   text,
			}
			normalized = &event
			client.publish(event)
		}
	case update.AgentThoughtChunk != nil:
		if text := ACPContentBlockText(update.AgentThoughtChunk.Content); text != "" {
			acpLog().Debug("acp session update", client.logAttrs("update", "agent_thought_chunk", "chunk_len", len(text), "buffered", true)...)
			event := agentEvent{
				Type:    "agent.acp",
				Message: "思考：" + TruncateAgentMessage(text),
				ACP: &agentACPEvent{
					Kind:    "thought",
					Thought: text,
				},
			}
			normalized = &event
			client.bufferThought(text)
		}
	case update.ToolCall != nil:
		toolKind := InferACPToolKind(string(update.ToolCall.Kind), update.ToolCall.Title)
		rawInput := MarshalACPRawMessage(update.ToolCall.RawInput)
		rawOutput := MarshalACPRawMessage(update.ToolCall.RawOutput)
		acpLog().Debug(
			"acp session update",
			client.logAttrs(
				"update", "tool_call",
				"tool_call_id", update.ToolCall.ToolCallId,
				"title", update.ToolCall.Title,
				"status", update.ToolCall.Status,
				"kind", update.ToolCall.Kind,
			)...,
		)
		event := agentEvent{
			Type:    "agent.acp",
			Message: FormatACPToolCall(update.ToolCall.Title, string(update.ToolCall.Status)),
			ACP: &agentACPEvent{
				Kind:       "toolCall",
				ToolCallID: string(update.ToolCall.ToolCallId),
				ToolKind:   toolKind,
				Title:      update.ToolCall.Title,
				Status:     string(update.ToolCall.Status),
				Locations:  MapACPToolCallLocations(update.ToolCall.Locations),
				RawInput:   rawInput,
				RawOutput:  rawOutput,
				Content:    MapACPToolCallContent(update.ToolCall.Content),
			},
		}
		normalized = &event
		client.markToolCallStarted(string(update.ToolCall.ToolCallId))
		client.markToolCallMutation(string(update.ToolCall.ToolCallId), toolKind, update.ToolCall.Title, rawInput)
		client.flushThoughts()
		client.publish(event)
	case update.ToolCallUpdate != nil:
		title := ""
		if update.ToolCallUpdate.Title != nil && *update.ToolCallUpdate.Title != "" {
			title = *update.ToolCallUpdate.Title
		}
		status := ""
		if update.ToolCallUpdate.Status != nil {
			status = string(*update.ToolCallUpdate.Status)
		}
		acpLog().Debug(
			"acp session update",
			client.logAttrs(
				"update", "tool_call_update",
				"tool_call_id", update.ToolCallUpdate.ToolCallId,
				"title", title,
				"status", status,
			)...,
		)
		if status == "completed" || status == "failed" {
			if duration, ok := client.takeToolCallDuration(string(update.ToolCallUpdate.ToolCallId)); ok {
				acpLog().Info(
					"acp tool call completed",
					client.logAttrs(
						"tool_call_id", update.ToolCallUpdate.ToolCallId,
						"title", title,
						"status", status,
						"duration_ms", duration.Milliseconds(),
					)...,
				)
			}
		}
		toolKind := InferACPToolKind(OptionalACPToolKind(update.ToolCallUpdate.Kind), title)
		rawInput := MarshalACPRawMessage(update.ToolCallUpdate.RawInput)
		rawOutput := MarshalACPRawMessage(update.ToolCallUpdate.RawOutput)
		acpPayload := &agentACPEvent{
			Kind:       "toolCallUpdate",
			ToolCallID: string(update.ToolCallUpdate.ToolCallId),
			ToolKind:   toolKind,
			Title:      title,
			Status:     status,
			Locations:  MapACPToolCallLocations(update.ToolCallUpdate.Locations),
			RawInput:   rawInput,
			RawOutput:  rawOutput,
			Content:    MapACPToolCallContent(update.ToolCallUpdate.Content),
		}
		client.markToolCallMutation(string(update.ToolCallUpdate.ToolCallId), toolKind, title, rawInput)
		message := FormatACPToolCall(FirstNonEmpty(title, string(update.ToolCallUpdate.ToolCallId)), status)
		if IsACPToolRuntimeLog(*acpPayload) {
			acpPayload.Kind = ACPRuntimeLogKind
			message = FirstNonEmpty(TruncateAgentMessage(ACPRuntimeLogText(*acpPayload)), "运行日志")
		}
		event := agentEvent{
			Type:    "agent.acp",
			Message: message,
			ACP:     acpPayload,
		}
		normalized = &event
		client.flushThoughts()
		client.publish(event)
	case update.Plan != nil:
		acpLog().Debug("acp session update", client.logAttrs("update", "plan", "entries", len(update.Plan.Entries))...)
		event := agentEvent{
			Type:    "agent.acp",
			Message: FormatACPPlan(update.Plan.Entries),
			ACP: &agentACPEvent{
				Kind: "plan",
				Plan: MapACPPlanEntries(update.Plan.Entries),
			},
		}
		normalized = &event
		client.flushThoughts()
		client.publish(event)
	default:
		acpLog().Debug("acp session update", client.logAttrs("update", "unknown")...)
	}

	return nil
}

func sessionUpdateKind(update acp.SessionUpdate) string {
	switch {
	case update.AgentMessageChunk != nil:
		return "agent_message_chunk"
	case update.AgentThoughtChunk != nil:
		return "agent_thought_chunk"
	case update.ToolCall != nil:
		return "tool_call"
	case update.ToolCallUpdate != nil:
		return "tool_call_update"
	case update.Plan != nil:
		return "plan"
	default:
		return "unknown"
	}
}
