// Package promptlibrary stores reusable generation prompt entries.
package promptlibrary

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode"

	configassets "github.com/mediago-dev/mediago-drama/services/server/configs"
	"github.com/mediago-dev/mediago-drama/services/server/internal/config"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"gopkg.in/yaml.v3"
)

const (
	builtinPromptLibraryDir = "prompt-library/builtin"
	builtinStylePresetDir   = "style-presets/builtin"
	defaultExtension        = ".md"
)

// Prompt categories group reusable prompt presets in the library.
const (
	categoryStyle         = "style" // 艺术风格
	categoryStyleLabel    = "风格"
	categoryExtra         = "extra" // 其他可复用提示词
	categoryExtraLabel    = "其他"
	legacyLayerSceneStyle = "scene_style" // 旧层:归并到 categoryExtra
	legacyLayerTone       = "tone"        // 旧层:归并到 categoryExtra
)

// Source identifies where a prompt entry currently comes from.
type Source string

const (
	// SourceBuiltin marks repository-shipped prompt entries that still match system defaults.
	SourceBuiltin Source = "builtin"
	// SourceUser marks user-created prompt entries or user overrides of system defaults.
	SourceUser Source = "user"
)

var (
	// ErrInvalidPromptEntry reports an invalid prompt library payload.
	ErrInvalidPromptEntry = errors.New("invalid prompt entry")
	// ErrPromptEntryNotFound reports a missing prompt entry ID.
	ErrPromptEntryNotFound = errors.New("prompt entry not found")
	// ErrPromptEntryExists reports a duplicate user prompt entry creation request.
	ErrPromptEntryExists = errors.New("prompt entry already exists")
	// ErrBuiltinPromptEntryReadonly reports attempts to delete a system-default prompt entry.
	ErrBuiltinPromptEntryReadonly = errors.New("builtin prompt entry cannot be deleted")
	// ErrInvalidPromptCategory reports an invalid prompt category payload.
	ErrInvalidPromptCategory = errors.New("invalid prompt category")
	// ErrPromptCategoryExists reports a duplicate user prompt category creation request.
	ErrPromptCategoryExists = errors.New("prompt category already exists")
)

// PromptCategory describes a reusable generation prompt category.
type PromptCategory struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Source    Source `json:"source"`
	Builtin   bool   `json:"builtin,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

// PromptEntry describes a reusable generation prompt category preset.
type PromptEntry struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Category string `json:"category"`
	Type     string `json:"type,omitempty"`
	Prompt   string `json:"prompt"`
	Source   Source `json:"source"`
	Builtin  bool   `json:"builtin,omitempty"`
}

// Filter limits prompt library list results.
type Filter struct {
	Category string
	Type     string
}

// Service loads embedded prompt defaults into the settings DB and persists edits there.
type Service struct {
	mu            sync.RWMutex
	defaults      fs.FS
	builtinRoot   string
	styleDefaults fs.FS  // 风格分类内嵌默认(生产环境注入;测试留空以隔离)
	styleRoot     string // 风格分类内嵌目录
	repo          *repository.PromptLibraryRepository
	initErr       error
}

type promptEntryFrontmatter struct {
	ID       string `yaml:"id"`
	Name     string `yaml:"name"`
	Layer    string `yaml:"layer,omitempty"` // legacy frontmatter key.
	Category string `yaml:"category,omitempty"`
	Type     string `yaml:"type,omitempty"`
}

type promptEntryModel = domain.PromptLibraryEntryModel
type promptCategoryModel = domain.PromptCategoryModel

// NewService creates a prompt library service backed by built-in defaults and the settings DB.
func NewService() *Service {
	repos, err := repository.OpenSettingsRepositories(config.DefaultSettingsDBPath())
	return NewServiceFromRepository(repos.PromptLibrary, err)
}

// NewServiceFromRepository creates a prompt library service from an existing settings repository.
func NewServiceFromRepository(repo *repository.PromptLibraryRepository, initErr error) *Service {
	service := NewServiceWithRepository(configassets.PromptLibrary, builtinPromptLibraryDir, repo, initErr)
	// 风格分类默认从独立的内嵌目录种入(仅生产路径;测试通过 NewServiceWithRepository 注入隔离的 FS)。
	service.styleDefaults = configassets.StylePresets
	service.styleRoot = builtinStylePresetDir
	return service
}

// NewServiceWithRepository creates a prompt library service with explicit defaults and repository.
func NewServiceWithRepository(defaults fs.FS, builtinRoot string, repo *repository.PromptLibraryRepository, initErr error) *Service {
	service := &Service{
		defaults:    defaults,
		builtinRoot: strings.TrimSpace(builtinRoot),
		repo:        repo,
		initErr:     initErr,
	}
	if service.initErr == nil && service.repo == nil {
		service.initErr = errors.New("prompt library repository is nil")
	}
	return service
}

// List returns prompt entries from the settings DB after syncing built-in Markdown defaults.
func (store *Service) List(ctx context.Context, filter Filter) ([]PromptEntry, error) {
	filter = normalizeFilter(filter)
	if err := validateFilter(filter); err != nil {
		return nil, err
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	if err := store.ensureReady(ctx); err != nil {
		return nil, err
	}
	if err := store.syncBuiltinsLocked(ctx); err != nil {
		return nil, err
	}
	models, err := store.repo.ListPromptLibraryEntries()
	if err != nil {
		return nil, err
	}

	items := make([]PromptEntry, 0, len(models))
	for _, model := range models {
		entry := promptEntryFromModel(model)
		if filter.Category != "" && entry.Category != filter.Category {
			continue
		}
		if filter.Type != "" && entry.Type != filter.Type {
			continue
		}
		items = append(items, entry)
	}
	sortPromptEntries(items)
	return items, nil
}

// ListCategories returns prompt categories from the settings DB after syncing defaults.
func (store *Service) ListCategories(ctx context.Context) ([]PromptCategory, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	if err := store.ensureReady(ctx); err != nil {
		return nil, err
	}
	if err := store.syncCategoriesLocked(ctx); err != nil {
		return nil, err
	}
	models, err := store.repo.ListPromptCategories()
	if err != nil {
		return nil, err
	}
	categories := make([]PromptCategory, 0, len(models))
	for _, model := range models {
		categories = append(categories, promptCategoryFromModel(model))
	}
	sortPromptCategories(categories)
	return categories, nil
}

// CreateCategory validates and writes a new user prompt category.
func (store *Service) CreateCategory(ctx context.Context, category PromptCategory) (PromptCategory, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	if err := store.ensureReady(ctx); err != nil {
		return PromptCategory{}, err
	}
	if err := store.syncCategoriesLocked(ctx); err != nil {
		return PromptCategory{}, err
	}
	category = categoryForUserWrite(category)
	if err := validatePromptCategory(category); err != nil {
		return PromptCategory{}, err
	}
	currentCategories, err := store.repo.ListPromptCategories()
	if err != nil {
		return PromptCategory{}, err
	}
	for _, current := range currentCategories {
		if normalizeCategory(current.ID) == category.ID || strings.TrimSpace(current.Label) == category.Label {
			return PromptCategory{}, fmt.Errorf("%w: %s", ErrPromptCategoryExists, category.ID)
		}
	}

	now := timestamp.NowRFC3339Nano()
	model := promptCategoryModelFromCategory(category, now, now)
	if err := store.repo.CreatePromptCategory(model); err != nil {
		return PromptCategory{}, err
	}
	return promptCategoryFromModel(model), nil
}

// Get returns one prompt entry by ID.
func (store *Service) Get(ctx context.Context, id string) (PromptEntry, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	if err := store.ensureReady(ctx); err != nil {
		return PromptEntry{}, err
	}
	if err := store.syncBuiltinsLocked(ctx); err != nil {
		return PromptEntry{}, err
	}
	model, err := store.repo.GetPromptLibraryEntry(strings.TrimSpace(id))
	if repository.IsRecordNotFound(err) {
		return PromptEntry{}, fmt.Errorf("%w: %s", ErrPromptEntryNotFound, strings.TrimSpace(id))
	}
	if err != nil {
		return PromptEntry{}, err
	}
	return promptEntryFromModel(model), nil
}

// Create validates and writes a new user prompt entry.
func (store *Service) Create(ctx context.Context, entry PromptEntry) (PromptEntry, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	if err := store.ensureReady(ctx); err != nil {
		return PromptEntry{}, err
	}
	if err := store.syncBuiltinsLocked(ctx); err != nil {
		return PromptEntry{}, err
	}
	entry = entryForUserWrite(entry)
	if err := validatePromptEntry(entry.ID, entry); err != nil {
		return PromptEntry{}, err
	}
	if err := store.ensureUserCategoryLocked(entry.Category); err != nil {
		return PromptEntry{}, err
	}
	if _, err := store.repo.GetPromptLibraryEntry(entry.ID); err == nil {
		return PromptEntry{}, fmt.Errorf("%w: %s", ErrPromptEntryExists, entry.ID)
	} else if !repository.IsRecordNotFound(err) {
		return PromptEntry{}, err
	}

	now := timestamp.NowRFC3339Nano()
	model := promptEntryModelFromEntry(entry, now, now)
	if err := store.repo.UpsertPromptLibraryEntry(model); err != nil {
		return PromptEntry{}, err
	}
	return promptEntryFromModel(model), nil
}

// Update validates and writes a user-created prompt or user override of a built-in prompt.
func (store *Service) Update(ctx context.Context, id string, entry PromptEntry) (PromptEntry, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	if err := store.ensureReady(ctx); err != nil {
		return PromptEntry{}, err
	}
	if err := store.syncBuiltinsLocked(ctx); err != nil {
		return PromptEntry{}, err
	}
	id = strings.TrimSpace(id)
	if strings.TrimSpace(entry.ID) == "" {
		entry.ID = id
	}
	entry = entryForUserWrite(entry)
	if err := validatePromptEntry(id, entry); err != nil {
		return PromptEntry{}, err
	}
	if err := store.ensureUserCategoryLocked(entry.Category); err != nil {
		return PromptEntry{}, err
	}
	current, err := store.repo.GetPromptLibraryEntry(id)
	if repository.IsRecordNotFound(err) {
		return PromptEntry{}, fmt.Errorf("%w: %s", ErrPromptEntryNotFound, id)
	}
	if err != nil {
		return PromptEntry{}, err
	}

	entry.Builtin = current.Builtin
	now := timestamp.NowRFC3339Nano()
	model := promptEntryModelFromEntry(entry, current.CreatedAt, now)
	if err := store.repo.UpsertPromptLibraryEntry(model); err != nil {
		return PromptEntry{}, err
	}
	return promptEntryFromModel(model), nil
}

// Reset restores a built-in prompt entry to the current system-default Markdown.
func (store *Service) Reset(ctx context.Context, id string) (PromptEntry, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	if err := store.ensureReady(ctx); err != nil {
		return PromptEntry{}, err
	}
	defaults, err := store.loadBuiltinEntries(ctx)
	if err != nil {
		return PromptEntry{}, err
	}
	id = strings.TrimSpace(id)
	defaultEntry, ok := defaults[id]
	if !ok {
		return PromptEntry{}, fmt.Errorf("%w: %s", ErrPromptEntryNotFound, id)
	}
	current, err := store.repo.GetPromptLibraryEntry(id)
	if repository.IsRecordNotFound(err) {
		current.CreatedAt = timestamp.NowRFC3339Nano()
	} else if err != nil {
		return PromptEntry{}, err
	}

	now := timestamp.NowRFC3339Nano()
	if strings.TrimSpace(current.CreatedAt) == "" {
		current.CreatedAt = now
	}
	defaultEntry.Source = SourceBuiltin
	defaultEntry.Builtin = true
	model := promptEntryModelFromEntry(defaultEntry, current.CreatedAt, now)
	if err := store.repo.UpsertPromptLibraryEntry(model); err != nil {
		return PromptEntry{}, err
	}
	return promptEntryFromModel(model), nil
}

// Delete removes a user-created prompt entry. Built-in prompt entries can be reset, not deleted.
func (store *Service) Delete(ctx context.Context, id string) error {
	store.mu.Lock()
	defer store.mu.Unlock()

	if err := store.ensureReady(ctx); err != nil {
		return err
	}
	if err := store.syncBuiltinsLocked(ctx); err != nil {
		return err
	}
	id = strings.TrimSpace(id)
	current, err := store.repo.GetPromptLibraryEntry(id)
	if repository.IsRecordNotFound(err) {
		return fmt.Errorf("%w: %s", ErrPromptEntryNotFound, id)
	}
	if err != nil {
		return err
	}
	if current.Builtin {
		return fmt.Errorf("%w: %s", ErrBuiltinPromptEntryReadonly, id)
	}
	return store.repo.DeletePromptLibraryEntry(id)
}

func (store *Service) ensureReady(ctx context.Context) error {
	if err := ctxErr(ctx); err != nil {
		return err
	}
	if store.initErr != nil {
		return store.initErr
	}
	if store.repo == nil {
		return errors.New("prompt library repository is nil")
	}
	return nil
}

func (store *Service) syncBuiltinsLocked(ctx context.Context) error {
	defaults, err := store.loadBuiltinEntries(ctx)
	if err != nil {
		return err
	}
	currentModels, err := store.repo.ListPromptLibraryEntries()
	if err != nil {
		return err
	}
	currentByID := map[string]promptEntryModel{}
	for _, model := range currentModels {
		currentByID[model.ID] = model
	}

	now := timestamp.NowRFC3339Nano()
	for id, defaultEntry := range defaults {
		current, exists := currentByID[id]
		if exists && current.Builtin && current.Source != string(SourceBuiltin) {
			continue
		}
		if exists && !builtinModelNeedsSync(current, defaultEntry) {
			continue
		}
		createdAt := now
		if exists && strings.TrimSpace(current.CreatedAt) != "" {
			createdAt = current.CreatedAt
		}
		defaultEntry.Source = SourceBuiltin
		defaultEntry.Builtin = true
		model := promptEntryModelFromEntry(defaultEntry, createdAt, now)
		if err := store.repo.UpsertPromptLibraryEntry(model); err != nil {
			return err
		}
	}
	if err := store.syncCategoriesLocked(ctx); err != nil {
		return err
	}
	return nil
}

func (store *Service) syncCategoriesLocked(ctx context.Context) error {
	if err := ctxErr(ctx); err != nil {
		return err
	}
	now := timestamp.NowRFC3339Nano()
	for _, category := range builtinPromptCategories() {
		model := promptCategoryModelFromCategory(category, now, now)
		if err := store.repo.UpsertPromptCategory(model); err != nil {
			return err
		}
	}

	currentModels, err := store.repo.ListPromptCategories()
	if err != nil {
		return err
	}
	currentByID := map[string]struct{}{}
	for _, model := range currentModels {
		currentByID[normalizeCategory(model.ID)] = struct{}{}
	}
	entryModels, err := store.repo.ListPromptLibraryEntries()
	if err != nil {
		return err
	}
	for _, entry := range entryModels {
		categoryID := normalizeCategory(entry.Category)
		if _, exists := currentByID[categoryID]; exists || !isSafeCategory(categoryID) {
			continue
		}
		category := PromptCategory{
			ID:      categoryID,
			Label:   categoryLabelForID(categoryID),
			Source:  SourceUser,
			Builtin: false,
		}
		if err := store.repo.UpsertPromptCategory(promptCategoryModelFromCategory(category, now, now)); err != nil {
			return err
		}
		currentByID[categoryID] = struct{}{}
	}
	return nil
}

func (store *Service) ensureUserCategoryLocked(categoryID string) error {
	categoryID = normalizeCategory(categoryID)
	if !isSafeCategory(categoryID) {
		return fmt.Errorf("%w: category is invalid", ErrInvalidPromptCategory)
	}
	if _, err := store.repo.GetPromptCategory(categoryID); err == nil {
		return nil
	} else if !repository.IsRecordNotFound(err) {
		return err
	}
	now := timestamp.NowRFC3339Nano()
	category := PromptCategory{
		ID:      categoryID,
		Label:   categoryLabelForID(categoryID),
		Source:  SourceUser,
		Builtin: false,
	}
	return store.repo.CreatePromptCategory(promptCategoryModelFromCategory(category, now, now))
}

func (store *Service) loadBuiltinEntries(ctx context.Context) (map[string]PromptEntry, error) {
	if err := ctxErr(ctx); err != nil {
		return nil, err
	}
	entries := map[string]PromptEntry{}
	// 提示词分类(style/extra/自定义):category 从 frontmatter 或 type 推断。
	if err := loadPromptEntryFS(ctx, store.defaults, store.builtinRoot, SourceBuiltin, "", entries); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("loading built-in prompt entries: %w", err)
	}
	// 风格分类:从 style-presets/builtin 内嵌目录种入,强制 category=style(仅当生产路径注入了 styleDefaults)。
	if store.styleDefaults != nil && strings.TrimSpace(store.styleRoot) != "" {
		if err := loadPromptEntryFS(ctx, store.styleDefaults, store.styleRoot, SourceBuiltin, categoryStyle, entries); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return nil, fmt.Errorf("loading built-in style presets: %w", err)
		}
	}
	for id, entry := range entries {
		entry.Source = SourceBuiltin
		entry.Builtin = true
		entries[id] = entry
	}
	return entries, nil
}

func loadPromptEntryFS(ctx context.Context, filesystem fs.FS, root string, source Source, forceCategory string, entries map[string]PromptEntry) error {
	if filesystem == nil || strings.TrimSpace(root) == "" {
		return fs.ErrNotExist
	}
	dirEntries, err := fs.ReadDir(filesystem, root)
	if err != nil {
		return err
	}
	for _, dirEntry := range dirEntries {
		if err := ctxErr(ctx); err != nil {
			return err
		}
		if dirEntry.IsDir() || !isPromptEntryFilename(dirEntry.Name()) {
			continue
		}
		path := filepath.ToSlash(filepath.Join(root, dirEntry.Name()))
		data, err := fs.ReadFile(filesystem, path)
		if err != nil {
			return err
		}
		entry, err := decodePromptEntry(data, source, forceCategory)
		if err != nil {
			return fmt.Errorf("decoding %s: %w", path, err)
		}
		entries[entry.ID] = entry
	}
	return nil
}

func decodePromptEntry(data []byte, source Source, forceCategory string) (PromptEntry, error) {
	frontmatter, body, err := splitFrontmatter(string(data))
	if err != nil {
		return PromptEntry{}, err
	}
	var meta promptEntryFrontmatter
	if err := yaml.Unmarshal([]byte(frontmatter), &meta); err != nil {
		return PromptEntry{}, fmt.Errorf("%w: parsing frontmatter: %w", ErrInvalidPromptEntry, err)
	}
	category := meta.Category
	if strings.TrimSpace(forceCategory) != "" {
		category = forceCategory
	} else if strings.TrimSpace(category) == "" && strings.TrimSpace(meta.Layer) != "" {
		category = categoryFromLegacyLayer(meta.Layer)
	}
	entry := normalizePromptEntry(PromptEntry{
		ID:       meta.ID,
		Name:     meta.Name,
		Category: category,
		Type:     meta.Type,
		Prompt:   body,
		Source:   source,
	})
	if err := validatePromptEntry(entry.ID, entry); err != nil {
		return PromptEntry{}, err
	}
	return entry, nil
}

func validatePromptEntry(id string, entry PromptEntry) error {
	id = strings.TrimSpace(id)
	if !isSafeIdentifier(id) {
		return fmt.Errorf("%w: prompt entry id is required", ErrInvalidPromptEntry)
	}
	if strings.TrimSpace(entry.ID) != id {
		return fmt.Errorf("%w: prompt entry id must match path id %q", ErrInvalidPromptEntry, id)
	}
	if strings.TrimSpace(entry.Name) == "" {
		return fmt.Errorf("%w: name is required", ErrInvalidPromptEntry)
	}
	if !isSafeCategory(entry.Category) {
		return fmt.Errorf("%w: category is invalid", ErrInvalidPromptEntry)
	}
	if strings.TrimSpace(entry.Type) != "" && !isSupportedType(entry.Type) {
		return fmt.Errorf("%w: unsupported prompt type %q", ErrInvalidPromptEntry, entry.Type)
	}
	if strings.TrimSpace(entry.Prompt) == "" {
		return fmt.Errorf("%w: prompt is required", ErrInvalidPromptEntry)
	}
	return nil
}

func validatePromptCategory(category PromptCategory) error {
	if !isSafeCategory(category.ID) {
		return fmt.Errorf("%w: category id is invalid", ErrInvalidPromptCategory)
	}
	if !isSafeCategoryLabel(category.Label) {
		return fmt.Errorf("%w: category label is invalid", ErrInvalidPromptCategory)
	}
	return nil
}

func validateFilter(filter Filter) error {
	if filter.Category != "" && !isSafeCategory(filter.Category) {
		return fmt.Errorf("%w: category is invalid", ErrInvalidPromptEntry)
	}
	if filter.Type != "" && !isSupportedType(filter.Type) {
		return fmt.Errorf("%w: unsupported prompt type %q", ErrInvalidPromptEntry, filter.Type)
	}
	return nil
}

func normalizeFilter(filter Filter) Filter {
	filter.Category = normalizeCategory(filter.Category)
	filter.Type = strings.TrimSpace(filter.Type)
	return filter
}

func normalizePromptEntry(entry PromptEntry) PromptEntry {
	entry.ID = strings.TrimSpace(entry.ID)
	entry.Name = strings.TrimSpace(entry.Name)
	entry.Category = normalizeCategory(entry.Category)
	entry.Type = strings.TrimSpace(entry.Type)
	// 旧数据没有 category:从 type 回填(读时即生效,库页按分类过滤不依赖 DB 列)。
	if entry.Category == "" {
		entry.Category = categoryForType(entry.Type)
	}
	entry.Prompt = strings.TrimSpace(strings.ReplaceAll(entry.Prompt, "\r\n", "\n"))
	return entry
}

func normalizePromptCategory(category PromptCategory) PromptCategory {
	category.ID = normalizeCategory(category.ID)
	category.Label = strings.TrimSpace(category.Label)
	if category.ID == "" {
		category.ID = normalizeCategory(category.Label)
	}
	if category.Label == "" {
		category.Label = categoryLabelForID(category.ID)
	}
	return category
}

func categoryForType(promptType string) string {
	return categoryExtra
}

func normalizeCategory(category string) string {
	return strings.TrimSpace(category)
}

func categoryFromLegacyLayer(layer string) string {
	switch strings.TrimSpace(layer) {
	case legacyLayerSceneStyle, legacyLayerTone:
		return categoryExtra
	default:
		return strings.TrimSpace(layer)
	}
}

func entryForUserWrite(entry PromptEntry) PromptEntry {
	entry = normalizePromptEntry(entry)
	entry.Source = SourceUser
	return entry
}

func categoryForUserWrite(category PromptCategory) PromptCategory {
	category = normalizePromptCategory(category)
	category.Source = SourceUser
	category.Builtin = false
	return category
}

func builtinPromptCategories() []PromptCategory {
	now := timestamp.NowRFC3339Nano()
	return []PromptCategory{
		{
			ID:        categoryStyle,
			Label:     categoryStyleLabel,
			Source:    SourceBuiltin,
			Builtin:   true,
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:        categoryExtra,
			Label:     categoryExtraLabel,
			Source:    SourceBuiltin,
			Builtin:   true,
			CreatedAt: now,
			UpdatedAt: now,
		},
	}
}

func categoryLabelForID(categoryID string) string {
	switch normalizeCategory(categoryID) {
	case categoryStyle:
		return categoryStyleLabel
	case categoryExtra:
		return categoryExtraLabel
	default:
		return strings.TrimSpace(categoryID)
	}
}

func promptEntryFromModel(model promptEntryModel) PromptEntry {
	return normalizePromptEntry(PromptEntry{
		ID:       model.ID,
		Name:     model.Name,
		Category: model.Category,
		Type:     model.Type,
		Prompt:   model.Prompt,
		Source:   Source(model.Source),
		Builtin:  model.Builtin,
	})
}

func promptEntryModelFromEntry(entry PromptEntry, createdAt string, updatedAt string) promptEntryModel {
	entry = normalizePromptEntry(entry)
	return promptEntryModel{
		ID:        entry.ID,
		Name:      entry.Name,
		Category:  entry.Category,
		Type:      entry.Type,
		Prompt:    entry.Prompt,
		Source:    string(entry.Source),
		Builtin:   entry.Builtin,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}
}

func promptCategoryFromModel(model promptCategoryModel) PromptCategory {
	return normalizePromptCategory(PromptCategory{
		ID:        model.ID,
		Label:     model.Label,
		Source:    Source(model.Source),
		Builtin:   model.Builtin,
		CreatedAt: model.CreatedAt,
		UpdatedAt: model.UpdatedAt,
	})
}

func promptCategoryModelFromCategory(category PromptCategory, createdAt string, updatedAt string) promptCategoryModel {
	category = normalizePromptCategory(category)
	return promptCategoryModel{
		ID:        category.ID,
		Label:     category.Label,
		Source:    string(category.Source),
		Builtin:   category.Builtin,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}
}

func builtinModelNeedsSync(model promptEntryModel, defaultEntry PromptEntry) bool {
	defaultEntry = normalizePromptEntry(defaultEntry)
	return model.Name != defaultEntry.Name ||
		normalizedCategory(model.Category, model.Type) != defaultEntry.Category ||
		model.Type != defaultEntry.Type ||
		model.Prompt != defaultEntry.Prompt ||
		model.Source != string(SourceBuiltin) ||
		!model.Builtin
}

func normalizedCategory(category string, promptType string) string {
	if normalizeCategory(category) != "" {
		return normalizeCategory(category)
	}
	return categoryForType(promptType)
}

func splitFrontmatter(raw string) (string, string, error) {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\r\n", "\n"))
	if !strings.HasPrefix(raw, "---\n") {
		return "", "", fmt.Errorf("%w: frontmatter block is required", ErrInvalidPromptEntry)
	}
	rest := strings.TrimPrefix(raw, "---\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return "", "", fmt.Errorf("%w: frontmatter closing marker is required", ErrInvalidPromptEntry)
	}
	frontmatter := rest[:end]
	body := rest[end+len("\n---"):]
	body = strings.TrimPrefix(body, "\n")
	return frontmatter, body, nil
}

func sortPromptEntries(entries []PromptEntry) {
	sort.SliceStable(entries, func(first, second int) bool {
		firstEntry := entries[first]
		secondEntry := entries[second]
		if categoryOrder(firstEntry.Category) != categoryOrder(secondEntry.Category) {
			return categoryOrder(firstEntry.Category) < categoryOrder(secondEntry.Category)
		}
		if firstEntry.Category != secondEntry.Category {
			return firstEntry.Category < secondEntry.Category
		}
		if typeOrder(firstEntry.Type) != typeOrder(secondEntry.Type) {
			return typeOrder(firstEntry.Type) < typeOrder(secondEntry.Type)
		}
		if firstEntry.Builtin != secondEntry.Builtin {
			return firstEntry.Builtin
		}
		if firstEntry.Name != secondEntry.Name {
			return firstEntry.Name < secondEntry.Name
		}
		return firstEntry.ID < secondEntry.ID
	})
}

func sortPromptCategories(categories []PromptCategory) {
	sort.SliceStable(categories, func(first, second int) bool {
		firstCategory := categories[first]
		secondCategory := categories[second]
		if categoryOrder(firstCategory.ID) != categoryOrder(secondCategory.ID) {
			return categoryOrder(firstCategory.ID) < categoryOrder(secondCategory.ID)
		}
		if firstCategory.Builtin != secondCategory.Builtin {
			return firstCategory.Builtin
		}
		if firstCategory.Label != secondCategory.Label {
			return firstCategory.Label < secondCategory.Label
		}
		return firstCategory.ID < secondCategory.ID
	})
}

func categoryOrder(category string) int {
	switch normalizeCategory(category) {
	case categoryStyle:
		return 0
	case categoryExtra:
		return 1
	default:
		return 99
	}
}

func typeOrder(promptType string) int {
	switch promptType {
	case "image":
		return 0
	case "video":
		return 1
	default:
		return 99
	}
}

func isSupportedType(promptType string) bool {
	switch promptType {
	case "image", "video":
		return true
	default:
		return false
	}
}

func isPromptEntryFilename(filename string) bool {
	return strings.HasSuffix(filename, defaultExtension)
}

func isSafeCategory(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || value == "." || value == ".." || strings.ContainsAny(value, `/\`) {
		return false
	}
	if len([]rune(value)) > 64 {
		return false
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return false
		}
	}
	return true
}

func isSafeCategoryLabel(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || value == "." || value == ".." || strings.ContainsAny(value, `/\`) {
		return false
	}
	if len([]rune(value)) > 64 {
		return false
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return false
		}
	}
	return true
}

func isSafeIdentifier(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || value == "." || value == ".." || filepath.Base(value) != value || strings.Contains(value, "\\") {
		return false
	}
	for index, char := range value {
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

func ctxErr(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	return ctx.Err()
}
