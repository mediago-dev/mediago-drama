// Package pack defines the MediaGo prompt pack file format and parser.
package pack

import "fmt"

// Kind identifies the type of content stored by a pack entry.
type Kind string

const (
	// KindInstruction stores system instruction Markdown.
	KindInstruction Kind = "instruction"
	// KindSkill stores agent skill Markdown.
	KindSkill Kind = "skill"
	// KindPrompt stores reusable generation prompt Markdown.
	KindPrompt Kind = "prompt"
)

// SourceBuiltin marks repository-shipped prompt pack content.
const SourceBuiltin = "builtin"

// Manifest describes one prompt pack.
type Manifest struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Version     string     `json:"version"`
	Author      string     `json:"author,omitempty"`
	Description string     `json:"description,omitempty"`
	Categories  []Category `json:"categories,omitempty"`
}

// Category describes a prompt category included in a pack.
type Category struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Order int    `json:"order,omitempty"`
}

// Bundle contains a parsed prompt pack manifest and all entries.
type Bundle struct {
	Manifest   Manifest
	Categories []Category
	Entries    []Entry
}

// Entry describes one instruction, skill, or reusable prompt.
type Entry struct {
	ID          string
	PackID      string
	Kind        Kind
	Slug        string
	Name        string
	Title       string
	Description string
	Body        string
	Metadata    map[string]any
	Raw         string
}

// EntryID returns the canonical database ID for one entry.
func EntryID(packID string, kind Kind, slug string) string {
	return fmt.Sprintf("%s/%s/%s", packID, kind, slug)
}

// Validate reports whether kind is a supported pack entry kind.
func (kind Kind) Validate() error {
	switch kind {
	case KindInstruction, KindSkill, KindPrompt:
		return nil
	default:
		return fmt.Errorf("unsupported pack entry kind %q", kind)
	}
}
