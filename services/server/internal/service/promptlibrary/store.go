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
	"unicode"

	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	"github.com/mediago-dev/mediago-drama/services/server/internal/config"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
)

const (
	categoryStyle         = "style"
	categoryStyleLabel    = "风格"
	categoryExtra         = "extra"
	categoryExtraLabel    = "其他"
	legacyLayerSceneStyle = "scene_style"
	legacyLayerTone       = "tone"
)

// Source identifies where a prompt entry currently comes from.
type Source string

const (
	// SourcePack marks prompt entries from an installed prompt pack.
	SourcePack Source = "pack"
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
	// ErrBuiltinPromptEntryReadonly reports attempts to mutate a protected package-backed prompt entry.
	ErrBuiltinPromptEntryReadonly = errors.New("package prompt entry cannot be deleted")
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
	ID              string `json:"id"`
	Name            string `json:"name"`
	Category        string `json:"category"`
	Type            string `json:"type,omitempty"`
	Prompt          string `json:"prompt"`
	PackID          string `json:"packId,omitempty"`
	ReleaseID       string `json:"releaseId,omitempty"`
	SourcePackageID string `json:"sourcePackageId,omitempty"`
	SourceReleaseID string `json:"sourceReleaseId,omitempty"`
	Source          Source `json:"source"`
	Builtin         bool   `json:"builtin,omitempty"`
	Overridden      bool   `json:"overridden,omitempty"`
}

// Filter limits prompt library list results.
type Filter struct {
	Category string
	Type     string
}

// Service stores prompt library entries in the prompt pack store.
type Service struct {
	store   *promptpack.Service
	initErr error
}

// NewService creates a prompt library service backed by the settings DB.
func NewService() *Service {
	repos, err := repository.OpenSettingsRepositories(config.DefaultSettingsDBPath())
	return NewServiceFromPromptPack(promptpack.NewServiceFromRepository(repos.Packs, repos.PromptLibrary, err), err)
}

// NewServiceFromPromptPack creates a prompt library service from a prompt pack service.
func NewServiceFromPromptPack(store *promptpack.Service, initErr error) *Service {
	return &Service{store: store, initErr: initErr}
}

// NewServiceFromRepository is retained for older callers.
func NewServiceFromRepository(repo *repository.PromptLibraryRepository, initErr error) *Service {
	repos, err := repository.OpenSettingsRepositories(config.DefaultSettingsDBPath())
	if initErr == nil {
		initErr = err
	}
	return NewServiceFromPromptPack(promptpack.NewServiceFromRepository(repos.Packs, repo, initErr), initErr)
}

// NewServiceWithRepository is retained for older tests and callers.
func NewServiceWithRepository(_ fs.FS, _ string, repo *repository.PromptLibraryRepository, initErr error) *Service {
	return NewServiceFromRepository(repo, initErr)
}

// List returns prompt entries from enabled packs.
func (store *Service) List(ctx context.Context, filter Filter) ([]PromptEntry, error) {
	if err := store.ensureReady(); err != nil {
		return nil, err
	}
	filter = normalizeFilter(filter)
	if err := validateFilter(filter); err != nil {
		return nil, err
	}
	entries, err := store.store.ListEntries(ctx, instructionpack.KindPrompt)
	if err != nil {
		return nil, err
	}
	items := make([]PromptEntry, 0, len(entries))
	for _, entry := range entries {
		item := promptEntryFromPackEntry(entry)
		if filter.Category != "" && item.Category != filter.Category {
			continue
		}
		if filter.Type != "" && item.Type != filter.Type {
			continue
		}
		items = append(items, item)
	}
	sortPromptEntries(items)
	return items, nil
}

// ListCategories returns prompt categories from enabled packs.
func (store *Service) ListCategories(ctx context.Context) ([]PromptCategory, error) {
	if err := store.ensureReady(); err != nil {
		return nil, err
	}
	categories, err := store.store.ListCategories(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]PromptCategory, 0, len(categories))
	for _, category := range categories {
		items = append(items, promptCategoryFromPackCategory(category))
	}
	sortPromptCategories(items)
	return items, nil
}

// CreateCategory validates and writes a new user prompt category.
func (store *Service) CreateCategory(ctx context.Context, category PromptCategory) (PromptCategory, error) {
	if err := store.ensureReady(); err != nil {
		return PromptCategory{}, err
	}
	category = categoryForUserWrite(category)
	if err := validatePromptCategory(category); err != nil {
		return PromptCategory{}, err
	}
	current, err := store.ListCategories(ctx)
	if err != nil {
		return PromptCategory{}, err
	}
	for _, existing := range current {
		if normalizeCategory(existing.ID) == category.ID || strings.TrimSpace(existing.Label) == category.Label {
			return PromptCategory{}, fmt.Errorf("%w: %s", ErrPromptCategoryExists, category.ID)
		}
	}
	created, err := store.store.CreateCategory(ctx, promptpack.Category{
		ID:     category.ID,
		Label:  category.Label,
		Source: string(SourceUser),
	})
	if err != nil {
		return PromptCategory{}, err
	}
	return promptCategoryFromPackCategory(created), nil
}

// Get returns one prompt entry by ID.
func (store *Service) Get(ctx context.Context, id string) (PromptEntry, error) {
	if err := store.ensureReady(); err != nil {
		return PromptEntry{}, err
	}
	entry, err := store.store.GetEntry(ctx, instructionpack.KindPrompt, strings.TrimSpace(id))
	if errors.Is(err, promptpack.ErrEntryNotFound) {
		return PromptEntry{}, fmt.Errorf("%w: %s", ErrPromptEntryNotFound, strings.TrimSpace(id))
	}
	if err != nil {
		return PromptEntry{}, err
	}
	return promptEntryFromPackEntry(entry), nil
}

// Create validates and writes a new user prompt entry.
func (store *Service) Create(ctx context.Context, entry PromptEntry) (PromptEntry, error) {
	if err := store.ensureReady(); err != nil {
		return PromptEntry{}, err
	}
	entry = entryForUserWrite(entry)
	if err := validatePromptEntry(entry.ID, entry); err != nil {
		return PromptEntry{}, err
	}
	if err := store.ensureUserCategory(ctx, entry.Category); err != nil {
		return PromptEntry{}, err
	}
	created, err := store.store.CreateEntry(ctx, instructionpack.KindPrompt, packEntryFromPromptEntry(entry))
	if errors.Is(err, promptpack.ErrEntryExists) {
		return PromptEntry{}, fmt.Errorf("%w: %s", ErrPromptEntryExists, entry.ID)
	}
	if err != nil {
		return PromptEntry{}, err
	}
	return promptEntryFromPackEntry(created), nil
}

// Update validates and writes a user-created prompt or user override of a built-in prompt.
func (store *Service) Update(ctx context.Context, id string, entry PromptEntry) (PromptEntry, error) {
	if err := store.ensureReady(); err != nil {
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
	if err := store.ensureUserCategory(ctx, entry.Category); err != nil {
		return PromptEntry{}, err
	}
	updated, err := store.store.SaveEntry(ctx, instructionpack.KindPrompt, id, packEntryFromPromptEntry(entry))
	if errors.Is(err, promptpack.ErrEntryNotFound) {
		return PromptEntry{}, fmt.Errorf("%w: %s", ErrPromptEntryNotFound, id)
	}
	if err != nil {
		return PromptEntry{}, err
	}
	return promptEntryFromPackEntry(updated), nil
}

// Reset restores a built-in prompt entry to the current system-default Markdown.
func (store *Service) Reset(ctx context.Context, id string) (PromptEntry, error) {
	if err := store.ensureReady(); err != nil {
		return PromptEntry{}, err
	}
	reset, err := store.store.ResetEntry(ctx, instructionpack.KindPrompt, strings.TrimSpace(id))
	if errors.Is(err, promptpack.ErrEntryNotFound) {
		return PromptEntry{}, fmt.Errorf("%w: %s", ErrPromptEntryNotFound, strings.TrimSpace(id))
	}
	if err != nil {
		return PromptEntry{}, err
	}
	return promptEntryFromPackEntry(reset), nil
}

// Delete removes a user-created prompt entry or hides a package-backed prompt entry.
func (store *Service) Delete(ctx context.Context, id string) error {
	if err := store.ensureReady(); err != nil {
		return err
	}
	err := store.store.HideEntry(ctx, instructionpack.KindPrompt, strings.TrimSpace(id))
	if errors.Is(err, promptpack.ErrEntryNotFound) {
		return fmt.Errorf("%w: %s", ErrPromptEntryNotFound, strings.TrimSpace(id))
	}
	if errors.Is(err, promptpack.ErrPackReadonly) {
		return fmt.Errorf("%w: %s", ErrBuiltinPromptEntryReadonly, strings.TrimSpace(id))
	}
	return err
}

func (store *Service) ensureReady() error {
	if store.initErr != nil {
		return store.initErr
	}
	if store.store == nil {
		return errors.New("prompt library store is nil")
	}
	return nil
}

func (store *Service) ensureUserCategory(ctx context.Context, categoryID string) error {
	categories, err := store.ListCategories(ctx)
	if err != nil {
		return err
	}
	for _, category := range categories {
		if normalizeCategory(category.ID) == normalizeCategory(categoryID) {
			return nil
		}
	}
	_, err = store.CreateCategory(ctx, PromptCategory{ID: categoryID, Label: categoryLabelForID(categoryID)})
	return err
}

func promptEntryFromPackEntry(entry promptpack.Entry) PromptEntry {
	category := metadataString(entry.Metadata, "category")
	promptType := metadataString(entry.Metadata, "type")
	item := normalizePromptEntry(PromptEntry{
		ID:              entry.Slug,
		Name:            entry.Name,
		Category:        category,
		Type:            promptType,
		Prompt:          entry.Body,
		PackID:          entry.PackID,
		ReleaseID:       entry.ReleaseID,
		SourcePackageID: entry.SourcePackageID,
		SourceReleaseID: entry.SourceReleaseID,
		Source:          Source(entry.Source),
		Builtin:         entry.Source == string(SourcePack) || entry.OverriddenFrom != "",
		Overridden:      entry.Source == string(SourceUser) && entry.OverriddenFrom != "",
	})
	return item
}

func packEntryFromPromptEntry(entry PromptEntry) promptpack.Entry {
	entry = normalizePromptEntry(entry)
	return promptpack.Entry{
		PackID: entry.PackID,
		Kind:   instructionpack.KindPrompt,
		Slug:   entry.ID,
		Name:   entry.Name,
		Title:  entry.Name,
		Body:   entry.Prompt,
		Metadata: map[string]any{
			"category": entry.Category,
			"type":     entry.Type,
		},
	}
}

func promptCategoryFromPackCategory(category promptpack.Category) PromptCategory {
	return normalizePromptCategory(PromptCategory{
		ID:      category.ID,
		Label:   category.Label,
		Source:  Source(category.Source),
		Builtin: category.Builtin || category.Source == string(SourcePack),
	})
}

func metadataString(metadata map[string]any, key string) string {
	value, ok := metadata[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
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

func categoryForType(_ string) string {
	return categoryExtra
}

func normalizeCategory(category string) string {
	return strings.TrimSpace(category)
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
