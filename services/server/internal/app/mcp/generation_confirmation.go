package mcp

import (
	"encoding/json"
	"fmt"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	serviceselection "github.com/mediago-dev/mediago-drama/services/server/internal/service/selection"
)

// GenerationSelectionStore supplies the submitted generation plan used to
// authorize a run-scoped image or video generation request.
type GenerationSelectionStore interface {
	Get(projectID string, selectionID string) (serviceselection.Record, bool, error)
}

// GenerationRunContext identifies the agent run that owns generation tool
// calls. An empty RunID preserves project-scoped/manual MCP compatibility.
type GenerationRunContext struct {
	SessionID  string
	RunID      string
	Selections GenerationSelectionStore
}

func (server *GenerationServer) authorizeGeneration(
	input mediamcp.GenerationMessageInput,
	effectiveKind string,
) error {
	effectiveKind = strings.TrimSpace(effectiveKind)
	if effectiveKind == "" {
		effectiveKind = "image"
	}
	if server == nil || strings.TrimSpace(server.runID) == "" || !requiresGenerationConfirmation(effectiveKind) {
		return nil
	}
	if server.selections == nil {
		return fmt.Errorf("generation confirmation service is unavailable for this agent run")
	}
	selectionID := strings.TrimSpace(input.ConfirmationSelectionID)
	if selectionID == "" {
		return fmt.Errorf("generation requires a submitted generation_plan; pass its selectionId as confirmationSelectionId")
	}
	record, ok, err := server.selections.Get(server.projectID, selectionID)
	if err != nil {
		return fmt.Errorf("reading generation confirmation %q: %w", selectionID, err)
	}
	if !ok {
		return fmt.Errorf("generation confirmation %q was not found", selectionID)
	}
	if record.Kind != serviceselection.KindGenerationPlan {
		return fmt.Errorf("selection %q is not a generation_plan", selectionID)
	}
	if strings.TrimSpace(record.ProjectID) != strings.TrimSpace(server.projectID) {
		return fmt.Errorf("generation confirmation %q belongs to a different project", selectionID)
	}
	if strings.TrimSpace(record.RunID) != strings.TrimSpace(server.runID) {
		return fmt.Errorf("generation confirmation %q belongs to a different agent run", selectionID)
	}
	if strings.TrimSpace(record.SessionID) != strings.TrimSpace(server.sessionID) {
		return fmt.Errorf("generation confirmation %q belongs to a different agent session", selectionID)
	}
	if record.Status != serviceselection.StatusSubmitted || record.Decision == nil || record.Decision.Cancelled {
		return fmt.Errorf(
			"generation confirmation %q is %s; wait for an explicit user submission before generating",
			selectionID,
			firstNonEmpty(record.Status, serviceselection.StatusPending),
		)
	}

	plan, err := submittedGenerationPlanFromRecord(record)
	if err != nil {
		return fmt.Errorf("generation confirmation %q: %w", selectionID, err)
	}
	if plan.kind != effectiveKind {
		return fmt.Errorf(
			"generation kind %q does not match confirmed kind %q",
			effectiveKind,
			plan.kind,
		)
	}
	if firstNonEmpty(input.FamilyID, input.VersionID, input.Provider, input.ModelID, input.Model) != "" {
		return fmt.Errorf("generation model overrides are not allowed with a confirmed routeId")
	}
	if strings.TrimSpace(input.RouteID) != plan.routeID {
		return fmt.Errorf(
			"generation route %q does not match confirmed route %q",
			strings.TrimSpace(input.RouteID),
			plan.routeID,
		)
	}
	if !canonicalJSONEqual(nonNilMap(input.Params), nonNilMap(plan.params)) {
		return fmt.Errorf("generation params do not match the submitted generation_plan")
	}
	if len(input.ReferenceURLs) > 0 || len(input.ReferenceBindings) > 0 {
		return fmt.Errorf("generation references must use only the asset ids submitted in the generation_plan")
	}
	if !canonicalJSONEqual(
		normalizeConfirmationStrings(input.ReferenceAssetIDs),
		plan.referenceAssetIDs,
	) {
		return fmt.Errorf("generation reference assets do not match the submitted generation_plan")
	}
	if !canonicalJSONEqual(
		canonicalPromptSupplements(input.PromptSupplements),
		plan.promptSupplements,
	) {
		return fmt.Errorf("generation prompt supplements do not match the submitted generation_plan")
	}
	if err := authorizePromptOptimization(input.PromptOptimization, plan.promptOptimization); err != nil {
		return err
	}
	return nil
}

type submittedGenerationPlan struct {
	kind               string
	routeID            string
	params             map[string]any
	referenceAssetIDs  []string
	promptSupplements  []confirmedPromptSupplement
	promptOptimization *confirmedPromptOptimization
}

type confirmedPromptSupplement struct {
	ReferenceID     string `json:"referenceId,omitempty"`
	ReferenceName   string `json:"referenceName"`
	ReferencePrompt string `json:"referencePrompt"`
}

type confirmedPromptOptimization struct {
	RouteID         string
	ReferenceName   string
	ReferencePrompt string
}

func submittedGenerationPlanFromRecord(record serviceselection.Record) (submittedGenerationPlan, error) {
	if record.Decision == nil {
		return submittedGenerationPlan{}, fmt.Errorf("submitted decision is missing")
	}
	if err := validateSubmittedGenerationValueIDs(record.Fields, record.Decision.Values); err != nil {
		return submittedGenerationPlan{}, err
	}

	settingsCount := 0
	var settingsField serviceselection.FormField
	for _, field := range record.Fields {
		if field.Type == serviceselection.FieldTypeGenerationSettings {
			settingsCount++
			settingsField = field
		}
	}
	if settingsCount > 0 {
		if settingsCount != 1 || len(record.Fields) != 1 {
			return submittedGenerationPlan{}, fmt.Errorf(
				"image generation_plan must contain exactly one generation_settings field and cannot mix other fields",
			)
		}
		return submittedImageGenerationPlan(record.Decision.Values, settingsField)
	}
	return submittedLegacyVideoGenerationPlan(record.Decision.Values, record.Fields)
}

func validateSubmittedGenerationValueIDs(fields []serviceselection.FormField, values map[string]any) error {
	known := make(map[string]bool, len(fields))
	for _, field := range fields {
		known[field.ID] = true
	}
	for id := range values {
		if !known[id] {
			return fmt.Errorf("submitted values contain unknown field %q", id)
		}
	}
	return nil
}

func submittedImageGenerationPlan(
	values map[string]any,
	field serviceselection.FormField,
) (submittedGenerationPlan, error) {
	if strings.TrimSpace(field.Kind) != "image" {
		return submittedGenerationPlan{}, fmt.Errorf("generation_settings field %q requires kind=image", field.ID)
	}
	value, err := submittedObjectValue(values, field)
	if err != nil {
		return submittedGenerationPlan{}, err
	}
	kind, ok := value["kind"].(string)
	if !ok || strings.TrimSpace(kind) != "image" {
		return submittedGenerationPlan{}, fmt.Errorf("submitted field %q requires kind=image", field.ID)
	}
	routeID, params, err := submittedRouteAndParams(field, value, true)
	if err != nil {
		return submittedGenerationPlan{}, err
	}
	referenceValue, ok := value["referenceAssetIds"]
	if !ok || referenceValue == nil {
		return submittedGenerationPlan{}, fmt.Errorf("submitted field %q is missing referenceAssetIds", field.ID)
	}
	referenceAssetIDs, err := submittedReferenceAssetIDs(referenceValue)
	if err != nil {
		return submittedGenerationPlan{}, fmt.Errorf("submitted field %q referenceAssetIds: %w", field.ID, err)
	}
	supplementValue, ok := value["promptSupplements"]
	if !ok || supplementValue == nil {
		return submittedGenerationPlan{}, fmt.Errorf("submitted field %q is missing promptSupplements", field.ID)
	}
	promptSupplements, err := submittedPromptSupplements(supplementValue)
	if err != nil {
		return submittedGenerationPlan{}, fmt.Errorf("submitted field %q promptSupplements: %w", field.ID, err)
	}
	optimizationValue, ok := value["promptOptimization"]
	if !ok || optimizationValue == nil {
		return submittedGenerationPlan{}, fmt.Errorf("submitted field %q is missing promptOptimization", field.ID)
	}
	promptOptimization, err := submittedPromptOptimization(optimizationValue)
	if err != nil {
		return submittedGenerationPlan{}, fmt.Errorf("submitted field %q promptOptimization: %w", field.ID, err)
	}
	return submittedGenerationPlan{
		kind:               "image",
		routeID:            routeID,
		params:             params,
		referenceAssetIDs:  referenceAssetIDs,
		promptSupplements:  promptSupplements,
		promptOptimization: promptOptimization,
	}, nil
}

func submittedLegacyVideoGenerationPlan(
	values map[string]any,
	fields []serviceselection.FormField,
) (submittedGenerationPlan, error) {
	var generationField, imagesField, promptOptimizationField *serviceselection.FormField
	for _, field := range fields {
		switch field.Type {
		case serviceselection.FieldTypeGenerationParams:
			if generationField != nil {
				return submittedGenerationPlan{}, fmt.Errorf("generation_plan has multiple generation_params fields")
			}
			fieldCopy := field
			generationField = &fieldCopy
		case serviceselection.FieldTypeImages:
			if imagesField != nil {
				return submittedGenerationPlan{}, fmt.Errorf("generation_plan has multiple %s fields", field.Type)
			}
			fieldCopy := field
			imagesField = &fieldCopy
		case serviceselection.FieldTypePromptOptimization:
			if promptOptimizationField != nil {
				return submittedGenerationPlan{}, fmt.Errorf("generation_plan has multiple %s fields", field.Type)
			}
			fieldCopy := field
			promptOptimizationField = &fieldCopy
		default:
			return submittedGenerationPlan{}, fmt.Errorf(
				"generation_plan contains disallowed field type %q",
				field.Type,
			)
		}
	}
	if generationField == nil {
		return submittedGenerationPlan{}, fmt.Errorf("generation_params field is missing")
	}
	if strings.TrimSpace(generationField.Kind) != "video" {
		return submittedGenerationPlan{}, fmt.Errorf(
			"legacy generation_params field %q requires kind=video",
			generationField.ID,
		)
	}
	value, err := submittedObjectValue(values, *generationField)
	if err != nil {
		return submittedGenerationPlan{}, err
	}
	routeID, params, err := submittedRouteAndParams(*generationField, value, false)
	if err != nil {
		return submittedGenerationPlan{}, err
	}
	plan := submittedGenerationPlan{
		kind:              "video",
		routeID:           routeID,
		params:            params,
		referenceAssetIDs: []string{},
		promptSupplements: []confirmedPromptSupplement{},
	}
	if imagesField != nil {
		ids, err := submittedReferenceAssetIDs(values[imagesField.ID])
		if err != nil {
			return submittedGenerationPlan{}, fmt.Errorf("submitted field %q: %w", imagesField.ID, err)
		}
		plan.referenceAssetIDs = ids
	}
	if promptOptimizationField != nil {
		optimization, err := submittedPromptOptimization(values[promptOptimizationField.ID])
		if err != nil {
			return submittedGenerationPlan{}, fmt.Errorf("submitted field %q: %w", promptOptimizationField.ID, err)
		}
		plan.promptOptimization = optimization
	}
	return plan, nil
}

func submittedObjectValue(
	values map[string]any,
	field serviceselection.FormField,
) (map[string]any, error) {
	raw, ok := values[field.ID]
	if !ok {
		return nil, fmt.Errorf("submitted values are missing field %q", field.ID)
	}
	value, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("submitted field %q is not an object", field.ID)
	}
	return value, nil
}

func submittedRouteAndParams(
	field serviceselection.FormField,
	value map[string]any,
	requireParams bool,
) (string, map[string]any, error) {
	routeID, ok := value["routeId"].(string)
	if !ok || strings.TrimSpace(routeID) == "" {
		return "", nil, fmt.Errorf("submitted field %q requires a routeId", field.ID)
	}
	rawParams, present := value["params"]
	if !present && !requireParams {
		return strings.TrimSpace(routeID), map[string]any{}, nil
	}
	params, ok := rawParams.(map[string]any)
	if !ok {
		return "", nil, fmt.Errorf("submitted field %q expects params to be an object", field.ID)
	}
	return strings.TrimSpace(routeID), params, nil
}

func submittedReferenceAssetIDs(value any) ([]string, error) {
	if value == nil {
		return []string{}, nil
	}
	switch items := value.(type) {
	case []string:
		return normalizeConfirmationStrings(items), nil
	case []any:
		ids := make([]string, 0, len(items))
		for _, item := range items {
			id, ok := item.(string)
			if !ok {
				return nil, fmt.Errorf("expects an array of media asset ids")
			}
			ids = append(ids, id)
		}
		return normalizeConfirmationStrings(ids), nil
	default:
		return nil, fmt.Errorf("expects an array of media asset ids")
	}
}

func submittedPromptSupplements(value any) ([]confirmedPromptSupplement, error) {
	var items []any
	switch typed := value.(type) {
	case []any:
		items = typed
	case []map[string]any:
		items = make([]any, 0, len(typed))
		for _, item := range typed {
			items = append(items, item)
		}
	default:
		return nil, fmt.Errorf("expects an array of prompt supplement objects")
	}
	result := make([]confirmedPromptSupplement, 0, len(items))
	for index, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("expects item %d to be an object", index)
		}
		name, ok := object["referenceName"].(string)
		if !ok {
			return nil, fmt.Errorf("expects item %d referenceName to be a string", index)
		}
		prompt, ok := object["referencePrompt"].(string)
		if !ok || strings.TrimSpace(prompt) == "" {
			return nil, fmt.Errorf("requires item %d referencePrompt", index)
		}
		id := ""
		if rawID, present := object["referenceId"]; present && rawID != nil {
			var idOK bool
			id, idOK = rawID.(string)
			if !idOK {
				return nil, fmt.Errorf("expects item %d referenceId to be a string", index)
			}
		}
		result = append(result, confirmedPromptSupplement{
			ReferenceID:     strings.TrimSpace(id),
			ReferenceName:   strings.TrimSpace(name),
			ReferencePrompt: strings.TrimSpace(prompt),
		})
	}
	return result, nil
}

func submittedPromptOptimization(value any) (*confirmedPromptOptimization, error) {
	if value == nil {
		return nil, nil
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("expects an object with an enabled flag")
	}
	enabled, ok := object["enabled"].(bool)
	if !ok {
		return nil, fmt.Errorf("expects a boolean enabled flag")
	}
	if !enabled {
		return nil, nil
	}
	routeID, ok := object["routeId"].(string)
	if !ok || strings.TrimSpace(routeID) == "" {
		return nil, fmt.Errorf("requires routeId when enabled")
	}
	referencePrompt, ok := object["referencePrompt"].(string)
	if !ok || strings.TrimSpace(referencePrompt) == "" {
		return nil, fmt.Errorf("requires referencePrompt when enabled")
	}
	referenceName := ""
	if rawName, present := object["referenceName"]; present && rawName != nil {
		var nameOK bool
		referenceName, nameOK = rawName.(string)
		if !nameOK {
			return nil, fmt.Errorf("expects referenceName to be a string")
		}
	}
	return &confirmedPromptOptimization{
		RouteID:         strings.TrimSpace(routeID),
		ReferenceName:   strings.TrimSpace(referenceName),
		ReferencePrompt: strings.TrimSpace(referencePrompt),
	}, nil
}

func canonicalPromptSupplements(input []mediamcp.GenerationPromptSupplementInput) []confirmedPromptSupplement {
	result := make([]confirmedPromptSupplement, 0, len(input))
	for _, supplement := range input {
		result = append(result, confirmedPromptSupplement{
			ReferenceID:     strings.TrimSpace(supplement.ReferenceID),
			ReferenceName:   strings.TrimSpace(supplement.ReferenceName),
			ReferencePrompt: strings.TrimSpace(supplement.ReferencePrompt),
		})
	}
	return result
}

func authorizePromptOptimization(
	input *mediamcp.GenerationPromptOptimizationInput,
	confirmed *confirmedPromptOptimization,
) error {
	if confirmed == nil {
		if input != nil {
			return fmt.Errorf("prompt optimization was not enabled in the submitted generation_plan")
		}
		return nil
	}
	if input == nil {
		return fmt.Errorf("prompt optimization does not match the submitted generation_plan")
	}
	want := map[string]any{
		"sessionId":         "",
		"scopeId":           "",
		"conversationTitle": "",
		"projectId":         "",
		"capabilityId":      "",
		"routeId":           confirmed.RouteID,
		"model":             "",
		"referenceName":     confirmed.ReferenceName,
		"referencePrompt":   confirmed.ReferencePrompt,
		"params":            map[string]any{},
	}
	got := map[string]any{
		"sessionId":         strings.TrimSpace(input.ConversationID),
		"scopeId":           strings.TrimSpace(input.ScopeID),
		"conversationTitle": strings.TrimSpace(input.ConversationTitle),
		"projectId":         strings.TrimSpace(input.ProjectID),
		"capabilityId":      strings.TrimSpace(input.CapabilityID),
		"routeId":           strings.TrimSpace(input.RouteID),
		"model":             strings.TrimSpace(input.Model),
		"referenceName":     strings.TrimSpace(input.ReferenceName),
		"referencePrompt":   strings.TrimSpace(input.ReferencePrompt),
		"params":            nonNilMap(input.Params),
	}
	if !canonicalJSONEqual(got, want) {
		return fmt.Errorf("prompt optimization does not match the submitted generation_plan")
	}
	return nil
}

func normalizeConfirmationStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func requiresGenerationConfirmation(kind string) bool {
	switch strings.TrimSpace(kind) {
	case "image", "video":
		return true
	default:
		return false
	}
}

func nonNilMap(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func canonicalJSONEqual(left any, right any) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && string(leftJSON) == string(rightJSON)
}
