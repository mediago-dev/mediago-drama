package prompt

import (
	"sync"
	"testing"
)

func TestRenderSectionUsesParsedCache(t *testing.T) {
	parsedTemplates = sync.Map{}
	t.Cleanup(func() {
		parsedTemplates = sync.Map{}
	})

	_, err := renderSection("AGENTS", agentsMdData{})
	if err != nil {
		t.Fatalf("renderSection() error = %v", err)
	}
	if _, ok := parsedTemplates.Load("AGENTS"); !ok {
		t.Fatalf("renderSection() did not cache parsed template")
	}
}

func TestInvalidateTemplateCache(t *testing.T) {
	parsedTemplates = sync.Map{}
	t.Cleanup(func() {
		parsedTemplates = sync.Map{}
	})

	_, err := renderSection("AGENTS", agentsMdData{})
	if err != nil {
		t.Fatalf("renderSection() error = %v", err)
	}
	InvalidateTemplateCache("AGENTS")
	if _, ok := parsedTemplates.Load("AGENTS"); ok {
		t.Fatalf("InvalidateTemplateCache() left cached template")
	}
}
