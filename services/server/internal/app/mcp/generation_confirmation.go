package mcp

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	servicegeneration "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
	serviceselection "github.com/mediago-dev/mediago-drama/services/server/internal/service/selection"
)

// GenerationSelectionStore supplies the submitted generation plan used to
// authorize a run-scoped image or video generation request.
type GenerationSelectionStore interface {
	Get(projectID string, selectionID string) (serviceselection.Record, bool, error)
}

// GenerationSelectionAuthorizationStore atomically consumes a confirmation
// and persists the replayable result of the side effect it authorized.
type GenerationSelectionAuthorizationStore interface {
	ClaimGenerationUse(
		projectID string,
		sessionID string,
		runID string,
		selectionID string,
		fingerprint string,
	) (serviceselection.GenerationUseClaimResult, error)
	CompleteGenerationUse(
		projectID string,
		selectionID string,
		fingerprint string,
		outcome json.RawMessage,
	) error
}

// GenerationRunContext identifies the agent run that owns generation tool
// calls. Agent image and video side effects require every field to be present.
type GenerationRunContext struct {
	SessionID  string
	RunID      string
	Selections GenerationSelectionStore
}

// GenerationConfirmationErrorCode is a stable machine-readable authorization
// error code returned by generation MCP side-effect operations.
type GenerationConfirmationErrorCode string

const (
	// GenerationConfirmationContextMissing reports missing agent project,
	// session, run, or selection-store context.
	GenerationConfirmationContextMissing GenerationConfirmationErrorCode = "GENERATION_CONFIRMATION_CONTEXT_MISSING"
	// GenerationConfirmationRequired reports that no explicit submitted user
	// confirmation was supplied for the requested side effect.
	GenerationConfirmationRequired GenerationConfirmationErrorCode = "GENERATION_CONFIRMATION_REQUIRED"
	// GenerationConfirmationStale reports a missing, expired, or legacy
	// confirmation that can no longer authorize a generation.
	GenerationConfirmationStale GenerationConfirmationErrorCode = "GENERATION_CONFIRMATION_STALE"
	// GenerationConfirmationMismatch reports that the supplied confirmation
	// belongs to another context or does not match the generation request.
	GenerationConfirmationMismatch GenerationConfirmationErrorCode = "GENERATION_CONFIRMATION_MISMATCH"
	// GenerationConfirmationConsumed reports that a one-use confirmation has
	// already authorized a different completed side effect.
	GenerationConfirmationConsumed GenerationConfirmationErrorCode = "GENERATION_CONFIRMATION_CONSUMED"
	// GenerationConfirmationOutcomeUnknown reports a claimed confirmation whose
	// external side-effect outcome cannot safely be determined or repeated.
	GenerationConfirmationOutcomeUnknown GenerationConfirmationErrorCode = "GENERATION_CONFIRMATION_OUTCOME_UNKNOWN"
	// GenerationExecutionFailed is the stable replayable error returned when an
	// authorized generation service call fails.
	GenerationExecutionFailed GenerationConfirmationErrorCode = "GENERATION_EXECUTION_FAILED"
)

// GenerationConfirmationError carries a stable confirmation error code while
// preserving a human-readable MCP error message and optional underlying cause.
type GenerationConfirmationError struct {
	Code    GenerationConfirmationErrorCode
	Message string
	Cause   error
}

// Error implements error.
func (err *GenerationConfirmationError) Error() string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(err.Message)
	if message == "" && err.Cause != nil {
		message = err.Cause.Error()
	}
	if message == "" {
		return string(err.Code)
	}
	return fmt.Sprintf("%s: %s", err.Code, message)
}

// Unwrap exposes the underlying storage or validation failure, when present.
func (err *GenerationConfirmationError) Unwrap() error {
	if err == nil {
		return nil
	}
	return err.Cause
}

func generationConfirmationError(
	code GenerationConfirmationErrorCode,
	message string,
	cause error,
) error {
	return &GenerationConfirmationError{Code: code, Message: message, Cause: cause}
}

func (server *GenerationServer) requireGenerationConfirmationContext(
	effectiveKind string,
	selectionID string,
) (bool, error) {
	if !requiresGenerationConfirmation(effectiveKind) {
		return false, nil
	}
	if server == nil {
		return false, generationConfirmationError(
			GenerationConfirmationContextMissing,
			"generation agent caller context is unavailable",
			nil,
		)
	}
	switch server.callerMode {
	case GenerationCallerTrustedManual:
		return false, nil
	case GenerationCallerAgent:
		// Continue below.
	default:
		return false, generationConfirmationError(
			GenerationConfirmationContextMissing,
			"generation caller mode is not configured",
			nil,
		)
	}

	missing := make([]string, 0, 4)
	if strings.TrimSpace(server.projectID) == "" {
		missing = append(missing, "projectId")
	}
	if strings.TrimSpace(server.sessionID) == "" {
		missing = append(missing, "sessionId")
	}
	if strings.TrimSpace(server.runID) == "" {
		missing = append(missing, "runId")
	}
	if server.selections == nil {
		missing = append(missing, "selectionStore")
	}
	if len(missing) > 0 {
		return false, generationConfirmationError(
			GenerationConfirmationContextMissing,
			fmt.Sprintf("agent image/video generation is missing %s", strings.Join(missing, ", ")),
			nil,
		)
	}
	if strings.TrimSpace(selectionID) == "" {
		return false, generationConfirmationError(
			GenerationConfirmationRequired,
			"generation requires an explicit submitted confirmationSelectionId",
			nil,
		)
	}
	return true, nil
}

func (server *GenerationServer) loadAgentGenerationConfirmation(
	selectionID string,
	expectedKind string,
) (serviceselection.Record, error) {
	selectionID = strings.TrimSpace(selectionID)
	record, ok, err := server.selections.Get(server.projectID, selectionID)
	if err != nil {
		return serviceselection.Record{}, generationConfirmationError(
			GenerationConfirmationOutcomeUnknown,
			fmt.Sprintf("reading generation confirmation %q failed", selectionID),
			err,
		)
	}
	if !ok {
		return serviceselection.Record{}, generationConfirmationError(
			GenerationConfirmationStale,
			fmt.Sprintf("generation confirmation %q was not found; confirm again", selectionID),
			nil,
		)
	}
	if record.Kind != expectedKind {
		return serviceselection.Record{}, generationConfirmationError(
			GenerationConfirmationMismatch,
			fmt.Sprintf("selection %q is not a %s", selectionID, expectedKind),
			nil,
		)
	}
	if strings.TrimSpace(record.ProjectID) != strings.TrimSpace(server.projectID) {
		return serviceselection.Record{}, generationConfirmationError(
			GenerationConfirmationMismatch,
			fmt.Sprintf("generation confirmation %q belongs to a different project", selectionID),
			nil,
		)
	}
	if strings.TrimSpace(record.RunID) != strings.TrimSpace(server.runID) {
		return serviceselection.Record{}, generationConfirmationError(
			GenerationConfirmationMismatch,
			fmt.Sprintf("generation confirmation %q belongs to a different agent run", selectionID),
			nil,
		)
	}
	if strings.TrimSpace(record.SessionID) != strings.TrimSpace(server.sessionID) {
		return serviceselection.Record{}, generationConfirmationError(
			GenerationConfirmationMismatch,
			fmt.Sprintf("generation confirmation %q belongs to a different agent session", selectionID),
			nil,
		)
	}
	return record, nil
}

func (server *GenerationServer) authorizeGeneration(
	input mediamcp.GenerationMessageInput,
	effectiveKind string,
) error {
	effectiveKind = strings.TrimSpace(effectiveKind)
	if effectiveKind == "" {
		effectiveKind = "image"
	}
	required, err := server.requireGenerationConfirmationContext(
		effectiveKind,
		input.ConfirmationSelectionID,
	)
	if err != nil {
		return err
	}
	if !required {
		return nil
	}
	selectionID := strings.TrimSpace(input.ConfirmationSelectionID)
	record, err := server.loadAgentGenerationConfirmation(
		selectionID,
		serviceselection.KindGenerationPlan,
	)
	if err != nil {
		return err
	}
	if record.Status != serviceselection.StatusSubmitted || record.Decision == nil || record.Decision.Cancelled {
		return generationConfirmationError(
			GenerationConfirmationRequired,
			fmt.Sprintf(
				"generation confirmation %q is %s; wait for an explicit user submission before generating",
				selectionID,
				firstNonEmpty(record.Status, serviceselection.StatusPending),
			),
			nil,
		)
	}

	plan, err := submittedGenerationPlanFromRecord(record)
	if err != nil {
		return generationConfirmationError(
			GenerationConfirmationStale,
			fmt.Sprintf("generation confirmation %q is no longer valid", selectionID),
			err,
		)
	}
	if plan.kind != effectiveKind {
		return generationConfirmationError(
			GenerationConfirmationMismatch,
			fmt.Sprintf(
				"generation kind %q does not match confirmed kind %q",
				effectiveKind,
				plan.kind,
			),
			nil,
		)
	}
	if firstNonEmpty(input.FamilyID, input.VersionID, input.Provider, input.ModelID, input.Model) != "" {
		return generationConfirmationError(
			GenerationConfirmationMismatch,
			"generation model overrides are not allowed with a confirmed routeId",
			nil,
		)
	}
	if strings.TrimSpace(input.RouteID) != plan.routeID {
		return generationConfirmationError(
			GenerationConfirmationMismatch,
			fmt.Sprintf(
				"generation route %q does not match confirmed route %q",
				strings.TrimSpace(input.RouteID),
				plan.routeID,
			),
			nil,
		)
	}
	if !canonicalJSONEqual(nonNilMap(input.Params), nonNilMap(plan.params)) {
		return generationConfirmationError(
			GenerationConfirmationMismatch,
			"generation params do not match the submitted generation_plan",
			nil,
		)
	}
	if len(input.ReferenceURLs) > 0 || len(input.ReferenceBindings) > 0 {
		return generationConfirmationError(
			GenerationConfirmationMismatch,
			"generation references must use only the asset ids submitted in the generation_plan",
			nil,
		)
	}
	if !canonicalJSONEqual(
		normalizeConfirmationStrings(input.ReferenceAssetIDs),
		plan.referenceAssetIDs,
	) {
		return generationConfirmationError(
			GenerationConfirmationMismatch,
			"generation reference assets do not match the submitted generation_plan",
			nil,
		)
	}
	if !canonicalJSONEqual(
		canonicalPromptSupplements(input.PromptSupplements),
		plan.promptSupplements,
	) {
		return generationConfirmationError(
			GenerationConfirmationMismatch,
			"generation prompt supplements do not match the submitted generation_plan",
			nil,
		)
	}
	if err := authorizePromptOptimization(input.PromptOptimization, plan.promptOptimization); err != nil {
		return generationConfirmationError(
			GenerationConfirmationMismatch,
			err.Error(),
			err,
		)
	}
	return nil
}

type preparedGenerationMessage struct {
	SelectionID string
	Fingerprint string
	Request     servicegeneration.GenerationMessageRequest
}

type preparedGenerationBatch struct {
	SelectionID string
	Fingerprint string
	Request     servicegeneration.GenerationBatchRequest
}

func (server *GenerationServer) prepareAgentGenerationMessage(
	input mediamcp.GenerationMessageInput,
	effectiveProjectID string,
) (preparedGenerationMessage, bool, error) {
	effectiveKind := firstNonEmpty(input.Kind, "image")
	required, err := server.requireGenerationConfirmationContext(
		effectiveKind,
		input.ConfirmationSelectionID,
	)
	if err != nil {
		return preparedGenerationMessage{}, false, err
	}
	if !required {
		return preparedGenerationMessage{}, false, nil
	}

	selectionID := strings.TrimSpace(input.ConfirmationSelectionID)
	record, err := server.loadAgentGenerationConfirmation(
		selectionID,
		serviceselection.KindGenerationPlan,
	)
	if err != nil {
		return preparedGenerationMessage{}, false, err
	}
	if record.Status != serviceselection.StatusSubmitted ||
		record.Decision == nil ||
		record.Decision.Cancelled {
		return preparedGenerationMessage{}, false, generationConfirmationError(
			GenerationConfirmationRequired,
			fmt.Sprintf(
				"generation confirmation %q is %s; wait for an explicit user submission before generating",
				selectionID,
				firstNonEmpty(record.Status, serviceselection.StatusPending),
			),
			nil,
		)
	}
	if record.Intent == nil {
		return preparedGenerationMessage{}, false, generationConfirmationError(
			GenerationConfirmationStale,
			fmt.Sprintf("generation confirmation %q has no immutable intent; confirm again", selectionID),
			nil,
		)
	}
	if record.Intent.Version != serviceselection.GenerationPlanIntentVersion ||
		record.Intent.Operation != serviceselection.GenerationPlanOperationCreateSingle ||
		len(record.Intent.Items) != 1 {
		return preparedGenerationMessage{}, false, generationConfirmationError(
			GenerationConfirmationMismatch,
			fmt.Sprintf("generation confirmation %q does not authorize a single create request", selectionID),
			nil,
		)
	}

	plan, err := submittedGenerationPlanFromRecord(record)
	if err != nil {
		return preparedGenerationMessage{}, false, generationConfirmationError(
			GenerationConfirmationStale,
			fmt.Sprintf("generation confirmation %q is no longer valid", selectionID),
			err,
		)
	}
	item := record.Intent.Items[0]
	if item.Kind != plan.kind {
		return preparedGenerationMessage{}, false, generationConfirmationError(
			GenerationConfirmationStale,
			fmt.Sprintf("generation confirmation %q has inconsistent media settings", selectionID),
			nil,
		)
	}

	expected := expectedGenerationMessageInput(item, plan)
	actualCanonical := canonicalGenerationMessageInput(input, effectiveProjectID)
	expectedCanonical := canonicalGenerationMessageInput(expected, effectiveProjectID)
	if usesConfirmedDocumentResourcePrompt(item) {
		actualCanonical.Prompt = expectedCanonical.Prompt
		actualCanonical.ResourceType = expectedCanonical.ResourceType
	}
	actualJSON, err := json.Marshal(actualCanonical)
	if err != nil {
		return preparedGenerationMessage{}, false, generationConfirmationError(
			GenerationConfirmationMismatch,
			"generation request cannot be normalized for confirmation",
			err,
		)
	}
	expectedJSON, err := json.Marshal(expectedCanonical)
	if err != nil {
		return preparedGenerationMessage{}, false, generationConfirmationError(
			GenerationConfirmationStale,
			fmt.Sprintf("generation confirmation %q cannot be normalized", selectionID),
			err,
		)
	}
	if string(actualJSON) != string(expectedJSON) {
		return preparedGenerationMessage{}, false, generationConfirmationError(
			GenerationConfirmationMismatch,
			"generation request does not exactly match the confirmed prompt, target, references, and settings",
			nil,
		)
	}

	fingerprintPayload, err := json.Marshal(struct {
		Operation         string          `json:"operation"`
		ConversationTitle string          `json:"conversationTitle,omitempty"`
		ItemID            string          `json:"itemId"`
		Request           json.RawMessage `json:"request"`
	}{
		Operation:         record.Intent.Operation,
		ConversationTitle: strings.TrimSpace(record.Intent.ConversationTitle),
		ItemID:            strings.TrimSpace(item.ID),
		Request:           expectedJSON,
	})
	if err != nil {
		return preparedGenerationMessage{}, false, generationConfirmationError(
			GenerationConfirmationOutcomeUnknown,
			"generation confirmation fingerprint could not be created",
			err,
		)
	}
	fingerprint := fmt.Sprintf("%x", sha256.Sum256(fingerprintPayload))
	return preparedGenerationMessage{
		SelectionID: selectionID,
		Fingerprint: fingerprint,
		Request:     generationMessageRequestFromMCP(expectedCanonical, effectiveProjectID),
	}, true, nil
}

func (server *GenerationServer) prepareAgentGenerationBatch(
	input mediamcp.GenerationBatchInput,
	effectiveProjectID string,
) (preparedGenerationBatch, bool, error) {
	if server != nil &&
		server.callerMode == GenerationCallerAgent &&
		generationBatchContainsConfirmationKind(input) {
		for index, item := range input.Items {
			if strings.TrimSpace(item.Request.ConfirmationSelectionID) != "" {
				return preparedGenerationBatch{}, false, generationConfirmationError(
					GenerationConfirmationMismatch,
					fmt.Sprintf(
						"generation batch item %d (%s) must not contain a child confirmationSelectionId; use only the batch-level confirmation",
						index,
						firstNonEmpty(strings.TrimSpace(item.ID), "unnamed"),
					),
					nil,
				)
			}
		}
	}
	required, err := server.requireGenerationBatchConfirmation(input)
	if err != nil {
		return preparedGenerationBatch{}, false, err
	}
	if !required {
		return preparedGenerationBatch{}, false, nil
	}

	selectionID := strings.TrimSpace(input.ConfirmationSelectionID)
	record, err := server.loadAgentGenerationConfirmation(
		selectionID,
		serviceselection.KindGenerationPlan,
	)
	if err != nil {
		return preparedGenerationBatch{}, false, err
	}
	if record.Status != serviceselection.StatusSubmitted ||
		record.Decision == nil ||
		record.Decision.Cancelled {
		return preparedGenerationBatch{}, false, generationConfirmationError(
			GenerationConfirmationRequired,
			fmt.Sprintf(
				"generation confirmation %q is %s; wait for an explicit user submission before generating",
				selectionID,
				firstNonEmpty(record.Status, serviceselection.StatusPending),
			),
			nil,
		)
	}
	if record.Intent == nil {
		return preparedGenerationBatch{}, false, generationConfirmationError(
			GenerationConfirmationStale,
			fmt.Sprintf("generation confirmation %q has no immutable intent; confirm again", selectionID),
			nil,
		)
	}
	if record.Intent.Version != serviceselection.GenerationPlanIntentVersion ||
		record.Intent.Operation != serviceselection.GenerationPlanOperationCreateBatch {
		return preparedGenerationBatch{}, false, generationConfirmationError(
			GenerationConfirmationMismatch,
			fmt.Sprintf("generation confirmation %q does not authorize a batch create request", selectionID),
			nil,
		)
	}
	if len(input.Items) != len(record.Intent.Items) {
		return preparedGenerationBatch{}, false, generationConfirmationError(
			GenerationConfirmationMismatch,
			fmt.Sprintf(
				"generation batch item count %d does not match the %d confirmed items",
				len(input.Items),
				len(record.Intent.Items),
			),
			nil,
		)
	}

	plan, err := submittedGenerationPlanFromRecord(record)
	if err != nil {
		return preparedGenerationBatch{}, false, generationConfirmationError(
			GenerationConfirmationStale,
			fmt.Sprintf("generation confirmation %q is no longer valid", selectionID),
			err,
		)
	}
	batchKind := strings.TrimSpace(input.Kind)
	if batchKind != "" && batchKind != plan.kind {
		return preparedGenerationBatch{}, false, generationConfirmationError(
			GenerationConfirmationMismatch,
			fmt.Sprintf("generation batch kind %q does not match confirmed kind %q", batchKind, plan.kind),
			nil,
		)
	}
	if strings.TrimSpace(input.ConversationTitle) != strings.TrimSpace(record.Intent.ConversationTitle) {
		return preparedGenerationBatch{}, false, generationConfirmationError(
			GenerationConfirmationMismatch,
			"generation batch conversation title does not match the confirmed intent",
			nil,
		)
	}

	batchConversationID := strings.TrimSpace(input.ConversationID)
	batchScopeID := strings.TrimSpace(input.ScopeID)
	if batchConversationID != "" && batchKind == "" {
		return preparedGenerationBatch{}, false, generationConfirmationError(
			GenerationConfirmationMismatch,
			"generation batch kind is required when a batch sessionId is provided",
			nil,
		)
	}
	authorizedInput := mediamcp.GenerationBatchInput{
		Kind:              batchKind,
		ConversationID:    batchConversationID,
		ConversationTitle: strings.TrimSpace(record.Intent.ConversationTitle),
		ProjectID:         strings.TrimSpace(effectiveProjectID),
		ScopeID:           batchScopeID,
		Items:             make([]mediamcp.GenerationBatchItemInput, 0, len(record.Intent.Items)),
	}
	for index, intentItem := range record.Intent.Items {
		actualItem := input.Items[index]
		actualID := strings.TrimSpace(actualItem.ID)
		intentID := strings.TrimSpace(intentItem.ID)
		if actualID != intentID {
			return preparedGenerationBatch{}, false, generationConfirmationError(
				GenerationConfirmationMismatch,
				fmt.Sprintf(
					"generation batch item %d id %q does not match confirmed id %q",
					index,
					actualID,
					intentID,
				),
				nil,
			)
		}
		if intentItem.Kind != plan.kind {
			return preparedGenerationBatch{}, false, generationConfirmationError(
				GenerationConfirmationStale,
				fmt.Sprintf("generation confirmation %q has inconsistent media settings", selectionID),
				nil,
			)
		}
		if batchConversationID != "" && strings.TrimSpace(intentItem.ConversationID) != batchConversationID {
			return preparedGenerationBatch{}, false, generationConfirmationError(
				GenerationConfirmationMismatch,
				fmt.Sprintf("generation batch sessionId does not match confirmed item %q", intentID),
				nil,
			)
		}
		if batchScopeID != "" && strings.TrimSpace(intentItem.ScopeID) != batchScopeID {
			return preparedGenerationBatch{}, false, generationConfirmationError(
				GenerationConfirmationMismatch,
				fmt.Sprintf("generation batch scopeId does not match confirmed item %q", intentID),
				nil,
			)
		}
		authorizedInput.Items = append(authorizedInput.Items, mediamcp.GenerationBatchItemInput{
			ID:      intentID,
			Request: expectedGenerationMessageInput(intentItem, plan),
		})
	}

	actualCanonical := canonicalGenerationBatchInput(input, effectiveProjectID)
	expectedCanonical := canonicalGenerationBatchInput(authorizedInput, effectiveProjectID)
	for index, item := range record.Intent.Items {
		if usesConfirmedDocumentResourcePrompt(item) {
			actualCanonical.Items[index].Request.Prompt = expectedCanonical.Items[index].Request.Prompt
			actualCanonical.Items[index].Request.ResourceType = expectedCanonical.Items[index].Request.ResourceType
		}
	}
	actualJSON, err := json.Marshal(actualCanonical)
	if err != nil {
		return preparedGenerationBatch{}, false, generationConfirmationError(
			GenerationConfirmationMismatch,
			"generation batch cannot be normalized for confirmation",
			err,
		)
	}
	expectedJSON, err := json.Marshal(expectedCanonical)
	if err != nil {
		return preparedGenerationBatch{}, false, generationConfirmationError(
			GenerationConfirmationStale,
			fmt.Sprintf("generation confirmation %q cannot be normalized", selectionID),
			err,
		)
	}
	if string(actualJSON) != string(expectedJSON) {
		return preparedGenerationBatch{}, false, generationConfirmationError(
			GenerationConfirmationMismatch,
			"generation batch does not exactly match the confirmed ordered prompts, targets, references, and settings",
			nil,
		)
	}

	fingerprintPayload, err := json.Marshal(struct {
		Operation string          `json:"operation"`
		Batch     json.RawMessage `json:"batch"`
	}{
		Operation: record.Intent.Operation,
		Batch:     expectedJSON,
	})
	if err != nil {
		return preparedGenerationBatch{}, false, generationConfirmationError(
			GenerationConfirmationOutcomeUnknown,
			"generation batch confirmation fingerprint could not be created",
			err,
		)
	}
	fingerprint := fmt.Sprintf("%x", sha256.Sum256(fingerprintPayload))
	return preparedGenerationBatch{
		SelectionID: selectionID,
		Fingerprint: fingerprint,
		Request:     generationBatchRequestFromMCP(expectedCanonical, effectiveProjectID),
	}, true, nil
}

func (server *GenerationServer) requireGenerationBatchConfirmation(
	input mediamcp.GenerationBatchInput,
) (bool, error) {
	for _, item := range input.Items {
		effectiveKind := firstNonEmpty(item.Request.Kind, input.Kind, "image")
		required, err := server.requireGenerationConfirmationContext(
			effectiveKind,
			input.ConfirmationSelectionID,
		)
		if err != nil {
			return false, err
		}
		if required {
			return true, nil
		}
	}
	return false, nil
}

func generationBatchContainsConfirmationKind(input mediamcp.GenerationBatchInput) bool {
	for _, item := range input.Items {
		if requiresGenerationConfirmation(firstNonEmpty(item.Request.Kind, input.Kind, "image")) {
			return true
		}
	}
	return false
}

func expectedGenerationMessageInput(
	item serviceselection.GenerationPlanIntentItem,
	plan submittedGenerationPlan,
) mediamcp.GenerationMessageInput {
	promptSupplements := make(
		[]mediamcp.GenerationPromptSupplementInput,
		0,
		len(plan.promptSupplements),
	)
	for _, supplement := range plan.promptSupplements {
		promptSupplements = append(promptSupplements, mediamcp.GenerationPromptSupplementInput{
			ReferenceID:     supplement.ReferenceID,
			ReferenceName:   supplement.ReferenceName,
			ReferencePrompt: supplement.ReferencePrompt,
		})
	}
	expected := mediamcp.GenerationMessageInput{
		Kind:               item.Kind,
		ConversationID:     item.ConversationID,
		ScopeID:            item.ScopeID,
		DocumentID:         item.DocumentID,
		SectionID:          item.SectionID,
		CapabilityID:       item.CapabilityID,
		ResourceType:       item.ResourceType,
		RouteID:            plan.routeID,
		Prompt:             item.Prompt,
		PromptSupplements:  promptSupplements,
		AssetTitle:         item.AssetTitle,
		ReferenceAssetIDs:  orderedGenerationReferenceUnion(plan.referenceAssetIDs, item.ReferenceAssetIDs),
		Params:             nonNilMap(plan.params),
		DocumentContext:    generationDocumentContextFromIntent(item.DocumentContext),
		NotificationTarget: generationNotificationTargetFromIntent(item.NotificationTarget),
	}
	if plan.promptOptimization != nil {
		expected.PromptOptimization = &mediamcp.GenerationPromptOptimizationInput{
			RouteID:         plan.promptOptimization.RouteID,
			ReferenceName:   plan.promptOptimization.ReferenceName,
			ReferencePrompt: plan.promptOptimization.ReferencePrompt,
			Params:          map[string]any{},
		}
	}
	return expected
}

func usesConfirmedDocumentResourcePrompt(item serviceselection.GenerationPlanIntentItem) bool {
	if item.DocumentContext == nil ||
		strings.TrimSpace(item.DocumentContext.DocumentID) == "" ||
		strings.TrimSpace(item.DocumentContext.SectionID) == "" {
		return false
	}
	switch strings.TrimSpace(item.ResourceType) {
	case "character", "scene", "prop", "storyboard":
		return true
	default:
		return false
	}
}

func generationDocumentContextFromIntent(
	input *serviceselection.GenerationDocumentContext,
) *mediamcp.GenerationDocumentContext {
	if input == nil {
		return nil
	}
	return &mediamcp.GenerationDocumentContext{
		ProjectID:  input.ProjectID,
		DocumentID: input.DocumentID,
		SectionID:  input.SectionID,
	}
}

func generationNotificationTargetFromIntent(
	input *serviceselection.GenerationNotificationTarget,
) *mediamcp.GenerationNotificationTarget {
	if input == nil {
		return nil
	}
	return &mediamcp.GenerationNotificationTarget{
		Kind:          input.Kind,
		ProjectID:     input.ProjectID,
		DocumentID:    input.DocumentID,
		DocumentTitle: input.DocumentTitle,
		Section: mediamcp.GenerationNotificationSectionTarget{
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

func canonicalGenerationMessageInput(
	input mediamcp.GenerationMessageInput,
	effectiveProjectID string,
) mediamcp.GenerationMessageInput {
	canonical := mediamcp.GenerationMessageInput{
		Kind:               firstNonEmpty(input.Kind, "image"),
		ConversationID:     strings.TrimSpace(input.ConversationID),
		ScopeID:            strings.TrimSpace(input.ScopeID),
		ProjectID:          strings.TrimSpace(effectiveProjectID),
		DocumentID:         strings.TrimSpace(input.DocumentID),
		SectionID:          strings.TrimSpace(input.SectionID),
		CapabilityID:       strings.TrimSpace(input.CapabilityID),
		ResourceType:       strings.TrimSpace(input.ResourceType),
		RouteID:            strings.TrimSpace(input.RouteID),
		FamilyID:           strings.TrimSpace(input.FamilyID),
		VersionID:          strings.TrimSpace(input.VersionID),
		Provider:           strings.TrimSpace(input.Provider),
		ModelID:            strings.TrimSpace(input.ModelID),
		Model:              strings.TrimSpace(input.Model),
		Prompt:             strings.TrimSpace(input.Prompt),
		PromptSupplements:  canonicalGenerationPromptSupplementInputs(input.PromptSupplements),
		AssetTitle:         strings.TrimSpace(input.AssetTitle),
		ReferenceURLs:      normalizeConfirmationStrings(input.ReferenceURLs),
		ReferenceAssetIDs:  normalizeConfirmationStrings(input.ReferenceAssetIDs),
		ReferenceBindings:  canonicalGenerationReferenceBindings(input.ReferenceBindings),
		Params:             nonNilMap(input.Params),
		DocumentContext:    canonicalGenerationDocumentContext(input.DocumentContext, effectiveProjectID),
		NotificationTarget: canonicalGenerationNotificationTarget(input.NotificationTarget, effectiveProjectID),
		PromptOptimization: canonicalGenerationPromptOptimization(input.PromptOptimization, effectiveProjectID),
	}
	return canonical
}

func canonicalGenerationBatchInput(
	input mediamcp.GenerationBatchInput,
	effectiveProjectID string,
) mediamcp.GenerationBatchInput {
	batchKind := strings.TrimSpace(input.Kind)
	batchConversationID := strings.TrimSpace(input.ConversationID)
	batchScopeID := strings.TrimSpace(input.ScopeID)
	canonical := mediamcp.GenerationBatchInput{
		Kind:              batchKind,
		ConversationID:    batchConversationID,
		ConversationTitle: strings.TrimSpace(input.ConversationTitle),
		ProjectID:         strings.TrimSpace(effectiveProjectID),
		ScopeID:           batchScopeID,
		Items:             make([]mediamcp.GenerationBatchItemInput, 0, len(input.Items)),
	}
	for _, item := range input.Items {
		request := item.Request
		request.Kind = firstNonEmpty(request.Kind, batchKind, "image")
		request.ConversationID = firstNonEmpty(request.ConversationID, batchConversationID)
		request.ScopeID = firstNonEmpty(request.ScopeID, batchScopeID)
		canonical.Items = append(canonical.Items, mediamcp.GenerationBatchItemInput{
			ID:      strings.TrimSpace(item.ID),
			Request: canonicalGenerationMessageInput(request, effectiveProjectID),
		})
	}
	return canonical
}

func canonicalGenerationPromptSupplementInputs(
	input []mediamcp.GenerationPromptSupplementInput,
) []mediamcp.GenerationPromptSupplementInput {
	output := make([]mediamcp.GenerationPromptSupplementInput, 0, len(input))
	for _, item := range input {
		output = append(output, mediamcp.GenerationPromptSupplementInput{
			ReferenceID:     strings.TrimSpace(item.ReferenceID),
			ReferenceName:   strings.TrimSpace(item.ReferenceName),
			ReferencePrompt: strings.TrimSpace(item.ReferencePrompt),
		})
	}
	return output
}

func canonicalGenerationReferenceBindings(
	input []mediamcp.GenerationReferenceBinding,
) []mediamcp.GenerationReferenceBinding {
	output := make([]mediamcp.GenerationReferenceBinding, 0, len(input))
	for _, binding := range input {
		output = append(output, mediamcp.GenerationReferenceBinding{
			Kind:       strings.TrimSpace(binding.Kind),
			DocumentID: strings.TrimSpace(binding.DocumentID),
			BlockID:    strings.TrimSpace(binding.BlockID),
			AssetID:    strings.TrimSpace(binding.AssetID),
			URL:        strings.TrimSpace(binding.URL),
		})
	}
	return output
}

func canonicalGenerationDocumentContext(
	input *mediamcp.GenerationDocumentContext,
	effectiveProjectID string,
) *mediamcp.GenerationDocumentContext {
	if input == nil {
		return nil
	}
	return &mediamcp.GenerationDocumentContext{
		ProjectID:  firstNonEmpty(input.ProjectID, effectiveProjectID),
		DocumentID: strings.TrimSpace(input.DocumentID),
		SectionID:  strings.TrimSpace(input.SectionID),
	}
}

func canonicalGenerationNotificationTarget(
	input *mediamcp.GenerationNotificationTarget,
	effectiveProjectID string,
) *mediamcp.GenerationNotificationTarget {
	if input == nil {
		return nil
	}
	return &mediamcp.GenerationNotificationTarget{
		Kind:          strings.TrimSpace(input.Kind),
		ProjectID:     firstNonEmpty(input.ProjectID, effectiveProjectID),
		DocumentID:    strings.TrimSpace(input.DocumentID),
		DocumentTitle: strings.TrimSpace(input.DocumentTitle),
		Section: mediamcp.GenerationNotificationSectionTarget{
			BlockID:           strings.TrimSpace(input.Section.BlockID),
			DocumentID:        strings.TrimSpace(input.Section.DocumentID),
			HeadingLevel:      input.Section.HeadingLevel,
			HeadingOccurrence: input.Section.HeadingOccurrence,
			HeadingText:       strings.TrimSpace(input.Section.HeadingText),
			Markdown:          strings.TrimSpace(input.Section.Markdown),
			PlainText:         strings.TrimSpace(input.Section.PlainText),
			Prompt:            strings.TrimSpace(input.Section.Prompt),
		},
	}
}

func canonicalGenerationPromptOptimization(
	input *mediamcp.GenerationPromptOptimizationInput,
	effectiveProjectID string,
) *mediamcp.GenerationPromptOptimizationInput {
	if input == nil {
		return nil
	}
	return &mediamcp.GenerationPromptOptimizationInput{
		ConversationID:    strings.TrimSpace(input.ConversationID),
		ScopeID:           strings.TrimSpace(input.ScopeID),
		ConversationTitle: strings.TrimSpace(input.ConversationTitle),
		ProjectID:         firstNonEmpty(input.ProjectID, effectiveProjectID),
		CapabilityID:      strings.TrimSpace(input.CapabilityID),
		RouteID:           strings.TrimSpace(input.RouteID),
		Model:             strings.TrimSpace(input.Model),
		ReferenceName:     strings.TrimSpace(input.ReferenceName),
		ReferencePrompt:   strings.TrimSpace(input.ReferencePrompt),
		Params:            nonNilMap(input.Params),
	}
}

func orderedGenerationReferenceUnion(groups ...[]string) []string {
	combined := make([]string, 0)
	for _, group := range groups {
		combined = append(combined, group...)
	}
	return normalizeConfirmationStrings(combined)
}

func (server *GenerationServer) claimAgentGenerationUse(
	selectionID string,
	fingerprint string,
) (serviceselection.GenerationUseClaimResult, error) {
	store, ok := server.selections.(GenerationSelectionAuthorizationStore)
	if !ok {
		return serviceselection.GenerationUseClaimResult{}, generationConfirmationError(
			GenerationConfirmationContextMissing,
			"generation confirmation store does not support atomic authorization claims",
			nil,
		)
	}
	result, err := store.ClaimGenerationUse(
		server.projectID,
		server.sessionID,
		server.runID,
		selectionID,
		fingerprint,
	)
	if err == nil {
		return result, nil
	}
	if errors.Is(err, serviceselection.ErrGenerationUseNotAuthorized) {
		return serviceselection.GenerationUseClaimResult{}, generationConfirmationError(
			GenerationConfirmationStale,
			"generation confirmation is no longer eligible; confirm again",
			err,
		)
	}
	return serviceselection.GenerationUseClaimResult{}, generationConfirmationError(
		GenerationConfirmationOutcomeUnknown,
		"generation confirmation could not be claimed safely",
		err,
	)
}

func (server *GenerationServer) completeAgentGenerationUse(
	selectionID string,
	fingerprint string,
	outcome json.RawMessage,
) error {
	store, ok := server.selections.(GenerationSelectionAuthorizationStore)
	if !ok {
		return generationConfirmationError(
			GenerationConfirmationOutcomeUnknown,
			"generation confirmation outcome store is unavailable",
			nil,
		)
	}
	if err := store.CompleteGenerationUse(
		server.projectID,
		selectionID,
		fingerprint,
		outcome,
	); err != nil {
		return generationConfirmationError(
			GenerationConfirmationOutcomeUnknown,
			"generation outcome could not be persisted; the request will not be submitted again",
			err,
		)
	}
	return nil
}

const (
	generationOutcomeVersion     = 1
	generationMessageOutcomeType = "generation_message"
	generationBatchOutcomeType   = "generation_batch"
)

type generationOutcomeFailure struct {
	Code    GenerationConfirmationErrorCode `json:"code"`
	Message string                          `json:"message"`
	Status  int                             `json:"status,omitempty"`
}

type generationMessageOutcomeEnvelope struct {
	Version int                               `json:"version"`
	Type    string                            `json:"type"`
	Output  *mediamcp.GenerationMessageOutput `json:"output,omitempty"`
	Failure *generationOutcomeFailure         `json:"failure,omitempty"`
}

type generationBatchOutcomeEnvelope struct {
	Version int                             `json:"version"`
	Type    string                          `json:"type"`
	Output  *mediamcp.GenerationBatchOutput `json:"output,omitempty"`
	Failure *generationOutcomeFailure       `json:"failure,omitempty"`
}

func encodeGenerationMessageSuccessOutcome(
	output mediamcp.GenerationMessageOutput,
) (json.RawMessage, error) {
	return json.Marshal(generationMessageOutcomeEnvelope{
		Version: generationOutcomeVersion,
		Type:    generationMessageOutcomeType,
		Output:  &output,
	})
}

func stableGenerationExecutionFailure(action string, status int) generationOutcomeFailure {
	action = strings.TrimSpace(action)
	if action == "" {
		action = "generation"
	}
	message := fmt.Sprintf("%s failed", action)
	if status > 0 {
		message = fmt.Sprintf("%s failed with HTTP %d", action, status)
	}
	return generationOutcomeFailure{
		Code:    GenerationExecutionFailed,
		Message: message,
		Status:  status,
	}
}

func encodeGenerationMessageFailureOutcome(
	failure generationOutcomeFailure,
) (json.RawMessage, error) {
	return json.Marshal(generationMessageOutcomeEnvelope{
		Version: generationOutcomeVersion,
		Type:    generationMessageOutcomeType,
		Failure: &failure,
	})
}

func replayGenerationMessageOutcome(
	raw json.RawMessage,
) (mediamcp.GenerationMessageOutput, error) {
	envelope := generationMessageOutcomeEnvelope{}
	if err := json.Unmarshal(raw, &envelope); err != nil ||
		envelope.Version != generationOutcomeVersion ||
		envelope.Type != generationMessageOutcomeType ||
		(envelope.Output == nil) == (envelope.Failure == nil) {
		return mediamcp.GenerationMessageOutput{}, generationConfirmationError(
			GenerationConfirmationOutcomeUnknown,
			"persisted generation outcome is invalid and cannot be replayed safely",
			err,
		)
	}
	if envelope.Failure != nil {
		if envelope.Failure.Code == "" || strings.TrimSpace(envelope.Failure.Message) == "" {
			return mediamcp.GenerationMessageOutput{}, generationConfirmationError(
				GenerationConfirmationOutcomeUnknown,
				"persisted generation failure is invalid and cannot be replayed safely",
				nil,
			)
		}
		return mediamcp.GenerationMessageOutput{}, generationConfirmationError(
			envelope.Failure.Code,
			envelope.Failure.Message,
			nil,
		)
	}
	return *envelope.Output, nil
}

func encodeGenerationBatchSuccessOutcome(
	output mediamcp.GenerationBatchOutput,
) (json.RawMessage, error) {
	return json.Marshal(generationBatchOutcomeEnvelope{
		Version: generationOutcomeVersion,
		Type:    generationBatchOutcomeType,
		Output:  &output,
	})
}

func encodeGenerationBatchFailureOutcome(
	failure generationOutcomeFailure,
) (json.RawMessage, error) {
	return json.Marshal(generationBatchOutcomeEnvelope{
		Version: generationOutcomeVersion,
		Type:    generationBatchOutcomeType,
		Failure: &failure,
	})
}

func replayGenerationBatchOutcome(
	raw json.RawMessage,
) (mediamcp.GenerationBatchOutput, error) {
	envelope := generationBatchOutcomeEnvelope{}
	if err := json.Unmarshal(raw, &envelope); err != nil ||
		envelope.Version != generationOutcomeVersion ||
		envelope.Type != generationBatchOutcomeType ||
		(envelope.Output == nil) == (envelope.Failure == nil) {
		return mediamcp.GenerationBatchOutput{}, generationConfirmationError(
			GenerationConfirmationOutcomeUnknown,
			"persisted generation batch outcome is invalid and cannot be replayed safely",
			err,
		)
	}
	if envelope.Failure != nil {
		if envelope.Failure.Code == "" || strings.TrimSpace(envelope.Failure.Message) == "" {
			return mediamcp.GenerationBatchOutput{}, generationConfirmationError(
				GenerationConfirmationOutcomeUnknown,
				"persisted generation batch failure is invalid and cannot be replayed safely",
				nil,
			)
		}
		return mediamcp.GenerationBatchOutput{}, generationConfirmationError(
			envelope.Failure.Code,
			envelope.Failure.Message,
			nil,
		)
	}
	return *envelope.Output, nil
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
				"generation_plan must contain exactly one generation_settings field and cannot mix other fields",
			)
		}
		return submittedGenerationSettingsPlan(record.Decision.Values, settingsField)
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

func submittedGenerationSettingsPlan(
	values map[string]any,
	field serviceselection.FormField,
) (submittedGenerationPlan, error) {
	fieldKind := strings.TrimSpace(field.Kind)
	if fieldKind != "image" && fieldKind != "video" {
		return submittedGenerationPlan{}, fmt.Errorf("generation_settings field %q requires kind=image or kind=video", field.ID)
	}
	value, err := submittedObjectValue(values, field)
	if err != nil {
		return submittedGenerationPlan{}, err
	}
	kind, ok := value["kind"].(string)
	if !ok || strings.TrimSpace(kind) != fieldKind {
		return submittedGenerationPlan{}, fmt.Errorf("submitted field %q requires kind=%s", field.ID, fieldKind)
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
		kind:               fieldKind,
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
	switch strings.ToLower(strings.TrimSpace(kind)) {
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
