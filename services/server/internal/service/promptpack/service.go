// Package promptpack provides the global prompt pack store.
package promptpack

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
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
	packSourceLocal    = "local"
	entrySourcePack    = "pack"
	entrySourceUser    = "user"

	entryMetadataHidden         = "hidden"
	entryMetadataCopiedFrom     = "copied_from"
	entryMetadataCopiedFromPack = "copied_from_pack"
	entryMetadataLinked         = "linked"

	maxCopyEntryReferences = 200
)

var (
	// ErrInvalidPack reports invalid pack data or operations.
	ErrInvalidPack = errors.New("invalid prompt pack")
	// ErrUnsupportedPackVersion reports a valid .mgpack version this build cannot import.
	ErrUnsupportedPackVersion = errors.New("unsupported prompt pack version")
	// ErrPackNotFound reports a missing installed pack.
	ErrPackNotFound = errors.New("prompt pack not found")
	// ErrPackExists reports an attempt to reuse an installed pack ID.
	ErrPackExists = errors.New("prompt pack already exists")
	// ErrPackReadonly reports attempts to remove protected packs.
	ErrPackReadonly = errors.New("prompt pack is read-only")
	// ErrEntryNotFound reports a missing pack entry.
	ErrEntryNotFound = errors.New("prompt pack entry not found")
	// ErrEntryExists reports attempts to create a duplicate entry.
	ErrEntryExists = errors.New("prompt pack entry already exists")
)

var localPackIDPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$`)

// Pack describes an installed prompt pack.
type Pack struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	ReleaseID   string `json:"releaseId,omitempty"`
	Author      string `json:"author,omitempty"`
	Description string `json:"description,omitempty"`
	Source      string `json:"source"`
	Origin      string `json:"origin,omitempty"`
	Enabled     bool   `json:"enabled"`
	CreatedAt   string `json:"createdAt,omitempty"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
	SkillCount  int    `json:"skillCount"`
	PromptCount int    `json:"promptCount"`
}

// Entry describes one resolved prompt pack entry.
type Entry struct {
	ID                string               `json:"id"`
	PackID            string               `json:"packId"`
	ReleaseID         string               `json:"releaseId,omitempty"`
	SourcePackageID   string               `json:"sourcePackageId,omitempty"`
	SourceReleaseID   string               `json:"sourceReleaseId,omitempty"`
	Kind              instructionpack.Kind `json:"kind"`
	Slug              string               `json:"slug"`
	Name              string               `json:"name"`
	Title             string               `json:"title,omitempty"`
	Description       string               `json:"description,omitempty"`
	Body              string               `json:"body"`
	Metadata          map[string]any       `json:"metadata,omitempty"`
	Source            string               `json:"source"`
	OverriddenFrom    string               `json:"overriddenFrom,omitempty"`
	Linked            bool                 `json:"linked,omitempty"`
	ReferenceEntryID  string               `json:"referenceEntryId,omitempty"`
	ReferencePackID   string               `json:"referencePackId,omitempty"`
	ReferenceSlug     string               `json:"referenceSlug,omitempty"`
	ReferenceSource   string               `json:"referenceSource,omitempty"`
	ReferenceEditable bool                 `json:"referenceEditable,omitempty"`
	ReferenceMissing  bool                 `json:"referenceMissing,omitempty"`
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

// EntryReference identifies one source entry to copy into a local authoring pack.
type EntryReference struct {
	PackID string               `json:"packId"`
	Kind   instructionpack.Kind `json:"kind"`
	Slug   string               `json:"slug"`
}

// EntryUpdate contains the editable fields accepted by a package-scoped save.
// Canonical identity and release fields are always inherited from storage.
type EntryUpdate struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Body        string         `json:"body"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

// PackContents contains one pack and its direct or linked draft entries.
type PackContents struct {
	Pack    Pack    `json:"pack"`
	Entries []Entry `json:"entries"`
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
	if err := store.ensureDefaultEnabled(ctx); err != nil {
		return nil, err
	}
	models, err := store.repo.ListPacks()
	if err != nil {
		return nil, err
	}
	entryModels, err := store.repo.ListEntries()
	if err != nil {
		return nil, err
	}
	counts := make(map[string]map[instructionpack.Kind]int, len(models))
	for _, model := range entryModels {
		entry := entryFromModel(model)
		if entryIsHidden(entry) {
			continue
		}
		if counts[model.PackID] == nil {
			counts[model.PackID] = map[instructionpack.Kind]int{}
		}
		counts[model.PackID][entry.Kind]++
	}
	packs := make([]Pack, 0, len(models))
	for _, model := range models {
		pack := packFromModel(model)
		pack.SkillCount = counts[model.ID][instructionpack.KindSkill]
		pack.PromptCount = counts[model.ID][instructionpack.KindPrompt]
		packs = append(packs, pack)
	}
	return packs, nil
}

// GetPack returns one installed prompt pack.
func (store *Service) GetPack(ctx context.Context, packID string) (Pack, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return Pack{}, err
	}
	model, err := store.repo.GetPack(strings.TrimSpace(packID))
	if repository.IsRecordNotFound(err) {
		return Pack{}, fmt.Errorf("%w: %s", ErrPackNotFound, strings.TrimSpace(packID))
	}
	if err != nil {
		return Pack{}, err
	}
	return packFromModel(model), nil
}

// RecordSubmittedRelease records the latest platform submission for a local
// authoring pack so its next release can advance without changing package ID.
func (store *Service) RecordSubmittedRelease(
	ctx context.Context,
	packID string,
	releaseID string,
	version string,
) (Pack, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return Pack{}, err
	}
	packID = strings.TrimSpace(packID)
	releaseID = strings.TrimSpace(releaseID)
	version = strings.TrimSpace(version)
	if packID == "" || releaseID == "" || version == "" {
		return Pack{}, fmt.Errorf("%w: pack, release, and version are required", ErrInvalidPack)
	}
	model, err := store.repo.GetPack(packID)
	if repository.IsRecordNotFound(err) {
		return Pack{}, fmt.Errorf("%w: %s", ErrPackNotFound, packID)
	}
	if err != nil {
		return Pack{}, err
	}
	if normalizePackSource(model.Source, model.ID) != packSourceLocal {
		return Pack{}, fmt.Errorf("%w: only local authoring packs can record releases", ErrPackReadonly)
	}
	if err := store.repo.SetPackReleaseVersion(packID, releaseID, version); err != nil {
		return Pack{}, err
	}
	return store.GetPack(ctx, packID)
}

// PromoteImportedPackToLocal converts an installed formal release snapshot
// into a standalone authoring draft. Callers must authorize the publisher
// before invoking this local state transition.
func (store *Service) PromoteImportedPackToLocal(ctx context.Context, packID string) (Pack, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return Pack{}, err
	}
	packID = strings.TrimSpace(packID)
	if packID == "" {
		return Pack{}, fmt.Errorf("%w: pack id is required", ErrInvalidPack)
	}

	err := store.repo.WithTransaction(ctx, func(tx *repository.PackRepository) error {
		pack, err := tx.GetPack(packID)
		if repository.IsRecordNotFound(err) {
			return fmt.Errorf("%w: %s", ErrPackNotFound, packID)
		}
		if err != nil {
			return err
		}
		if strings.TrimSpace(pack.ReleaseID) == "" {
			return fmt.Errorf("%w: only formal releases can recover an authoring draft", ErrPackReadonly)
		}
		source := normalizePackSource(pack.Source, pack.ID)
		if source == packSourceLocal {
			return nil
		}
		if source != packSourceImported {
			return fmt.Errorf("%w: only imported formal releases can recover an authoring draft", ErrPackReadonly)
		}

		entries, err := tx.ListEntries()
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if entry.PackID != packID {
				continue
			}
			if entryIsHidden(entryFromModel(entry)) {
				if err := tx.DeleteEntry(entry.ID); err != nil {
					return err
				}
				continue
			}
			metadata := metadataFromJSON(entry.Metadata)
			delete(metadata, entryMetadataHidden)
			entry.Metadata = mustJSON(metadata)
			entry.Source = entrySourceUser
			entry.OverriddenFrom = ""
			entry.ReleaseID = ""
			if err := tx.UpsertEntry(entry); err != nil {
				return err
			}
		}

		categories, err := tx.ListCategories()
		if err != nil {
			return err
		}
		for _, category := range categories {
			if category.PackID != packID {
				continue
			}
			category.Source = entrySourceUser
			category.Builtin = false
			if err := tx.UpsertCategory(category); err != nil {
				return err
			}
		}

		pack.Source = packSourceLocal
		pack.Origin = ""
		return tx.UpsertPack(pack)
	})
	if err != nil {
		return Pack{}, err
	}
	return store.GetPack(ctx, packID)
}

// GetPackContents returns one pack and its direct or linked entries, including
// content from a disabled pack. Linked draft entries resolve against their
// current source while formal exports remain complete snapshots.
func (store *Service) GetPackContents(ctx context.Context, packID string) (PackContents, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return PackContents{}, err
	}
	packID = strings.TrimSpace(packID)
	model, err := store.repo.GetPack(packID)
	if repository.IsRecordNotFound(err) {
		return PackContents{}, fmt.Errorf("%w: %s", ErrPackNotFound, packID)
	}
	if err != nil {
		return PackContents{}, err
	}
	models, err := store.repo.ListEntries()
	if err != nil {
		return PackContents{}, err
	}
	entries := resolvePackEntryModels(models, packID)
	sortEntries(entries)
	pack := packFromModel(model)
	for _, entry := range entries {
		switch entry.Kind {
		case instructionpack.KindSkill:
			pack.SkillCount++
		case instructionpack.KindPrompt:
			pack.PromptCount++
		}
	}
	return PackContents{Pack: pack, Entries: entries}, nil
}

// CreatePack creates an empty local authoring pack.
func (store *Service) CreatePack(ctx context.Context, pack Pack) (Pack, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return Pack{}, err
	}
	pack.ID = strings.TrimSpace(pack.ID)
	pack.Name = strings.TrimSpace(pack.Name)
	pack.Version = strings.TrimSpace(pack.Version)
	pack.Author = strings.TrimSpace(pack.Author)
	pack.Description = strings.TrimSpace(pack.Description)
	if pack.Version == "" {
		pack.Version = "1.0.0"
	}
	if !localPackIDPattern.MatchString(pack.ID) || pack.Name == "" || len(pack.Name) > 160 || len(pack.Version) > 64 {
		return Pack{}, fmt.Errorf("%w: local pack id, name, or version is invalid", ErrInvalidPack)
	}
	if pack.ID == DefaultPackID {
		return Pack{}, fmt.Errorf("%w: default pack id is reserved", ErrInvalidPack)
	}
	if _, err := store.repo.GetPack(pack.ID); err == nil {
		return Pack{}, fmt.Errorf("%w: %s", ErrPackExists, pack.ID)
	} else if !repository.IsRecordNotFound(err) {
		return Pack{}, err
	}
	if err := store.repo.UpsertPack(domain.PackModel{
		ID:          pack.ID,
		Name:        pack.Name,
		Version:     pack.Version,
		Author:      pack.Author,
		Description: pack.Description,
		Source:      packSourceLocal,
		Enabled:     true,
	}); err != nil {
		return Pack{}, err
	}
	return store.GetPack(ctx, pack.ID)
}

// CopyEntries links resolved source entries into a local authoring pack. A
// materialized row preserves v1 export compatibility while reads resolve the
// latest source content and global content lists continue to show one entry.
func (store *Service) CopyEntries(
	ctx context.Context,
	targetPackID string,
	references []EntryReference,
) ([]Entry, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return nil, err
	}
	targetPackID = strings.TrimSpace(targetPackID)
	if len(references) == 0 || len(references) > maxCopyEntryReferences {
		return nil, fmt.Errorf("%w: between 1 and %d entries are required", ErrInvalidPack, maxCopyEntryReferences)
	}

	normalized := make([]EntryReference, 0, len(references))
	seenReferences := map[string]bool{}
	for _, reference := range references {
		reference.PackID = strings.TrimSpace(reference.PackID)
		reference.Slug = strings.TrimSpace(reference.Slug)
		if reference.PackID == "" || reference.Slug == "" {
			return nil, fmt.Errorf("%w: source pack id and slug are required", ErrInvalidPack)
		}
		if err := reference.Kind.Validate(); err != nil {
			return nil, fmt.Errorf("%w: %w", ErrInvalidPack, err)
		}
		if reference.PackID == targetPackID {
			return nil, fmt.Errorf("%w: source entry already belongs to target pack", ErrInvalidPack)
		}
		key := reference.PackID + "/" + string(reference.Kind) + "/" + reference.Slug
		if seenReferences[key] {
			continue
		}
		seenReferences[key] = true
		normalized = append(normalized, reference)
	}

	createdIDs := make([]string, 0, len(normalized))
	err := store.repo.WithTransaction(ctx, func(tx *repository.PackRepository) error {
		target, err := tx.GetPack(targetPackID)
		if repository.IsRecordNotFound(err) {
			return fmt.Errorf("%w: %s", ErrPackNotFound, targetPackID)
		}
		if err != nil {
			return err
		}
		if normalizePackSource(target.Source, target.ID) != packSourceLocal {
			return fmt.Errorf("%w: only local authoring packs accept copied entries", ErrPackReadonly)
		}

		allEntries, err := tx.ListEntries()
		if err != nil {
			return err
		}
		usedSlugs := make(map[string]bool, len(allEntries)+len(normalized))
		linkedSourceIDs := make(map[string]bool, len(allEntries))
		for _, model := range allEntries {
			usedSlugs[model.Kind+"/"+model.Slug] = true
			if model.PackID == targetPackID {
				metadata := metadataFromJSON(model.Metadata)
				referenceID := metadataText(metadata, entryMetadataCopiedFrom)
				if metadataBool(metadata, entryMetadataLinked) && referenceID != "" {
					linkedSourceIDs[referenceID] = true
				}
			}
		}
		categories, err := tx.ListCategories()
		if err != nil {
			return err
		}

		for _, reference := range normalized {
			sourceModel, err := tx.GetEntryByPackKindSlug(reference.PackID, string(reference.Kind), reference.Slug)
			if repository.IsRecordNotFound(err) {
				return fmt.Errorf("%w: %s/%s/%s", ErrEntryNotFound, reference.PackID, reference.Kind, reference.Slug)
			}
			if err != nil {
				return err
			}
			source := entryFromModel(sourceModel)
			if entryIsHidden(source) {
				return fmt.Errorf("%w: %s/%s/%s", ErrEntryNotFound, reference.PackID, reference.Kind, reference.Slug)
			}
			if linkedSourceIDs[source.ID] {
				return fmt.Errorf("%w: source entry is already in target pack", ErrEntryExists)
			}

			copiedEntry := source
			copiedEntry.SourcePackageID, copiedEntry.SourceReleaseID = contentProvenance(source)
			copiedEntry.PackID = targetPackID
			copiedEntry.ReleaseID = target.ReleaseID
			copiedEntry.Slug = nextCopySlug(source.Slug, source.Kind, usedSlugs)
			copiedEntry.ID = instructionpack.EntryID(targetPackID, source.Kind, copiedEntry.Slug)
			copiedEntry.Source = entrySourceUser
			copiedEntry.OverriddenFrom = ""
			copiedEntry.Metadata = cloneMetadata(source.Metadata)
			if copiedEntry.Metadata == nil {
				copiedEntry.Metadata = map[string]any{}
			}
			copiedEntry.Metadata[entryMetadataCopiedFrom] = source.ID
			copiedEntry.Metadata[entryMetadataCopiedFromPack] = source.PackID
			copiedEntry.Metadata[entryMetadataLinked] = true
			if copiedEntry.Kind == instructionpack.KindSkill {
				copiedEntry.Name = copiedEntry.Slug
			}
			if err := validateEntryForWrite(copiedEntry); err != nil {
				return err
			}
			if err := copyPromptCategory(tx, targetPackID, source.PackID, copiedEntry, categories); err != nil {
				return err
			}
			if err := tx.UpsertEntry(entryModelFromEntry(copiedEntry)); err != nil {
				return err
			}
			linkedSourceIDs[source.ID] = true
			createdIDs = append(createdIDs, copiedEntry.ID)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	contents, err := store.GetPackContents(ctx, targetPackID)
	if err != nil {
		return nil, err
	}
	created := make(map[string]bool, len(createdIDs))
	for _, id := range createdIDs {
		created[id] = true
	}
	linked := make([]Entry, 0, len(createdIDs))
	for _, entry := range contents.Entries {
		if created[entry.ID] {
			linked = append(linked, entry)
		}
	}
	sortEntries(linked)
	return linked, nil
}

// DetachEntry converts a linked draft entry into a package-owned version.
func (store *Service) DetachEntry(ctx context.Context, packID string, entryID string) (Entry, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return Entry{}, err
	}
	packID = strings.TrimSpace(packID)
	entryID = strings.TrimSpace(entryID)
	pack, err := store.repo.GetPack(packID)
	if repository.IsRecordNotFound(err) {
		return Entry{}, fmt.Errorf("%w: %s", ErrPackNotFound, packID)
	}
	if err != nil {
		return Entry{}, err
	}
	if normalizePackSource(pack.Source, pack.ID) != packSourceLocal {
		return Entry{}, fmt.Errorf("%w: only local authoring packs can detach entries", ErrPackReadonly)
	}
	models, err := store.repo.ListEntries()
	if err != nil {
		return Entry{}, err
	}
	var target domain.PackEntryModel
	found := false
	for _, model := range models {
		if model.ID == entryID && model.PackID == packID {
			target = model
			found = true
			break
		}
	}
	if !found {
		return Entry{}, fmt.Errorf("%w: %s", ErrEntryNotFound, entryID)
	}
	resolved := resolveLinkedEntryModel(target, entryModelsByID(models), map[string]bool{})
	if !resolved.Linked {
		return resolved, nil
	}
	resolved.Metadata = cloneMetadata(resolved.Metadata)
	delete(resolved.Metadata, entryMetadataCopiedFrom)
	delete(resolved.Metadata, entryMetadataCopiedFromPack)
	delete(resolved.Metadata, entryMetadataLinked)
	resolved.Linked = false
	resolved.ReferenceEntryID = ""
	resolved.ReferencePackID = ""
	resolved.ReferenceSlug = ""
	resolved.ReferenceSource = ""
	resolved.ReferenceEditable = false
	resolved.ReferenceMissing = false
	resolved.Source = entrySourceUser
	resolved.OverriddenFrom = ""
	if err := store.repo.UpsertEntry(entryModelFromEntry(resolved)); err != nil {
		return Entry{}, err
	}
	return entryFromModel(entryModelFromEntry(resolved)), nil
}

// RemoveEntry removes one direct or linked entry from a local authoring pack.
func (store *Service) RemoveEntry(ctx context.Context, packID string, entryID string) error {
	if err := store.ensureSeeded(ctx); err != nil {
		return err
	}
	packID = strings.TrimSpace(packID)
	entryID = strings.TrimSpace(entryID)
	pack, err := store.repo.GetPack(packID)
	if repository.IsRecordNotFound(err) {
		return fmt.Errorf("%w: %s", ErrPackNotFound, packID)
	}
	if err != nil {
		return err
	}
	if normalizePackSource(pack.Source, pack.ID) != packSourceLocal {
		return fmt.Errorf("%w: only local authoring packs can remove entries", ErrPackReadonly)
	}
	model, err := store.repo.GetEntry(entryID)
	if repository.IsRecordNotFound(err) || model.PackID != packID {
		return fmt.Errorf("%w: %s", ErrEntryNotFound, entryID)
	}
	if err != nil {
		return err
	}
	entry := entryFromModel(model)
	if entry.Source != entrySourceUser || entry.OverriddenFrom != "" {
		return fmt.Errorf("%w: %s", ErrPackReadonly, entryID)
	}
	return store.repo.DeleteEntry(entryID)
}

// SetEnabled enables or disables one installed pack. Packs are additive: the
// built-in default pack is always enabled as a base layer and installed packs
// stack on top, so enabling one never disables another.
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
	// The default pack stays usable at all times; disabling it is a no-op.
	if !(packID == DefaultPackID && !enabled) {
		if err := store.repo.SetPackEnabled(packID, enabled); err != nil {
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
	source := packSourceImported
	if info.IsDir() {
		bundle, err = instructionpack.ParseDir(ctx, path)
	} else {
		bundle, err = store.parsePackFile(ctx, path)
	}
	if err != nil {
		return Pack{}, err
	}
	if bundle.Manifest.ID == DefaultPackID {
		return Pack{}, fmt.Errorf("%w: default pack cannot be imported", ErrInvalidPack)
	}
	if err := store.installBundle(ctx, bundle, source, path); err != nil {
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
	if err := store.ensureDefaultEnabled(ctx); err != nil {
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
	entry.ReleaseID = current.ReleaseID
	entry.SourcePackageID = current.SourcePackageID
	entry.SourceReleaseID = current.SourceReleaseID
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

// SavePackEntry saves one exact package entry without resolving by its global
// slug. Linked rows must be detached first or their canonical source targeted.
func (store *Service) SavePackEntry(
	ctx context.Context,
	packID string,
	entryID string,
	update EntryUpdate,
) (Entry, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return Entry{}, err
	}
	current, err := store.getPackEntry(packID, entryID)
	if err != nil {
		return Entry{}, err
	}
	if current.Linked {
		return Entry{}, fmt.Errorf("%w: linked entries must be detached or edited at their source", ErrPackReadonly)
	}

	updated := current
	updated.Body = update.Body
	updated.Source = entrySourceUser
	if current.Kind == instructionpack.KindPrompt {
		updated.Name = strings.TrimSpace(update.Name)
	} else {
		updated.Description = strings.TrimSpace(update.Description)
	}
	updated.Metadata = cloneMetadata(current.Metadata)
	if updated.Metadata == nil && len(update.Metadata) > 0 {
		updated.Metadata = make(map[string]any, len(update.Metadata))
	}
	for key, value := range update.Metadata {
		switch key {
		case entryMetadataCopiedFrom, entryMetadataCopiedFromPack, entryMetadataLinked:
			continue
		default:
			updated.Metadata[key] = value
		}
	}
	if current.Source == entrySourceUser && current.OverriddenFrom == "" {
		updated.OverriddenFrom = ""
	} else if current.OverriddenFrom != "" {
		updated.OverriddenFrom = current.OverriddenFrom
	} else {
		updated.OverriddenFrom = current.ID
	}
	if err := validateEntryForWrite(updated); err != nil {
		return Entry{}, err
	}
	if err := store.repo.UpsertEntry(entryModelFromEntry(updated)); err != nil {
		return Entry{}, err
	}
	return store.getPackEntry(current.PackID, current.ID)
}

// CreateEntry creates a user-owned entry in a local pack namespace.
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
	packID := strings.TrimSpace(entry.PackID)
	if packID == "" {
		packID = DefaultPackID
	}
	pack, err := store.repo.GetPack(packID)
	if repository.IsRecordNotFound(err) {
		return Entry{}, fmt.Errorf("%w: %s", ErrPackNotFound, packID)
	}
	if err != nil {
		return Entry{}, err
	}
	entry.PackID = packID
	entry.ReleaseID = pack.ReleaseID
	entry.SourcePackageID = ""
	entry.SourceReleaseID = ""
	entry.ID = instructionpack.EntryID(packID, kind, entry.Slug)
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
		model.ReleaseID = pack.ReleaseID
		model.SourcePackageID, model.SourceReleaseID = packContentProvenance(pack)
		if err := store.repo.UpsertEntry(model); err != nil {
			return Entry{}, err
		}
		return store.GetEntry(ctx, kind, slug)
	}
	return Entry{}, fmt.Errorf("%w: %s/%s", ErrEntryNotFound, kind, slug)
}

// ResetPackEntry restores one exact package-backed entry to the installed
// artifact, avoiding ambiguity when multiple packs contain the same slug.
func (store *Service) ResetPackEntry(ctx context.Context, packID string, entryID string) (Entry, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return Entry{}, err
	}
	current, err := store.getPackEntry(packID, entryID)
	if err != nil {
		return Entry{}, err
	}
	if current.Linked {
		return Entry{}, fmt.Errorf("%w: linked entries cannot be reset directly", ErrPackReadonly)
	}
	if current.Source == entrySourceUser && current.OverriddenFrom == "" {
		return Entry{}, fmt.Errorf("%w: %s", ErrPackReadonly, entryID)
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
		if defaultEntry.Kind != current.Kind || defaultEntry.Slug != current.Slug {
			continue
		}
		model := entryModelFromPackEntry(defaultEntry, entrySourcePack)
		model.ID = current.ID
		model.PackID = current.PackID
		model.ReleaseID = pack.ReleaseID
		model.SourcePackageID, model.SourceReleaseID = packContentProvenance(pack)
		model.Kind = string(current.Kind)
		model.Slug = current.Slug
		if err := store.repo.UpsertEntry(model); err != nil {
			return Entry{}, err
		}
		return store.getPackEntry(current.PackID, current.ID)
	}
	return Entry{}, fmt.Errorf("%w: %s", ErrEntryNotFound, entryID)
}

func (store *Service) getPackEntry(packID string, entryID string) (Entry, error) {
	packID = strings.TrimSpace(packID)
	entryID = strings.TrimSpace(entryID)
	if packID == "" || entryID == "" {
		return Entry{}, fmt.Errorf("%w: pack id and entry id are required", ErrInvalidPack)
	}
	model, err := store.repo.GetEntry(entryID)
	if repository.IsRecordNotFound(err) {
		return Entry{}, fmt.Errorf("%w: %s", ErrEntryNotFound, entryID)
	}
	if err != nil {
		return Entry{}, err
	}
	if model.PackID != packID {
		return Entry{}, fmt.Errorf("%w: %s", ErrEntryNotFound, entryID)
	}
	return entryFromModel(model), nil
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
	if err := store.ensureDefaultEnabled(ctx); err != nil {
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

func nextCopySlug(base string, kind instructionpack.Kind, used map[string]bool) string {
	base = strings.TrimSpace(base)
	for index := 1; ; index++ {
		suffix := "-copy"
		if index > 1 {
			suffix = fmt.Sprintf("-copy-%d", index)
		}
		candidate := base + suffix
		key := string(kind) + "/" + candidate
		if used[key] {
			continue
		}
		used[key] = true
		return candidate
	}
}

func copyPromptCategory(
	repo *repository.PackRepository,
	targetPackID string,
	sourcePackID string,
	entry Entry,
	categories []domain.PackCategoryModel,
) error {
	if entry.Kind != instructionpack.KindPrompt {
		return nil
	}
	categoryID := metadataText(entry.Metadata, "category")
	if categoryID == "" {
		return nil
	}
	for _, category := range categories {
		if category.PackID == targetPackID && category.ID == categoryID {
			return nil
		}
	}

	copiedCategory := domain.PackCategoryModel{
		PackID: targetPackID,
		ID:     categoryID,
		Label:  categoryID,
		Source: entrySourceUser,
	}
	for _, category := range categories {
		if category.ID != categoryID {
			continue
		}
		if category.PackID == sourcePackID {
			copiedCategory.Label = category.Label
			copiedCategory.Order = category.Order
			break
		}
		if copiedCategory.Label == categoryID {
			copiedCategory.Label = category.Label
			copiedCategory.Order = category.Order
		}
	}
	return repo.UpsertCategory(copiedCategory)
}

func metadataText(metadata map[string]any, key string) string {
	value, ok := metadata[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func metadataBool(metadata map[string]any, key string) bool {
	value, ok := metadata[key].(bool)
	return ok && value
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
		if err := transactional.migrateCopiedEntriesToLinks(); err != nil {
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

// migrateCopiedEntriesToLinks upgrades untouched copies created by the early
// authoring UI. Modified copies are detached conservatively so existing local
// edits can never be overwritten by a later source update.
func (store *Service) migrateCopiedEntriesToLinks() error {
	models, err := store.repo.ListEntries()
	if err != nil {
		return err
	}
	byID := entryModelsByID(models)
	for _, model := range models {
		metadata := metadataFromJSON(model.Metadata)
		referenceID := metadataText(metadata, entryMetadataCopiedFrom)
		if referenceID == "" || metadataBool(metadata, entryMetadataLinked) {
			continue
		}
		source, sourceExists := byID[referenceID]
		if sourceExists && legacyCopyMatchesSource(model, source) {
			metadata[entryMetadataLinked] = true
		} else {
			delete(metadata, entryMetadataCopiedFrom)
			delete(metadata, entryMetadataCopiedFromPack)
			delete(metadata, entryMetadataLinked)
		}
		model.Metadata = mustJSON(metadata)
		if err := store.repo.UpsertEntry(model); err != nil {
			return fmt.Errorf("migrating copied entry %s: %w", model.ID, err)
		}
	}
	return nil
}

func legacyCopyMatchesSource(copyModel domain.PackEntryModel, sourceModel domain.PackEntryModel) bool {
	if copyModel.Kind != sourceModel.Kind ||
		copyModel.Title != sourceModel.Title ||
		copyModel.Description != sourceModel.Description ||
		copyModel.Body != sourceModel.Body {
		return false
	}
	expectedName := sourceModel.Name
	if copyModel.Kind == string(instructionpack.KindSkill) {
		expectedName = copyModel.Slug
	}
	if copyModel.Name != expectedName {
		return false
	}
	copyMetadata := metadataFromJSON(copyModel.Metadata)
	delete(copyMetadata, entryMetadataCopiedFrom)
	delete(copyMetadata, entryMetadataCopiedFromPack)
	delete(copyMetadata, entryMetadataLinked)
	sourceMetadata := metadataFromJSON(sourceModel.Metadata)
	return mustJSON(copyMetadata) == mustJSON(sourceMetadata)
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

// ensureDefaultEnabled keeps the built-in default pack enabled at all times so
// its content is always available as a base layer. Installed packs stack on top
// additively; this never disables any pack.
func (store *Service) ensureDefaultEnabled(ctx context.Context) error {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	model, err := store.repo.GetPack(DefaultPackID)
	if repository.IsRecordNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if model.Enabled {
		return nil
	}
	return store.repo.SetPackEnabled(DefaultPackID, true)
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
	return store.installBundleWithProvenance(ctx, bundle, source, origin, InstallProvenance{})
}

func (store *Service) installBundleWithProvenance(ctx context.Context, bundle instructionpack.Bundle, source string, origin string, provenance InstallProvenance) error {
	return store.repo.WithTransaction(ctx, func(tx *repository.PackRepository) error {
		transactional := &Service{repo: tx, legacyRepo: store.legacyRepo, initErr: store.initErr}
		// Importing a pack is additive: it is enabled and stacks on top of the
		// always-enabled default pack, without disabling any other pack.
		if _, err := transactional.upsertPackFromBundle(bundle, source, origin); err != nil {
			return err
		}
		if err := tx.SetPackRelease(bundle.Manifest.ID, provenance.ReleaseID); err != nil {
			return err
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
			model := entryModelFromPackEntry(entry, entrySourcePack)
			model.ReleaseID = provenance.ReleaseID
			if provenance.ReleaseID != "" {
				model.SourcePackageID = provenance.PackageID
				model.SourceReleaseID = provenance.ReleaseID
			}
			if err := tx.UpsertEntry(model); err != nil {
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
		return store.parsePackFile(ctx, origin)
	case packSourceLocal:
		return store.bundleFromStoredPack(ctx, pack)
	default:
		return instructionpack.Bundle{}, fmt.Errorf("%w: unsupported pack source %q", ErrInvalidPack, pack.Source)
	}
}

func (store *Service) parsePackFile(ctx context.Context, path string) (instructionpack.Bundle, error) {
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(path)))
	data, err := os.ReadFile(path)
	if err != nil {
		return instructionpack.Bundle{}, fmt.Errorf("reading pack file: %w", err)
	}
	switch ext {
	case ".mgpack":
		archive, err := codec.Decode(data)
		if err != nil {
			return instructionpack.Bundle{}, err
		}
		bundle, err := instructionpack.ParseZip(ctx, archive)
		if err != nil {
			return instructionpack.Bundle{}, err
		}
		return bundle, nil
	default:
		return instructionpack.Bundle{}, fmt.Errorf("%w: expected .mgpack file", ErrInvalidPack)
	}
}

func defaultPackFilesDir(settingsDBPath string) string {
	settingsDBPath = strings.TrimSpace(settingsDBPath)
	if settingsDBPath == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(settingsDBPath), "packs")
}
