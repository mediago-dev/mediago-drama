package agent

import "strings"

func projectACPEvent(
	event AgentEvent,
	conversations map[string]AgentConversationRecord,
	activity *[]AgentChatActivityRecord,
) {
	if event.ACP == nil {
		appendProjectedActivity(activity, "runtime", "ACP", firstNonEmpty(event.Message, "ACP 更新缺少负载。"), event.CreatedAt)
		appendProjectedTrace(conversations, event, "runtime", "ACP", firstNonEmpty(event.Message, "ACP 更新缺少负载。"), "complete")
		return
	}
	acp := event.ACP
	switch acp.Kind {
	case "thought":
		content := strings.TrimSpace(firstNonEmpty(acp.Thought, event.Message))
		if content == "" {
			return
		}
		if conversation, ok := ensureProjectedConversation(conversations, event); ok {
			conversation.Messages = append(conversation.Messages, AgentChatMessageRecord{
				ID:        messageIDForEvent(event, "thought"),
				Role:      "assistant",
				Content:   content,
				Kind:      "thought",
				Title:     "思考",
				CreatedAt: event.CreatedAt,
				Status:    "complete",
			})
			conversation.UpdatedAt = event.CreatedAt
			conversations[conversation.RunID] = conversation
		}
	case ACPRuntimeLogKind:
		if conversation, ok := ensureProjectedConversation(conversations, event); ok {
			conversation = upsertProjectedACPRuntimeLog(conversation, event, *acp)
			conversations[conversation.RunID] = conversation
		}
	case "toolCall", "toolCallUpdate":
		if conversation, ok := ensureProjectedConversation(conversations, event); ok {
			if IsACPToolRuntimeLog(*acp) {
				conversation = upsertProjectedACPRuntimeLog(conversation, event, *acp)
			} else {
				conversation = upsertProjectedACPToolCall(conversation, event, *acp)
			}
			conversations[conversation.RunID] = conversation
		}
	case "plan":
		if conversation, ok := ensureProjectedConversation(conversations, event); ok {
			conversation = upsertProjectedACPPlan(conversation, event, acp.Plan)
			conversations[conversation.RunID] = conversation
		}
	case "permissionRequest":
		return
	case "mcpUnavailable", "runtimeError":
		detail := firstNonEmpty(acpRuntimeAlertMessage(acp.RuntimeAlert), event.Message, "ACP 运行时出现异常。")
		appendProjectedTrace(conversations, event, "message", acpRuntimeAlertTitle(acp.RuntimeAlert), detail, "error")
	default:
		detail := firstNonEmpty(event.Message, "ACP 更新："+acp.Kind)
		appendProjectedActivity(activity, "runtime", "ACP", detail, event.CreatedAt)
		appendProjectedTrace(conversations, event, "runtime", "ACP", detail, "complete")
	}
}

func acpRuntimeAlertTitle(alert *AgentACPRuntimeAlert) string {
	if alert == nil {
		return "运行时警告"
	}
	return firstNonEmpty(alert.Title, "运行时警告")
}

func acpRuntimeAlertMessage(alert *AgentACPRuntimeAlert) string {
	if alert == nil {
		return ""
	}
	return firstNonEmpty(alert.Message, alert.Detail)
}

func upsertProjectedACPToolCall(
	conversation AgentConversationRecord,
	event AgentEvent,
	acp AgentACPEvent,
) AgentConversationRecord {
	toolCallID := strings.TrimSpace(firstNonEmpty(acp.ToolCallID, event.ID))
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
		displayACPToolTitle(acp.Title, toolCallID),
		displayACPToolTitle(previous.Title, toolCallID),
		displayACPToolTitle(metadataString(previousMetadata, "toolName"), toolCallID),
		"工具调用",
	)
	status := firstNonEmpty(acp.Status, metadataString(previousMetadata, "status"))
	startedAt := firstNonEmpty(metadataString(previousMetadata, "startedAt"), previous.CreatedAt, event.CreatedAt)
	outputBlocks := acp.Content
	if len(outputBlocks) == 0 {
		outputBlocks = metadataACPContentBlocks(previousMetadata, "outputBlocks")
	}
	rawInput := firstNonEmptyRawMessage(acp.RawInput, metadataRawMessage(previousMetadata, "inputJson"))
	rawOutput := firstNonEmptyRawMessage(acp.RawOutput, metadataRawMessage(previousMetadata, "outputJson"))
	locations := acp.Locations
	if len(locations) == 0 {
		locations = metadataACPLocations(previousMetadata, "locations")
	}
	bytes, lines := measureProjectedACPOutput(outputBlocks, rawOutput)
	metadata := mergeMetadata(previousMetadata, map[string]any{
		"toolName":     title,
		"acpKind":      projectedACPToolKind(acp.ToolKind, inferProjectedACPToolKind(title), metadataString(previousMetadata, "acpKind")),
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
		Role:      "assistant",
		Content:   firstNonEmpty(event.Message, projectedACPToolSummary(status, lines, bytes), previous.Content, title),
		Kind:      "tool",
		Title:     title,
		CreatedAt: firstNonEmpty(previous.CreatedAt, event.CreatedAt),
		Status:    projectedMessageStatusFromToolStatus(status),
		Metadata:  metadata,
	}

	if existingIndex >= 0 {
		conversation.Messages[existingIndex] = message
	} else {
		conversation.Messages = append(conversation.Messages, message)
	}
	conversation.Status = nonTerminalProjectedRunStatus(conversation.Status)
	conversation.UpdatedAt = event.CreatedAt
	return conversation
}

func upsertProjectedACPRuntimeLog(
	conversation AgentConversationRecord,
	event AgentEvent,
	acp AgentACPEvent,
) AgentConversationRecord {
	toolCallID := strings.TrimSpace(firstNonEmpty(acp.ToolCallID, event.ID))
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

	status := firstNonEmpty(acp.Status, metadataString(previousMetadata, "status"))
	startedAt := firstNonEmpty(metadataString(previousMetadata, "startedAt"), previous.CreatedAt, event.CreatedAt)
	outputBlocks := acp.Content
	if len(outputBlocks) == 0 {
		outputBlocks = metadataACPContentBlocks(previousMetadata, "outputBlocks")
	}
	rawOutput := firstNonEmptyRawMessage(acp.RawOutput, metadataRawMessage(previousMetadata, "outputJson"))
	bytes, lines := measureProjectedACPOutput(outputBlocks, rawOutput)
	content := firstNonEmpty(ACPRuntimeLogText(acp), event.Message, previous.Content, projectedACPToolSummary(status, lines, bytes), "运行日志")
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
		Role:      "assistant",
		Content:   content,
		Kind:      "runtime",
		Title:     "运行日志",
		CreatedAt: firstNonEmpty(previous.CreatedAt, event.CreatedAt),
		Status:    projectedMessageStatusFromToolStatus(status),
		Metadata:  metadata,
	}

	if existingIndex >= 0 {
		conversation.Messages[existingIndex] = message
	} else {
		conversation.Messages = append(conversation.Messages, message)
	}
	conversation.Status = nonTerminalProjectedRunStatus(conversation.Status)
	conversation.UpdatedAt = event.CreatedAt
	return conversation
}

func upsertProjectedACPPlan(
	conversation AgentConversationRecord,
	event AgentEvent,
	entries []AgentACPPlanEntry,
) AgentConversationRecord {
	contentParts := make([]string, 0, len(entries))
	for _, entry := range entries {
		if strings.TrimSpace(entry.Content) != "" {
			contentParts = append(contentParts, strings.TrimSpace(entry.Content))
		}
	}
	content := strings.Join(contentParts, "\n")
	if content == "" {
		content = firstNonEmpty(event.Message, "ACP 计划已更新。")
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
		message.CreatedAt = firstNonEmpty(previous.CreatedAt, event.CreatedAt)
		conversation.Messages[existingIndex] = message
	} else {
		conversation.Messages = append(conversation.Messages, message)
	}
	conversation.Status = nonTerminalProjectedRunStatus(conversation.Status)
	conversation.UpdatedAt = event.CreatedAt
	return conversation
}
