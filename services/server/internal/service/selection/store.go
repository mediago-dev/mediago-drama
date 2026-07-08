package selection

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

// Create persists a new pending selection prompt.
func (store *Service) Create(projectID string, request CreateRequest) (Record, error) {
	if store.initErr != nil {
		return Record{}, store.initErr
	}
	projectID = domain.CleanProjectID(projectID)
	title := strings.TrimSpace(request.Title)
	if title == "" {
		return Record{}, fmt.Errorf("selection title is required")
	}
	fields, err := normalizeFields(request.Fields)
	if err != nil {
		return Record{}, err
	}
	options, err := normalizeOptions(request.Options, len(fields) > 0)
	if err != nil {
		return Record{}, err
	}
	optionsJSON, err := json.Marshal(options)
	if err != nil {
		return Record{}, fmt.Errorf("encoding selection options: %w", err)
	}
	fieldsJSON := ""
	if len(fields) > 0 {
		raw, err := json.Marshal(fields)
		if err != nil {
			return Record{}, fmt.Errorf("encoding selection fields: %w", err)
		}
		fieldsJSON = string(raw)
	}

	now := time.Now().UTC()
	expiresAt := now.Add(RetrieveTTL)
	model := domain.AgentSelectionModel{
		ProjectID:   projectID,
		ID:          shared.MustRandomID("selection"),
		SessionID:   strings.TrimSpace(request.SessionID),
		RunID:       strings.TrimSpace(request.RunID),
		Kind:        strings.TrimSpace(request.Kind),
		Title:       title,
		Prompt:      strings.TrimSpace(request.Prompt),
		OptionsJSON: string(optionsJSON),
		FieldsJSON:  fieldsJSON,
		AllowCustom: request.AllowCustom,
		Status:      StatusPending,
		CreatedAt:   now,
		ExpiresAt:   &expiresAt,
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	if store.repo == nil {
		return Record{}, fmt.Errorf("agent selection repository is not initialized")
	}
	if err := store.repo.CreateAgentSelection(model); err != nil {
		return Record{}, err
	}
	return recordFromModel(model)
}

// Get returns a selection by ID. The bool reports whether it exists.
func (store *Service) Get(projectID string, selectionID string) (Record, bool, error) {
	if store.initErr != nil {
		return Record{}, false, store.initErr
	}
	store.mu.RLock()
	defer store.mu.RUnlock()
	return store.getUnlocked(projectID, selectionID)
}

// ListPending returns pending selections for a project, sweeping expired ones first.
func (store *Service) ListPending(projectID string) ([]Record, error) {
	if store.initErr != nil {
		return nil, store.initErr
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.repo == nil {
		return nil, fmt.Errorf("agent selection repository is not initialized")
	}
	if err := store.sweepExpiredUnlocked(projectID, time.Now().UTC()); err != nil {
		return nil, err
	}
	models, err := store.repo.ListPendingAgentSelections(domain.CleanProjectID(projectID))
	if err != nil {
		return nil, fmt.Errorf("reading agent selections: %w", err)
	}
	records := make([]Record, 0, len(models))
	for _, model := range models {
		record, err := recordFromModel(model)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, nil
}

// Decide records a user decision on a pending selection. If the selection was
// already decided or expired, it returns the current record without changing it.
func (store *Service) Decide(projectID string, selectionID string, request DecisionRequest) (Record, error) {
	if store.initErr != nil {
		return Record{}, store.initErr
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.repo == nil {
		return Record{}, fmt.Errorf("agent selection repository is not initialized")
	}

	current, ok, err := store.getUnlocked(projectID, selectionID)
	if err != nil {
		return Record{}, err
	}
	if !ok {
		return Record{}, repository.ErrRecordNotFound
	}
	if current.Status != StatusPending {
		return current, nil
	}

	status, decision, err := resolveDecision(current, request)
	if err != nil {
		return Record{}, err
	}
	decisionJSON, err := json.Marshal(decision)
	if err != nil {
		return Record{}, fmt.Errorf("encoding selection decision: %w", err)
	}

	// The conditional update is idempotent at the DB level; whether or not this
	// call won the race, we return the current persisted record.
	if _, err := store.repo.DecidePendingAgentSelection(
		domain.CleanProjectID(projectID),
		selectionID,
		status,
		timestamp.NowRFC3339Nano(),
		string(decisionJSON),
	); err != nil {
		return Record{}, fmt.Errorf("updating agent selection: %w", err)
	}
	record, ok, err := store.getUnlocked(projectID, selectionID)
	if err != nil {
		return Record{}, err
	}
	if !ok {
		return Record{}, repository.ErrRecordNotFound
	}
	return record, nil
}

// WaitForSelection blocks until the selection leaves pending or the blocking
// window elapses. On the block deadline it returns the still-pending record and
// ErrWaitTimeout; on parent context cancellation it returns ctx.Err(). The
// timeout is clamped to [MinTimeout, MaxTimeout].
func (store *Service) WaitForSelection(ctx context.Context, projectID string, selectionID string, timeout time.Duration, interval time.Duration) (Record, error) {
	return store.waitForSelection(ctx, projectID, selectionID, ClampTimeout(timeout), interval)
}

func (store *Service) waitForSelection(ctx context.Context, projectID string, selectionID string, block time.Duration, interval time.Duration) (Record, error) {
	if interval <= 0 {
		interval = defaultPollInterval
	}
	if block <= 0 {
		block = DefaultTimeout
	}
	waitCtx, cancel := context.WithTimeout(ctx, block)
	defer cancel()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		record, ok, err := store.Get(projectID, selectionID)
		if err != nil {
			return Record{}, err
		}
		if !ok {
			return Record{}, repository.ErrRecordNotFound
		}
		if record.Status != StatusPending {
			return record, nil
		}
		select {
		case <-waitCtx.Done():
			if ctx.Err() != nil {
				return record, ctx.Err()
			}
			return record, ErrWaitTimeout
		case <-ticker.C:
		}
	}
}

// FindReusable returns a same-question selection from the run that a repeated
// ask should attach to instead of popping a duplicate card: a still-pending
// one, or one decided within the last two minutes (raced with the re-ask).
func (store *Service) FindReusable(projectID string, runID string, kind string, title string) (Record, bool, error) {
	if store.initErr != nil {
		return Record{}, false, store.initErr
	}
	runID = strings.TrimSpace(runID)
	kind = strings.TrimSpace(kind)
	title = strings.TrimSpace(title)
	if runID == "" || title == "" {
		return Record{}, false, nil
	}
	store.mu.RLock()
	defer store.mu.RUnlock()
	if store.repo == nil {
		return Record{}, false, fmt.Errorf("agent selection repository is not initialized")
	}
	models, err := store.repo.ListAgentSelectionsByRun(domain.CleanProjectID(projectID), runID, 20)
	if err != nil {
		return Record{}, false, err
	}
	now := time.Now().UTC()
	for _, model := range models {
		if strings.TrimSpace(model.Kind) != kind || strings.TrimSpace(model.Title) != title {
			continue
		}
		switch model.Status {
		case StatusPending:
			record, err := recordFromModel(model)
			if err != nil {
				return Record{}, false, err
			}
			return record, true, nil
		case StatusSelected, StatusCustom, StatusSubmitted:
			if model.DecidedAt != nil && now.Sub(model.DecidedAt.UTC()) <= 2*time.Minute {
				record, err := recordFromModel(model)
				if err != nil {
					return Record{}, false, err
				}
				return record, true, nil
			}
		}
	}
	return Record{}, false, nil
}

func (store *Service) getUnlocked(projectID string, selectionID string) (Record, bool, error) {
	if store.repo == nil {
		return Record{}, false, fmt.Errorf("agent selection repository is not initialized")
	}
	model, err := store.repo.GetAgentSelection(domain.CleanProjectID(projectID), strings.TrimSpace(selectionID))
	if isNotFound(err) {
		return Record{}, false, nil
	}
	if err != nil {
		return Record{}, false, err
	}
	record, err := recordFromModel(model)
	if err != nil {
		return Record{}, false, err
	}
	return record, true, nil
}

func (store *Service) sweepExpiredUnlocked(projectID string, now time.Time) error {
	models, err := store.repo.ListPendingAgentSelections(domain.CleanProjectID(projectID))
	if err != nil {
		return fmt.Errorf("reading agent selections: %w", err)
	}
	expiredIDs := make([]string, 0)
	for _, model := range models {
		if model.ExpiresAt == nil {
			continue
		}
		if now.After(model.ExpiresAt.UTC()) {
			expiredIDs = append(expiredIDs, model.ID)
		}
	}
	if len(expiredIDs) == 0 {
		return nil
	}
	if _, err := store.repo.ExpirePendingAgentSelections(domain.CleanProjectID(projectID), expiredIDs, timestamp.NowRFC3339Nano()); err != nil {
		return err
	}
	return nil
}

func normalizeOptions(options []Option, allowEmpty bool) ([]Option, error) {
	if len(options) == 0 {
		if allowEmpty {
			return []Option{}, nil
		}
		return nil, fmt.Errorf("at least one selection option is required")
	}
	seen := map[string]bool{}
	normalized := make([]Option, 0, len(options))
	for _, option := range options {
		id := strings.TrimSpace(option.ID)
		label := strings.TrimSpace(option.Label)
		if id == "" {
			return nil, fmt.Errorf("selection option id is required")
		}
		if seen[id] {
			return nil, fmt.Errorf("duplicate selection option id %q", id)
		}
		seen[id] = true
		if label == "" {
			label = id
		}
		normalized = append(normalized, Option{
			ID:          id,
			Label:       label,
			ImageURL:    strings.TrimSpace(option.ImageURL),
			Description: strings.TrimSpace(option.Description),
		})
	}
	return normalized, nil
}

func resolveDecision(record Record, request DecisionRequest) (string, Decision, error) {
	if request.Cancelled {
		return StatusCancelled, Decision{Cancelled: true}, nil
	}
	if len(request.Values) > 0 {
		values, err := validateFormValues(record.Fields, request.Values)
		if err != nil {
			return "", Decision{}, err
		}
		return StatusSubmitted, Decision{Values: values}, nil
	}
	optionID := strings.TrimSpace(request.OptionID)
	if optionID != "" {
		for _, option := range record.Options {
			if option.ID == optionID {
				return StatusSelected, Decision{OptionID: optionID}, nil
			}
		}
		return "", Decision{}, fmt.Errorf("unknown selection option %q", optionID)
	}
	customText := strings.TrimSpace(request.CustomText)
	if customText != "" {
		if !record.AllowCustom {
			return "", Decision{}, fmt.Errorf("selection does not allow custom input")
		}
		return StatusCustom, Decision{CustomText: customText}, nil
	}
	return "", Decision{}, fmt.Errorf("selection decision requires optionId, customText, or cancelled")
}

func normalizeFields(fields []FormField) ([]FormField, error) {
	if len(fields) == 0 {
		return nil, nil
	}
	seen := map[string]bool{}
	normalized := make([]FormField, 0, len(fields))
	for _, field := range fields {
		id := strings.TrimSpace(field.ID)
		if id == "" {
			return nil, fmt.Errorf("form field id is required")
		}
		if seen[id] {
			return nil, fmt.Errorf("duplicate form field id %q", id)
		}
		seen[id] = true
		fieldType := strings.TrimSpace(field.Type)
		switch fieldType {
		case FieldTypeSelect:
			if len(field.Options) == 0 {
				return nil, fmt.Errorf("form field %q needs options", id)
			}
		case FieldTypeToggle, FieldTypeNumber, FieldTypeText:
		default:
			return nil, fmt.Errorf("form field %q has unsupported type %q", id, fieldType)
		}
		field.ID = id
		field.Type = fieldType
		field.Label = strings.TrimSpace(field.Label)
		if field.Label == "" {
			field.Label = id
		}
		normalized = append(normalized, field)
	}
	return normalized, nil
}

// validateFormValues checks submitted values against the form's field specs
// and fills defaults for omitted fields.
func validateFormValues(fields []FormField, values map[string]any) (map[string]any, error) {
	if len(fields) == 0 {
		return nil, fmt.Errorf("selection does not accept form values")
	}
	byID := map[string]FormField{}
	for _, field := range fields {
		byID[field.ID] = field
	}
	for id := range values {
		if _, ok := byID[id]; !ok {
			return nil, fmt.Errorf("unknown form field %q", id)
		}
	}
	resolved := map[string]any{}
	for _, field := range fields {
		value, provided := values[field.ID]
		if !provided || value == nil {
			if field.Default != nil {
				resolved[field.ID] = field.Default
				continue
			}
			if field.Required {
				return nil, fmt.Errorf("form field %q is required", field.ID)
			}
			continue
		}
		checked, err := validateFormValue(field, value)
		if err != nil {
			return nil, err
		}
		resolved[field.ID] = checked
	}
	return resolved, nil
}

func validateFormValue(field FormField, value any) (any, error) {
	switch field.Type {
	case FieldTypeSelect:
		text, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("form field %q expects a string option value", field.ID)
		}
		for _, option := range field.Options {
			if option.Value == text {
				return text, nil
			}
		}
		return nil, fmt.Errorf("form field %q has no option %q", field.ID, text)
	case FieldTypeToggle:
		flag, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("form field %q expects a boolean", field.ID)
		}
		return flag, nil
	case FieldTypeNumber:
		number, ok := value.(float64)
		if !ok {
			return nil, fmt.Errorf("form field %q expects a number", field.ID)
		}
		if field.Min != nil && number < *field.Min {
			return nil, fmt.Errorf("form field %q must be >= %v", field.ID, *field.Min)
		}
		if field.Max != nil && number > *field.Max {
			return nil, fmt.Errorf("form field %q must be <= %v", field.ID, *field.Max)
		}
		return number, nil
	case FieldTypeText:
		text, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("form field %q expects a string", field.ID)
		}
		return strings.TrimSpace(text), nil
	}
	return nil, fmt.Errorf("form field %q has unsupported type %q", field.ID, field.Type)
}
