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
	// StatusTimeout is an output-only status returned to the caller when the
	// blocking wait elapses. It is never persisted; the record stays pending.
	StatusTimeout = "timeout"
)

// Blocking-wait bounds. The caller-supplied timeout is clamped to this range;
// DefaultTimeout applies when the caller gives no hint.
const (
	MinTimeout     = 30 * time.Second
	MaxTimeout     = 10 * time.Minute
	DefaultTimeout = 3 * time.Minute
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
	OptionID   string `json:"optionId,omitempty"`
	CustomText string `json:"customText,omitempty"`
	Cancelled  bool   `json:"cancelled,omitempty"`
}

// Record is the API/service shape of a persisted selection.
type Record struct {
	ID          string    `json:"id"`
	ProjectID   string    `json:"projectId,omitempty"`
	SessionID   string    `json:"sessionId,omitempty"`
	RunID       string    `json:"runId,omitempty"`
	Kind        string    `json:"kind,omitempty"`
	Title       string    `json:"title"`
	Prompt      string    `json:"prompt,omitempty"`
	Options     []Option  `json:"options"`
	AllowCustom bool      `json:"allowCustom"`
	Status      string    `json:"status"`
	Decision    *Decision `json:"decision,omitempty"`
	CreatedAt   string    `json:"createdAt"`
	DecidedAt   string    `json:"decidedAt,omitempty"`
	ExpiresAt   string    `json:"expiresAt,omitempty"`
}

// CreateRequest describes a new selection prompt.
type CreateRequest struct {
	SessionID      string
	RunID          string
	Kind           string
	Title          string
	Prompt         string
	Options        []Option
	AllowCustom    bool
	TimeoutSeconds int
}

// DecisionRequest decides a pending selection from HTTP handlers.
type DecisionRequest struct {
	OptionID   string `json:"optionId,omitempty"`
	CustomText string `json:"customText,omitempty"`
	Cancelled  bool   `json:"cancelled,omitempty"`
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
