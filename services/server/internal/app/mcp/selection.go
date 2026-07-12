package mcp

import (
	"context"
	"encoding/json"
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

	if reused, ok := adapter.reuseSelection(ctx, projectID, input.Kind, input.Title, input.TimeoutSeconds); ok {
		return reused.output, reused.err
	}

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

	return waitSelectionOutput(ctx, service, projectID, created.ID, input.TimeoutSeconds)
}

type reusedSelectionResult struct {
	output mediamcp.AskUserSelectionOutput
	err    error
}

// reuseSelection catches repeated asks for the same question in one run: a
// model that re-asks instead of awaiting would otherwise pop a duplicate card,
// and a decision that landed while it was re-asking would be lost. A pending
// duplicate is waited on (no new card); a decision made within the last two
// minutes is returned immediately.
func (adapter *Adapter) reuseSelection(ctx context.Context, projectID string, kind string, title string, timeoutSeconds int) (reusedSelectionResult, bool) {
	service := adapter.document.store.Selections
	existing, ok, err := service.FindReusable(projectID, adapter.document.config.RunID, strings.TrimSpace(kind), strings.TrimSpace(title))
	if err != nil || !ok {
		return reusedSelectionResult{}, false
	}
	adapter.document.logToolInvocation("reuse_user_selection", "selection_id", existing.ID, "status", existing.Status)
	if existing.Status != serviceselection.StatusPending {
		return reusedSelectionResult{output: selectionOutputFromRecord(existing)}, true
	}
	output, waitErr := waitSelectionOutput(ctx, service, projectID, existing.ID, timeoutSeconds)
	return reusedSelectionResult{output: output, err: waitErr}, true
}

// AskUserForm presents a native parameter form card, blocks until the user
// submits, and returns the field values. It shares the selection lifecycle so
// await_user_selection and the retrieve-after-timeout flow work unchanged.
func (adapter *Adapter) AskUserForm(ctx context.Context, projectID string, input mediamcp.AskUserFormInput) (mediamcp.AskUserSelectionOutput, error) {
	if adapter == nil || adapter.document == nil {
		return mediamcp.AskUserSelectionOutput{}, fmt.Errorf("ask_user_form is only available on the run-scoped document mcp server")
	}
	service := adapter.document.store.Selections
	if service == nil {
		return mediamcp.AskUserSelectionOutput{}, fmt.Errorf("selection service is not configured")
	}
	projectID = adapter.projectIDForAgentEvent(projectID)

	if reused, ok := adapter.reuseSelection(ctx, projectID, firstNonEmpty(input.Kind, "form"), input.Title, input.TimeoutSeconds); ok {
		return reused.output, reused.err
	}

	created, err := service.Create(projectID, serviceselection.CreateRequest{
		SessionID:      adapter.document.config.SessionID,
		RunID:          adapter.document.config.RunID,
		Kind:           strings.TrimSpace(firstNonEmpty(input.Kind, "form")),
		Title:          strings.TrimSpace(input.Title),
		Prompt:         strings.TrimSpace(input.Prompt),
		Fields:         selectionFieldsFromMCP(input.Fields),
		TimeoutSeconds: input.TimeoutSeconds,
	})
	if err != nil {
		return mediamcp.AskUserSelectionOutput{}, err
	}

	adapter.document.logToolInvocation(mediamcp.AgentDocumentTools.AskUserForm.Name, "selection_id", created.ID, "fields", len(created.Fields))
	adapter.publishFormCard(projectID, created, strings.TrimSpace(input.SubmitLabel))

	return waitSelectionOutput(ctx, service, projectID, created.ID, input.TimeoutSeconds)
}

func (adapter *Adapter) publishFormCard(projectID string, record serviceselection.Record, submitLabel string) {
	publisher := adapter.publisherForAgentEvent(projectID)
	if publisher == nil {
		return
	}
	fieldsJSON, err := json.Marshal(record.Fields)
	if err != nil {
		return
	}
	publisher.PublishEvent(agentEvent{
		ProjectID: projectID,
		SessionID: adapter.document.config.SessionID,
		RunID:     adapter.document.config.RunID,
		Type:      serviceagent.AgentUIEventType,
		Message:   firstNonEmpty(record.Title, "需要你确认参数"),
		Form: &serviceagent.AgentFormPayload{
			SelectionID: record.ID,
			ProjectID:   projectID,
			Title:       record.Title,
			Prompt:      record.Prompt,
			SubmitLabel: submitLabel,
			Fields:      fieldsJSON,
		},
	})
}

func selectionFieldsFromMCP(input []mediamcp.FormFieldInput) []serviceselection.FormField {
	fields := make([]serviceselection.FormField, 0, len(input))
	for _, field := range input {
		options := make([]serviceselection.FormFieldOption, 0, len(field.Options))
		for _, option := range field.Options {
			options = append(options, serviceselection.FormFieldOption{
				Value:       option.Value,
				Label:       option.Label,
				Description: option.Description,
			})
		}
		fields = append(fields, serviceselection.FormField{
			ID:          field.ID,
			Label:       field.Label,
			Type:        field.Type,
			Kind:        field.Kind,
			Description: field.Description,
			Options:     options,
			Default:     field.Default,
			Min:         field.Min,
			Max:         field.Max,
			Unit:        field.Unit,
			Required:    field.Required,
		})
	}
	return fields
}

// AwaitUserSelection keeps waiting on an existing selection without creating a
// new card, so agents can split a long wait into client-safe short rounds and
// still catch a decision that lands between rounds.
func (adapter *Adapter) AwaitUserSelection(ctx context.Context, projectID string, input mediamcp.AwaitUserSelectionInput) (mediamcp.AskUserSelectionOutput, error) {
	if adapter == nil || adapter.document == nil {
		return mediamcp.AskUserSelectionOutput{}, fmt.Errorf("await_user_selection is only available on the run-scoped document mcp server")
	}
	service := adapter.document.store.Selections
	if service == nil {
		return mediamcp.AskUserSelectionOutput{}, fmt.Errorf("selection service is not configured")
	}
	selectionID := strings.TrimSpace(input.SelectionID)
	if selectionID == "" {
		return mediamcp.AskUserSelectionOutput{}, fmt.Errorf("selectionId is required")
	}
	projectID = adapter.projectIDForAgentEvent(projectID)
	record, ok, err := service.Get(projectID, selectionID)
	if err != nil {
		return mediamcp.AskUserSelectionOutput{}, err
	}
	if !ok {
		return mediamcp.AskUserSelectionOutput{}, fmt.Errorf("selection not found")
	}
	adapter.document.logToolInvocation(mediamcp.AgentDocumentTools.AwaitUserSelection.Name, "selection_id", selectionID, "status", record.Status)
	if record.Status != serviceselection.StatusPending {
		return selectionOutputFromRecord(record), nil
	}
	return waitSelectionOutput(ctx, service, projectID, selectionID, input.TimeoutSeconds)
}

func waitSelectionOutput(ctx context.Context, service *serviceselection.Service, projectID string, selectionID string, timeoutSeconds int) (mediamcp.AskUserSelectionOutput, error) {
	timeout := time.Duration(timeoutSeconds) * time.Second
	record, err := service.WaitForSelection(ctx, projectID, selectionID, timeout, 0)
	if err != nil {
		if errors.Is(err, serviceselection.ErrWaitTimeout) {
			return mediamcp.AskUserSelectionOutput{SelectionID: selectionID, Status: serviceselection.StatusTimeout}, nil
		}
		return mediamcp.AskUserSelectionOutput{}, err
	}
	return selectionOutputFromRecord(record), nil
}

func selectionOutputFromRecord(record serviceselection.Record) mediamcp.AskUserSelectionOutput {
	output := mediamcp.AskUserSelectionOutput{SelectionID: record.ID, Status: record.Status}
	if record.Decision != nil {
		output.OptionID = record.Decision.OptionID
		output.CustomText = record.Decision.CustomText
		output.Values = record.Decision.Values
	}
	return output
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
