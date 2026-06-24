package templates

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestTemplatesLoadsBuiltins(t *testing.T) {
	items, err := Templates(context.Background())
	if err != nil {
		t.Fatalf("Templates() error = %v", err)
	}
	if len(items) != 6 {
		t.Fatalf("templates = %d, want 6", len(items))
	}
	for _, item := range items {
		if item.ID == "" || item.Name == "" || item.DocumentCategory == "" || item.Body == "" {
			t.Fatalf("template = %#v, want populated fields", item)
		}
	}
}

func TestTemplateByID(t *testing.T) {
	item, err := TemplateByID(context.Background(), "storyboard.v1")
	if err != nil {
		t.Fatalf("TemplateByID() error = %v", err)
	}
	if item.DocumentCategory != "storyboard" || !strings.Contains(item.Body, "## 第 01 组") {
		t.Fatalf("template = %#v, want storyboard template body", item)
	}
}

func TestTemplateByIDNotFound(t *testing.T) {
	_, err := TemplateByID(context.Background(), "missing.v1")
	if !errors.Is(err, ErrTemplateNotFound) {
		t.Fatalf("TemplateByID() error = %v, want ErrTemplateNotFound", err)
	}
}
