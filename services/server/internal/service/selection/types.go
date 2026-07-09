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

// Form field types renderable by the client form card.
const (
	FieldTypeSelect = "select"
	FieldTypeToggle = "toggle"
	FieldTypeNumber = "number"
	FieldTypeText   = "text"
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
	// timeouts (codex kills MCP calls at ~120s); agents extend the wait by
	// looping await_user_selection instead of blocking longer.
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
var ErrWaitTimeout = errors.New("selection wait timed out")

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
	Description string            `json:"description,omitempty"`
	Options     []FormFieldOption `json:"options,omitempty"`
	Default     any               `json:"default,omitempty"`
	Min         *float64          `json:"min,omitempty"`
	Max         *float64          `json:"max,omitempty"`
	Unit        string            `json:"unit,omitempty"`
	Required    bool              `json:"required,omitempty"`
}

// Record is the API/service shape of a persisted selection.
type Record struct {
	ID          string      `json:"id"`
	ProjectID   string      `json:"projectId,omitempty"`
	SessionID   string      `json:"sessionId,omitempty"`
	RunID       string      `json:"runId,omitempty"`
	Kind        string      `json:"kind,omitempty"`
	Title       string      `json:"title"`
	Prompt      string      `json:"prompt,omitempty"`
	Options     []Option    `json:"options"`
	Fields      []FormField `json:"fields,omitempty"`
	AllowCustom bool        `json:"allowCustom"`
	Status      string      `json:"status"`
	Decision    *Decision   `json:"decision,omitempty"`
	CreatedAt   string      `json:"createdAt"`
	DecidedAt   string      `json:"decidedAt,omitempty"`
	ExpiresAt   string      `json:"expiresAt,omitempty"`
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
	AllowCustom    bool
	TimeoutSeconds int
}

// DecisionRequest decides a pending selection from HTTP handlers.
type DecisionRequest struct {
	OptionID   string         `json:"optionId,omitempty"`
	CustomText string         `json:"customText,omitempty"`
	Cancelled  bool           `json:"cancelled,omitempty"`
	Values     map[string]any `json:"values,omitempty"`
}

// Service owns agent selection prompts.
type Service struct {
	mu      sync.RWMutex
	repo    *repository.AgentSelectionRepository
	initErr error
}

// NewService returns a selection service backed by a repository.
func NewService(repo *repository.AgentSelectionRepository, initErr error) *Service {
	service := &Service{repo: repo, initErr: initErr}
	if service.initErr == nil && service.repo == nil {
		service.initErr = fmt.Errorf("agent selection repository is nil")
	}
	return service
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
		ID:          model.ID,
		ProjectID:   model.ProjectID,
		SessionID:   model.SessionID,
		RunID:       model.RunID,
		Kind:        model.Kind,
		Title:       model.Title,
		Prompt:      model.Prompt,
		AllowCustom: model.AllowCustom,
		Status:      model.Status,
		CreatedAt:   domain.StringFromTime(model.CreatedAt),
		DecidedAt:   domain.StringFromTime(timePtrValue(model.DecidedAt)),
		ExpiresAt:   domain.StringFromTime(timePtrValue(model.ExpiresAt)),
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

func timePtrValue(value *time.Time) time.Time {
	if value == nil {
		return time.Time{}
	}
	return *value
}

func isNotFound(err error) bool {
	return errors.Is(err, repository.ErrRecordNotFound)
}
