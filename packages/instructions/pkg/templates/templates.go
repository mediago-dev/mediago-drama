// Package templates exposes repository-shipped document format templates.
package templates

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

//go:embed assets/document-templates/*.md
var assets embed.FS

const templatesDir = "assets/document-templates"

// ErrTemplateNotFound reports a missing document template.
var ErrTemplateNotFound = errors.New("document template not found")

// Template describes one repository-shipped document format template.
type Template struct {
	ID               string
	Name             string
	Description      string
	DocumentCategory string
	Body             string
}

type templateFrontmatter struct {
	ID               string `yaml:"id"`
	Title            string `yaml:"title"`
	Description      string `yaml:"description"`
	DocumentCategory string `yaml:"document_category"`
}

// Templates parses and returns every built-in document template.
func Templates(ctx context.Context) ([]Template, error) {
	if err := ctxErr(ctx); err != nil {
		return nil, err
	}
	dirEntries, err := fs.ReadDir(assets, templatesDir)
	if err != nil {
		return nil, fmt.Errorf("reading document templates: %w", err)
	}
	templates := make([]Template, 0, len(dirEntries))
	for _, dirEntry := range dirEntries {
		if err := ctxErr(ctx); err != nil {
			return nil, err
		}
		if dirEntry.IsDir() || !strings.HasSuffix(dirEntry.Name(), ".md") {
			continue
		}
		filePath := path.Join(templatesDir, dirEntry.Name())
		data, err := fs.ReadFile(assets, filePath)
		if err != nil {
			return nil, fmt.Errorf("reading document template %s: %w", dirEntry.Name(), err)
		}
		template, err := parseTemplate(filePath, data)
		if err != nil {
			return nil, err
		}
		templates = append(templates, template)
	}
	sort.SliceStable(templates, func(first, second int) bool {
		return templates[first].ID < templates[second].ID
	})
	return templates, nil
}

// TemplateByID returns one built-in document template by ID.
func TemplateByID(ctx context.Context, id string) (Template, error) {
	id = strings.TrimSpace(id)
	templates, err := Templates(ctx)
	if err != nil {
		return Template{}, err
	}
	for _, template := range templates {
		if template.ID == id {
			return template, nil
		}
	}
	return Template{}, fmt.Errorf("%w: %s", ErrTemplateNotFound, id)
}

func parseTemplate(filePath string, data []byte) (Template, error) {
	frontmatter, body, err := splitMarkdownFrontmatter(data)
	if err != nil {
		return Template{}, fmt.Errorf("decoding %s: %w", filePath, err)
	}
	var meta templateFrontmatter
	if err := yaml.Unmarshal([]byte(frontmatter), &meta); err != nil {
		return Template{}, fmt.Errorf("parsing %s frontmatter: %w", filePath, err)
	}
	id := strings.TrimSpace(meta.ID)
	if id == "" {
		id = strings.TrimSuffix(path.Base(filePath), ".md")
	}
	if !isSafeID(id) {
		return Template{}, fmt.Errorf("document template id %q is invalid", id)
	}
	name := strings.TrimSpace(meta.Title)
	if name == "" {
		name = id
	}
	category := strings.TrimSpace(meta.DocumentCategory)
	if category == "" {
		return Template{}, fmt.Errorf("document template %q document_category is required", id)
	}
	return Template{
		ID:               id,
		Name:             name,
		Description:      strings.TrimSpace(meta.Description),
		DocumentCategory: category,
		Body:             normalizeBody(body),
	}, nil
}

func splitMarkdownFrontmatter(data []byte) (string, string, error) {
	raw := normalizeNewlines(string(data))
	trimmed := strings.TrimSpace(raw)
	if !strings.HasPrefix(trimmed, "---\n") {
		return "", "", errors.New("frontmatter block is required")
	}
	rest := strings.TrimPrefix(trimmed, "---\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return "", "", errors.New("frontmatter closing marker is required")
	}
	frontmatter := rest[:end]
	body := strings.TrimPrefix(rest[end+len("\n---"):], "\n")
	return frontmatter, body, nil
}

func normalizeBody(body string) string {
	text := strings.TrimSpace(normalizeNewlines(body))
	if text == "" {
		return ""
	}
	return text + "\n"
}

func normalizeNewlines(value string) string {
	return strings.ReplaceAll(value, "\r\n", "\n")
}

func isSafeID(value string) bool {
	if value == "" {
		return false
	}
	for index, char := range value {
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
	return !strings.HasSuffix(value, ".")
}

func ctxErr(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	return ctx.Err()
}
