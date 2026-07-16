// Package selection implements agent-driven user selection prompts: the agent
// asks the user to pick one of several options (e.g. a style recommendation
// grid) through an A2UI card, blocks on the decision, and resumes with the
// chosen option. Decisions persist so a late click is still retrievable after
// the blocking wait returns.
package selection

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

// Selection lifecycle statuses.
const (
	StatusPending   = "pending"
	StatusSelected  = "selected"
	StatusCustom    = "custom"
	StatusCancelled = "cancelled"
	StatusExpired   = "expired"
	// StatusSubmitted records a form submission (field values in Decision.Values).
	StatusSubmitted = "submitted"
	// StatusTimeout is an output-only status returned to the caller when the
	// blocking wait elapses. It is never persisted; the record stays pending.
	StatusTimeout = "timeout"
)

// Selection kinds with a server-enforced field contract.
const (
	// KindGenerationPlan is the canonical media-generation confirmation form.
	// Image and video plans use one generation_settings snapshot. Historical
	// video plans may still use generation_params plus optional legacy fields.
	KindGenerationPlan = "generation_plan"
)

// Generation intent protocol constants.
const (
	// GenerationPlanIntentVersion is the only intent schema version currently accepted.
	GenerationPlanIntentVersion = 1
	// GenerationPlanOperationCreateSingle authorizes one new media request.
	GenerationPlanOperationCreateSingle = "create_single"
	// GenerationPlanOperationCreateBatch authorizes one ordered media batch.
	GenerationPlanOperationCreateBatch = "create_batch"
	// MaxGenerationPlanIntentItems bounds one generation batch authorization.
	MaxGenerationPlanIntentItems = 50
	// MaxGenerationPlanIntentJSONBytes bounds the persisted canonical intent.
	MaxGenerationPlanIntentJSONBytes = 1 << 20
	// MaxGenerationOutcomeJSONBytes bounds one persisted replay outcome.
	MaxGenerationOutcomeJSONBytes = 1 << 20
)

// Form field types renderable by the client form card.
const (
	FieldTypeSelect = "select"
	FieldTypeToggle = "toggle"
	FieldTypeNumber = "number"
	FieldTypeText   = "text"
	// FieldTypeGenerationSettings is the complete media-generation form value:
	// route/params, reference assets, prompt supplements, and prompt optimization
	// are confirmed and submitted as one immutable snapshot.
	FieldTypeGenerationSettings = "generation_settings"
	// FieldTypeGenerationParams is a composite generation-parameter picker: the
	// client renders the configured model catalog (family → model → provider)
	// plus that route's aspect-ratio/resolution/count controls, and submits
	// {"routeId": string, "params": {...}}. The agent supplies no options.
	FieldTypeGenerationParams = "generation_params"
	// FieldTypeImages lets the user attach reference images: upload new files
	// or keep agent-prefilled defaults. The submitted value is a deduplicated
	// array of media asset ids; Max bounds the count. The client resolves ids
	// to thumbnails, the server validates shape only — bad ids surface when
	// generate_media resolves references.
	FieldTypeImages = "images"
	// FieldTypePromptOptimization is a composite prompt-optimization picker:
	// an on/off switch plus, when on, a text-model route and a prompt-library
	// package (mirroring the generation workbench control). The submitted
	// value is {"enabled": bool} or {"enabled": true, "routeId", "label",
	// "referenceId", "referenceName", "referencePrompt"}; the agent maps an
	// enabled value onto generate_media's promptOptimization input.
	FieldTypePromptOptimization = "prompt_optimization"
)

// Blocking-wait bounds. The caller-supplied timeout is clamped to this range;
// DefaultTimeout applies when the caller gives no hint.
const (
	MinTimeout = 30 * time.Second
	MaxTimeout = 10 * time.Minute
	// DefaultTimeout keeps one blocking wait under ACP client tool-call
	// timeouts (codex kills MCP calls at ~120s). Reaching this transport window
	// is not a user decision: agents keep waiting on the same selection by
	// calling await_user_selection again.
	DefaultTimeout = 90 * time.Second
	// RetrieveTTL is how long a pending selection stays claimable after
	// creation. It is deliberately longer than MaxTimeout so a decision that
	// arrives after the blocking wait returns can still be recorded and
	// retrieved before the sweep marks the selection expired.
	RetrieveTTL = 30 * time.Minute
	// defaultPollInterval is the WaitForSelection DB poll cadence.
	defaultPollInterval = time.Second
)

// ErrWaitTimeout is returned by WaitForSelection when the blocking window
// elapses before the user decides. The selection stays pending, so the caller
// can surface a timeout sentinel while the decision remains retrievable.
var (
	ErrWaitTimeout = errors.New("selection wait timed out")
	// ErrInvalidGenerationPlan reports a generation_plan form that does not use
	// the catalog-backed composite field contract.
	ErrInvalidGenerationPlan = errors.New("invalid generation_plan form")
	// ErrInvalidGenerationPlanIntent reports a malformed or unsupported
	// versioned generation intent attached to a selection.
	ErrInvalidGenerationPlanIntent = errors.New("invalid generation plan intent")
	// ErrGenerationUseNotAuthorized reports that a selection does not authorize
	// a generation use in the supplied project/session/run context.
	ErrGenerationUseNotAuthorized = errors.New("generation use is not authorized")
	// ErrGenerationUseConflict reports an attempt to overwrite an outcome or
	// otherwise reuse a claim with incompatible data.
	ErrGenerationUseConflict = errors.New("generation use conflicts with the existing claim")
	// ErrInvalidGenerationOutcome reports a non-versioned replay outcome.
	ErrInvalidGenerationOutcome = errors.New("invalid generation outcome")
)

// Generation use claim results.
const (
	GenerationUseClaimed             = "claimed"
	GenerationUseReplay              = "replay"
	GenerationUseInProgressOrUnknown = "in_progress_or_unknown"
	GenerationUseConflict            = "conflict"
)

// Option is one selectable choice presented to the user.
type Option struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	ImageURL    string `json:"imageUrl,omitempty"`
	Description string `json:"description,omitempty"`
}

// Decision is the recorded outcome of a selection.
type Decision struct {
	OptionID   string         `json:"optionId,omitempty"`
	CustomText string         `json:"customText,omitempty"`
	Cancelled  bool           `json:"cancelled,omitempty"`
	Values     map[string]any `json:"values,omitempty"`
}

// FormFieldOption is one choice of a select form field.
type FormFieldOption struct {
	Value       string `json:"value"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

// FormField is one typed input on a form prompt.
type FormField struct {
	ID          string            `json:"id"`
	Label       string            `json:"label"`
	Type        string            `json:"type"`
	Kind        string            `json:"kind,omitempty"`
	Description string            `json:"description,omitempty"`
	Options     []FormFieldOption `json:"options,omitempty"`
	Default     any               `json:"default,omitempty"`
	Min         *float64          `json:"min,omitempty"`
	Max         *float64          `json:"max,omitempty"`
	Unit        string            `json:"unit,omitempty"`
	Required    bool              `json:"required,omitempty"`
}

// GenerationPlanIntent is the immutable, versioned generation operation shown
// to the user alongside editable generation settings.
type GenerationPlanIntent struct {
	Version           int                        `json:"version"`
	Operation         string                     `json:"operation"`
	ConversationTitle string                     `json:"conversationTitle,omitempty"`
	Items             []GenerationPlanIntentItem `json:"items"`
}

// GenerationPlanIntentItem is one ordered generation target authorized by a
// generation plan.
type GenerationPlanIntentItem struct {
	ID                 string                        `json:"id"`
	Kind               string                        `json:"kind"`
	Prompt             string                        `json:"prompt"`
	AssetTitle         string                        `json:"assetTitle,omitempty"`
	CapabilityID       string                        `json:"capabilityId,omitempty"`
	ConversationID     string                        `json:"sessionId,omitempty"`
	ScopeID            string                        `json:"scopeId,omitempty"`
	DocumentID         string                        `json:"documentId,omitempty"`
	SectionID          string                        `json:"sectionId,omitempty"`
	DocumentContext    *GenerationDocumentContext    `json:"documentContext,omitempty"`
	ResourceType       string                        `json:"resourceType,omitempty"`
	ReferenceAssetIDs  []string                      `json:"referenceAssetIds,omitempty"`
	NotificationTarget *GenerationNotificationTarget `json:"notificationTarget,omitempty"`
}

// GenerationDocumentContext identifies a source document section bound to an
// intent item.
type GenerationDocumentContext struct {
	ProjectID  string `json:"projectId,omitempty"`
	DocumentID string `json:"documentId,omitempty"`
	SectionID  string `json:"sectionId,omitempty"`
}

// GenerationNotificationSectionTarget identifies the document section opened
// by a generation notification.
type GenerationNotificationSectionTarget struct {
	BlockID           string `json:"blockId"`
	DocumentID        string `json:"documentId"`
	HeadingLevel      int    `json:"headingLevel"`
	HeadingOccurrence int    `json:"headingOccurrence"`
	HeadingText       string `json:"headingText"`
	Markdown          string `json:"markdown"`
	PlainText         string `json:"plainText"`
	Prompt            string `json:"prompt"`
}

// GenerationNotificationTarget identifies where a generation completion
// notification should open.
type GenerationNotificationTarget struct {
	Kind          string                              `json:"kind"`
	ProjectID     string                              `json:"projectId,omitempty"`
	DocumentID    string                              `json:"documentId,omitempty"`
	DocumentTitle string                              `json:"documentTitle,omitempty"`
	Section       GenerationNotificationSectionTarget `json:"section"`
}

// GenerationUseClaimResult reports whether a generation request acquired the
// single-use claim, should replay a completed result, or must not proceed.
type GenerationUseClaimResult struct {
	Status  string          `json:"status"`
	Outcome json.RawMessage `json:"outcome,omitempty"`
}

// Record is the API/service shape of a persisted selection.
type Record struct {
	ID                         string                `json:"id"`
	ProjectID                  string                `json:"projectId,omitempty"`
	SessionID                  string                `json:"sessionId,omitempty"`
	RunID                      string                `json:"runId,omitempty"`
	Kind                       string                `json:"kind,omitempty"`
	Title                      string                `json:"title"`
	Prompt                     string                `json:"prompt,omitempty"`
	Options                    []Option              `json:"options"`
	Fields                     []FormField           `json:"fields,omitempty"`
	Intent                     *GenerationPlanIntent `json:"intent,omitempty"`
	AllowCustom                bool                  `json:"allowCustom"`
	Status                     string                `json:"status"`
	Decision                   *Decision             `json:"decision,omitempty"`
	GenerationClaimFingerprint string                `json:"-"`
	GenerationClaimedAt        string                `json:"-"`
	GenerationOutcome          json.RawMessage       `json:"-"`
	GenerationCompletedAt      string                `json:"-"`
	CreatedAt                  string                `json:"createdAt"`
	DecidedAt                  string                `json:"decidedAt,omitempty"`
	ExpiresAt                  string                `json:"expiresAt,omitempty"`
}

// CreateRequest describes a new selection prompt.
type CreateRequest struct {
	SessionID      string
	RunID          string
	Kind           string
	Title          string
	Prompt         string
	Options        []Option
	Fields         []FormField
	Intent         *GenerationPlanIntent
	AllowCustom    bool
	TimeoutSeconds int
}

// ReuseRequest identifies an existing prompt that a repeated ask may reuse.
// It carries the full form or option contract so distinct questions never
// collapse into one card merely because their run, kind, and title match.
type ReuseRequest struct {
	SessionID   string
	RunID       string
	Kind        string
	Title       string
	Prompt      string
	Options     []Option
	Fields      []FormField
	Intent      *GenerationPlanIntent
	AllowCustom bool
}

// DecisionRequest decides a pending selection from HTTP handlers.
type DecisionRequest struct {
	OptionID   string         `json:"optionId,omitempty"`
	CustomText string         `json:"customText,omitempty"`
	Cancelled  bool           `json:"cancelled,omitempty"`
	Values     map[string]any `json:"values,omitempty"`
}

// RunDecisionGuard serializes a selection decision with authoritative agent
// run state. Implementations must keep the reported run status stable until
// callback returns; this prevents a cancellation from racing a late submit.
type RunDecisionGuard interface {
	WithRunStatus(sessionID string, runID string, callback func(status string, found bool) error) error
}

// Service owns agent selection prompts.
type Service struct {
	mu               sync.RWMutex
	repo             *repository.AgentSelectionRepository
	initErr          error
	runDecisionGuard RunDecisionGuard
}

// NewService returns a selection service backed by a repository.
func NewService(repo *repository.AgentSelectionRepository, initErr error) *Service {
	service := &Service{repo: repo, initErr: initErr}
	if service.initErr == nil && service.repo == nil {
		service.initErr = fmt.Errorf("agent selection repository is nil")
	}
	return service
}

// SetRunDecisionGuard attaches authoritative agent-run state to decision
// validation. It should be configured during application wiring before the
// service accepts requests.
func (service *Service) SetRunDecisionGuard(guard RunDecisionGuard) {
	if service == nil {
		return
	}
	service.mu.Lock()
	defer service.mu.Unlock()
	service.runDecisionGuard = guard
}

// ClampTimeout bounds a caller-supplied blocking timeout to [MinTimeout, MaxTimeout].
func ClampTimeout(requested time.Duration) time.Duration {
	if requested <= 0 {
		requested = DefaultTimeout
	}
	if requested < MinTimeout {
		return MinTimeout
	}
	if requested > MaxTimeout {
		return MaxTimeout
	}
	return requested
}

func recordFromModel(model domain.AgentSelectionModel) (Record, error) {
	record := Record{
		ID:                         model.ID,
		ProjectID:                  model.ProjectID,
		SessionID:                  model.SessionID,
		RunID:                      model.RunID,
		Kind:                       model.Kind,
		Title:                      model.Title,
		Prompt:                     model.Prompt,
		AllowCustom:                model.AllowCustom,
		Status:                     model.Status,
		GenerationClaimFingerprint: model.GenerationClaimFingerprint,
		GenerationClaimedAt:        domain.StringFromTime(timePtrValue(model.GenerationClaimedAt)),
		GenerationCompletedAt:      domain.StringFromTime(timePtrValue(model.GenerationCompletedAt)),
		CreatedAt:                  domain.StringFromTime(model.CreatedAt),
		DecidedAt:                  domain.StringFromTime(timePtrValue(model.DecidedAt)),
		ExpiresAt:                  domain.StringFromTime(timePtrValue(model.ExpiresAt)),
	}
	if strings.TrimSpace(model.GenerationOutcomeJSON) != "" {
		outcome, err := normalizeGenerationOutcome(json.RawMessage(model.GenerationOutcomeJSON))
		if err != nil {
			return Record{}, fmt.Errorf("decoding selection generation outcome: %w", err)
		}
		record.GenerationOutcome = outcome
	}
	if strings.TrimSpace(model.IntentJSON) != "" {
		intent, err := decodeGenerationPlanIntent(model.IntentJSON, model.ProjectID)
		if err != nil {
			return Record{}, fmt.Errorf("decoding selection intent: %w", err)
		}
		record.Intent = intent
	}
	if strings.TrimSpace(model.OptionsJSON) != "" {
		if err := json.Unmarshal([]byte(model.OptionsJSON), &record.Options); err != nil {
			return Record{}, fmt.Errorf("decoding selection options: %w", err)
		}
	}
	if record.Options == nil {
		record.Options = []Option{}
	}
	if strings.TrimSpace(model.FieldsJSON) != "" {
		if err := json.Unmarshal([]byte(model.FieldsJSON), &record.Fields); err != nil {
			return Record{}, fmt.Errorf("decoding selection fields: %w", err)
		}
	}
	if strings.TrimSpace(model.DecisionJSON) != "" {
		decision := Decision{}
		if err := json.Unmarshal([]byte(model.DecisionJSON), &decision); err != nil {
			return Record{}, fmt.Errorf("decoding selection decision: %w", err)
		}
		record.Decision = &decision
	}
	return record, nil
}

func encodeGenerationPlanIntent(intent *GenerationPlanIntent) (string, error) {
	if intent == nil {
		return "", nil
	}
	if intent.Version != GenerationPlanIntentVersion {
		return "", fmt.Errorf("%w: unsupported version %d", ErrInvalidGenerationPlanIntent, intent.Version)
	}
	raw, err := json.Marshal(intent)
	if err != nil {
		return "", fmt.Errorf("%w: encoding: %v", ErrInvalidGenerationPlanIntent, err)
	}
	if len(raw) > MaxGenerationPlanIntentJSONBytes {
		return "", fmt.Errorf(
			"%w: encoded size %d exceeds %d bytes",
			ErrInvalidGenerationPlanIntent,
			len(raw),
			MaxGenerationPlanIntentJSONBytes,
		)
	}
	return string(raw), nil
}

func decodeGenerationPlanIntent(raw string, projectID string) (*GenerationPlanIntent, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	if len([]byte(raw)) > MaxGenerationPlanIntentJSONBytes {
		return nil, fmt.Errorf(
			"%w: encoded size %d exceeds %d bytes",
			ErrInvalidGenerationPlanIntent,
			len([]byte(raw)),
			MaxGenerationPlanIntentJSONBytes,
		)
	}
	intent := &GenerationPlanIntent{}
	if err := json.Unmarshal([]byte(raw), intent); err != nil {
		return nil, fmt.Errorf("%w: decoding: %v", ErrInvalidGenerationPlanIntent, err)
	}
	return normalizeGenerationPlanIntent(projectID, intent)
}

func timePtrValue(value *time.Time) time.Time {
	if value == nil {
		return time.Time{}
	}
	return *value
}

func isNotFound(err error) bool {
	return errors.Is(err, repository.ErrRecordNotFound)
}
