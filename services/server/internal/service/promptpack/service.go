// Package promptpack provides the global prompt pack store.
package promptpack

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	instructionbuiltin "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack/builtin"
	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack/codec"
	"github.com/mediago-dev/mediago-drama/services/server/internal/config"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

const (
	// DefaultPackID is the internal pack ID for repository-shipped default prompt content.
	DefaultPackID = "builtin"
	// BuiltinPackID is retained for compatibility with older callers.
	BuiltinPackID = DefaultPackID

	packSourceDefault  = "default"
	packSourceImported = "imported"
	entrySourcePack    = "pack"
	entrySourceUser    = "user"

	entryMetadataHidden = "hidden"
)

var (
	// ErrInvalidPack reports invalid pack data or operations.
	ErrInvalidPack = errors.New("invalid prompt pack")
	// ErrPackNotFound reports a missing installed pack.
	ErrPackNotFound = errors.New("prompt pack not found")
	// ErrPackReadonly reports attempts to remove protected packs.
	ErrPackReadonly = errors.New("prompt pack is read-only")
	// ErrEntryNotFound reports a missing pack entry.
	ErrEntryNotFound = errors.New("prompt pack entry not found")
	// ErrEntryExists reports attempts to create a duplicate entry.
	ErrEntryExists = errors.New("prompt pack entry already exists")
)

// Pack describes an installed prompt pack.
type Pack struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Author      string `json:"author,omitempty"`
	Description string `json:"description,omitempty"`
	Source      string `json:"source"`
	Origin      string `json:"origin,omitempty"`
	Enabled     bool   `json:"enabled"`
	CreatedAt   string `json:"createdAt,omitempty"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
}

// Entry describes one resolved prompt pack entry.
type Entry struct {
	ID             string               `json:"id"`
	PackID         string               `json:"packId"`
	Kind           instructionpack.Kind `json:"kind"`
	Slug           string               `json:"slug"`
	Name           string               `json:"name"`
	Title          string               `json:"title,omitempty"`
	Description    string               `json:"description,omitempty"`
	Body           string               `json:"body"`
	Metadata       map[string]any       `json:"metadata,omitempty"`
	Source         string               `json:"source"`
	OverriddenFrom string               `json:"overriddenFrom,omitempty"`
}

// Category describes a resolved prompt category.
type Category struct {
	ID      string `json:"id"`
	PackID  string `json:"packId"`
	Label   string `json:"label"`
	Order   int    `json:"order,omitempty"`
	Source  string `json:"source"`
	Builtin bool   `json:"builtin,omitempty"`
}

// Service coordinates prompt pack persistence and built-in seeding.
type Service struct {
	mu           sync.Mutex
	repo         *repository.PackRepository
	legacyRepo   *repository.PromptLibraryRepository
	initErr      error
	seeded       bool
	packFilesDir string
}

// NewService creates a prompt pack service backed by the default settings DB.
func NewService() *Service {
	settingsDBPath := config.DefaultSettingsDBPath()
	repos, err := repository.OpenSettingsRepositories(settingsDBPath)
	return NewServiceFromRepositoryWithPackFilesDir(
		repos.Packs,
		repos.PromptLibrary,
		err,
		defaultPackFilesDir(settingsDBPath),
	)
}

// NewServiceFromRepository creates a prompt pack service from settings repositories.
func NewServiceFromRepository(
	repo *repository.PackRepository,
	legacyRepo *repository.PromptLibraryRepository,
	initErr error,
) *Service {
	return NewServiceFromRepositoryWithPackFilesDir(repo, legacyRepo, initErr, "")
}

// NewServiceFromRepositoryWithPackFilesDir creates a prompt pack service with uploaded pack storage.
func NewServiceFromRepositoryWithPackFilesDir(
	repo *repository.PackRepository,
	legacyRepo *repository.PromptLibraryRepository,
	initErr error,
	packFilesDir string,
) *Service {
	return &Service{
		repo:         repo,
		legacyRepo:   legacyRepo,
		initErr:      initErr,
		packFilesDir: strings.TrimSpace(packFilesDir),
	}
}

// ListPacks returns every installed prompt pack.
func (store *Service) ListPacks(ctx context.Context) ([]Pack, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return nil, err
	}
	if err := store.ensureSingleEnabledPack(ctx); err != nil {
		return nil, err
	}
	models, err := store.repo.ListPacks()
	if err != nil {
		return nil, err
	}
	packs := make([]Pack, 0, len(models))
	for _, model := range models {
		packs = append(packs, packFromModel(model))
	}
	return packs, nil
}

// SetEnabled enables or disables one installed pack.
func (store *Service) SetEnabled(ctx context.Context, packID string, enabled bool) (Pack, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return Pack{}, err
	}
	packID = strings.TrimSpace(packID)
	if _, err := store.repo.GetPack(packID); repository.IsRecordNotFound(err) {
		return Pack{}, fmt.Errorf("%w: %s", ErrPackNotFound, packID)
	} else if err != nil {
		return Pack{}, err
	}
	if enabled {
		if err := store.repo.WithTransaction(ctx, func(tx *repository.PackRepository) error {
			if err := tx.SetPackEnabled(packID, true); err != nil {
				return err
			}
			return tx.DisableOtherPacks(packID)
		}); err != nil {
			return Pack{}, err
		}
	} else {
		if packID == DefaultPackID {
			if err := store.repo.SetPackEnabled(packID, false); err != nil {
				return Pack{}, err
			}
		} else if err := store.repo.WithTransaction(ctx, func(tx *repository.PackRepository) error {
			if err := tx.SetPackEnabled(packID, false); err != nil {
				return err
			}
			return tx.SetPackEnabled(DefaultPackID, true)
		}); err != nil {
			return Pack{}, err
		}
	}
	model, err := store.repo.GetPack(packID)
	if err != nil {
		return Pack{}, err
	}
	return packFromModel(model), nil
}

// Uninstall removes an imported pack.
func (store *Service) Uninstall(ctx context.Context, packID string) error {
	if err := store.ensureSeeded(ctx); err != nil {
		return err
	}
	packID = strings.TrimSpace(packID)
	pack, err := store.repo.GetPack(packID)
	if repository.IsRecordNotFound(err) {
		return fmt.Errorf("%w: %s", ErrPackNotFound, packID)
	} else if err != nil {
		return err
	}
	if pack.Source == packSourceDefault {
		return fmt.Errorf("%w: %s", ErrPackReadonly, packID)
	}
	return store.repo.DeletePack(packID)
}

// ResetPack restores package-owned entries and categories to the installed pack defaults.
func (store *Service) ResetPack(ctx context.Context, packID string) (Pack, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return Pack{}, err
	}
	packID = strings.TrimSpace(packID)
	pack, err := store.repo.GetPack(packID)
	if repository.IsRecordNotFound(err) {
		return Pack{}, fmt.Errorf("%w: %s", ErrPackNotFound, packID)
	}
	if err != nil {
		return Pack{}, err
	}
	defaults, err := store.bundleForInstalledPack(ctx, pack)
	if err != nil {
		return Pack{}, err
	}
	if strings.TrimSpace(defaults.Manifest.ID) != packID {
		return Pack{}, fmt.Errorf("%w: pack id mismatch", ErrInvalidPack)
	}
	if err := store.repo.WithTransaction(ctx, func(tx *repository.PackRepository) error {
		existing, err := tx.ListEntries()
		if err != nil {
			return err
		}
		userOwnedEntryIDs := map[string]bool{}
		for _, entry := range existing {
			if entry.PackID != packID {
				continue
			}
			if normalizeLegacyEntrySource(entry.Source) == entrySourceUser && strings.TrimSpace(entry.OverriddenFrom) == "" {
				userOwnedEntryIDs[entry.ID] = true
			}
		}
		if err := tx.DeleteResettableEntriesByPack(packID); err != nil {
			return err
		}
		if err := tx.DeletePackOwnedCategoriesByPack(packID); err != nil {
			return err
		}
		for _, category := range defaults.Categories {
			if err := tx.UpsertCategory(domain.PackCategoryModel{
				PackID:  packID,
				ID:      category.ID,
				Label:   category.Label,
				Order:   category.Order,
				Source:  entrySourcePack,
				Builtin: normalizePackSource(pack.Source, pack.ID) == packSourceDefault,
			}); err != nil {
				return err
			}
		}
		for _, entry := range defaults.Entries {
			if userOwnedEntryIDs[entry.ID] {
				continue
			}
			if err := tx.UpsertEntry(entryModelFromPackEntry(entry, entrySourcePack)); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return Pack{}, err
	}
	model, err := store.repo.GetPack(packID)
	if err != nil {
		return Pack{}, err
	}
	return packFromModel(model), nil
}

// InstallPath installs a local pack directory or .mgpack file.
func (store *Service) InstallPath(ctx context.Context, path string) (Pack, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return Pack{}, err
	}
	path = strings.TrimSpace(path)
	if path == "" {
		return Pack{}, fmt.Errorf("%w: path is required", ErrInvalidPack)
	}
	info, err := os.Stat(path)
	if err != nil {
		return Pack{}, fmt.Errorf("%w: reading path: %w", ErrInvalidPack, err)
	}
	var bundle instructionpack.Bundle
	if info.IsDir() {
		bundle, err = instructionpack.ParseDir(ctx, path)
	} else {
		bundle, err = parsePackFile(ctx, path)
	}
	if err != nil {
		return Pack{}, err
	}
	if bundle.Manifest.ID == DefaultPackID {
		return Pack{}, fmt.Errorf("%w: default pack cannot be imported", ErrInvalidPack)
	}
	if err := store.installBundle(ctx, bundle, packSourceImported, path); err != nil {
		return Pack{}, err
	}
	model, err := store.repo.GetPack(bundle.Manifest.ID)
	if err != nil {
		return Pack{}, err
	}
	return packFromModel(model), nil
}

// ListEntries returns resolved entries for a kind from enabled packs.
func (store *Service) ListEntries(ctx context.Context, kind instructionpack.Kind) ([]Entry, error) {
	if err := kind.Validate(); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidPack, err)
	}
	if err := store.ensureSeeded(ctx); err != nil {
		return nil, err
	}
	if err := store.ensureSingleEnabledPack(ctx); err != nil {
		return nil, err
	}
	models, err := store.repo.ListEnabledEntries(string(kind))
	if err != nil {
		return nil, err
	}
	entries := resolveEntryModels(models)
	sortEntries(entries)
	return entries, nil
}

// GetEntry returns one resolved entry by kind and slug.
func (store *Service) GetEntry(ctx context.Context, kind instructionpack.Kind, slug string) (Entry, error) {
	entries, err := store.ListEntries(ctx, kind)
	if err != nil {
		return Entry{}, err
	}
	slug = strings.TrimSpace(slug)
	for _, entry := range entries {
		if entry.Slug == slug {
			return entry, nil
		}
	}
	return Entry{}, fmt.Errorf("%w: %s/%s", ErrEntryNotFound, kind, slug)
}

// SaveEntry saves an existing entry as user-edited content.
func (store *Service) SaveEntry(ctx context.Context, kind instructionpack.Kind, slug string, entry Entry) (Entry, error) {
	if err := kind.Validate(); err != nil {
		return Entry{}, fmt.Errorf("%w: %w", ErrInvalidPack, err)
	}
	if err := store.ensureSeeded(ctx); err != nil {
		return Entry{}, err
	}
	current, err := store.GetEntry(ctx, kind, slug)
	if err != nil {
		return Entry{}, err
	}
	entry.Kind = kind
	entry.Slug = strings.TrimSpace(slug)
	if err := validateEntryForWrite(entry); err != nil {
		return Entry{}, err
	}
	entry.ID = current.ID
	entry.PackID = current.PackID
	entry.Source = entrySourceUser
	if current.Source == entrySourceUser && current.OverriddenFrom == "" {
		entry.OverriddenFrom = ""
	} else {
		entry.OverriddenFrom = current.ID
	}
	if err := store.repo.UpsertEntry(entryModelFromEntry(entry)); err != nil {
		return Entry{}, err
	}
	return store.GetEntry(ctx, kind, slug)
}

// CreateEntry creates a user-owned entry in the default pack namespace.
func (store *Service) CreateEntry(ctx context.Context, kind instructionpack.Kind, entry Entry) (Entry, error) {
	if err := kind.Validate(); err != nil {
		return Entry{}, fmt.Errorf("%w: %w", ErrInvalidPack, err)
	}
	if err := store.ensureSeeded(ctx); err != nil {
		return Entry{}, err
	}
	entry.Kind = kind
	entry.Slug = strings.TrimSpace(entry.Slug)
	if err := validateEntryForWrite(entry); err != nil {
		return Entry{}, err
	}
	if _, err := store.GetEntry(ctx, kind, entry.Slug); err == nil {
		return Entry{}, fmt.Errorf("%w: %s/%s", ErrEntryExists, kind, entry.Slug)
	} else if !errors.Is(err, ErrEntryNotFound) {
		return Entry{}, err
	}
	entry.PackID = DefaultPackID
	entry.ID = instructionpack.EntryID(DefaultPackID, kind, entry.Slug)
	entry.Source = entrySourceUser
	if err := store.repo.UpsertEntry(entryModelFromEntry(entry)); err != nil {
		return Entry{}, err
	}
	return store.GetEntry(ctx, kind, entry.Slug)
}

// ResetEntry restores a package-backed entry to the current package default.
func (store *Service) ResetEntry(ctx context.Context, kind instructionpack.Kind, slug string) (Entry, error) {
	if err := kind.Validate(); err != nil {
		return Entry{}, fmt.Errorf("%w: %w", ErrInvalidPack, err)
	}
	if err := store.ensureSeeded(ctx); err != nil {
		return Entry{}, err
	}
	current, err := store.GetEntry(ctx, kind, slug)
	if err != nil {
		return Entry{}, err
	}
	if current.Source == entrySourceUser && current.OverriddenFrom == "" {
		return Entry{}, fmt.Errorf("%w: %s/%s", ErrPackReadonly, kind, slug)
	}
	pack, err := store.repo.GetPack(current.PackID)
	if repository.IsRecordNotFound(err) {
		return Entry{}, fmt.Errorf("%w: %s", ErrPackNotFound, current.PackID)
	}
	if err != nil {
		return Entry{}, err
	}
	defaults, err := store.bundleForInstalledPack(ctx, pack)
	if err != nil {
		return Entry{}, err
	}
	for _, defaultEntry := range defaults.Entries {
		if defaultEntry.Kind != kind || defaultEntry.Slug != strings.TrimSpace(slug) {
			continue
		}
		model := entryModelFromPackEntry(defaultEntry, entrySourcePack)
		if err := store.repo.UpsertEntry(model); err != nil {
			return Entry{}, err
		}
		return store.GetEntry(ctx, kind, slug)
	}
	return Entry{}, fmt.Errorf("%w: %s/%s", ErrEntryNotFound, kind, slug)
}

// DeleteEntry removes a user-created entry. Package entries can be reset or uninstalled.
func (store *Service) DeleteEntry(ctx context.Context, kind instructionpack.Kind, slug string) error {
	if err := kind.Validate(); err != nil {
		return fmt.Errorf("%w: %w", ErrInvalidPack, err)
	}
	if err := store.ensureSeeded(ctx); err != nil {
		return err
	}
	current, err := store.GetEntry(ctx, kind, slug)
	if err != nil {
		return err
	}
	if current.Source != entrySourceUser || current.OverriddenFrom != "" {
		return fmt.Errorf("%w: %s/%s", ErrPackReadonly, kind, slug)
	}
	return store.repo.DeleteEntry(current.ID)
}

// HideEntry removes a user-created entry or hides a package-backed entry.
func (store *Service) HideEntry(ctx context.Context, kind instructionpack.Kind, slug string) error {
	if err := kind.Validate(); err != nil {
		return fmt.Errorf("%w: %w", ErrInvalidPack, err)
	}
	if err := store.ensureSeeded(ctx); err != nil {
		return err
	}
	current, err := store.GetEntry(ctx, kind, slug)
	if err != nil {
		return err
	}
	if current.Source == entrySourceUser && current.OverriddenFrom == "" {
		return store.repo.DeleteEntry(current.ID)
	}
	hidden := current
	hidden.Source = entrySourceUser
	hidden.OverriddenFrom = nonEmpty(current.OverriddenFrom, current.ID)
	hidden.Metadata = cloneMetadata(current.Metadata)
	if hidden.Metadata == nil {
		hidden.Metadata = map[string]any{}
	}
	hidden.Metadata[entryMetadataHidden] = true
	if err := store.repo.UpsertEntry(entryModelFromEntry(hidden)); err != nil {
		return err
	}
	return nil
}

// ListCategories returns resolved prompt categories from enabled packs.
func (store *Service) ListCategories(ctx context.Context) ([]Category, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return nil, err
	}
	if err := store.ensureSingleEnabledPack(ctx); err != nil {
		return nil, err
	}
	models, err := store.repo.ListEnabledCategories()
	if err != nil {
		return nil, err
	}
	categories := resolveCategoryModels(models)
	sort.SliceStable(categories, func(first, second int) bool {
		if categories[first].Order != categories[second].Order {
			return categories[first].Order < categories[second].Order
		}
		return categories[first].ID < categories[second].ID
	})
	return categories, nil
}

// CreateCategory creates a user prompt category in the default pack namespace.
func (store *Service) CreateCategory(ctx context.Context, category Category) (Category, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return Category{}, err
	}
	category.ID = strings.TrimSpace(strings.ToLower(category.ID))
	if category.ID == "" || category.Label == "" {
		return Category{}, fmt.Errorf("%w: category id and label are required", ErrInvalidPack)
	}
	category.PackID = DefaultPackID
	category.Source = entrySourceUser
	model := categoryModelFromCategory(category)
	if err := store.repo.UpsertCategory(model); err != nil {
		return Category{}, err
	}
	return categoryFromModel(model), nil
}

func (store *Service) ensureSeeded(ctx context.Context) error {
	store.mu.Lock()
	defer store.mu.Unlock()

	if store.seeded {
		return nil
	}
	if err := store.ensureReady(ctx); err != nil {
		return err
	}
	err := store.repo.WithTransaction(ctx, func(tx *repository.PackRepository) error {
		transactional := &Service{repo: tx, legacyRepo: store.legacyRepo, initErr: store.initErr}
		if err := transactional.repo.NormalizeLegacySources(); err != nil {
			return err
		}
		if err := transactional.migrateLegacyPromptLibrary(ctx); err != nil {
			return err
		}
		if err := transactional.seedBuiltinPack(ctx); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return err
	}
	store.seeded = true
	return nil
}

func (store *Service) ensureReady(ctx context.Context) error {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	if store.initErr != nil {
		return store.initErr
	}
	if store.repo == nil {
		return errors.New("prompt pack repository is nil")
	}
	return nil
}

func (store *Service) ensureSingleEnabledPack(ctx context.Context) error {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	models, err := store.repo.ListPacks()
	if err != nil {
		return err
	}
	enabled := make([]domain.PackModel, 0, len(models))
	for _, model := range models {
		if model.Enabled {
			enabled = append(enabled, model)
		}
	}
	if len(enabled) <= 1 {
		return nil
	}
	keep := preferredEnabledPack(enabled)
	return store.repo.DisableOtherPacks(keep.ID)
}

func preferredEnabledPack(models []domain.PackModel) domain.PackModel {
	preferred := models[0]
	for _, model := range models[1:] {
		if packModelPreferredOver(model, preferred) {
			preferred = model
		}
	}
	return preferred
}

func packModelPreferredOver(left domain.PackModel, right domain.PackModel) bool {
	leftDefault := normalizePackSource(left.Source, left.ID) == packSourceDefault
	rightDefault := normalizePackSource(right.Source, right.ID) == packSourceDefault
	if leftDefault != rightDefault {
		return !leftDefault
	}
	if !left.UpdatedAt.Equal(right.UpdatedAt) {
		return left.UpdatedAt.After(right.UpdatedAt)
	}
	if !left.CreatedAt.Equal(right.CreatedAt) {
		return left.CreatedAt.After(right.CreatedAt)
	}
	return left.ID > right.ID
}

func (store *Service) migrateLegacyPromptLibrary(ctx context.Context) error {
	if store.legacyRepo == nil {
		return nil
	}
	existing, err := store.repo.ListEntries()
	if err != nil {
		return err
	}
	if len(existing) > 0 {
		return nil
	}
	categories, err := store.legacyRepo.ListPromptCategories()
	if err != nil {
		return err
	}
	entries, err := store.legacyRepo.ListPromptLibraryEntries()
	if err != nil {
		return err
	}
	if len(categories) > 0 || len(entries) > 0 {
		bundle, err := instructionbuiltin.Builtin(ctx)
		if err != nil {
			return err
		}
		if _, err := store.upsertPackFromBundle(bundle, packSourceDefault, ""); err != nil {
			return err
		}
	}
	for _, category := range categories {
		model := domain.PackCategoryModel{
			PackID:  DefaultPackID,
			ID:      category.ID,
			Label:   category.Label,
			Source:  normalizeLegacyEntrySource(nonEmpty(category.Source, entrySourceUser)),
			Builtin: category.Builtin,
		}
		if err := store.repo.UpsertCategory(model); err != nil {
			return err
		}
	}
	for _, entry := range entries {
		metadata := map[string]any{
			"category": strings.TrimSpace(entry.Category),
			"type":     strings.TrimSpace(entry.Type),
		}
		id := instructionpack.EntryID(DefaultPackID, instructionpack.KindPrompt, entry.ID)
		source := normalizeLegacyEntrySource(nonEmpty(entry.Source, entrySourceUser))
		model := domain.PackEntryModel{
			ID:             id,
			PackID:         DefaultPackID,
			Kind:           string(instructionpack.KindPrompt),
			Slug:           entry.ID,
			Name:           entry.Name,
			Title:          entry.Name,
			Body:           entry.Prompt,
			Metadata:       mustJSON(metadata),
			Source:         source,
			OverriddenFrom: overriddenFromForLegacy(id, source, entry.Builtin),
		}
		if err := store.repo.UpsertEntry(model); err != nil {
			return err
		}
	}
	if ctx == nil {
		return nil
	}
	return ctx.Err()
}

func (store *Service) seedBuiltinPack(ctx context.Context) error {
	bundle, err := instructionbuiltin.Builtin(ctx)
	if err != nil {
		return err
	}
	if _, err := store.upsertPackFromBundle(bundle, packSourceDefault, ""); err != nil {
		return err
	}
	for _, category := range bundle.Categories {
		model := domain.PackCategoryModel{
			PackID:  bundle.Manifest.ID,
			ID:      category.ID,
			Label:   category.Label,
			Order:   category.Order,
			Source:  entrySourcePack,
			Builtin: true,
		}
		if err := store.repo.UpsertCategory(model); err != nil {
			return err
		}
	}
	for _, entry := range bundle.Entries {
		current, err := store.repo.GetEntry(entry.ID)
		if err != nil && !repository.IsRecordNotFound(err) {
			return err
		}
		if err == nil && current.Source == entrySourceUser {
			continue
		}
		if err := store.repo.UpsertEntry(entryModelFromPackEntry(entry, entrySourcePack)); err != nil {
			return err
		}
	}
	return nil
}

func (store *Service) installBundle(ctx context.Context, bundle instructionpack.Bundle, source string, origin string) error {
	return store.repo.WithTransaction(ctx, func(tx *repository.PackRepository) error {
		transactional := &Service{repo: tx, legacyRepo: store.legacyRepo, initErr: store.initErr}
		enabled, err := transactional.upsertPackFromBundle(bundle, source, origin)
		if err != nil {
			return err
		}
		if enabled {
			if err := tx.DisableOtherPacks(bundle.Manifest.ID); err != nil {
				return err
			}
		}
		if err := tx.DeleteEntriesByPack(bundle.Manifest.ID); err != nil {
			return err
		}
		if err := tx.DeleteCategoriesByPack(bundle.Manifest.ID); err != nil {
			return err
		}
		for _, category := range bundle.Categories {
			if err := tx.UpsertCategory(domain.PackCategoryModel{
				PackID:  bundle.Manifest.ID,
				ID:      category.ID,
				Label:   category.Label,
				Order:   category.Order,
				Source:  entrySourcePack,
				Builtin: source == packSourceDefault,
			}); err != nil {
				return err
			}
		}
		for _, entry := range bundle.Entries {
			if err := tx.UpsertEntry(entryModelFromPackEntry(entry, entrySourcePack)); err != nil {
				return err
			}
		}
		return nil
	})
}

func (store *Service) upsertPackFromBundle(bundle instructionpack.Bundle, source string, origin string) (bool, error) {
	enabled := true
	if existing, err := store.repo.GetPack(bundle.Manifest.ID); err == nil {
		enabled = existing.Enabled
	} else if err != nil && !repository.IsRecordNotFound(err) {
		return false, err
	}
	if err := store.repo.UpsertPack(domain.PackModel{
		ID:          bundle.Manifest.ID,
		Name:        bundle.Manifest.Name,
		Version:     bundle.Manifest.Version,
		Author:      bundle.Manifest.Author,
		Description: bundle.Manifest.Description,
		Source:      source,
		Origin:      origin,
		Enabled:     enabled,
	}); err != nil {
		return false, err
	}
	return enabled, nil
}

func (store *Service) bundleForInstalledPack(ctx context.Context, pack domain.PackModel) (instructionpack.Bundle, error) {
	switch normalizePackSource(pack.Source, pack.ID) {
	case packSourceDefault:
		return instructionbuiltin.Builtin(ctx)
	case packSourceImported:
		origin := strings.TrimSpace(pack.Origin)
		if origin == "" {
			return instructionpack.Bundle{}, fmt.Errorf("%w: imported pack origin is empty", ErrInvalidPack)
		}
		info, err := os.Stat(origin)
		if err != nil {
			return instructionpack.Bundle{}, fmt.Errorf("%w: reading pack origin: %w", ErrInvalidPack, err)
		}
		if info.IsDir() {
			return instructionpack.ParseDir(ctx, origin)
		}
		return parsePackFile(ctx, origin)
	default:
		return instructionpack.Bundle{}, fmt.Errorf("%w: unsupported pack source %q", ErrInvalidPack, pack.Source)
	}
}

func parsePackFile(ctx context.Context, path string) (instructionpack.Bundle, error) {
	if filepath.Ext(path) != ".mgpack" {
		return instructionpack.Bundle{}, fmt.Errorf("%w: expected .mgpack file", ErrInvalidPack)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return instructionpack.Bundle{}, fmt.Errorf("reading pack file: %w", err)
	}
	archive, err := codec.Decode(data)
	if err != nil {
		return instructionpack.Bundle{}, err
	}
	bundle, err := instructionpack.ParseZip(ctx, archive)
	if err != nil {
		return instructionpack.Bundle{}, err
	}
	return bundle, nil
}

func defaultPackFilesDir(settingsDBPath string) string {
	settingsDBPath = strings.TrimSpace(settingsDBPath)
	if settingsDBPath == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(settingsDBPath), "packs")
}
