package pack

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	instructionsDir = "instructions"
	skillsDir       = "skills"
	promptsDir      = "prompts"
	markdownExt     = ".md"
	skillExt        = ".skill.md"
)

var (
	// ErrInvalidPack reports an invalid prompt pack manifest or entry.
	ErrInvalidPack = errors.New("invalid prompt pack")
	// ErrEntryNotFound reports a missing pack entry.
	ErrEntryNotFound = errors.New("pack entry not found")
)

type instructionFrontmatter struct {
	Slug        string `yaml:"slug"`
	Title       string `yaml:"title"`
	Description string `yaml:"description"`
	Order       int    `yaml:"order"`
	Editable    bool   `yaml:"editable"`
}

type skillFrontmatter struct {
	Name             string         `yaml:"name"`
	Title            string         `yaml:"title"`
	Description      string         `yaml:"description"`
	DocumentCategory string         `yaml:"document_category"`
	Hint             map[string]any `yaml:"hint"`
}

type promptFrontmatter struct {
	ID       string `yaml:"id"`
	Name     string `yaml:"name"`
	Layer    string `yaml:"layer,omitempty"`
	Category string `yaml:"category,omitempty"`
	Type     string `yaml:"type,omitempty"`
}

// ParseFS parses a prompt pack rooted at fsys.
func ParseFS(ctx context.Context, fsys fs.FS) (Bundle, error) {
	if err := ctxErr(ctx); err != nil {
		return Bundle{}, err
	}
	manifest, err := parseManifest(fsys)
	if err != nil {
		return Bundle{}, err
	}
	if err := validateManifest(manifest); err != nil {
		return Bundle{}, err
	}

	bundle := Bundle{
		Manifest:   manifest,
		Categories: append([]Category(nil), manifest.Categories...),
	}
	if err := parseInstructionEntries(ctx, fsys, manifest.ID, &bundle.Entries); err != nil {
		return Bundle{}, err
	}
	if err := parseSkillEntries(ctx, fsys, manifest.ID, &bundle.Entries); err != nil {
		return Bundle{}, err
	}
	if err := parsePromptEntries(ctx, fsys, manifest.ID, &bundle.Entries); err != nil {
		return Bundle{}, err
	}
	sortBundle(&bundle)
	return bundle, nil
}

// ParseDir parses a prompt pack from a local directory.
func ParseDir(ctx context.Context, dir string) (Bundle, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return Bundle{}, fmt.Errorf("%w: pack directory is required", ErrInvalidPack)
	}
	return ParseFS(ctx, os.DirFS(dir))
}

func parseManifest(fsys fs.FS) (Manifest, error) {
	data, err := fs.ReadFile(fsys, "pack.json")
	if err != nil {
		return Manifest{}, fmt.Errorf("%w: reading pack.json: %w", ErrInvalidPack, err)
	}
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("%w: parsing pack.json: %w", ErrInvalidPack, err)
	}
	return manifest, nil
}

func parseInstructionEntries(ctx context.Context, fsys fs.FS, packID string, entries *[]Entry) error {
	return readMarkdownDir(ctx, fsys, instructionsDir, markdownExt, func(path string, data []byte) error {
		frontmatter, body, raw, err := splitMarkdownFrontmatter(data)
		if err != nil {
			return fmt.Errorf("decoding %s: %w", path, err)
		}
		var meta instructionFrontmatter
		if err := yaml.Unmarshal([]byte(frontmatter), &meta); err != nil {
			return fmt.Errorf("%w: parsing %s frontmatter: %w", ErrInvalidPack, path, err)
		}
		slug := strings.TrimSpace(meta.Slug)
		if slug == "" {
			slug = strings.TrimSuffix(filepath.Base(path), markdownExt)
		}
		if !isSafeSlug(slug) {
			return fmt.Errorf("%w: instruction slug %q is invalid", ErrInvalidPack, slug)
		}
		title := strings.TrimSpace(meta.Title)
		if title == "" {
			title = slug
		}
		*entries = append(*entries, Entry{
			ID:          EntryID(packID, KindInstruction, slug),
			PackID:      packID,
			Kind:        KindInstruction,
			Slug:        slug,
			Name:        title,
			Title:       title,
			Description: strings.TrimSpace(meta.Description),
			Body:        normalizeBody(body),
			Raw:         raw,
			Metadata: map[string]any{
				"order":    meta.Order,
				"editable": meta.Editable,
			},
		})
		return nil
	})
}

func parseSkillEntries(ctx context.Context, fsys fs.FS, packID string, entries *[]Entry) error {
	return readMarkdownDir(ctx, fsys, skillsDir, skillExt, func(path string, data []byte) error {
		frontmatter, body, raw, err := splitMarkdownFrontmatter(data)
		if err != nil {
			return fmt.Errorf("decoding %s: %w", path, err)
		}
		var meta skillFrontmatter
		if err := yaml.Unmarshal([]byte(frontmatter), &meta); err != nil {
			return fmt.Errorf("%w: parsing %s frontmatter: %w", ErrInvalidPack, path, err)
		}
		name := strings.TrimSpace(meta.Name)
		if !isSafeSlug(name) {
			return fmt.Errorf("%w: skill name %q is invalid", ErrInvalidPack, name)
		}
		description := strings.TrimSpace(meta.Description)
		if description == "" {
			return fmt.Errorf("%w: skill %q description is required", ErrInvalidPack, name)
		}
		*entries = append(*entries, Entry{
			ID:          EntryID(packID, KindSkill, name),
			PackID:      packID,
			Kind:        KindSkill,
			Slug:        name,
			Name:        name,
			Title:       strings.TrimSpace(meta.Title),
			Description: description,
			Body:        normalizeBody(body),
			Raw:         raw,
			Metadata: map[string]any{
				"hint": normalizeSkillHint(meta.Hint, meta.DocumentCategory),
			},
		})
		return nil
	})
}

func parsePromptEntries(ctx context.Context, fsys fs.FS, packID string, entries *[]Entry) error {
	return readMarkdownDir(ctx, fsys, promptsDir, markdownExt, func(path string, data []byte) error {
		frontmatter, body, raw, err := splitMarkdownFrontmatter(data)
		if err != nil {
			return fmt.Errorf("decoding %s: %w", path, err)
		}
		var meta promptFrontmatter
		if err := yaml.Unmarshal([]byte(frontmatter), &meta); err != nil {
			return fmt.Errorf("%w: parsing %s frontmatter: %w", ErrInvalidPack, path, err)
		}
		id := strings.TrimSpace(meta.ID)
		if id == "" {
			id = strings.TrimSuffix(filepath.Base(path), markdownExt)
		}
		if !isSafeSlug(id) {
			return fmt.Errorf("%w: prompt id %q is invalid", ErrInvalidPack, id)
		}
		name := strings.TrimSpace(meta.Name)
		if name == "" {
			return fmt.Errorf("%w: prompt %q name is required", ErrInvalidPack, id)
		}
		category := normalizeCategory(meta.Category)
		if category == "" && strings.TrimSpace(meta.Layer) != "" {
			category = categoryFromLegacyLayer(meta.Layer)
		}
		if category == "" {
			category = "extra"
		}
		if !isSafeSlug(category) {
			return fmt.Errorf("%w: prompt %q category is invalid", ErrInvalidPack, id)
		}
		*entries = append(*entries, Entry{
			ID:          EntryID(packID, KindPrompt, id),
			PackID:      packID,
			Kind:        KindPrompt,
			Slug:        id,
			Name:        name,
			Title:       name,
			Description: "",
			Body:        normalizeBody(body),
			Raw:         raw,
			Metadata: map[string]any{
				"category": category,
				"type":     strings.TrimSpace(meta.Type),
			},
		})
		return nil
	})
}

func readMarkdownDir(ctx context.Context, fsys fs.FS, root string, extension string, visit func(string, []byte) error) error {
	if err := ctxErr(ctx); err != nil {
		return err
	}
	dirEntries, err := fs.ReadDir(fsys, root)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("%w: reading %s: %w", ErrInvalidPack, root, err)
	}
	for _, dirEntry := range dirEntries {
		if err := ctxErr(ctx); err != nil {
			return err
		}
		if dirEntry.IsDir() || !strings.HasSuffix(dirEntry.Name(), extension) {
			continue
		}
		path := filepath.ToSlash(filepath.Join(root, dirEntry.Name()))
		data, err := fs.ReadFile(fsys, path)
		if err != nil {
			return fmt.Errorf("%w: reading %s: %w", ErrInvalidPack, path, err)
		}
		if err := visit(path, data); err != nil {
			return err
		}
	}
	return nil
}

func splitMarkdownFrontmatter(data []byte) (string, string, string, error) {
	raw := normalizeNewlines(string(data))
	trimmed := strings.TrimSpace(raw)
	if !strings.HasPrefix(trimmed, "---\n") {
		return "", "", raw, fmt.Errorf("%w: frontmatter block is required", ErrInvalidPack)
	}
	rest := strings.TrimPrefix(trimmed, "---\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return "", "", raw, fmt.Errorf("%w: frontmatter closing marker is required", ErrInvalidPack)
	}
	frontmatter := rest[:end]
	body := rest[end+len("\n---"):]
	body = strings.TrimPrefix(body, "\n")
	return frontmatter, body, trimmed + "\n", nil
}

func validateManifest(manifest Manifest) error {
	if !isSafePackID(manifest.ID) {
		return fmt.Errorf("%w: pack id is required", ErrInvalidPack)
	}
	if strings.TrimSpace(manifest.Name) == "" {
		return fmt.Errorf("%w: pack name is required", ErrInvalidPack)
	}
	if strings.TrimSpace(manifest.Version) == "" {
		return fmt.Errorf("%w: pack version is required", ErrInvalidPack)
	}
	for _, category := range manifest.Categories {
		if !isSafeSlug(category.ID) || strings.TrimSpace(category.Label) == "" {
			return fmt.Errorf("%w: category %q is invalid", ErrInvalidPack, category.ID)
		}
	}
	return nil
}

func sortBundle(bundle *Bundle) {
	sort.SliceStable(bundle.Categories, func(first, second int) bool {
		if bundle.Categories[first].Order != bundle.Categories[second].Order {
			return bundle.Categories[first].Order < bundle.Categories[second].Order
		}
		return bundle.Categories[first].ID < bundle.Categories[second].ID
	})
	sort.SliceStable(bundle.Entries, func(first, second int) bool {
		if bundle.Entries[first].Kind != bundle.Entries[second].Kind {
			return bundle.Entries[first].Kind < bundle.Entries[second].Kind
		}
		return bundle.Entries[first].Slug < bundle.Entries[second].Slug
	})
}

func categoryFromLegacyLayer(layer string) string {
	switch strings.TrimSpace(layer) {
	case "scene_style", "tone":
		return "extra"
	default:
		return normalizeCategory(layer)
	}
}

func normalizeCategory(category string) string {
	return strings.TrimSpace(strings.ToLower(category))
}

func normalizeBody(body string) string {
	body = strings.TrimSpace(normalizeNewlines(body))
	if body == "" {
		return ""
	}
	return body + "\n"
}

func normalizeNewlines(text string) string {
	return strings.ReplaceAll(text, "\r\n", "\n")
}

func normalizeStringMap(values map[string]any) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		key = strings.TrimSpace(key)
		if key == "" || value == nil {
			continue
		}
		result[key] = strings.TrimSpace(fmt.Sprint(value))
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeSkillHint(values map[string]any, documentCategory string) map[string]string {
	hint := normalizeStringMap(values)
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

func isSafePackID(id string) bool {
	id = strings.TrimSpace(id)
	if id == "" || id == "." || id == ".." || filepath.Base(id) != id || strings.Contains(id, "\\") {
		return false
	}
	for index, char := range id {
		valid := char >= 'a' && char <= 'z' ||
			char >= 'A' && char <= 'Z' ||
			char >= '0' && char <= '9' ||
			char == '-' ||
			char == '_' ||
			char == '.'
		if !valid {
			return false
		}
		if index == 0 && (char == '-' || char == '_' || char == '.') {
			return false
		}
	}
	return !strings.HasSuffix(id, ".")
}

func isSafeSlug(slug string) bool {
	slug = strings.TrimSpace(slug)
	if slug == "" || slug == "." || slug == ".." || filepath.Base(slug) != slug || strings.Contains(slug, "\\") {
		return false
	}
	for index, char := range slug {
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
