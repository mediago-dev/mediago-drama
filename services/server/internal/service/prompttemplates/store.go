// Package prompttemplates stores editable system prompt instructions.
package prompttemplates

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
)

// ErrInvalidTemplate reports an invalid prompt template payload.
var ErrInvalidTemplate = errors.New("invalid prompt template")

// PromptTemplate describes an editable system prompt template.
type PromptTemplate struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Content     string `json:"content"`
	Source      string `json:"source"`
	Overridden  bool   `json:"overridden,omitempty"`
	Order       int    `json:"-"`
}

// PackStore supplies prompt instruction persistence.
type PackStore interface {
	ListEntries(ctx context.Context, kind instructionpack.Kind) ([]promptpack.Entry, error)
	GetEntry(ctx context.Context, kind instructionpack.Kind, slug string) (promptpack.Entry, error)
	SaveEntry(ctx context.Context, kind instructionpack.Kind, slug string, entry promptpack.Entry) (promptpack.Entry, error)
	ResetEntry(ctx context.Context, kind instructionpack.Kind, slug string) (promptpack.Entry, error)
}

// Service loads and saves editable system prompt instructions.
type Service struct {
	store PackStore
}

// NewService creates a prompt template service backed by the global prompt pack store.
func NewService() *Service {
	return NewServiceWithStore(promptpack.NewService())
}

// NewServiceWithSource is retained for compatibility with older tests and callers.
func NewServiceWithSource(_ fs.FS, _ string) *Service {
	return NewService()
}

// NewServiceWithStore creates a prompt template service with an explicit pack store.
func NewServiceWithStore(store PackStore) *Service {
	return &Service{store: store}
}

// Load returns editable system prompt instructions.
func (store *Service) Load(ctx context.Context) (map[string]PromptTemplate, error) {
	if store == nil || store.store == nil {
		return nil, errors.New("prompt template store is nil")
	}
	entries, err := store.store.ListEntries(ctx, instructionpack.KindInstruction)
	if err != nil {
		return nil, err
	}
	templates := map[string]PromptTemplate{}
	for _, entry := range entries {
		if !metadataBool(entry.Metadata, "editable") {
			continue
		}
		templates[entry.Slug] = templateFromEntry(entry)
	}
	return templates, nil
}

// Save validates and writes one prompt instruction as a user override.
func (store *Service) Save(ctx context.Context, id string, template PromptTemplate) (PromptTemplate, error) {
	if store == nil || store.store == nil {
		return PromptTemplate{}, errors.New("prompt template store is nil")
	}
	id = strings.TrimSpace(id)
	if strings.TrimSpace(template.ID) == "" {
		template.ID = id
	}
	if err := validateTemplate(id, template); err != nil {
		return PromptTemplate{}, err
	}
	current, err := store.store.GetEntry(ctx, instructionpack.KindInstruction, id)
	if errors.Is(err, promptpack.ErrEntryNotFound) {
		return PromptTemplate{}, fmt.Errorf("%w: template %q is not editable", ErrInvalidTemplate, id)
	}
	if err != nil {
		return PromptTemplate{}, err
	}
	if !metadataBool(current.Metadata, "editable") {
		return PromptTemplate{}, fmt.Errorf("%w: template %q is not editable", ErrInvalidTemplate, id)
	}
	current.Body = normalizeContent(template.Content)
	current.Name = nonEmpty(current.Name, template.Name)
	current.Title = nonEmpty(current.Title, template.Name)
	saved, err := store.store.SaveEntry(ctx, instructionpack.KindInstruction, id, current)
	if err != nil {
		return PromptTemplate{}, err
	}
	return templateFromEntry(saved), nil
}

// Reset restores one prompt instruction from its installed prompt pack.
func (store *Service) Reset(ctx context.Context, id string) (PromptTemplate, error) {
	if store == nil || store.store == nil {
		return PromptTemplate{}, errors.New("prompt template store is nil")
	}
	id = strings.TrimSpace(id)
	reset, err := store.store.ResetEntry(ctx, instructionpack.KindInstruction, id)
	if errors.Is(err, promptpack.ErrEntryNotFound) || errors.Is(err, promptpack.ErrPackReadonly) {
		return PromptTemplate{}, fmt.Errorf("%w: template %q cannot be reset", ErrInvalidTemplate, id)
	}
	if err != nil {
		return PromptTemplate{}, err
	}
	if !metadataBool(reset.Metadata, "editable") {
		return PromptTemplate{}, fmt.Errorf("%w: template %q is not editable", ErrInvalidTemplate, id)
	}
	return templateFromEntry(reset), nil
}

// OrderedTemplates returns prompt templates in system prompt assembly order.
func OrderedTemplates(templateMap map[string]PromptTemplate) []PromptTemplate {
	templates := make([]PromptTemplate, 0, len(templateMap))
	for _, template := range templateMap {
		templates = append(templates, template)
	}
	sort.SliceStable(templates, func(first, second int) bool {
		if templates[first].Order != templates[second].Order {
			return templates[first].Order < templates[second].Order
		}
		return templates[first].ID < templates[second].ID
	})
	return templates
}

func templateFromEntry(entry promptpack.Entry) PromptTemplate {
	name := nonEmpty(entry.Title, entry.Name)
	return PromptTemplate{
		ID:          entry.Slug,
		Name:        name,
		Description: entry.Description,
		Content:     normalizeContent(entry.Body),
		Source:      entry.Source,
		Overridden:  entry.Source == "user" && entry.OverriddenFrom != "",
		Order:       metadataInt(entry.Metadata, "order"),
	}
}

func validateTemplate(id string, template PromptTemplate) error {
	if !isSafeTemplateID(id) {
		return fmt.Errorf("%w: template id is required", ErrInvalidTemplate)
	}
	if strings.TrimSpace(template.ID) != id {
		return fmt.Errorf("%w: template id must match path id %q", ErrInvalidTemplate, id)
	}
	if strings.TrimSpace(template.Content) == "" {
		return fmt.Errorf("%w: content is required", ErrInvalidTemplate)
	}
	return nil
}

func normalizeContent(content string) string {
	text := strings.TrimSpace(strings.ReplaceAll(content, "\r\n", "\n"))
	if text == "" {
		return ""
	}
	return text + "\n"
}

func metadataBool(metadata map[string]any, key string) bool {
	value, ok := metadata[key]
	if !ok || value == nil {
		return false
	}
	typed, ok := value.(bool)
	return ok && typed
}

func metadataInt(metadata map[string]any, key string) int {
	value, ok := metadata[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case int:
		return typed
	case float64:
		return int(typed)
	default:
		return 0
	}
}

func isSafeTemplateID(id string) bool {
	id = strings.TrimSpace(id)
	if id == "" || id == "." || id == ".." || strings.ContainsAny(id, `/\`) {
		return false
	}
	for index, char := range id {
		valid := char >= 'a' && char <= 'z' ||
			char >= 'A' && char <= 'Z' ||
			char >= '0' && char <= '9' ||
			char == '-' ||
			char == '_'
		if !valid {
			return false
		}
		if index == 0 && (char == '-' || char == '_') {
			return false
		}
	}
	return true
}

func nonEmpty(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return strings.TrimSpace(fallback)
	}
	return value
}
