// Package prompttemplates stores editable system prompt templates.
package prompttemplates

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	configassets "github.com/torchstellar-team/mediago-drama/packages/server/configs"
	serviceprompt "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/prompt"
)

const embeddedTemplatesDir = "templates/prompts"

// ErrInvalidTemplate reports an invalid prompt template payload.
var ErrInvalidTemplate = errors.New("invalid prompt template")

// PromptTemplate describes an editable system prompt template.
type PromptTemplate struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Content     string `json:"content"`
}

// Service loads embedded prompt templates and persists source edits.
type Service struct {
	mu        sync.RWMutex
	defaults  fs.FS
	sourceDir string
}

// NewService creates a prompt template service backed by the repository configs directory.
func NewService() *Service {
	return NewServiceWithSource(configassets.PromptTemplates, configassets.SourceTemplateDir("prompts"))
}

// NewServiceWithSource creates a prompt template service with explicit defaults and source path.
func NewServiceWithSource(defaults fs.FS, sourceDir string) *Service {
	return &Service{
		defaults:  defaults,
		sourceDir: strings.TrimSpace(sourceDir),
	}
}

// Load returns editable system prompt templates.
func (store *Service) Load(ctx context.Context) (map[string]PromptTemplate, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	templates, err := loadTemplateFS(ctx, store.defaults, embeddedTemplatesDir)
	if err != nil {
		return nil, fmt.Errorf("loading embedded prompt templates: %w", err)
	}

	if err := archiveLegacyPromptTemplates(ctx, store.sourceDir); err != nil {
		return nil, err
	}
	diskTemplates, err := loadTemplateDir(ctx, store.sourceDir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return editableTemplates(templates), nil
		}
		return nil, fmt.Errorf("loading prompt templates from disk: %w", err)
	}
	for id, template := range diskTemplates {
		templates[id] = template
	}

	return editableTemplates(templates), nil
}

// Save validates and writes one prompt template to the source configs directory.
func (store *Service) Save(ctx context.Context, id string, template PromptTemplate) (PromptTemplate, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	if err := ctxErr(ctx); err != nil {
		return PromptTemplate{}, err
	}
	if err := validateTemplate(id, template); err != nil {
		return PromptTemplate{}, err
	}
	template = normalizeTemplate(template)

	if err := os.MkdirAll(store.sourceDir, 0o755); err != nil {
		return PromptTemplate{}, fmt.Errorf("creating prompt templates directory: %w", err)
	}
	path := filepath.Join(store.sourceDir, strings.TrimSpace(id)+".md")
	if err := os.WriteFile(path, []byte(template.Content), 0o644); err != nil {
		return PromptTemplate{}, fmt.Errorf("writing prompt template %s: %w", id, err)
	}
	serviceprompt.InvalidateTemplateCache(id)
	return template, nil
}

// OrderedTemplates returns prompt templates in system prompt assembly order.
func OrderedTemplates(templateMap map[string]PromptTemplate) []PromptTemplate {
	templates := make([]PromptTemplate, 0, len(templateMap))
	for _, template := range templateMap {
		templates = append(templates, template)
	}
	sort.SliceStable(templates, func(first, second int) bool {
		firstOrder, firstKnown := templateOrder(templates[first].ID)
		secondOrder, secondKnown := templateOrder(templates[second].ID)
		if firstKnown != secondKnown {
			return firstKnown
		}
		if firstOrder != secondOrder {
			return firstOrder < secondOrder
		}
		return templates[first].ID < templates[second].ID
	})
	return templates
}

func loadTemplateFS(ctx context.Context, filesystem fs.FS, root string) (map[string]PromptTemplate, error) {
	if err := ctxErr(ctx); err != nil {
		return nil, err
	}

	entries, err := fs.ReadDir(filesystem, root)
	if err != nil {
		return nil, err
	}

	templates := map[string]PromptTemplate{}
	for _, entry := range entries {
		if err := ctxErr(ctx); err != nil {
			return nil, err
		}
		if entry.IsDir() || !isTemplateFilename(entry.Name()) {
			continue
		}
		path := filepath.ToSlash(filepath.Join(root, entry.Name()))
		data, err := fs.ReadFile(filesystem, path)
		if err != nil {
			return nil, err
		}
		template := decodeTemplate(data, templateIDFromFilename(entry.Name()))
		templates[template.ID] = template
	}
	if len(templates) == 0 {
		return nil, fs.ErrNotExist
	}
	return templates, nil
}

func loadTemplateDir(ctx context.Context, dir string) (map[string]PromptTemplate, error) {
	if err := ctxErr(ctx); err != nil {
		return nil, err
	}
	if strings.TrimSpace(dir) == "" {
		return nil, fs.ErrNotExist
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	templates := map[string]PromptTemplate{}
	for _, entry := range entries {
		if err := ctxErr(ctx); err != nil {
			return nil, err
		}
		if entry.IsDir() || !isTemplateFilename(entry.Name()) {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, err
		}
		template := decodeTemplate(data, templateIDFromFilename(entry.Name()))
		templates[template.ID] = template
	}
	return templates, nil
}

func decodeTemplate(data []byte, id string) PromptTemplate {
	template := PromptTemplate{
		ID:      id,
		Content: normalizeContent(string(data)),
	}
	if descriptor, ok := serviceprompt.SectionDescriptorByID(id); ok {
		template.Name = descriptor.Name
		template.Description = descriptor.Description
	} else {
		template.Name = fallbackTemplateName(id)
	}
	return template
}

func validateTemplate(id string, template PromptTemplate) error {
	id = strings.TrimSpace(id)
	if !isSafeTemplateID(id) {
		return fmt.Errorf("%w: template id is required", ErrInvalidTemplate)
	}
	if strings.TrimSpace(template.ID) != id {
		return fmt.Errorf("%w: template id must match path id %q", ErrInvalidTemplate, id)
	}
	if !isEditableTemplateID(id) {
		return fmt.Errorf("%w: template %q is not editable", ErrInvalidTemplate, id)
	}
	if strings.TrimSpace(template.Content) == "" {
		return fmt.Errorf("%w: content is required", ErrInvalidTemplate)
	}
	return nil
}

func normalizeTemplate(template PromptTemplate) PromptTemplate {
	template = decodeTemplate([]byte(template.Content), strings.TrimSpace(template.ID))
	return template
}

func normalizeContent(content string) string {
	text := strings.TrimSpace(strings.ReplaceAll(content, "\r\n", "\n"))
	return text + "\n"
}

func fallbackTemplateName(id string) string {
	words := strings.Split(strings.ReplaceAll(id, "-", "_"), "_")
	for index, word := range words {
		if word == "" {
			continue
		}
		words[index] = strings.ToUpper(word[:1]) + word[1:]
	}
	return strings.Join(words, " ")
}

func isSafeTemplateID(id string) bool {
	return id != "" && id != "." && id != ".." && filepath.Base(id) == id && !strings.Contains(id, "\\")
}

func templateIDFromFilename(filename string) string {
	return strings.TrimSuffix(filename, ".md")
}

func isTemplateFilename(filename string) bool {
	return strings.HasSuffix(filename, ".md")
}

func archiveLegacyPromptTemplates(ctx context.Context, dir string) error {
	if err := ctxErr(ctx); err != nil {
		return err
	}
	if strings.TrimSpace(dir) == "" {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("reading prompt template overrides: %w", err)
	}
	for _, entry := range entries {
		if err := ctxErr(ctx); err != nil {
			return err
		}
		if entry.IsDir() || !isLegacyTemplateID(templateIDFromFilename(entry.Name())) {
			continue
		}
		sourcePath := filepath.Join(dir, entry.Name())
		legacyDir := filepath.Join(dir, "legacy")
		if err := os.MkdirAll(legacyDir, 0o755); err != nil {
			return fmt.Errorf("creating legacy prompt template directory: %w", err)
		}
		targetPath := nextLegacyTemplatePath(legacyDir, entry.Name())
		if err := os.Rename(sourcePath, targetPath); err != nil {
			return fmt.Errorf("archiving legacy prompt template %s: %w", entry.Name(), err)
		}
		slog.Warn("legacy prompt template override archived", "source", sourcePath, "target", targetPath)
	}
	return nil
}

func nextLegacyTemplatePath(dir string, filename string) string {
	path := filepath.Join(dir, filename)
	if _, err := os.Stat(path); errors.Is(err, fs.ErrNotExist) {
		return path
	}
	extension := filepath.Ext(filename)
	base := strings.TrimSuffix(filename, extension)
	for index := 1; ; index++ {
		candidate := filepath.Join(dir, fmt.Sprintf("%s.%d%s", base, index, extension))
		if _, err := os.Stat(candidate); errors.Is(err, fs.ErrNotExist) {
			return candidate
		}
	}
}

func isLegacyTemplateID(id string) bool {
	_, ok := legacyTemplateIDs[id]
	return ok
}

func editableTemplates(templateMap map[string]PromptTemplate) map[string]PromptTemplate {
	templates := map[string]PromptTemplate{}
	for _, descriptor := range serviceprompt.EditableSectionDescriptors() {
		if template, ok := templateMap[descriptor.ID]; ok {
			templates[descriptor.ID] = template
		}
	}
	return templates
}

func templateOrder(id string) (int, bool) {
	descriptor, ok := serviceprompt.SectionDescriptorByID(id)
	if !ok {
		return 0, false
	}
	return descriptor.Order, true
}

func isEditableTemplateID(id string) bool {
	descriptor, ok := serviceprompt.SectionDescriptorByID(id)
	return ok && descriptor.Editable
}

var legacyTemplateIDs = map[string]struct{}{
	"role_persona":               {},
	"project_brief":              {},
	"tool_usage_rules":           {},
	"writing_strategy":           {},
	"category_screenplay":        {},
	"category_character":         {},
	"category_scene":             {},
	"category_storyboard":        {},
	"workflow_gate":              {},
	"project_document_tree":      {},
	"document_templates_catalog": {},
	"focused_document":           {},
	"scoped_edit":                {},
	"editor_state_snapshot":      {},
	"user_prompt":                {},
}

func ctxErr(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	return ctx.Err()
}
