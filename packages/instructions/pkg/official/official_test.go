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
	instruction, err := InstructionByID(context.Background(), "AGENTS")
	if err != nil {
		t.Fatalf("InstructionByID(%q) error = %v", "AGENTS", err)
	}
	internal, ok := ExtractMarkdownSection(instruction.Body, "内部模板（代码读取）")
	if !ok {
		t.Fatal("AGENTS internal template section missing")
	}
	if strings.Contains(internal, "{{") || strings.Contains(internal, "}}") {
		t.Fatalf("AGENTS internal templates contain template variables:\n%s", internal)
	}
}

func TestPromptOptimizationIsNotOfficialInstruction(t *testing.T) {
	_, err := InstructionByID(context.Background(), "PROMPT_OPTIMIZATION")
	if !errors.Is(err, ErrInstructionNotFound) {
		t.Fatalf("InstructionByID(%q) error = %v, want ErrInstructionNotFound", "PROMPT_OPTIMIZATION", err)
	}
}

func TestToolsInstructionDoesNotBlockBusinessDocumentsOnMissingStyle(t *testing.T) {
	instruction, err := InstructionByID(context.Background(), "TOOLS")
	if err != nil {
		t.Fatalf("InstructionByID(%q) error = %v", "TOOLS", err)
	}
	for _, want := range []string{
		"缺少视觉风格不得中断任务或先询问用户",
		"先生成风格中性的基础设定",
	} {
		if !strings.Contains(instruction.Body, want) {
			t.Fatalf("TOOLS instruction = %q, want fragment %q", instruction.Body, want)
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
