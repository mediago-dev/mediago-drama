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

	configassets "github.com/torchstellar-team/mediago-drama/packages/server/configs"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/config"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/platform/timestamp"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/repository"
	"gopkg.in/yaml.v3"
)

const (
	builtinPromptLibraryDir = "prompt-library/builtin"
	builtinStylePresetDir   = "style-presets/builtin"
	defaultExtension        = ".md"
)

// Prompt layers (the fixed building blocks composed at generation time).
const (
	layerStyle      = "style"       // 艺术风格
	layerSceneStyle = "scene_style" // 旧层:归并到 layerExtra
	layerTone       = "tone"        // 旧层:归并到 layerExtra
	layerExtra      = "extra"       // 其他可复用提示词
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
)

// PromptEntry describes a reusable generation prompt layer preset.
type PromptEntry struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Layer    string `json:"layer"`
	Type     string `json:"type,omitempty"`
	Kind     string `json:"kind,omitempty"`
	Category string `json:"category,omitempty"`
	Prompt   string `json:"prompt"`
	Source   Source `json:"source"`
	Builtin  bool   `json:"builtin,omitempty"`
}

// Filter limits prompt library list results.
type Filter struct {
	Layer string
	Type  string
	Kind  string
}

// Service loads embedded prompt defaults into the settings DB and persists edits there.
type Service struct {
	mu            sync.RWMutex
	defaults      fs.FS
	builtinRoot   string
	styleDefaults fs.FS  // 风格层内嵌默认(生产环境注入;测试留空以隔离)
	styleRoot     string // 风格层内嵌目录
	repo          *repository.PromptLibraryRepository
	initErr       error
}

type promptEntryFrontmatter struct {
	ID       string `yaml:"id"`
	Name     string `yaml:"name"`
	Layer    string `yaml:"layer,omitempty"`
	Type     string `yaml:"type,omitempty"`
	Kind     string `yaml:"kind,omitempty"`
	Category string `yaml:"category,omitempty"`
}

type promptEntryModel = domain.PromptLibraryEntryModel

// NewService creates a prompt library service backed by built-in defaults and the settings DB.
func NewService() *Service {
	repos, err := repository.OpenSettingsRepositories(config.DefaultSettingsDBPath())
	return NewServiceFromRepository(repos.PromptLibrary, err)
}

// NewServiceFromRepository creates a prompt library service from an existing settings repository.
func NewServiceFromRepository(repo *repository.PromptLibraryRepository, initErr error) *Service {
	service := NewServiceWithRepository(configassets.PromptLibrary, builtinPromptLibraryDir, repo, initErr)
	// 风格层默认从独立的内嵌目录种入(仅生产路径;测试通过 NewServiceWithRepository 注入隔离的 FS)。
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
		if filter.Layer != "" && entry.Layer != filter.Layer {
			continue
		}
		if filter.Type != "" && entry.Type != filter.Type {
			continue
		}
		// 风格层图/视频通用,不按 kind 过滤。
		if filter.Kind != "" && entry.Layer != layerStyle && entry.Kind != filter.Kind {
			continue
		}
		items = append(items, entry)
	}
	sortPromptEntries(items)
	return items, nil
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
	return nil
}

func (store *Service) loadBuiltinEntries(ctx context.Context) (map[string]PromptEntry, error) {
	if err := ctxErr(ctx); err != nil {
		return nil, err
	}
	entries := map[string]PromptEntry{}
	// 提示词层(style/extra):layer 从 frontmatter 或 type 推断。
	if err := loadPromptEntryFS(ctx, store.defaults, store.builtinRoot, SourceBuiltin, "", entries); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("loading built-in prompt entries: %w", err)
	}
	// 风格层:从 style-presets/builtin 内嵌目录种入,强制 layer=style(仅当生产路径注入了 styleDefaults)。
	if store.styleDefaults != nil && strings.TrimSpace(store.styleRoot) != "" {
		if err := loadPromptEntryFS(ctx, store.styleDefaults, store.styleRoot, SourceBuiltin, layerStyle, entries); err != nil && !errors.Is(err, fs.ErrNotExist) {
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

func loadPromptEntryFS(ctx context.Context, filesystem fs.FS, root string, source Source, forceLayer string, entries map[string]PromptEntry) error {
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
		entry, err := decodePromptEntry(data, source, forceLayer)
		if err != nil {
			return fmt.Errorf("decoding %s: %w", path, err)
		}
		entries[entry.ID] = entry
	}
	return nil
}

func decodePromptEntry(data []byte, source Source, forceLayer string) (PromptEntry, error) {
	frontmatter, body, err := splitFrontmatter(string(data))
	if err != nil {
		return PromptEntry{}, err
	}
	var meta promptEntryFrontmatter
	if err := yaml.Unmarshal([]byte(frontmatter), &meta); err != nil {
		return PromptEntry{}, fmt.Errorf("%w: parsing frontmatter: %w", ErrInvalidPromptEntry, err)
	}
	layer := meta.Layer
	if strings.TrimSpace(forceLayer) != "" {
		layer = forceLayer
	}
	entry := normalizePromptEntry(PromptEntry{
		ID:       meta.ID,
		Name:     meta.Name,
		Layer:    layer,
		Type:     meta.Type,
		Kind:     meta.Kind,
		Category: meta.Category,
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
	if !isSupportedLayer(entry.Layer) {
		return fmt.Errorf("%w: unsupported layer %q", ErrInvalidPromptEntry, entry.Layer)
	}
	if strings.TrimSpace(entry.Type) != "" && !isSupportedType(entry.Type) {
		return fmt.Errorf("%w: unsupported prompt type %q", ErrInvalidPromptEntry, entry.Type)
	}
	// 风格层与生成 kind 无关(图/视频通用);其余层需指定 kind。
	if entry.Layer != layerStyle && !isSupportedKind(entry.Kind) {
		return fmt.Errorf("%w: unsupported generation kind %q", ErrInvalidPromptEntry, entry.Kind)
	}
	if entry.Layer == layerStyle && strings.TrimSpace(entry.Kind) != "" && !isSupportedKind(entry.Kind) {
		return fmt.Errorf("%w: unsupported generation kind %q", ErrInvalidPromptEntry, entry.Kind)
	}
	if strings.TrimSpace(entry.Category) != "" && !isSafeIdentifier(entry.Category) {
		return fmt.Errorf("%w: category is invalid", ErrInvalidPromptEntry)
	}
	if strings.TrimSpace(entry.Prompt) == "" {
		return fmt.Errorf("%w: prompt is required", ErrInvalidPromptEntry)
	}
	return nil
}

func validateFilter(filter Filter) error {
	if filter.Layer != "" && !isSupportedLayer(filter.Layer) {
		return fmt.Errorf("%w: unsupported layer %q", ErrInvalidPromptEntry, filter.Layer)
	}
	if filter.Type != "" && !isSupportedType(filter.Type) {
		return fmt.Errorf("%w: unsupported prompt type %q", ErrInvalidPromptEntry, filter.Type)
	}
	if filter.Kind != "" && !isSupportedKind(filter.Kind) {
		return fmt.Errorf("%w: unsupported generation kind %q", ErrInvalidPromptEntry, filter.Kind)
	}
	return nil
}

func normalizeFilter(filter Filter) Filter {
	filter.Layer = normalizeLayer(filter.Layer)
	filter.Type = strings.TrimSpace(filter.Type)
	filter.Kind = strings.TrimSpace(filter.Kind)
	return filter
}

func normalizePromptEntry(entry PromptEntry) PromptEntry {
	entry.ID = strings.TrimSpace(entry.ID)
	entry.Name = strings.TrimSpace(entry.Name)
	entry.Layer = normalizeLayer(entry.Layer)
	entry.Type = strings.TrimSpace(entry.Type)
	entry.Kind = strings.TrimSpace(entry.Kind)
	entry.Category = strings.TrimSpace(entry.Category)
	if entry.Kind == "" && (entry.Type == "image" || entry.Type == "video") {
		entry.Kind = entry.Type
	}
	// 旧数据没有 layer:从 type 回填(读时即生效,库页按层过滤不依赖 DB 列)。
	if entry.Layer == "" {
		entry.Layer = layerForType(entry.Type)
	}
	entry.Prompt = strings.TrimSpace(strings.ReplaceAll(entry.Prompt, "\r\n", "\n"))
	return entry
}

func layerForType(promptType string) string {
	return layerExtra
}

func normalizeLayer(layer string) string {
	switch strings.TrimSpace(layer) {
	case layerSceneStyle, layerTone:
		return layerExtra
	default:
		return strings.TrimSpace(layer)
	}
}

func isSupportedLayer(layer string) bool {
	switch layer {
	case layerStyle, layerExtra:
		return true
	default:
		return false
	}
}

func entryForUserWrite(entry PromptEntry) PromptEntry {
	entry = normalizePromptEntry(entry)
	entry.Source = SourceUser
	return entry
}

func promptEntryFromModel(model promptEntryModel) PromptEntry {
	return normalizePromptEntry(PromptEntry{
		ID:       model.ID,
		Name:     model.Name,
		Layer:    model.Layer,
		Type:     model.Type,
		Kind:     model.Kind,
		Category: model.Category,
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
		Layer:     entry.Layer,
		Type:      entry.Type,
		Kind:      entry.Kind,
		Category:  entry.Category,
		Prompt:    entry.Prompt,
		Source:    string(entry.Source),
		Builtin:   entry.Builtin,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}
}

func builtinModelNeedsSync(model promptEntryModel, defaultEntry PromptEntry) bool {
	defaultEntry = normalizePromptEntry(defaultEntry)
	return model.Name != defaultEntry.Name ||
		normalizedLayer(model.Layer, model.Type) != defaultEntry.Layer ||
		model.Type != defaultEntry.Type ||
		model.Kind != defaultEntry.Kind ||
		model.Category != defaultEntry.Category ||
		model.Prompt != defaultEntry.Prompt ||
		model.Source != string(SourceBuiltin) ||
		!model.Builtin
}

func normalizedLayer(layer string, promptType string) string {
	if normalizeLayer(layer) != "" {
		return normalizeLayer(layer)
	}
	return layerForType(promptType)
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
		if layerOrder(firstEntry.Layer) != layerOrder(secondEntry.Layer) {
			return layerOrder(firstEntry.Layer) < layerOrder(secondEntry.Layer)
		}
		if typeOrder(firstEntry.Type) != typeOrder(secondEntry.Type) {
			return typeOrder(firstEntry.Type) < typeOrder(secondEntry.Type)
		}
		if firstEntry.Category != secondEntry.Category {
			return firstEntry.Category < secondEntry.Category
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

func layerOrder(layer string) int {
	switch normalizeLayer(layer) {
	case layerStyle:
		return 0
	case layerExtra:
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

func isSupportedKind(kind string) bool {
	switch kind {
	case "image", "video", "text":
		return true
	default:
		return false
	}
}

func isPromptEntryFilename(filename string) bool {
	return strings.HasSuffix(filename, defaultExtension)
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
