// Package official exposes repository-shipped official instruction templates.
package official

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

//go:embed assets/instructions/*.md
var assets embed.FS

var instructionDirs = []string{
	"assets/instructions",
}

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
	Injectable  bool
}

type instructionFrontmatter struct {
	Slug        string `yaml:"slug"`
	Title       string `yaml:"title"`
	Description string `yaml:"description"`
	Order       int    `yaml:"order"`
	Editable    bool   `yaml:"editable"`
	Injectable  *bool  `yaml:"injectable"`
}

// Instructions parses and returns every official instruction template.
func Instructions(ctx context.Context) ([]Instruction, error) {
	if err := ctxErr(ctx); err != nil {
		return nil, err
	}
	instructions := []Instruction{}
	for _, dir := range instructionDirs {
		dirEntries, err := fs.ReadDir(assets, dir)
		if err != nil {
			return nil, fmt.Errorf("reading official instructions in %s: %w", dir, err)
		}
		for _, dirEntry := range dirEntries {
			if err := ctxErr(ctx); err != nil {
				return nil, err
			}
			if dirEntry.IsDir() || !strings.HasSuffix(dirEntry.Name(), ".md") {
				continue
			}
			filePath := path.Join(dir, dirEntry.Name())
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

// InstructionSection returns a Markdown section from an official instruction.
func InstructionSection(ctx context.Context, id string, headings ...string) (string, error) {
	instruction, err := InstructionByID(ctx, id)
	if err != nil {
		return "", err
	}
	section, ok := ExtractMarkdownSection(instruction.Body, headings...)
	if !ok {
		return "", fmt.Errorf("%w: %s section %q", ErrInstructionNotFound, id, strings.Join(headings, " > "))
	}
	return section, nil
}

// MustInstructionSection returns an official Markdown section or panics when
// the repository-shipped instruction is invalid.
func MustInstructionSection(id string, headings ...string) string {
	section, err := InstructionSection(context.Background(), id, headings...)
	if err != nil {
		panic(err)
	}
	return section
}

// ExtractMarkdownSection returns the body of a heading path from Markdown.
func ExtractMarkdownSection(markdown string, headings ...string) (string, bool) {
	lines, bodyStart, _, end, _, ok := markdownSectionRange(markdown, headings...)
	if !ok {
		return "", false
	}
	return strings.TrimSpace(strings.Join(lines[bodyStart:end], "\n")), true
}

// RemoveMarkdownSection removes one heading path and its body from Markdown.
func RemoveMarkdownSection(markdown string, headings ...string) string {
	lines, _, headingStart, end, _, ok := markdownSectionRange(markdown, headings...)
	if !ok {
		return markdown
	}
	if len(headings) == 1 {
		end = len(lines)
	}
	next := append([]string{}, lines[:headingStart]...)
	next = append(next, lines[end:]...)
	return strings.TrimSpace(strings.Join(next, "\n"))
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
	injectable := true
	if meta.Injectable != nil {
		injectable = *meta.Injectable
	}
	return Instruction{
		ID:          id,
		Name:        name,
		Description: strings.TrimSpace(meta.Description),
		Body:        normalizeBody(body),
		Order:       meta.Order,
		Editable:    meta.Editable,
		Injectable:  injectable,
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

var markdownHeadingPattern = regexp.MustCompile(`^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$`)

func markdownSectionRange(markdown string, headings ...string) (
	lines []string,
	bodyStart int,
	headingStart int,
	end int,
	level int,
	ok bool,
) {
	text := strings.TrimSpace(normalizeNewlines(markdown))
	lines = strings.Split(text, "\n")
	if len(headings) == 0 {
		return lines, 0, 0, len(lines), 0, true
	}

	start := 0
	sectionEnd := len(lines)
	parentLevel := 0
	foundHeading := -1
	foundLevel := 0
	for _, heading := range headings {
		normalizedHeading := normalizeHeadingTitle(heading)
		foundHeading = -1
		foundLevel = 0
		for index := start; index < sectionEnd; index++ {
			currentLevel, title, isHeading := markdownHeading(lines[index])
			if !isHeading || currentLevel <= parentLevel {
				continue
			}
			if normalizeHeadingTitle(title) != normalizedHeading {
				continue
			}
			foundHeading = index
			foundLevel = currentLevel
			break
		}
		if foundHeading < 0 {
			return lines, 0, 0, 0, 0, false
		}
		nextEnd := sectionEnd
		for index := foundHeading + 1; index < sectionEnd; index++ {
			currentLevel, _, isHeading := markdownHeading(lines[index])
			if !isHeading {
				continue
			}
			if currentLevel == foundLevel {
				nextEnd = index
				break
			}
		}
		start = foundHeading + 1
		sectionEnd = nextEnd
		parentLevel = foundLevel
	}
	return lines, start, foundHeading, sectionEnd, foundLevel, true
}

func markdownHeading(line string) (int, string, bool) {
	matches := markdownHeadingPattern.FindStringSubmatch(strings.TrimSpace(line))
	if len(matches) != 3 {
		return 0, "", false
	}
	return len(matches[1]), strings.TrimSpace(matches[2]), true
}

func normalizeHeadingTitle(value string) string {
	return strings.TrimSpace(value)
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
