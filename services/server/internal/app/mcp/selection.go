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
	options := selectionOptionsFromMCP(input.Options)
	intent := selectionIntentFromMCP(input.Intent)
	title := strings.TrimSpace(input.Title)
	prompt := strings.TrimSpace(input.Prompt)

	if reused, ok := adapter.reuseSelection(
		ctx,
		projectID,
		input.Kind,
		title,
		prompt,
		options,
		nil,
		intent,
		input.AllowCustom,
		input.TimeoutSeconds,
	); ok {
		return reused.output, reused.err
	}

	created, err := service.Create(projectID, serviceselection.CreateRequest{
		SessionID:      adapter.document.config.SessionID,
		RunID:          adapter.document.config.RunID,
		Kind:           strings.TrimSpace(input.Kind),
		Title:          title,
		Prompt:         prompt,
		Options:        options,
		Intent:         intent,
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
func (adapter *Adapter) reuseSelection(
	ctx context.Context,
	projectID string,
	kind string,
	title string,
	prompt string,
	options []serviceselection.Option,
	fields []serviceselection.FormField,
	intent *serviceselection.GenerationPlanIntent,
	allowCustom bool,
	timeoutSeconds int,
) (reusedSelectionResult, bool) {
	service := adapter.document.store.Selections
	existing, ok, err := service.FindReusable(projectID, serviceselection.ReuseRequest{
		SessionID:   adapter.document.config.SessionID,
		RunID:       adapter.document.config.RunID,
		Kind:        strings.TrimSpace(kind),
		Title:       strings.TrimSpace(title),
		Prompt:      strings.TrimSpace(prompt),
		Options:     options,
		Fields:      fields,
		Intent:      intent,
		AllowCustom: allowCustom,
	})
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
	fields := selectionFieldsFromMCP(input.Fields)
	intent := selectionIntentFromMCP(input.Intent)

	if reused, ok := adapter.reuseSelection(
		ctx,
		projectID,
		firstNonEmpty(input.Kind, "form"),
		input.Title,
		input.Prompt,
		nil,
		fields,
		intent,
		false,
		input.TimeoutSeconds,
	); ok {
		return reused.output, reused.err
	}

	created, err := service.Create(projectID, serviceselection.CreateRequest{
		SessionID:      adapter.document.config.SessionID,
		RunID:          adapter.document.config.RunID,
		Kind:           strings.TrimSpace(firstNonEmpty(input.Kind, "form")),
		Title:          strings.TrimSpace(input.Title),
		Prompt:         strings.TrimSpace(input.Prompt),
		Fields:         fields,
		Intent:         intent,
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
	var intentJSON json.RawMessage
	if record.Intent != nil {
		intentJSON, err = json.Marshal(record.Intent)
		if err != nil {
			return
		}
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
			Intent:      intentJSON,
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
	if record.Intent != nil {
		intentJSON, err := json.Marshal(record.Intent)
		if err != nil {
			return
		}
		payload.Intent = intentJSON
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

func selectionIntentFromMCP(input *mediamcp.GenerationPlanIntentInput) *serviceselection.GenerationPlanIntent {
	if input == nil {
		return nil
	}
	items := make([]serviceselection.GenerationPlanIntentItem, 0, len(input.Items))
	for _, item := range input.Items {
		items = append(items, serviceselection.GenerationPlanIntentItem{
			ID:                 item.ID,
			Kind:               item.Kind,
			Prompt:             item.Prompt,
			AssetTitle:         item.AssetTitle,
			CapabilityID:       item.CapabilityID,
			ConversationID:     item.ConversationID,
			ScopeID:            item.ScopeID,
			DocumentID:         item.DocumentID,
			SectionID:          item.SectionID,
			DocumentContext:    selectionDocumentContextFromMCP(item.DocumentContext),
			ResourceType:       item.ResourceType,
			ReferenceAssetIDs:  append([]string(nil), item.ReferenceAssetIDs...),
			NotificationTarget: selectionNotificationTargetFromMCP(item.NotificationTarget),
		})
	}
	return &serviceselection.GenerationPlanIntent{
		Version:           input.Version,
		Operation:         input.Operation,
		ConversationTitle: input.ConversationTitle,
		Items:             items,
	}
}

func selectionDocumentContextFromMCP(input *mediamcp.GenerationDocumentContext) *serviceselection.GenerationDocumentContext {
	if input == nil {
		return nil
	}
	return &serviceselection.GenerationDocumentContext{
		ProjectID:  input.ProjectID,
		DocumentID: input.DocumentID,
		SectionID:  input.SectionID,
	}
}

func selectionNotificationTargetFromMCP(input *mediamcp.GenerationNotificationTarget) *serviceselection.GenerationNotificationTarget {
	if input == nil {
		return nil
	}
	return &serviceselection.GenerationNotificationTarget{
		Kind:          input.Kind,
		ProjectID:     input.ProjectID,
		DocumentID:    input.DocumentID,
		DocumentTitle: input.DocumentTitle,
		Section: serviceselection.GenerationNotificationSectionTarget{
			BlockID:           input.Section.BlockID,
			DocumentID:        input.Section.DocumentID,
			HeadingLevel:      input.Section.HeadingLevel,
			HeadingOccurrence: input.Section.HeadingOccurrence,
			HeadingText:       input.Section.HeadingText,
			Markdown:          input.Section.Markdown,
			PlainText:         input.Section.PlainText,
			Prompt:            input.Section.Prompt,
		},
	}
}
