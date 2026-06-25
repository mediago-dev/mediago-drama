package official

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestInstructionsParsesOfficialTemplates(t *testing.T) {
	instructions, err := Instructions(context.Background())
	if err != nil {
		t.Fatalf("Instructions() error = %v", err)
	}
	if len(instructions) != 2 {
		t.Fatalf("instructions = %#v, want AGENTS and TOOLS", instructions)
	}
	if instructions[0].ID != "AGENTS" || instructions[1].ID != "TOOLS" {
		t.Fatalf("instructions = %#v, want AGENTS then TOOLS", instructions)
	}
	for _, instruction := range instructions {
		if instruction.Name == "" || instruction.Body == "" || !instruction.Editable {
			t.Fatalf("instruction = %#v, want name, body, editable", instruction)
		}
	}
}

func TestInstructionByIDReportsMissingInstruction(t *testing.T) {
	_, err := InstructionByID(context.Background(), "MISSING")
	if !errors.Is(err, ErrInstructionNotFound) {
		t.Fatalf("InstructionByID() error = %v, want ErrInstructionNotFound", err)
	}
}

func TestOfficialInternalTemplatesDoNotContainTemplateVariables(t *testing.T) {
	for _, id := range []string{"AGENTS", "TOOLS"} {
		instruction, err := InstructionByID(context.Background(), id)
		if err != nil {
			t.Fatalf("InstructionByID(%q) error = %v", id, err)
		}
		internal, ok := ExtractMarkdownSection(instruction.Body, "内部模板（代码读取）")
		if !ok {
			t.Fatalf("%s internal template section missing", id)
		}
		if strings.Contains(internal, "{{") || strings.Contains(internal, "}}") {
			t.Fatalf("%s internal templates contain template variables:\n%s", id, internal)
		}
	}
}

func TestExtractMarkdownSectionFindsNestedHeading(t *testing.T) {
	markdown := `# Root

intro

## Parent

parent intro

### Child

child body

### Sibling

sibling body

## Next

next body`
	section, ok := ExtractMarkdownSection(markdown, "Parent", "Child")
	if !ok {
		t.Fatal("ExtractMarkdownSection() ok = false")
	}
	if section != "child body" {
		t.Fatalf("section = %q, want child body", section)
	}
}

func TestExtractMarkdownSectionAllowsEscapedTemplateHeadings(t *testing.T) {
	markdown := `## Internal

### Template

{{"#"}} Prompt Title

{{"##"}} Prompt Fields

body

### Next

next body`
	section, ok := ExtractMarkdownSection(markdown, "Internal", "Template")
	if !ok {
		t.Fatal("ExtractMarkdownSection() ok = false")
	}
	if !strings.Contains(section, `{{"#"}} Prompt Title`) || !strings.Contains(section, "body") {
		t.Fatalf("section = %q, want escaped template headings retained", section)
	}
	if strings.Contains(section, "next body") {
		t.Fatalf("section = %q, want next sibling excluded", section)
	}
}

func TestRemoveMarkdownSectionRemovesNestedHeading(t *testing.T) {
	markdown := `# Root

intro

## Keep

keep body

## Internal

hidden body

### Hidden Child

child body`
	cleaned := RemoveMarkdownSection(markdown, "Internal")
	if strings.Contains(cleaned, "hidden body") || strings.Contains(cleaned, "Hidden Child") {
		t.Fatalf("cleaned = %q, want internal section removed", cleaned)
	}
	if !strings.Contains(cleaned, "keep body") {
		t.Fatalf("cleaned = %q, want keep body retained", cleaned)
	}
}
