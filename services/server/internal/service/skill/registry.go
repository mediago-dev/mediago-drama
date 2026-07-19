// Package skill loads prompt-pack backed agent skills.
package skill

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"

	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
)

// Source identifies where a skill was loaded from.
type Source string

const (
	// SourcePack marks skills loaded from an installed prompt pack.
	SourcePack Source = "pack"
	// SourceUser marks user-created or user-overridden skills.
	SourceUser Source = "user"
)

var (
	// ErrInvalidSkill reports invalid skill Markdown or metadata.
	ErrInvalidSkill = errors.New("invalid skill")
	// ErrSkillNotFound reports a missing skill name.
	ErrSkillNotFound = errors.New("skill not found")
	// ErrSkillExists reports a duplicate skill creation request.
	ErrSkillExists = errors.New("skill already exists")
	// ErrBuiltinSkillReadonly reports attempts to delete or reset a package-backed skill incorrectly.
	ErrBuiltinSkillReadonly = errors.New("package skill is read-only")
)

// SkillMeta is the public skill index entry.
type SkillMeta struct {
	Name            string            `json:"name"`
	Title           string            `json:"title,omitempty"`
	Description     string            `json:"description"`
	Source          Source            `json:"source"`
	Overridden      bool              `json:"overridden,omitempty"`
	TemplateID      string            `json:"templateId,omitempty"`
	Hint            map[string]string `json:"hint,omitempty"`
	PackID          string            `json:"packId,omitempty"`
	ReleaseID       string            `json:"releaseId,omitempty"`
	SourcePackageID string            `json:"sourcePackageId,omitempty"`
	SourceReleaseID string            `json:"sourceReleaseId,omitempty"`
}

// Skill contains a parsed skill, including body content and raw Markdown.
type Skill struct {
	SkillMeta
	Content string `json:"content"`
	Raw     string `json:"raw,omitempty"`
}

// PackStore supplies prompt-pack skill persistence.
type PackStore interface {
	ListEntries(ctx context.Context, kind instructionpack.Kind) ([]promptpack.Entry, error)
	GetEntry(ctx context.Context, kind instructionpack.Kind, slug string) (promptpack.Entry, error)
	SaveEntry(ctx context.Context, kind instructionpack.Kind, slug string, entry promptpack.Entry) (promptpack.Entry, error)
	CreateEntry(ctx context.Context, kind instructionpack.Kind, entry promptpack.Entry) (promptpack.Entry, error)
	ResetEntry(ctx context.Context, kind instructionpack.Kind, slug string) (promptpack.Entry, error)
	DeleteEntry(ctx context.Context, kind instructionpack.Kind, slug string) error
	HideEntry(ctx context.Context, kind instructionpack.Kind, slug string) error
}

type packVisibilityStore interface {
	ListPacks(ctx context.Context) ([]promptpack.Pack, error)
}

// Registry loads skills from the prompt pack store.
type Registry struct {
	store PackStore
}

type skillFrontmatter struct {
	Name             string            `yaml:"name"`
	Title            string            `yaml:"title,omitempty"`
	Description      string            `yaml:"description"`
	DocumentCategory string            `yaml:"document_category,omitempty"`
	TemplateID       string            `yaml:"template_id,omitempty"`
	Hint             map[string]string `yaml:"hint,omitempty"`
}

var (
	defaultStoreMu   sync.RWMutex
	defaultStore     PackStore
	defaultStoreOnce sync.Once
)

// SetPromptPackStore sets the default prompt pack store used by NewRegistry.
func SetPromptPackStore(store PackStore) {
	if store == nil {
		return
	}
	defaultStoreMu.Lock()
	defer defaultStoreMu.Unlock()
	defaultStore = store
}

// NewRegistry creates a skill registry backed by the global prompt pack store.
func NewRegistry() *Registry {
	return NewRegistryWithStore(currentDefaultStore())
}

// NewRegistryWithSource is retained for older callers; it now uses the global pack store.
func NewRegistryWithSource(_ fs.FS, _ string, _ string) *Registry {
	return NewRegistry()
}

// NewRegistryWithStore creates a skill registry with an explicit pack store.
func NewRegistryWithStore(store PackStore) *Registry {
	return &Registry{store: store}
}

func currentDefaultStore() PackStore {
	defaultStoreMu.RLock()
	store := defaultStore
	defaultStoreMu.RUnlock()
	if store != nil {
		return store
	}
	defaultStoreOnce.Do(func() {
		defaultStoreMu.Lock()
		defer defaultStoreMu.Unlock()
		if defaultStore == nil {
			defaultStore = promptpack.NewService()
		}
	})
	defaultStoreMu.RLock()
	defer defaultStoreMu.RUnlock()
	return defaultStore
}

// List returns skill metadata.
func (registry *Registry) List(ctx context.Context) ([]SkillMeta, error) {
	if registry == nil || registry.store == nil {
		return nil, errors.New("skill registry store is nil")
	}
	entries, err := registry.store.ListEntries(ctx, instructionpack.KindSkill)
	if err != nil {
		return nil, err
	}
	metas := make([]SkillMeta, 0, len(entries))
	for _, entry := range entries {
		metas = append(metas, skillFromEntry(entry).SkillMeta)
	}
	sort.SliceStable(metas, func(first, second int) bool {
		return metas[first].Name < metas[second].Name
	})
	return metas, nil
}

// ListBrowsable returns the skill index shown in management UIs. Imported pack
// skills expose only identity and ownership fields so their names can be shown
// as disabled rows without leaking descriptions or other content metadata.
func (registry *Registry) ListBrowsable(ctx context.Context) ([]SkillMeta, error) {
	metas, err := registry.List(ctx)
	if err != nil {
		return nil, err
	}
	importedPackIDs, err := registry.importedPackIDs(ctx)
	if err != nil {
		return nil, err
	}
	browsable := make([]SkillMeta, 0, len(metas))
	for _, meta := range metas {
		if _, imported := importedPackIDs[meta.PackID]; imported {
			meta.Description = ""
			meta.Overridden = false
			meta.TemplateID = ""
			meta.Hint = nil
			meta.ReleaseID = ""
			meta.SourcePackageID = ""
			meta.SourceReleaseID = ""
		}
		browsable = append(browsable, meta)
	}
	return browsable, nil
}

// Get returns one skill by name, including frontmatter-free body content.
func (registry *Registry) Get(ctx context.Context, name string) (Skill, error) {
	if registry == nil || registry.store == nil {
		return Skill{}, errors.New("skill registry store is nil")
	}
	name = strings.TrimSpace(name)
	entry, err := registry.store.GetEntry(ctx, instructionpack.KindSkill, name)
	if err != nil {
		if errors.Is(err, promptpack.ErrEntryNotFound) {
			metas, _ := registry.List(ctx)
			return Skill{}, NotFoundError{Name: name, Available: metas}
		}
		return Skill{}, err
	}
	return skillFromEntry(entry), nil
}

// GetRaw returns one skill by name, including the full raw Markdown file.
func (registry *Registry) GetRaw(ctx context.Context, name string) (Skill, error) {
	return registry.Get(ctx, name)
}

// GetBrowsable returns one skill only when its source pack is visible to the
// management UI. Imported pack skills remain accessible to runtime callers
// through Get and GetRaw.
func (registry *Registry) GetBrowsable(ctx context.Context, name string) (Skill, error) {
	item, err := registry.GetRaw(ctx, name)
	if err != nil {
		return Skill{}, err
	}
	importedPackIDs, err := registry.importedPackIDs(ctx)
	if err != nil {
		return Skill{}, err
	}
	if _, imported := importedPackIDs[item.PackID]; !imported {
		return item, nil
	}
	available, listErr := registry.ListBrowsable(ctx)
	if listErr != nil {
		return Skill{}, listErr
	}
	return Skill{}, NotFoundError{Name: strings.TrimSpace(name), Available: available}
}

func (registry *Registry) importedPackIDs(ctx context.Context) (map[string]struct{}, error) {
	store, ok := registry.store.(packVisibilityStore)
	if !ok {
		return nil, errors.New("skill registry store does not support pack visibility")
	}
	packs, err := store.ListPacks(ctx)
	if err != nil {
		return nil, err
	}
	importedPackIDs := make(map[string]struct{})
	for _, pack := range packs {
		if pack.Source == "imported" {
			importedPackIDs[pack.ID] = struct{}{}
		}
	}
	return importedPackIDs, nil
}

// Save validates and writes an existing skill as a user override.
func (registry *Registry) Save(ctx context.Context, name string, raw string) (Skill, error) {
	parsed, err := ParseRaw(name, raw)
	if err != nil {
		return Skill{}, err
	}
	entry := entryFromSkill(parsed)
	saved, err := registry.store.SaveEntry(ctx, instructionpack.KindSkill, parsed.Name, entry)
	if err != nil {
		if errors.Is(err, promptpack.ErrEntryNotFound) {
			metas, _ := registry.List(ctx)
			return Skill{}, NotFoundError{Name: parsed.Name, Available: metas}
		}
		return Skill{}, err
	}
	return skillFromEntry(saved), nil
}

// Create validates and writes a new user skill.
func (registry *Registry) Create(ctx context.Context, name string, raw string) (Skill, error) {
	return registry.CreateInPack(ctx, name, raw, "")
}

// CreateInPack validates and writes a new user skill into a selected local pack.
func (registry *Registry) CreateInPack(ctx context.Context, name string, raw string, packID string) (Skill, error) {
	parsed, err := ParseRaw(name, raw)
	if err != nil {
		return Skill{}, err
	}
	entry := entryFromSkill(parsed)
	entry.PackID = strings.TrimSpace(packID)
	created, err := registry.store.CreateEntry(ctx, instructionpack.KindSkill, entry)
	if err != nil {
		if errors.Is(err, promptpack.ErrEntryExists) {
			return Skill{}, fmt.Errorf("%w: %s", ErrSkillExists, parsed.Name)
		}
		return Skill{}, err
	}
	return skillFromEntry(created), nil
}

// Delete removes a user-created skill or hides a package-backed skill.
func (registry *Registry) Delete(ctx context.Context, name string) error {
	err := registry.store.HideEntry(ctx, instructionpack.KindSkill, strings.TrimSpace(name))
	if err != nil {
		if errors.Is(err, promptpack.ErrEntryNotFound) {
			metas, _ := registry.List(ctx)
			return NotFoundError{Name: strings.TrimSpace(name), Available: metas}
		}
		if errors.Is(err, promptpack.ErrPackReadonly) {
			return fmt.Errorf("%w: %s", ErrBuiltinSkillReadonly, strings.TrimSpace(name))
		}
	}
	return err
}

// Reset restores a package-backed skill to the version from its installed prompt pack.
func (registry *Registry) Reset(ctx context.Context, name string) (Skill, error) {
	reset, err := registry.store.ResetEntry(ctx, instructionpack.KindSkill, strings.TrimSpace(name))
	if err != nil {
		if errors.Is(err, promptpack.ErrEntryNotFound) {
			metas, _ := registry.List(ctx)
			return Skill{}, NotFoundError{Name: strings.TrimSpace(name), Available: metas}
		}
		if errors.Is(err, promptpack.ErrPackReadonly) {
			return Skill{}, fmt.Errorf("%w: %s", ErrBuiltinSkillReadonly, strings.TrimSpace(name))
		}
		return Skill{}, err
	}
	return skillFromEntry(reset), nil
}

// ParseRaw validates full skill Markdown for a specific skill name.
func ParseRaw(name string, raw string) (Skill, error) {
	name = strings.TrimSpace(name)
	if !instructionpack.IsSafeSkillName(name) {
		return Skill{}, fmt.Errorf("%w: skill name is required", ErrInvalidSkill)
	}
	item, err := parseRaw(raw, SourceUser)
	if err != nil {
		return Skill{}, err
	}
	if item.Name != name {
		return Skill{}, fmt.Errorf("%w: frontmatter name %q must match %q", ErrInvalidSkill, item.Name, name)
	}
	return item, nil
}

func parseRaw(raw string, source Source) (Skill, error) {
	raw = normalizeRaw(raw)
	frontmatter, body, err := splitFrontmatter(raw)
	if err != nil {
		return Skill{}, err
	}
	var meta skillFrontmatter
	if err := yaml.Unmarshal([]byte(frontmatter), &meta); err != nil {
		return Skill{}, fmt.Errorf("%w: parsing frontmatter: %w", ErrInvalidSkill, err)
	}
	name := strings.TrimSpace(meta.Name)
	if !instructionpack.IsSafeSkillName(name) {
		return Skill{}, fmt.Errorf("%w: frontmatter name is required", ErrInvalidSkill)
	}
	description := strings.TrimSpace(meta.Description)
	if description == "" {
		return Skill{}, fmt.Errorf("%w: frontmatter description is required", ErrInvalidSkill)
	}
	return Skill{
		SkillMeta: SkillMeta{
			Name:        name,
			Title:       strings.TrimSpace(meta.Title),
			Description: description,
			Source:      source,
			TemplateID:  strings.TrimSpace(meta.TemplateID),
			Hint:        normalizeSkillHint(meta.Hint, meta.DocumentCategory),
		},
		Content: normalizeBody(body),
		Raw:     raw,
	}, nil
}

func splitFrontmatter(raw string) (string, string, error) {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "---\n") {
		return "", "", fmt.Errorf("%w: frontmatter block is required", ErrInvalidSkill)
	}
	rest := strings.TrimPrefix(raw, "---\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return "", "", fmt.Errorf("%w: frontmatter closing marker is required", ErrInvalidSkill)
	}
	frontmatter := rest[:end]
	body := rest[end+len("\n---"):]
	body = strings.TrimPrefix(body, "\n")
	return frontmatter, body, nil
}

func skillFromEntry(entry promptpack.Entry) Skill {
	hint := metadataStringMap(entry.Metadata, "hint")
	item := Skill{
		SkillMeta: SkillMeta{
			Name:            entry.Slug,
			Title:           entry.Title,
			Description:     entry.Description,
			Source:          Source(entry.Source),
			Overridden:      entry.Source == string(SourceUser) && entry.OverriddenFrom != "",
			TemplateID:      metadataString(entry.Metadata, "template_id"),
			Hint:            hint,
			PackID:          entry.PackID,
			ReleaseID:       entry.ReleaseID,
			SourcePackageID: entry.SourcePackageID,
			SourceReleaseID: entry.SourceReleaseID,
		},
		Content: normalizeBody(entry.Body),
	}
	item.Raw = rawFromSkill(item)
	return item
}

func entryFromSkill(item Skill) promptpack.Entry {
	return promptpack.Entry{
		Kind:        instructionpack.KindSkill,
		Slug:        item.Name,
		Name:        item.Name,
		Title:       item.Title,
		Description: item.Description,
		Body:        item.Content,
		Metadata:    metadataFromSkill(item),
	}
}

func rawFromSkill(item Skill) string {
	hint, documentCategory := splitDocumentCategoryHint(item.Hint)
	frontmatter, _ := yaml.Marshal(skillFrontmatter{
		Name:             item.Name,
		Title:            item.Title,
		Description:      item.Description,
		DocumentCategory: documentCategory,
		TemplateID:       item.TemplateID,
		Hint:             hint,
	})
	return "---\n" + strings.TrimSpace(string(frontmatter)) + "\n---\n" + normalizeBody(item.Content)
}

func metadataFromSkill(item Skill) map[string]any {
	metadata := map[string]any{}
	if len(item.Hint) > 0 {
		metadata["hint"] = item.Hint
	}
	if strings.TrimSpace(item.TemplateID) != "" {
		metadata["template_id"] = strings.TrimSpace(item.TemplateID)
	}
	return metadata
}

func metadataString(metadata map[string]any, key string) string {
	value, ok := metadata[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func metadataStringMap(metadata map[string]any, key string) map[string]string {
	value, ok := metadata[key]
	if !ok || value == nil {
		return nil
	}
	result := map[string]string{}
	switch typed := value.(type) {
	case map[string]string:
		for key, value := range typed {
			result[key] = value
		}
	case map[string]any:
		for key, value := range typed {
			if value != nil {
				result[key] = strings.TrimSpace(fmt.Sprint(value))
			}
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeHint(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	hint := make(map[string]string, len(values))
	for key, value := range values {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		hint[key] = strings.TrimSpace(value)
	}
	if len(hint) == 0 {
		return nil
	}
	return hint
}

func normalizeSkillHint(values map[string]string, documentCategory string) map[string]string {
	hint := normalizeHint(values)
	documentCategory = strings.TrimSpace(documentCategory)
	if documentCategory == "" {
		return hint
	}
	if hint == nil {
		hint = map[string]string{}
	}
	hint["document_category"] = documentCategory
	return hint
}

func splitDocumentCategoryHint(values map[string]string) (map[string]string, string) {
	hint := normalizeHint(values)
	if hint == nil {
		return nil, ""
	}
	documentCategory := strings.TrimSpace(hint["document_category"])
	delete(hint, "document_category")
	if len(hint) == 0 {
		return nil, documentCategory
	}
	return hint, documentCategory
}

func normalizeRaw(raw string) string {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	return raw + "\n"
}

func normalizeBody(body string) string {
	body = strings.TrimSpace(strings.ReplaceAll(body, "\r\n", "\n"))
	if body == "" {
		return ""
	}
	return body + "\n"
}

// NotFoundError includes the current available skill list.
type NotFoundError struct {
	Name      string
	Available []SkillMeta
}

func (err NotFoundError) Error() string {
	names := make([]string, 0, len(err.Available))
	for _, meta := range err.Available {
		names = append(names, meta.Name)
	}
	if len(names) == 0 {
		return fmt.Sprintf("%s: %s", ErrSkillNotFound, err.Name)
	}
	return fmt.Sprintf("%s: %s (available: %s)", ErrSkillNotFound, err.Name, strings.Join(names, ", "))
}

func (err NotFoundError) Unwrap() error {
	return ErrSkillNotFound
}
