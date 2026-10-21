package agent

import "strings"

func projectRuntimeEvent(
	event AgentEvent,
	conversations map[string]AgentConversationRecord,
	activity *[]AgentChatActivityRecord,
) {
	if event.Runtime == nil {
		appendProjectedActivity(activity, "runtime", "Runtime", firstNonEmpty(event.Message, "Runtime 更新缺少负载。"), event.CreatedAt)
		appendProjectedTrace(conversations, event, "runtime", "Runtime", firstNonEmpty(event.Message, "Runtime 更新缺少负载。"), "complete")
		return
	}
	runtime := event.Runtime
	switch runtime.Kind {
	case "thought":
		content := firstNonEmpty(runtime.Thought, event.Message)
		if content == "" {
			return
		}
		if conversation, ok := ensureProjectedConversation(conversations, event); ok {
			message := applyProjectedMessageSemantics(AgentChatMessageRecord{
				ID:        messageIDForEvent(event, "thought"),
				Role:      "assistant",
				Content:   content,
				Kind:      "thought",
				Title:     "思考",
				CreatedAt: event.CreatedAt,
				Status:    "complete",
			}, event)
			merged := false
			if event.ItemID != "" {
				for i := len(conversation.Messages) - 1; i >= 0; i-- {
					previous := &conversation.Messages[i]
					if previous.Kind == "thought" && previous.ItemID == event.ItemID && previous.TurnID == event.TurnID {
						previous.Content += content
						merged = true
						break
					}
				}
			}
			if !merged {
				conversation.Messages = append(conversation.Messages, message)
			}
			conversation.UpdatedAt = event.CreatedAt
			conversations[conversation.RunID] = conversation
		}
	case RuntimeLogKind:
		if conversation, ok := ensureProjectedConversation(conversations, event); ok {
			conversation = upsertProjectedRuntimeLog(conversation, event, *runtime)
			conversations[conversation.RunID] = conversation
		}
	case "toolCall", "toolCallUpdate":
		if conversation, ok := ensureProjectedConversation(conversations, event); ok {
			if IsRuntimeToolRuntimeLog(*runtime) {
				conversation = upsertProjectedRuntimeLog(conversation, event, *runtime)
			} else {
				conversation = upsertProjectedRuntimeToolCall(conversation, event, *runtime)
			}
			conversations[conversation.RunID] = conversation
		}
	case "plan":
		if conversation, ok := ensureProjectedConversation(conversations, event); ok {
			conversation = upsertProjectedRuntimePlan(conversation, event, runtime.Plan)
			conversations[conversation.RunID] = conversation
		}
	case "permissionRequest":
		return
	case "mcpUnavailable", "runtimeError":
		detail := firstNonEmpty(runtimeAlertMessage(runtime.RuntimeAlert), event.Message, "Runtime 运行时出现异常。")
		appendProjectedTrace(conversations, event, "message", runtimeAlertTitle(runtime.RuntimeAlert), detail, "error")
	default:
		detail := firstNonEmpty(event.Message, "Runtime 更新："+runtime.Kind)
		appendProjectedActivity(activity, "runtime", "Runtime", detail, event.CreatedAt)
		appendProjectedTrace(conversations, event, "runtime", "Runtime", detail, "complete")
	}
}

func runtimeAlertTitle(alert *AgentRuntimeAlert) string {
	if alert == nil {
		return "运行时警告"
	}
	return firstNonEmpty(alert.Title, "运行时警告")
}

func runtimeAlertMessage(alert *AgentRuntimeAlert) string {
	if alert == nil {
		return ""
	}
	return firstNonEmpty(alert.Message, alert.Detail)
}

func upsertProjectedRuntimeToolCall(
	conversation AgentConversationRecord,
	event AgentEvent,
	runtime AgentRuntimeEvent,
) AgentConversationRecord {
	toolCallID := strings.TrimSpace(firstNonEmpty(runtime.ToolCallID, event.ID))
	if toolCallID == "" {
		return conversation
	}
	existingIndex := -1
	for index, message := range conversation.Messages {
		if metadataString(message.Metadata, "toolCallId") == toolCallID {
			existingIndex = index
			break
		}
	}
	if existingIndex < 0 {
		conversation = completeProjectedStreamingMessage(conversation)
	}

	previous := AgentChatMessageRecord{}
	if existingIndex >= 0 {
		previous = conversation.Messages[existingIndex]
	}
	previousMetadata := previous.Metadata
	if previousMetadata == nil {
		previousMetadata = map[string]any{}
	}

	title := firstNonEmpty(
		displayRuntimeToolTitle(runtime.Title, toolCallID),
		displayRuntimeToolTitle(previous.Title, toolCallID),
		displayRuntimeToolTitle(metadataString(previousMetadata, "toolName"), toolCallID),
		"工具调用",
	)
	status := firstNonEmpty(runtime.Status, metadataString(previousMetadata, "status"))
	startedAt := firstNonEmpty(metadataString(previousMetadata, "startedAt"), previous.CreatedAt, event.CreatedAt)
	outputBlocks := runtime.Content
	if len(outputBlocks) == 0 {
		outputBlocks = metadataRuntimeContentBlocks(previousMetadata, "outputBlocks")
	}
	rawInput := firstNonEmptyRawMessage(runtime.RawInput, metadataRawMessage(previousMetadata, "inputJson"))
	rawOutput := firstNonEmptyRawMessage(runtime.RawOutput, metadataRawMessage(previousMetadata, "outputJson"))
	locations := runtime.Locations
	if len(locations) == 0 {
		locations = metadataRuntimeLocations(previousMetadata, "locations")
	}
	bytes, lines := measureProjectedRuntimeOutput(outputBlocks, rawOutput)
	metadata := mergeMetadata(previousMetadata, map[string]any{
		"toolName":     title,
		"runtimeKind":  projectedRuntimeToolKind(runtime.ToolKind, inferProjectedRuntimeToolKind(title), metadataString(previousMetadata, "runtimeKind")),
		"toolCallId":   toolCallID,
		"status":       status,
		"durationMs":   projectedDurationMs(startedAt, event.CreatedAt, status, previousMetadata["durationMs"]),
		"inputJson":    rawInput,
		"outputJson":   rawOutput,
		"outputBlocks": outputBlocks,
		"locations":    locations,
		"bytes":        bytes,
		"lines":        lines,
		"startedAt":    startedAt,
	})
	message := AgentChatMessageRecord{
		ID:        firstNonEmpty(previous.ID, messageIDForEvent(event, "tool")),
		TurnID:    previous.TurnID,
		ItemID:    previous.ItemID,
		Role:      "assistant",
		Content:   firstNonEmpty(event.Message, projectedRuntimeToolSummary(status, lines, bytes), previous.Content, title),
		Kind:      "tool",
		Phase:     previous.Phase,
		Title:     title,
		CreatedAt: firstNonEmpty(previous.CreatedAt, event.CreatedAt),
		Status:    projectedMessageStatusFromToolStatus(status),
		Metadata:  metadata,
	}
	message = applyProjectedMessageSemantics(message, event)

	if existingIndex >= 0 {
		conversation.Messages[existingIndex] = message
	} else {
		conversation.Messages = append(conversation.Messages, message)
	}
	conversation.Status = nonTerminalProjectedRunStatus(conversation.Status)
	conversation.UpdatedAt = event.CreatedAt
	return conversation
}

func upsertProjectedRuntimeLog(
	conversation AgentConversationRecord,
	event AgentEvent,
	runtime AgentRuntimeEvent,
) AgentConversationRecord {
	toolCallID := strings.TrimSpace(firstNonEmpty(runtime.ToolCallID, event.ID))
	existingIndex := -1
	for index, message := range conversation.Messages {
		if message.Kind == "runtime" && metadataBool(message.Metadata, "runtimeLog") {
			if toolCallID == "" || metadataString(message.Metadata, "toolCallId") == toolCallID {
				existingIndex = index
				break
			}
		}
	}
	if existingIndex < 0 {
		conversation = completeProjectedStreamingMessage(conversation)
	}

	previous := AgentChatMessageRecord{}
	if existingIndex >= 0 {
		previous = conversation.Messages[existingIndex]
	}
	previousMetadata := previous.Metadata
	if previousMetadata == nil {
		previousMetadata = map[string]any{}
	}

	status := firstNonEmpty(runtime.Status, metadataString(previousMetadata, "status"))
	startedAt := firstNonEmpty(metadataString(previousMetadata, "startedAt"), previous.CreatedAt, event.CreatedAt)
	outputBlocks := runtime.Content
	if len(outputBlocks) == 0 {
		outputBlocks = metadataRuntimeContentBlocks(previousMetadata, "outputBlocks")
	}
	rawOutput := firstNonEmptyRawMessage(runtime.RawOutput, metadataRawMessage(previousMetadata, "outputJson"))
	bytes, lines := measureProjectedRuntimeOutput(outputBlocks, rawOutput)
	content := firstNonEmpty(RuntimeLogText(runtime), event.Message, previous.Content, projectedRuntimeToolSummary(status, lines, bytes), "运行日志")
	metadata := mergeMetadata(previousMetadata, map[string]any{
		"runtimeLog":   true,
		"toolName":     "运行日志",
		"toolCallId":   toolCallID,
		"status":       status,
		"durationMs":   projectedDurationMs(startedAt, event.CreatedAt, status, previousMetadata["durationMs"]),
		"outputJson":   rawOutput,
		"outputBlocks": outputBlocks,
		"bytes":        bytes,
		"lines":        lines,
		"startedAt":    startedAt,
	})
	message := AgentChatMessageRecord{
		ID:        firstNonEmpty(previous.ID, messageIDForEvent(event, "runtime")),
		TurnID:    previous.TurnID,
		ItemID:    previous.ItemID,
		Role:      "assistant",
		Content:   content,
		Kind:      "runtime",
		Phase:     previous.Phase,
		Title:     "运行日志",
		CreatedAt: firstNonEmpty(previous.CreatedAt, event.CreatedAt),
		Status:    projectedMessageStatusFromToolStatus(status),
		Metadata:  metadata,
	}
	message = applyProjectedMessageSemantics(message, event)

	if existingIndex >= 0 {
		conversation.Messages[existingIndex] = message
	} else {
		conversation.Messages = append(conversation.Messages, message)
	}
	conversation.Status = nonTerminalProjectedRunStatus(conversation.Status)
	conversation.UpdatedAt = event.CreatedAt
	return conversation
}

func upsertProjectedRuntimePlan(
	conversation AgentConversationRecord,
	event AgentEvent,
	entries []AgentRuntimePlanEntry,
) AgentConversationRecord {
	contentParts := make([]string, 0, len(entries))
	for _, entry := range entries {
		if strings.TrimSpace(entry.Content) != "" {
			contentParts = append(contentParts, strings.TrimSpace(entry.Content))
		}
	}
	content := strings.Join(contentParts, "\n")
	if content == "" {
		content = firstNonEmpty(event.Message, "Runtime 计划已更新。")
	}
	existingIndex := findProjectedCurrentTurnPlanIndex(conversation.Messages)
	metadata := map[string]any{"planEntries": entries}
	message := AgentChatMessageRecord{
		ID:        messageIDForEvent(event, "plan"),
		Role:      "assistant",
		Content:   content,
		Kind:      "plan",
		Title:     "计划",
		CreatedAt: event.CreatedAt,
		Status:    "complete",
		Metadata:  metadata,
	}
	if existingIndex >= 0 {
		previous := conversation.Messages[existingIndex]
		message.ID = previous.ID
		message.TurnID = previous.TurnID
		message.ItemID = previous.ItemID
		message.Phase = previous.Phase
		message.CreatedAt = firstNonEmpty(previous.CreatedAt, event.CreatedAt)
	}
	message = applyProjectedMessageSemantics(message, event)
	if existingIndex >= 0 {
		conversation.Messages[existingIndex] = message
	} else {
		conversation.Messages = append(conversation.Messages, message)
	}
	conversation.Status = nonTerminalProjectedRunStatus(conversation.Status)
	conversation.UpdatedAt = event.CreatedAt
	return conversation
}
