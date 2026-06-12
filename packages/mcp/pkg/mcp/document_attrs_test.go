package mcp

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTypedBlockAttrsReadGenericWireMaps(t *testing.T) {
	code := DocumentBlockInput{
		Kind:  "code",
		Attrs: NewDocumentBlockAttrsFromMap(map[string]any{"language": " go "}),
	}
	if got := code.CodeAttrs().Language; got != "go" {
		t.Fatalf("CodeAttrs().Language = %q, want go", got)
	}

	list := DocumentBlockNode{
		Kind:  "list",
		Attrs: NewDocumentBlockAttrsFromMap(map[string]any{"ordered": "true"}),
	}
	if !list.ListAttrs().Ordered {
		t.Fatal("ListAttrs().Ordered = false, want true")
	}

	heading := HeadingBlockAttrsFrom(map[string]any{"level": float64(3)})
	if heading.Level != 3 {
		t.Fatalf("HeadingBlockAttrsFrom().Level = %d, want 3", heading.Level)
	}
}

func TestTypedInlineAttrsReadGenericWireMaps(t *testing.T) {
	link := DocumentInlineMarkInput{
		Kind:  "link",
		Attrs: NewLinkMarkAttrsFromMap(map[string]any{"href": " https://example.test "}),
	}
	if got := link.LinkAttrs().Href; got != "https://example.test" {
		t.Fatalf("LinkAttrs().Href = %q, want URL", got)
	}

	mention := DocumentInlineContentInput{
		Type:  "mention",
		Attrs: NewMentionAttrsFromMap(map[string]any{"id": " doc-1 ", "label": " Scene "}),
	}
	attrs := mention.MentionAttrs()
	if attrs.ID != "doc-1" || attrs.Label != "Scene" {
		t.Fatalf("MentionAttrs() = %#v, want trimmed id and label", attrs)
	}
}

func TestTypedAttrsPreserveWireShape(t *testing.T) {
	ordered := false
	block := DocumentBlockNode{
		ID:       "list-1",
		Kind:     "list",
		Markdown: "- item",
		Attrs:    &DocumentBlockAttrs{Ordered: &ordered},
		Range:    DocumentLineRange{StartLine: 1, EndLine: 1},
		Hash:     "hash",
	}
	data, err := json.Marshal(block)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"attrs":{"ordered":false}`) {
		t.Fatalf("block attrs JSON = %s, want attrs object with ordered false", data)
	}

	empty := DocumentBlockInput{Kind: "paragraph", Text: "body"}
	data, err = json.Marshal(empty)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), `"attrs"`) {
		t.Fatalf("empty block JSON = %s, want attrs omitted", data)
	}

	var mark DocumentInlineMarkInput
	if err := json.Unmarshal([]byte(`{"kind":"link","attrs":{"href":" https://example.test "}}`), &mark); err != nil {
		t.Fatal(err)
	}
	if got := mark.LinkAttrs().Href; got != "https://example.test" {
		t.Fatalf("unmarshaled link href = %q, want trimmed URL", got)
	}
}
