// Package prompttemplates stores editable system prompt instructions.
package prompttemplates

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/official"
	"github.com/mediago-dev/mediago-drama/services/server/internal/config"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

const (
	sourceOfficial = "official"
	sourceUser     = "user"
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

// Repository supplies user instruction template override persistence.
type Repository interface {
	List(ctx context.Context) ([]domain.InstructionTemplateModel, error)
	Upsert(ctx context.Context, model domain.InstructionTemplateModel) error
	Delete(ctx context.Context, id string) error
}

// Service loads official system prompt instructions and saves user overrides.
type Service struct {
	repo    Repository
	initErr error
}

// NewService creates a prompt template service backed by the settings DB.
func NewService() *Service {
	repos, err := repository.OpenSettingsRepositories(config.DefaultSettingsDBPath())
	return NewServiceFromRepository(repos.Instructions, err)
}

// NewServiceWithSource is retained for compatibility with older tests and callers.
func NewServiceWithSource(_ fs.FS, _ string) *Service {
	return NewService()
}

// NewServiceWithStore creates a prompt template service with an explicit repository.
func NewServiceWithStore(repo Repository) *Service {
	return NewServiceFromRepository(repo, nil)
}

// NewServiceFromRepository creates a prompt template service from a repository.
func NewServiceFromRepository(repo Repository, initErr error) *Service {
	return &Service{repo: repo, initErr: initErr}
}

// Load returns editable system prompt instructions.
func (store *Service) Load(ctx context.Context) (map[string]PromptTemplate, error) {
	if err := store.ensureReady(); err != nil {
		return nil, err
	}
	instructions, err := official.Instructions(ctx)
	if err != nil {
		return nil, err
	}
	overrides, err := store.overrideMap(ctx)
	if err != nil {
		return nil, err
	}
	templates := map[string]PromptTemplate{}
	for _, instruction := range instructions {
		if !instruction.Editable {
			continue
		}
		var override *domain.InstructionTemplateModel
		if model, ok := overrides[instruction.ID]; ok {
			override = &model
		}
		templates[instruction.ID] = templateFromInstruction(instruction, override)
	}
	return templates, nil
}

// Get returns one resolved system prompt instruction.
func (store *Service) Get(ctx context.Context, id string) (PromptTemplate, error) {
	id = strings.TrimSpace(id)
	templates, err := store.Load(ctx)
	if err != nil {
		return PromptTemplate{}, err
	}
	template, ok := templates[id]
	if !ok {
		return PromptTemplate{}, fmt.Errorf("%w: template %q is not editable", ErrInvalidTemplate, id)
	}
	return template, nil
}

// Save validates and writes one prompt instruction as a user override.
func (store *Service) Save(ctx context.Context, id string, template PromptTemplate) (PromptTemplate, error) {
	if err := store.ensureReady(); err != nil {
		return PromptTemplate{}, err
	}
	id = strings.TrimSpace(id)
	if strings.TrimSpace(template.ID) == "" {
		template.ID = id
	}
	if err := validateTemplate(id, template); err != nil {
		return PromptTemplate{}, err
	}
	instruction, err := official.InstructionByID(ctx, id)
	if errors.Is(err, official.ErrInstructionNotFound) {
		return PromptTemplate{}, fmt.Errorf("%w: template %q is not editable", ErrInvalidTemplate, id)
	}
	if err != nil {
		return PromptTemplate{}, err
	}
	if !instruction.Editable {
		return PromptTemplate{}, fmt.Errorf("%w: template %q is not editable", ErrInvalidTemplate, id)
	}
	if err := store.repo.Upsert(ctx, domain.InstructionTemplateModel{
		ID:      id,
		Content: normalizeContent(template.Content),
	}); err != nil {
		return PromptTemplate{}, err
	}
	return store.Get(ctx, id)
}

// Reset removes one user prompt instruction override and restores the official default.
func (store *Service) Reset(ctx context.Context, id string) (PromptTemplate, error) {
	if err := store.ensureReady(); err != nil {
		return PromptTemplate{}, err
	}
	id = strings.TrimSpace(id)
	instruction, err := official.InstructionByID(ctx, id)
	if errors.Is(err, official.ErrInstructionNotFound) {
		return PromptTemplate{}, fmt.Errorf("%w: template %q cannot be reset", ErrInvalidTemplate, id)
	}
	if err != nil {
		return PromptTemplate{}, err
	}
	if !instruction.Editable {
		return PromptTemplate{}, fmt.Errorf("%w: template %q is not editable", ErrInvalidTemplate, id)
	}
	if err := store.repo.Delete(ctx, id); err != nil {
		return PromptTemplate{}, err
	}
	return templateFromInstruction(instruction, nil), nil
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

func (store *Service) ensureReady() error {
	if store == nil {
		return errors.New("prompt template service is nil")
	}
	if store.initErr != nil {
		return store.initErr
	}
	if store.repo == nil {
		return errors.New("prompt template repository is nil")
	}
	return nil
}

func (store *Service) overrideMap(ctx context.Context) (map[string]domain.InstructionTemplateModel, error) {
	models, err := store.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	overrides := make(map[string]domain.InstructionTemplateModel, len(models))
	for _, model := range models {
		overrides[strings.TrimSpace(model.ID)] = model
	}
	return overrides, nil
}

func templateFromInstruction(
	instruction official.Instruction,
	override *domain.InstructionTemplateModel,
) PromptTemplate {
	content := instruction.Body
	source := sourceOfficial
	overridden := false
	if override != nil {
		content = override.Content
		source = sourceUser
		overridden = true
	}
	return PromptTemplate{
		ID:          instruction.ID,
		Name:        instruction.Name,
		Description: instruction.Description,
		Content:     normalizeContent(content),
		Source:      source,
		Overridden:  overridden,
		Order:       instruction.Order,
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
