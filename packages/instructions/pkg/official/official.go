// Package official exposes repository-shipped official instruction templates.
package official

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

//go:embed assets/instructions/*.md
var assets embed.FS

const instructionsDir = "assets/instructions"

// ErrInstructionNotFound reports a missing official instruction template.
var ErrInstructionNotFound = errors.New("official instruction not found")

// Instruction describes one official system instruction template.
type Instruction struct {
	ID          string
	Name        string
	Description string
	Body        string
	Order       int
	Editable    bool
}

type instructionFrontmatter struct {
	Slug        string `yaml:"slug"`
	Title       string `yaml:"title"`
	Description string `yaml:"description"`
	Order       int    `yaml:"order"`
	Editable    bool   `yaml:"editable"`
}

// Instructions parses and returns every official instruction template.
func Instructions(ctx context.Context) ([]Instruction, error) {
	if err := ctxErr(ctx); err != nil {
		return nil, err
	}
	dirEntries, err := fs.ReadDir(assets, instructionsDir)
	if err != nil {
		return nil, fmt.Errorf("reading official instructions: %w", err)
	}
	instructions := make([]Instruction, 0, len(dirEntries))
	for _, dirEntry := range dirEntries {
		if err := ctxErr(ctx); err != nil {
			return nil, err
		}
		if dirEntry.IsDir() || !strings.HasSuffix(dirEntry.Name(), ".md") {
			continue
		}
		filePath := path.Join(instructionsDir, dirEntry.Name())
		data, err := fs.ReadFile(assets, filePath)
		if err != nil {
			return nil, fmt.Errorf("reading official instruction %s: %w", dirEntry.Name(), err)
		}
		instruction, err := parseInstruction(filePath, data)
		if err != nil {
			return nil, err
		}
		instructions = append(instructions, instruction)
	}
	sort.SliceStable(instructions, func(first, second int) bool {
		if instructions[first].Order != instructions[second].Order {
			return instructions[first].Order < instructions[second].Order
		}
		return instructions[first].ID < instructions[second].ID
	})
	return instructions, nil
}

// InstructionByID returns one official instruction template by ID.
func InstructionByID(ctx context.Context, id string) (Instruction, error) {
	id = strings.TrimSpace(id)
	instructions, err := Instructions(ctx)
	if err != nil {
		return Instruction{}, err
	}
	for _, instruction := range instructions {
		if instruction.ID == id {
			return instruction, nil
		}
	}
	return Instruction{}, fmt.Errorf("%w: %s", ErrInstructionNotFound, id)
}

func parseInstruction(filePath string, data []byte) (Instruction, error) {
	frontmatter, body, err := splitMarkdownFrontmatter(data)
	if err != nil {
		return Instruction{}, fmt.Errorf("decoding %s: %w", filePath, err)
	}
	var meta instructionFrontmatter
	if err := yaml.Unmarshal([]byte(frontmatter), &meta); err != nil {
		return Instruction{}, fmt.Errorf("parsing %s frontmatter: %w", filePath, err)
	}
	id := strings.TrimSpace(meta.Slug)
	if id == "" {
		id = strings.TrimSuffix(path.Base(filePath), ".md")
	}
	if !isSafeID(id) {
		return Instruction{}, fmt.Errorf("official instruction id %q is invalid", id)
	}
	name := strings.TrimSpace(meta.Title)
	if name == "" {
		name = id
	}
	return Instruction{
		ID:          id,
		Name:        name,
		Description: strings.TrimSpace(meta.Description),
		Body:        normalizeBody(body),
		Order:       meta.Order,
		Editable:    meta.Editable,
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
	for _, char := range value {
		if char >= 'a' && char <= 'z' ||
			char >= 'A' && char <= 'Z' ||
			char >= '0' && char <= '9' ||
			char == '-' ||
			char == '_' {
			continue
		}
		return false
	}
	return true
}

func ctxErr(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	return ctx.Err()
}
