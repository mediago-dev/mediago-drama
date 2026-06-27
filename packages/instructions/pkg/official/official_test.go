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
	if len(instructions) != 3 {
		t.Fatalf("instructions = %#v, want AGENTS, TOOLS, and PROMPT_OPTIMIZATION", instructions)
	}
	if instructions[0].ID != "AGENTS" ||
		instructions[1].ID != "TOOLS" ||
		instructions[2].ID != "PROMPT_OPTIMIZATION" {
		t.Fatalf("instructions = %#v, want AGENTS, TOOLS, then PROMPT_OPTIMIZATION", instructions)
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

func TestPromptOptimizationTemplateIsSeparateAndNotInjectable(t *testing.T) {
	instruction, err := InstructionByID(context.Background(), "PROMPT_OPTIMIZATION")
	if err != nil {
		t.Fatalf("InstructionByID(%q) error = %v", "PROMPT_OPTIMIZATION", err)
	}
	if instruction.Injectable {
		t.Fatalf("PROMPT_OPTIMIZATION Injectable = true, want false")
	}
	if strings.Contains(instruction.Body, "内部模板（代码读取）") {
		t.Fatalf("PROMPT_OPTIMIZATION body = %q, should not use agent internal template section", instruction.Body)
	}
	section, ok := ExtractMarkdownSection(instruction.Body, "提示词优化系统指令")
	if !ok || !strings.Contains(section, "AI 绘画提示词优化专家") {
		t.Fatalf("prompt optimization section = %q, ok = %v", section, ok)
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
