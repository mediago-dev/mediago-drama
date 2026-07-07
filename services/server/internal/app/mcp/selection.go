package mcp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	serviceselection "github.com/mediago-dev/mediago-drama/services/server/internal/service/selection"
)

// AskUserSelection presents the user with a set of options, pushes a
// deterministic A2UI card to the run timeline, and blocks until the user
// decides or the wait window elapses. It is only available on the run-scoped
// document MCP server, which carries the session/run context and event
// publisher needed to render and correlate the card.
func (adapter *Adapter) AskUserSelection(ctx context.Context, projectID string, input mediamcp.AskUserSelectionInput) (mediamcp.AskUserSelectionOutput, error) {
	if adapter == nil || adapter.document == nil {
		return mediamcp.AskUserSelectionOutput{}, fmt.Errorf("ask_user_selection is only available on the run-scoped document mcp server")
	}
	service := adapter.document.store.Selections
	if service == nil {
		return mediamcp.AskUserSelectionOutput{}, fmt.Errorf("selection service is not configured")
	}
	projectID = adapter.projectIDForAgentEvent(projectID)

	created, err := service.Create(projectID, serviceselection.CreateRequest{
		SessionID:      adapter.document.config.SessionID,
		RunID:          adapter.document.config.RunID,
		Kind:           strings.TrimSpace(input.Kind),
		Title:          strings.TrimSpace(input.Title),
		Prompt:         strings.TrimSpace(input.Prompt),
		Options:        selectionOptionsFromMCP(input.Options),
		AllowCustom:    input.AllowCustom,
		TimeoutSeconds: input.TimeoutSeconds,
	})
	if err != nil {
		return mediamcp.AskUserSelectionOutput{}, err
	}

	adapter.document.logToolInvocation(mediamcp.AgentDocumentTools.AskUserSelection.Name, "selection_id", created.ID, "options", len(created.Options))
	adapter.publishSelectionCard(projectID, created)

	timeout := time.Duration(input.TimeoutSeconds) * time.Second
	record, err := service.WaitForSelection(ctx, projectID, created.ID, timeout, 0)
	if err != nil {
		if errors.Is(err, serviceselection.ErrWaitTimeout) {
			return mediamcp.AskUserSelectionOutput{SelectionID: created.ID, Status: serviceselection.StatusTimeout}, nil
		}
		return mediamcp.AskUserSelectionOutput{}, err
	}

	output := mediamcp.AskUserSelectionOutput{SelectionID: record.ID, Status: record.Status}
	if record.Decision != nil {
		output.OptionID = record.Decision.OptionID
		output.CustomText = record.Decision.CustomText
	}
	return output, nil
}

func (adapter *Adapter) publishSelectionCard(projectID string, record serviceselection.Record) {
	publisher := adapter.publisherForAgentEvent(projectID)
	if publisher == nil {
		return
	}
	options := make([]serviceagent.SelectionCardOption, 0, len(record.Options))
	for _, option := range record.Options {
		options = append(options, serviceagent.SelectionCardOption{
			ID:          option.ID,
			Label:       option.Label,
			ImageURL:    option.ImageURL,
			Description: option.Description,
		})
	}
	payload := serviceagent.BuildSelectionA2UI(projectID, record.ID, record.Title, record.Prompt, options, record.AllowCustom)
	if payload == nil {
		return
	}
	publisher.PublishEvent(agentEvent{
		ProjectID: projectID,
		SessionID: adapter.document.config.SessionID,
		RunID:     adapter.document.config.RunID,
		Type:      serviceagent.AgentUIEventType,
		Message:   firstNonEmpty(record.Title, "需要你选择"),
		A2UI:      payload,
	})
}

func selectionOptionsFromMCP(input []mediamcp.SelectionOptionInput) []serviceselection.Option {
	options := make([]serviceselection.Option, 0, len(input))
	for _, option := range input {
		options = append(options, serviceselection.Option{
			ID:          option.ID,
			Label:       option.Label,
			ImageURL:    option.ImageURL,
			Description: option.Description,
		})
	}
	return options
}
