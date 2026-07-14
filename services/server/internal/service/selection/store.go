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
	kind := strings.TrimSpace(request.Kind)
	if err := validateGenerationPlanFields(kind, fields); err != nil {
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
		Kind:        kind,
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

// CancelPendingByRun atomically cancels every still-pending selection for one
// agent run. Decisions that won the race before this call are left unchanged.
func (store *Service) CancelPendingByRun(projectID string, runID string) (int64, error) {
	if store.initErr != nil {
		return 0, store.initErr
	}
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return 0, fmt.Errorf("selection run id is required")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.repo == nil {
		return 0, fmt.Errorf("agent selection repository is not initialized")
	}
	decisionJSON, err := json.Marshal(Decision{Cancelled: true})
	if err != nil {
		return 0, fmt.Errorf("encoding cancelled selection decision: %w", err)
	}
	count, err := store.repo.CancelPendingAgentSelectionsByRun(
		domain.CleanProjectID(projectID),
		runID,
		timestamp.NowRFC3339Nano(),
		string(decisionJSON),
	)
	if err != nil {
		return 0, fmt.Errorf("cancelling pending selections by run: %w", err)
	}
	return count, nil
}

// ExpirePendingByRun atomically expires every still-pending selection for one
// finished agent run. Decisions that won the race before this call are left
// unchanged.
func (store *Service) ExpirePendingByRun(projectID string, runID string) (int64, error) {
	if store.initErr != nil {
		return 0, store.initErr
	}
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return 0, fmt.Errorf("selection run id is required")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.repo == nil {
		return 0, fmt.Errorf("agent selection repository is not initialized")
	}
	count, err := store.repo.ExpirePendingAgentSelectionsByRun(
		domain.CleanProjectID(projectID),
		runID,
		timestamp.NowRFC3339Nano(),
	)
	if err != nil {
		return 0, fmt.Errorf("expiring pending selections by run: %w", err)
	}
	return count, nil
}

// Get returns a selection by ID. The bool reports whether it exists.
func (store *Service) Get(projectID string, selectionID string) (Record, bool, error) {
	if store.initErr != nil {
		return Record{}, false, store.initErr
	}
	store.mu.Lock()
	defer store.mu.Unlock()
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
	projectID = domain.CleanProjectID(projectID)
	selectionID = strings.TrimSpace(selectionID)
	current, ok, err := store.Get(projectID, selectionID)
	if err != nil {
		return Record{}, err
	}
	if !ok {
		return Record{}, repository.ErrRecordNotFound
	}
	if current.Status != StatusPending {
		return current, nil
	}

	store.mu.RLock()
	guard := store.runDecisionGuard
	store.mu.RUnlock()
	if guard != nil && strings.TrimSpace(current.SessionID) != "" && strings.TrimSpace(current.RunID) != "" {
		var (
			decided     Record
			callbackErr error
		)
		guardErr := guard.WithRunStatus(current.SessionID, current.RunID, func(status string, found bool) error {
			decided, callbackErr = store.decideWithRunStatus(projectID, selectionID, request, status, found, true)
			return callbackErr
		})
		if callbackErr != nil {
			return Record{}, callbackErr
		}
		if guardErr != nil {
			return Record{}, fmt.Errorf("checking agent run before deciding selection: %w", guardErr)
		}
		return decided, nil
	}
	return store.decideWithRunStatus(projectID, selectionID, request, "", false, false)
}

func (store *Service) decideWithRunStatus(
	projectID string,
	selectionID string,
	request DecisionRequest,
	runStatus string,
	runFound bool,
	runChecked bool,
) (Record, error) {
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
	if runChecked && (!runFound || isTerminalSelectionRunStatus(runStatus)) {
		return store.finishTerminalRunSelectionUnlocked(projectID, current, runStatus)
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
	now := time.Now().UTC()
	if _, err := store.repo.DecidePendingAgentSelection(
		projectID,
		selectionID,
		status,
		now,
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

func (store *Service) finishTerminalRunSelectionUnlocked(projectID string, current Record, runStatus string) (Record, error) {
	status := StatusExpired
	decisionJSON := ""
	if strings.TrimSpace(runStatus) == StatusCancelled {
		status = StatusCancelled
		raw, err := json.Marshal(Decision{Cancelled: true})
		if err != nil {
			return Record{}, fmt.Errorf("encoding cancelled selection decision: %w", err)
		}
		decisionJSON = string(raw)
	}
	now := time.Now().UTC()
	if _, err := store.repo.DecidePendingAgentSelection(
		projectID,
		current.ID,
		status,
		now,
		timestamp.NowRFC3339Nano(),
		decisionJSON,
	); err != nil {
		return Record{}, fmt.Errorf("finishing selection for terminal agent run: %w", err)
	}
	record, ok, err := store.getUnlocked(projectID, current.ID)
	if err != nil {
		return Record{}, err
	}
	if !ok {
		return Record{}, repository.ErrRecordNotFound
	}
	return record, nil
}

func isTerminalSelectionRunStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "completed", "failed", "cancelled", "finished", "interrupted", "paused":
		return true
	default:
		return false
	}
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

// FindReusable returns a semantically identical selection from the run that a
// repeated ask should attach to instead of popping a duplicate card: a
// still-pending one, or one decided within the last two minutes (raced with the
// re-ask). Reuse compares a normalized prompt and the complete interaction
// contract (form fields, or options plus allowCustom) so distinct questions
// never collapse merely because their titles match.
func (store *Service) FindReusable(projectID string, request ReuseRequest) (Record, bool, error) {
	if store.initErr != nil {
		return Record{}, false, store.initErr
	}
	runID := strings.TrimSpace(request.RunID)
	kind := strings.TrimSpace(request.Kind)
	title := strings.TrimSpace(request.Title)
	if runID == "" || title == "" {
		return Record{}, false, nil
	}
	expectedFingerprint, err := reusableSelectionFingerprint(request)
	if err != nil {
		return Record{}, false, err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.repo == nil {
		return Record{}, false, fmt.Errorf("agent selection repository is not initialized")
	}
	now := time.Now().UTC()
	if err := store.sweepExpiredUnlocked(projectID, now); err != nil {
		return Record{}, false, err
	}
	models, err := store.repo.ListAgentSelectionsByRun(domain.CleanProjectID(projectID), runID, 20)
	if err != nil {
		return Record{}, false, err
	}
	for _, model := range models {
		if strings.TrimSpace(model.Kind) != kind || strings.TrimSpace(model.Title) != title {
			continue
		}
		record, err := recordFromModel(model)
		if err != nil {
			return Record{}, false, err
		}
		candidateFingerprint, err := reusableSelectionFingerprint(ReuseRequest{
			Kind:        kind,
			Prompt:      record.Prompt,
			Options:     record.Options,
			Fields:      record.Fields,
			AllowCustom: record.AllowCustom,
		})
		if err != nil || candidateFingerprint != expectedFingerprint {
			continue
		}
		switch model.Status {
		case StatusPending:
			return record, true, nil
		case StatusSelected, StatusCustom, StatusSubmitted:
			if model.DecidedAt != nil && now.Sub(model.DecidedAt.UTC()) <= 2*time.Minute {
				return record, true, nil
			}
		}
	}
	return Record{}, false, nil
}

func reusableSelectionFingerprint(request ReuseRequest) (string, error) {
	// ask_user_form permits domain-specific kind values in addition to "form"
	// and generation_plan. Fields, rather than the label-like kind, are the
	// reliable discriminator between a form and an option selection.
	if len(request.Fields) > 0 {
		return reusableFormFingerprint(request.Kind, request.Prompt, request.Fields)
	}
	options, err := normalizeOptions(request.Options, false)
	if err != nil {
		return "", fmt.Errorf("normalizing reusable selection options: %w", err)
	}
	raw, err := json.Marshal(struct {
		Prompt      string   `json:"prompt"`
		Options     []Option `json:"options"`
		AllowCustom bool     `json:"allowCustom"`
	}{
		Prompt:      strings.TrimSpace(request.Prompt),
		Options:     options,
		AllowCustom: request.AllowCustom,
	})
	if err != nil {
		return "", fmt.Errorf("encoding reusable selection fingerprint: %w", err)
	}
	return string(raw), nil
}

func reusableFormFingerprint(kind string, prompt string, fields []FormField) (string, error) {
	normalized, err := normalizeFields(fields)
	if err != nil {
		return "", fmt.Errorf("normalizing reusable form fields: %w", err)
	}
	if err := validateGenerationPlanFields(strings.TrimSpace(kind), normalized); err != nil {
		return "", fmt.Errorf("normalizing reusable generation plan: %w", err)
	}
	canonical := make([]FormField, len(normalized))
	for index, field := range normalized {
		field.Kind = strings.TrimSpace(field.Kind)
		field.Description = strings.TrimSpace(field.Description)
		field.Unit = strings.TrimSpace(field.Unit)
		if len(field.Options) > 0 {
			field.Options = append([]FormFieldOption(nil), field.Options...)
			for optionIndex := range field.Options {
				field.Options[optionIndex].Value = strings.TrimSpace(field.Options[optionIndex].Value)
				field.Options[optionIndex].Label = strings.TrimSpace(field.Options[optionIndex].Label)
				field.Options[optionIndex].Description = strings.TrimSpace(field.Options[optionIndex].Description)
			}
		}
		canonical[index] = field
	}
	raw, err := json.Marshal(struct {
		Prompt string      `json:"prompt"`
		Fields []FormField `json:"fields"`
	}{
		Prompt: strings.TrimSpace(prompt),
		Fields: canonical,
	})
	if err != nil {
		return "", fmt.Errorf("encoding reusable form fingerprint: %w", err)
	}
	return string(raw), nil
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
	now := time.Now().UTC()
	if selectionModelIsDue(model, now) {
		if _, err := store.repo.ExpirePendingAgentSelections(
			domain.CleanProjectID(projectID),
			[]string{model.ID},
			now,
			timestamp.NowRFC3339Nano(),
		); err != nil {
			return Record{}, false, fmt.Errorf("expiring due agent selection: %w", err)
		}
		model, err = store.repo.GetAgentSelection(domain.CleanProjectID(projectID), strings.TrimSpace(selectionID))
		if isNotFound(err) {
			return Record{}, false, nil
		}
		if err != nil {
			return Record{}, false, err
		}
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
		if selectionModelIsDue(model, now) {
			expiredIDs = append(expiredIDs, model.ID)
		}
	}
	if len(expiredIDs) == 0 {
		return nil
	}
	if _, err := store.repo.ExpirePendingAgentSelections(
		domain.CleanProjectID(projectID),
		expiredIDs,
		now,
		timestamp.NowRFC3339Nano(),
	); err != nil {
		return err
	}
	return nil
}

func selectionModelIsDue(model domain.AgentSelectionModel, now time.Time) bool {
	return model.Status == StatusPending &&
		model.ExpiresAt != nil &&
		!model.ExpiresAt.UTC().After(now.UTC())
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
		case FieldTypeToggle, FieldTypeNumber, FieldTypeText, FieldTypeGenerationSettings, FieldTypeGenerationParams, FieldTypeImages, FieldTypePromptOptimization:
		default:
			return nil, fmt.Errorf("form field %q has unsupported type %q", id, fieldType)
		}
		field.ID = id
		field.Type = fieldType
		field.Kind = strings.TrimSpace(field.Kind)
		if fieldType == FieldTypeImages {
			field.Max = clampImagesMax(field.Max)
		}
		if fieldType == FieldTypeGenerationSettings && field.Default != nil {
			checked, err := validateGenerationSettingsValue(field, field.Default)
			if err != nil {
				return nil, fmt.Errorf("form field %q default is invalid: %w", id, err)
			}
			field.Default = checked
		}
		field.Label = strings.TrimSpace(field.Label)
		if field.Label == "" {
			field.Label = id
		}
		normalized = append(normalized, field)
	}
	return normalized, nil
}

func validateGenerationPlanFields(kind string, fields []FormField) error {
	if kind != KindGenerationPlan {
		return nil
	}
	settingsCount := 0
	for _, field := range fields {
		if field.Type == FieldTypeGenerationSettings {
			settingsCount++
		}
	}
	if settingsCount > 0 {
		if settingsCount != 1 || len(fields) != 1 {
			return fmt.Errorf(
				"%w: image plans require exactly one %s field and cannot mix legacy or generic fields",
				ErrInvalidGenerationPlan,
				FieldTypeGenerationSettings,
			)
		}
		if fields[0].Kind != "image" {
			return fmt.Errorf(
				"%w: %s field %q requires kind=image (got %q)",
				ErrInvalidGenerationPlan,
				FieldTypeGenerationSettings,
				fields[0].ID,
				fields[0].Kind,
			)
		}
		fields[0].Required = true
		return nil
	}

	counts := map[string]int{}
	for index, field := range fields {
		switch field.Type {
		case FieldTypeGenerationParams, FieldTypeImages, FieldTypePromptOptimization:
			counts[field.Type]++
			if field.Type == FieldTypeGenerationParams {
				// A generation plan has no meaning without an explicit catalog-backed
				// route/params value. Enforce this even when the agent omitted required.
				fields[index].Required = true
			}
		default:
			return fmt.Errorf(
				"%w: field %q uses disallowed type %q; allowed types are %s, %s, and %s",
				ErrInvalidGenerationPlan,
				field.ID,
				field.Type,
				FieldTypeGenerationParams,
				FieldTypeImages,
				FieldTypePromptOptimization,
			)
		}
	}
	if counts[FieldTypeGenerationParams] != 1 {
		return fmt.Errorf(
			"%w: exactly one %s field is required (got %d)",
			ErrInvalidGenerationPlan,
			FieldTypeGenerationParams,
			counts[FieldTypeGenerationParams],
		)
	}
	for _, field := range fields {
		if field.Type == FieldTypeGenerationParams && field.Kind != "video" {
			return fmt.Errorf(
				"%w: legacy %s field %q requires kind=video (got %q)",
				ErrInvalidGenerationPlan,
				FieldTypeGenerationParams,
				field.ID,
				field.Kind,
			)
		}
	}
	for _, fieldType := range []string{FieldTypeImages, FieldTypePromptOptimization} {
		if counts[fieldType] > 1 {
			return fmt.Errorf(
				"%w: at most one %s field is allowed (got %d)",
				ErrInvalidGenerationPlan,
				fieldType,
				counts[fieldType],
			)
		}
	}
	return nil
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
				// Defaults come from the agent and would otherwise bypass the
				// shape checks user submissions must pass — validate them too,
				// and treat an invalid optional default as absent.
				checked, err := validateFormValue(field, field.Default)
				if err == nil {
					resolved[field.ID] = checked
					continue
				}
				if field.Required {
					return nil, fmt.Errorf("form field %q default is invalid: %w", field.ID, err)
				}
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
	case FieldTypeGenerationSettings:
		return validateGenerationSettingsValue(field, value)
	case FieldTypeGenerationParams:
		return validateGenerationParamsValue(field, value)
	case FieldTypeImages:
		return validateImagesValue(field, value)
	case FieldTypePromptOptimization:
		return validatePromptOptimizationValue(field, value)
	}
	return nil, fmt.Errorf("form field %q has unsupported type %q", field.ID, field.Type)
}

// validateGenerationSettingsValue validates and normalizes the complete image
// generation snapshot submitted by the shared settings form. Catalog-specific
// route/param validity remains the generation service's responsibility.
func validateGenerationSettingsValue(field FormField, value any) (any, error) {
	object, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("form field %q expects an object value", field.ID)
	}
	kind, ok := object["kind"].(string)
	if !ok || strings.TrimSpace(kind) != "image" {
		return nil, fmt.Errorf("form field %q requires kind=image", field.ID)
	}
	routeID, ok := object["routeId"].(string)
	if !ok || strings.TrimSpace(routeID) == "" {
		return nil, fmt.Errorf("form field %q requires a routeId", field.ID)
	}
	params, ok := object["params"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("form field %q expects params to be an object", field.ID)
	}

	referenceAssetIDs, err := validateGenerationSettingsReferenceAssetIDs(field, object["referenceAssetIds"])
	if err != nil {
		return nil, err
	}
	promptSupplements, err := validateGenerationSettingsPromptSupplements(field, object["promptSupplements"])
	if err != nil {
		return nil, err
	}
	promptOptimization, err := validateGenerationSettingsPromptOptimization(field, object["promptOptimization"])
	if err != nil {
		return nil, err
	}

	resolved := map[string]any{
		"kind":               "image",
		"routeId":            strings.TrimSpace(routeID),
		"params":             params,
		"referenceAssetIds":  referenceAssetIDs,
		"promptSupplements":  promptSupplements,
		"promptOptimization": promptOptimization,
	}
	if label, present := object["label"]; present && label != nil {
		text, ok := label.(string)
		if !ok {
			return nil, fmt.Errorf("form field %q expects label to be a string", field.ID)
		}
		if text = strings.TrimSpace(text); text != "" {
			resolved["label"] = text
		}
	}
	return resolved, nil
}

func validateGenerationSettingsReferenceAssetIDs(field FormField, value any) ([]string, error) {
	items, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("form field %q expects referenceAssetIds to be an array", field.ID)
	}
	seen := map[string]bool{}
	ids := make([]string, 0, len(items))
	for _, item := range items {
		id, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("form field %q expects referenceAssetIds to contain strings", field.ID)
		}
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	return ids, nil
}

func validateGenerationSettingsPromptSupplements(field FormField, value any) ([]map[string]any, error) {
	items, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("form field %q expects promptSupplements to be an array", field.ID)
	}
	resolved := make([]map[string]any, 0, len(items))
	for index, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("form field %q expects promptSupplements[%d] to be an object", field.ID, index)
		}
		name, ok := object["referenceName"].(string)
		if !ok {
			return nil, fmt.Errorf("form field %q expects promptSupplements[%d].referenceName to be a string", field.ID, index)
		}
		prompt, ok := object["referencePrompt"].(string)
		if !ok || strings.TrimSpace(prompt) == "" {
			return nil, fmt.Errorf("form field %q requires promptSupplements[%d].referencePrompt", field.ID, index)
		}
		supplement := map[string]any{
			"referenceName":   strings.TrimSpace(name),
			"referencePrompt": strings.TrimSpace(prompt),
		}
		if rawID, present := object["referenceId"]; present && rawID != nil {
			id, ok := rawID.(string)
			if !ok {
				return nil, fmt.Errorf("form field %q expects promptSupplements[%d].referenceId to be a string", field.ID, index)
			}
			if id = strings.TrimSpace(id); id != "" {
				supplement["referenceId"] = id
			}
		}
		resolved = append(resolved, supplement)
	}
	return resolved, nil
}

func validateGenerationSettingsPromptOptimization(field FormField, value any) (map[string]any, error) {
	object, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("form field %q expects promptOptimization to be an object", field.ID)
	}
	enabled, ok := object["enabled"].(bool)
	if !ok {
		return nil, fmt.Errorf("form field %q expects promptOptimization.enabled to be a boolean", field.ID)
	}
	if !enabled {
		return map[string]any{"enabled": false}, nil
	}
	resolved := map[string]any{"enabled": true}
	for _, key := range []string{"routeId", "label", "referenceId", "referenceName", "referencePrompt"} {
		raw, present := object[key]
		if !present || raw == nil {
			continue
		}
		text, ok := raw.(string)
		if !ok {
			return nil, fmt.Errorf("form field %q expects promptOptimization.%s to be a string", field.ID, key)
		}
		if text = strings.TrimSpace(text); text != "" {
			resolved[key] = text
		}
	}
	if _, ok := resolved["routeId"]; !ok {
		return nil, fmt.Errorf("form field %q requires promptOptimization.routeId when enabled", field.ID)
	}
	if _, ok := resolved["referencePrompt"]; !ok {
		return nil, fmt.Errorf("form field %q requires promptOptimization.referencePrompt when enabled", field.ID)
	}
	return resolved, nil
}

// validateGenerationParamsValue checks the composite generation-parameter
// value submitted by the client picker: {"routeId": string, "label"?: string,
// "params"?: object}. Route and param validity against the model catalog is
// enforced by the generation service when the request is actually submitted.
func validateGenerationParamsValue(field FormField, value any) (any, error) {
	record, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("form field %q expects an object value", field.ID)
	}
	routeID, _ := record["routeId"].(string)
	routeID = strings.TrimSpace(routeID)
	if routeID == "" {
		return nil, fmt.Errorf("form field %q requires a routeId", field.ID)
	}
	sanitized := map[string]any{"routeId": routeID}
	if label, ok := record["label"].(string); ok && strings.TrimSpace(label) != "" {
		sanitized["label"] = strings.TrimSpace(label)
	}
	if params, ok := record["params"].(map[string]any); ok && len(params) > 0 {
		sanitized["params"] = params
	}
	return sanitized, nil
}

// validateImagesValue normalizes an images-field submission to a deduplicated
// list of non-empty media asset ids within the field's Max bound.
func validateImagesValue(field FormField, value any) (any, error) {
	items, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("form field %q expects an array of media asset ids", field.ID)
	}
	seen := map[string]bool{}
	ids := []string{}
	for _, item := range items {
		id, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("form field %q expects string asset ids", field.ID)
		}
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	if field.Required && len(ids) == 0 {
		return nil, fmt.Errorf("form field %q requires at least one image", field.ID)
	}
	if field.Max != nil && float64(len(ids)) > *field.Max {
		return nil, fmt.Errorf("form field %q accepts at most %d images", field.ID, int(*field.Max))
	}
	return ids, nil
}

// validatePromptOptimizationValue normalizes a prompt-optimization submission:
// a disabled value collapses to {"enabled": false}; an enabled one keeps only
// the known string fields, trimmed. Route/reference existence is not checked
// here — generate_media resolves them.
func validatePromptOptimizationValue(field FormField, value any) (any, error) {
	// Agents may prefill the field with a bare boolean default and clients
	// submit defaults verbatim — normalize instead of 400ing the whole form.
	if flag, isBool := value.(bool); isBool {
		return map[string]any{"enabled": flag}, nil
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("form field %q expects an object with an enabled flag", field.ID)
	}
	enabled, ok := object["enabled"].(bool)
	if !ok {
		return nil, fmt.Errorf("form field %q expects a boolean enabled flag", field.ID)
	}
	if !enabled {
		return map[string]any{"enabled": false}, nil
	}
	resolved := map[string]any{"enabled": true}
	for _, key := range []string{"routeId", "label", "referenceId", "referenceName", "referencePrompt"} {
		raw, present := object[key]
		if !present || raw == nil {
			continue
		}
		text, ok := raw.(string)
		if !ok {
			return nil, fmt.Errorf("form field %q expects %s to be a string", field.ID, key)
		}
		if text = strings.TrimSpace(text); text != "" {
			resolved[key] = text
		}
	}
	return resolved, nil
}

// Images-count bounds: the instruction text only *recommends* max 3, but an
// agent run that omits max must not yield an unbounded uploader (each image is
// inlined as a base64 data URI in the provider request).
const (
	defaultImagesMax = 3
	ceilingImagesMax = 9
)

func clampImagesMax(requested *float64) *float64 {
	max := float64(defaultImagesMax)
	if requested != nil {
		max = *requested
	}
	if max < 1 {
		max = 1
	}
	if max > ceilingImagesMax {
		max = ceilingImagesMax
	}
	return &max
}

// ListDecidedBySession returns a session's decided selections oldest-first,
// for replaying confirmed decisions into a rebuilt agent session.
func (store *Service) ListDecidedBySession(projectID string, sessionID string, limit int) ([]Record, error) {
	if store.initErr != nil {
		return nil, store.initErr
	}
	store.mu.RLock()
	models, err := store.repo.ListDecidedAgentSelectionsBySession(domain.CleanProjectID(projectID), sessionID, limit)
	store.mu.RUnlock()
	if err != nil {
		return nil, err
	}
	records := make([]Record, 0, len(models))
	for _, model := range models {
		record, err := recordFromModel(model)
		if err != nil {
			continue
		}
		records = append(records, record)
	}
	return records, nil
}

// FormatDecisionLine renders one decided selection as a single human-readable
// line for the session recap, e.g. 「〔确认生成参数〕张数 1 · 优化提示词 关」.
func FormatDecisionLine(record Record) string {
	if record.Decision == nil {
		return ""
	}
	summary := ""
	switch {
	case record.Decision.Cancelled:
		summary = "已取消"
	case record.Decision.CustomText != "":
		summary = record.Decision.CustomText
	case record.Decision.OptionID != "":
		summary = record.Decision.OptionID
		for _, option := range record.Options {
			if option.ID == record.Decision.OptionID {
				summary = option.Label
				break
			}
		}
	case len(record.Decision.Values) > 0:
		encoded, err := json.Marshal(record.Decision.Values)
		if err != nil {
			return ""
		}
		summary = string(encoded)
	}
	if summary == "" {
		return ""
	}
	title := strings.TrimSpace(record.Title)
	if title == "" {
		title = "用户选择"
	}
	return "〔" + title + "〕" + summary
}
