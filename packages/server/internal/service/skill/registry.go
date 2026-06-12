// Package skill loads built-in and user-defined agent skills.
package skill

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

	"gopkg.in/yaml.v3"

	configassets "github.com/mediago-dev/mediago-drama/packages/server/configs"
)

const (
	builtinSkillsDir = "skills/builtin"
	defaultExtension = ".skill.md"
)

// Source identifies where a skill was loaded from.
type Source string

const (
	// SourceBuiltin marks repository-shipped skills.
	SourceBuiltin Source = "builtin"
	// SourceUser marks workspace-local user skills.
	SourceUser Source = "user"
)

var (
	// ErrInvalidSkill reports invalid skill Markdown or metadata.
	ErrInvalidSkill = errors.New("invalid skill")
	// ErrSkillNotFound reports a missing skill name.
	ErrSkillNotFound = errors.New("skill not found")
	// ErrSkillExists reports a duplicate skill creation request.
	ErrSkillExists = errors.New("skill already exists")
	// ErrBuiltinSkillReadonly reports attempts to mutate a built-in skill.
	ErrBuiltinSkillReadonly = errors.New("builtin skill is read-only")
)

// SkillMeta is the public skill index entry.
type SkillMeta struct {
	Name        string            `json:"name"`
	Title       string            `json:"title,omitempty"`
	Description string            `json:"description"`
	Source      Source            `json:"source"`
	Hint        map[string]string `json:"hint,omitempty"`
}

// Skill contains a parsed skill, including body content and raw Markdown.
type Skill struct {
	SkillMeta
	Content string `json:"content"`
	Raw     string `json:"raw,omitempty"`
}

// Registry loads skills from embedded defaults and a user skill directory.
type Registry struct {
	mu          sync.RWMutex
	defaults    fs.FS
	builtinRoot string
	userDir     string
}

type skillFrontmatter struct {
	Name        string         `yaml:"name"`
	Title       string         `yaml:"title"`
	Description string         `yaml:"description"`
	Hint        map[string]any `yaml:"hint"`
}

// NewRegistry creates a skill registry backed by built-in defaults and configs/skills/user.
func NewRegistry() *Registry {
	return NewRegistryWithSource(configassets.Skills, builtinSkillsDir, configassets.SourceSkillDir("user"))
}

// NewRegistryWithSource creates a skill registry with explicit sources.
func NewRegistryWithSource(defaults fs.FS, builtinRoot string, userDir string) *Registry {
	return &Registry{
		defaults:    defaults,
		builtinRoot: strings.TrimSpace(builtinRoot),
		userDir:     strings.TrimSpace(userDir),
	}
}

// List returns skill metadata, with user skills overriding built-ins of the same name.
func (registry *Registry) List(ctx context.Context) ([]SkillMeta, error) {
	skills, err := registry.load(ctx)
	if err != nil {
		return nil, err
	}
	metas := make([]SkillMeta, 0, len(skills))
	for _, item := range skills {
		metas = append(metas, item.SkillMeta)
	}
	sort.SliceStable(metas, func(first, second int) bool {
		return metas[first].Name < metas[second].Name
	})
	return metas, nil
}

// Get returns one skill by name, including frontmatter-free body content.
func (registry *Registry) Get(ctx context.Context, name string) (Skill, error) {
	name = strings.TrimSpace(name)
	skills, err := registry.load(ctx)
	if err != nil {
		return Skill{}, err
	}
	item, ok := skills[name]
	if !ok {
		return Skill{}, NotFoundError{Name: name, Available: sortedMetas(skills)}
	}
	return item, nil
}

// GetRaw returns one skill by name, including the full raw Markdown file.
func (registry *Registry) GetRaw(ctx context.Context, name string) (Skill, error) {
	return registry.Get(ctx, name)
}

// Save validates and writes an existing skill, creating a user override for built-ins.
func (registry *Registry) Save(ctx context.Context, name string, raw string) (Skill, error) {
	registry.mu.Lock()
	defer registry.mu.Unlock()

	if err := ctxErr(ctx); err != nil {
		return Skill{}, err
	}
	name = strings.TrimSpace(name)
	if !isSafeSkillName(name) {
		return Skill{}, fmt.Errorf("%w: skill name is required", ErrInvalidSkill)
	}
	current, err := registry.loadLocked(ctx)
	if err != nil {
		return Skill{}, err
	}
	if _, ok := current[name]; !ok {
		return Skill{}, NotFoundError{Name: name, Available: sortedMetas(current)}
	}
	parsed, err := ParseRaw(name, raw)
	if err != nil {
		return Skill{}, err
	}
	if err := writeUserSkill(registry.userDir, name, parsed.Raw); err != nil {
		return Skill{}, err
	}
	return parsed, nil
}

// Create validates and writes a new user skill.
func (registry *Registry) Create(ctx context.Context, name string, raw string) (Skill, error) {
	registry.mu.Lock()
	defer registry.mu.Unlock()

	if err := ctxErr(ctx); err != nil {
		return Skill{}, err
	}
	name = strings.TrimSpace(name)
	if !isSafeSkillName(name) {
		return Skill{}, fmt.Errorf("%w: skill name is required", ErrInvalidSkill)
	}
	current, err := registry.loadLocked(ctx)
	if err != nil {
		return Skill{}, err
	}
	if _, ok := current[name]; ok {
		return Skill{}, fmt.Errorf("%w: %s", ErrSkillExists, name)
	}
	parsed, err := ParseRaw(name, raw)
	if err != nil {
		return Skill{}, err
	}
	if err := writeUserSkill(registry.userDir, name, parsed.Raw); err != nil {
		return Skill{}, err
	}
	return parsed, nil
}

// Delete removes an existing user skill.
func (registry *Registry) Delete(ctx context.Context, name string) error {
	registry.mu.Lock()
	defer registry.mu.Unlock()

	if err := ctxErr(ctx); err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	current, err := registry.loadLocked(ctx)
	if err != nil {
		return err
	}
	if existing, ok := current[name]; !ok {
		return NotFoundError{Name: name, Available: sortedMetas(current)}
	} else if existing.Source != SourceUser {
		return fmt.Errorf("%w: %s", ErrBuiltinSkillReadonly, name)
	}
	if err := os.Remove(filepath.Join(registry.userDir, filenameForSkill(name))); err != nil {
		return fmt.Errorf("deleting skill %s: %w", name, err)
	}
	return nil
}

func (registry *Registry) load(ctx context.Context) (map[string]Skill, error) {
	registry.mu.RLock()
	defer registry.mu.RUnlock()
	return registry.loadLocked(ctx)
}

func (registry *Registry) loadLocked(ctx context.Context) (map[string]Skill, error) {
	if err := ctxErr(ctx); err != nil {
		return nil, err
	}
	skills := map[string]Skill{}
	if err := loadSkillFS(ctx, registry.defaults, registry.builtinRoot, SourceBuiltin, skills); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("loading built-in skills: %w", err)
	}
	if err := loadSkillDir(ctx, registry.userDir, SourceUser, skills); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("loading user skills: %w", err)
	}
	return skills, nil
}

func loadSkillFS(ctx context.Context, filesystem fs.FS, root string, source Source, skills map[string]Skill) error {
	if strings.TrimSpace(root) == "" {
		return fs.ErrNotExist
	}
	entries, err := fs.ReadDir(filesystem, root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := ctxErr(ctx); err != nil {
			return err
		}
		if entry.IsDir() || !isSkillFilename(entry.Name()) {
			continue
		}
		path := filepath.ToSlash(filepath.Join(root, entry.Name()))
		data, err := fs.ReadFile(filesystem, path)
		if err != nil {
			return err
		}
		addParsedSkill(skills, path, data, source)
	}
	return nil
}

func loadSkillDir(ctx context.Context, dir string, source Source, skills map[string]Skill) error {
	if strings.TrimSpace(dir) == "" {
		return fs.ErrNotExist
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := ctxErr(ctx); err != nil {
			return err
		}
		if entry.IsDir() || !isSkillFilename(entry.Name()) {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		addParsedSkill(skills, path, data, source)
	}
	return nil
}

func addParsedSkill(skills map[string]Skill, path string, data []byte, source Source) {
	item, err := parseRaw(string(data), source)
	if err != nil {
		slog.Warn("skill file skipped", "path", path, "error", err)
		return
	}
	skills[item.Name] = item
}

// ParseRaw validates full skill Markdown for a specific skill name.
func ParseRaw(name string, raw string) (Skill, error) {
	name = strings.TrimSpace(name)
	if !isSafeSkillName(name) {
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
	if !isSafeSkillName(name) {
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
			Hint:        normalizeHint(meta.Hint),
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

func normalizeHint(values map[string]any) map[string]string {
	if len(values) == 0 {
		return nil
	}
	hint := make(map[string]string, len(values))
	for key, value := range values {
		key = strings.TrimSpace(key)
		if key == "" || value == nil {
			continue
		}
		hint[key] = strings.TrimSpace(fmt.Sprint(value))
	}
	if len(hint) == 0 {
		return nil
	}
	return hint
}

func writeUserSkill(dir string, name string, raw string) error {
	if strings.TrimSpace(dir) == "" {
		return fmt.Errorf("user skill directory is not configured")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating user skill directory: %w", err)
	}
	path := filepath.Join(dir, filenameForSkill(name))
	if err := os.WriteFile(path, []byte(raw), 0o644); err != nil {
		return fmt.Errorf("writing skill %s: %w", name, err)
	}
	return nil
}

func sortedMetas(skills map[string]Skill) []SkillMeta {
	metas := make([]SkillMeta, 0, len(skills))
	for _, item := range skills {
		metas = append(metas, item.SkillMeta)
	}
	sort.SliceStable(metas, func(first, second int) bool {
		return metas[first].Name < metas[second].Name
	})
	return metas
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

func isSkillFilename(filename string) bool {
	return strings.HasSuffix(filename, defaultExtension)
}

func filenameForSkill(name string) string {
	return name + defaultExtension
}

func isSafeSkillName(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." || filepath.Base(name) != name || strings.Contains(name, "\\") {
		return false
	}
	for index, char := range name {
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
