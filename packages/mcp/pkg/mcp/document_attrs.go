package mcp

import (
	"encoding/json"
	"fmt"
	"strings"
)

// DocumentBlockAttrs is the typed wire attrs object shared by structured block
// inputs, block nodes, and patch_block_attrs operations.
type DocumentBlockAttrs struct {
	Level    int    `json:"level,omitempty"`
	Language string `json:"language,omitempty"`
	Ordered  *bool  `json:"ordered,omitempty"`
	Src      string `json:"src,omitempty"`
	Alt      string `json:"alt,omitempty"`
}

// DocumentBlockAttrsFromMap reads block attrs from a generic wire attrs map.
func DocumentBlockAttrsFromMap(attrs map[string]any) DocumentBlockAttrs {
	parsed := DocumentBlockAttrs{
		Level:    IntAttr(attrs, "level"),
		Language: StringAttr(attrs, "language"),
		Src:      StringAttr(attrs, "src"),
		Alt:      StringAttr(attrs, "alt"),
	}
	if _, ok := attrs["ordered"]; ok {
		ordered := BoolAttr(attrs, "ordered")
		parsed.Ordered = &ordered
	}
	return parsed
}

// NewDocumentBlockAttrsFromMap returns typed attrs or nil when no attrs exist.
func NewDocumentBlockAttrsFromMap(attrs map[string]any) *DocumentBlockAttrs {
	parsed := DocumentBlockAttrsFromMap(attrs)
	if parsed.IsZero() {
		return nil
	}
	return &parsed
}

// UnmarshalJSON accepts the typed attrs shape while preserving compatibility
// with older clients that sent stringified bools or numbers.
func (attrs *DocumentBlockAttrs) UnmarshalJSON(data []byte) error {
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*attrs = DocumentBlockAttrsFromMap(raw)
	return nil
}

// IsZero reports whether no supported block attrs are present.
func (attrs DocumentBlockAttrs) IsZero() bool {
	return attrs.Level == 0 &&
		strings.TrimSpace(attrs.Language) == "" &&
		attrs.Ordered == nil &&
		strings.TrimSpace(attrs.Src) == "" &&
		strings.TrimSpace(attrs.Alt) == ""
}

// Empty reports whether the attrs pointer is nil or contains no supported attrs.
func (attrs *DocumentBlockAttrs) Empty() bool {
	return attrs == nil || attrs.IsZero()
}

// Map returns block attrs in the MCP wire shape.
func (attrs DocumentBlockAttrs) Map() map[string]any {
	result := map[string]any{}
	if attrs.Level > 0 {
		result["level"] = attrs.Level
	}
	if language := strings.TrimSpace(attrs.Language); language != "" {
		result["language"] = language
	}
	if attrs.Ordered != nil {
		result["ordered"] = *attrs.Ordered
	}
	if src := strings.TrimSpace(attrs.Src); src != "" {
		result["src"] = src
	}
	if alt := strings.TrimSpace(attrs.Alt); alt != "" {
		result["alt"] = alt
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

// HeadingAttrs returns the heading-specific view of these block attrs.
func (attrs *DocumentBlockAttrs) HeadingAttrs() HeadingBlockAttrs {
	if attrs == nil {
		return HeadingBlockAttrs{}
	}
	return HeadingBlockAttrs{Level: attrs.Level}
}

// CodeAttrs returns the code-specific view of these block attrs.
func (attrs *DocumentBlockAttrs) CodeAttrs() CodeBlockAttrs {
	if attrs == nil {
		return CodeBlockAttrs{}
	}
	return CodeBlockAttrs{Language: strings.TrimSpace(attrs.Language)}
}

// ListAttrs returns the list-specific view of these block attrs.
func (attrs *DocumentBlockAttrs) ListAttrs() ListBlockAttrs {
	if attrs == nil || attrs.Ordered == nil {
		return ListBlockAttrs{}
	}
	return ListBlockAttrs{Ordered: *attrs.Ordered}
}

// HeadingBlockAttrs describes supported heading block attrs.
type HeadingBlockAttrs struct {
	Level int `json:"level,omitempty"`
}

// HeadingBlockAttrsFrom reads heading attrs from a generic wire attrs map.
func HeadingBlockAttrsFrom(attrs map[string]any) HeadingBlockAttrs {
	return HeadingBlockAttrs{Level: IntAttr(attrs, "level")}
}

// Map returns heading attrs in the MCP wire shape.
func (attrs HeadingBlockAttrs) Map() map[string]any {
	if attrs.Level <= 0 {
		return nil
	}
	return map[string]any{"level": attrs.Level}
}

// CodeBlockAttrs describes supported fenced code block attrs.
type CodeBlockAttrs struct {
	Language string `json:"language,omitempty"`
}

// CodeBlockAttrsFrom reads code block attrs from a generic wire attrs map.
func CodeBlockAttrsFrom(attrs map[string]any) CodeBlockAttrs {
	return CodeBlockAttrs{Language: StringAttr(attrs, "language")}
}

// Map returns code block attrs in the MCP wire shape.
func (attrs CodeBlockAttrs) Map() map[string]any {
	return map[string]any{"language": strings.TrimSpace(attrs.Language)}
}

// ListBlockAttrs describes supported list block attrs.
type ListBlockAttrs struct {
	Ordered bool `json:"ordered"`
}

// ListBlockAttrsFrom reads list attrs from a generic wire attrs map.
func ListBlockAttrsFrom(attrs map[string]any) ListBlockAttrs {
	return ListBlockAttrs{Ordered: BoolAttr(attrs, "ordered")}
}

// Map returns list attrs in the MCP wire shape.
func (attrs ListBlockAttrs) Map() map[string]any {
	return map[string]any{"ordered": attrs.Ordered}
}

// LinkMarkAttrs describes supported link mark attrs.
type LinkMarkAttrs struct {
	Href string `json:"href,omitempty"`
}

// LinkMarkAttrsFrom reads link mark attrs from a generic wire attrs map.
func LinkMarkAttrsFrom(attrs map[string]any) LinkMarkAttrs {
	return LinkMarkAttrs{Href: StringAttr(attrs, "href")}
}

// NewLinkMarkAttrsFromMap returns typed link mark attrs or nil when empty.
func NewLinkMarkAttrsFromMap(attrs map[string]any) *LinkMarkAttrs {
	parsed := LinkMarkAttrsFrom(attrs)
	if parsed.IsZero() {
		return nil
	}
	return &parsed
}

// UnmarshalJSON accepts the typed link attrs shape while trimming href.
func (attrs *LinkMarkAttrs) UnmarshalJSON(data []byte) error {
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*attrs = LinkMarkAttrsFrom(raw)
	return nil
}

// IsZero reports whether no link mark attrs are present.
func (attrs LinkMarkAttrs) IsZero() bool {
	return strings.TrimSpace(attrs.Href) == ""
}

// Map returns link mark attrs in the MCP wire shape.
func (attrs LinkMarkAttrs) Map() map[string]any {
	if strings.TrimSpace(attrs.Href) == "" {
		return nil
	}
	return map[string]any{"href": strings.TrimSpace(attrs.Href)}
}

// MentionAttrs describes supported mention inline attrs.
type MentionAttrs struct {
	ID    string `json:"id,omitempty"`
	Label string `json:"label,omitempty"`
}

// MentionAttrsFrom reads mention attrs from a generic wire attrs map.
func MentionAttrsFrom(attrs map[string]any) MentionAttrs {
	return MentionAttrs{
		ID:    StringAttr(attrs, "id"),
		Label: StringAttr(attrs, "label"),
	}
}

// NewMentionAttrsFromMap returns typed mention attrs or nil when empty.
func NewMentionAttrsFromMap(attrs map[string]any) *MentionAttrs {
	parsed := MentionAttrsFrom(attrs)
	if parsed.IsZero() {
		return nil
	}
	return &parsed
}

// UnmarshalJSON accepts the typed mention attrs shape while trimming values.
func (attrs *MentionAttrs) UnmarshalJSON(data []byte) error {
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*attrs = MentionAttrsFrom(raw)
	return nil
}

// IsZero reports whether no mention attrs are present.
func (attrs MentionAttrs) IsZero() bool {
	return strings.TrimSpace(attrs.ID) == "" && strings.TrimSpace(attrs.Label) == ""
}

// Map returns mention attrs in the MCP wire shape.
func (attrs MentionAttrs) Map() map[string]any {
	result := map[string]any{}
	if id := strings.TrimSpace(attrs.ID); id != "" {
		result["id"] = id
	}
	if label := strings.TrimSpace(attrs.Label); label != "" {
		result["label"] = label
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

// CodeAttrs returns typed code attrs for this block input.
func (block DocumentBlockInput) CodeAttrs() CodeBlockAttrs {
	return block.Attrs.CodeAttrs()
}

// ListAttrs returns typed list attrs for this block input.
func (block DocumentBlockInput) ListAttrs() ListBlockAttrs {
	return block.Attrs.ListAttrs()
}

// CodeAttrs returns typed code attrs for this block node.
func (block DocumentBlockNode) CodeAttrs() CodeBlockAttrs {
	return block.Attrs.CodeAttrs()
}

// ListAttrs returns typed list attrs for this block node.
func (block DocumentBlockNode) ListAttrs() ListBlockAttrs {
	return block.Attrs.ListAttrs()
}

// LinkAttrs returns typed link attrs for this inline mark input.
func (mark DocumentInlineMarkInput) LinkAttrs() LinkMarkAttrs {
	if mark.Attrs == nil {
		return LinkMarkAttrs{}
	}
	return LinkMarkAttrs{Href: strings.TrimSpace(mark.Attrs.Href)}
}

// MentionAttrs returns typed mention attrs for this inline content input.
func (content DocumentInlineContentInput) MentionAttrs() MentionAttrs {
	if content.Attrs == nil {
		return MentionAttrs{}
	}
	return MentionAttrs{ID: strings.TrimSpace(content.Attrs.ID), Label: strings.TrimSpace(content.Attrs.Label)}
}

// StringAttr reads a trimmed string attr from a generic wire attrs map.
func StringAttr(attrs map[string]any, key string) string {
	if attrs == nil {
		return ""
	}
	if value, ok := attrs[key].(string); ok {
		return strings.TrimSpace(value)
	}
	if value, ok := attrs[key]; ok && value != nil {
		return strings.TrimSpace(fmt.Sprint(value))
	}
	return ""
}

// BoolAttr reads a bool attr from a generic wire attrs map.
func BoolAttr(attrs map[string]any, key string) bool {
	if attrs == nil {
		return false
	}
	if value, ok := attrs[key].(bool); ok {
		return value
	}
	return strings.EqualFold(fmt.Sprint(attrs[key]), "true")
}

// MapAttr reads a nested object attr from a generic wire attrs map.
func MapAttr(attrs map[string]any, key string) map[string]any {
	if attrs == nil {
		return nil
	}
	if value, ok := attrs[key].(map[string]any); ok {
		return value
	}
	return nil
}

// IntAttr reads an int attr from a generic wire attrs map.
func IntAttr(attrs map[string]any, key string) int {
	if attrs == nil {
		return 0
	}
	switch value := attrs[key].(type) {
	case int:
		return value
	case float64:
		return int(value)
	case float32:
		return int(value)
	default:
		var parsed int
		_, _ = fmt.Sscanf(fmt.Sprint(value), "%d", &parsed)
		return parsed
	}
}
