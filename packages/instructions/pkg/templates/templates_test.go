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

func TestTemplatesUseStructureOnlyRules(t *testing.T) {
	character, err := TemplateByID(context.Background(), "character.v1")
	if err != nil {
		t.Fatalf("TemplateByID(character) error = %v", err)
	}
	for _, legacyField := range []string{"**形象定位**：", "**面部特征**：", "**身材气质**：", "**着装造型**：", "**标志性细节**："} {
		if strings.Contains(character.Body, legacyField) {
			t.Fatalf("character template contains legacy field %q", legacyField)
		}
	}
	for _, requiredFragment := range []string{"每个可生成的人物形象使用二级标题", "aaa（十年前）", "aaa（变身后）"} {
		if !strings.Contains(character.Body, requiredFragment) {
			t.Fatalf("character template missing visual variant rule %q:\n%s", requiredFragment, character.Body)
		}
	}

	scene, err := TemplateByID(context.Background(), "scene.v1")
	if err != nil {
		t.Fatalf("TemplateByID(scene) error = %v", err)
	}
	if strings.Contains(scene.Body, "## 场景提取清单\n") {
		t.Fatal("scene template contains scene extraction checklist heading")
	}

	novel, err := TemplateByID(context.Background(), "novel.v1")
	if err != nil {
		t.Fatalf("TemplateByID(novel) error = %v", err)
	}
	for _, fixedScene := range []string{"## 场景一：地点或事件", "## 场景二：地点或事件"} {
		if strings.Contains(novel.Body, fixedScene) {
			t.Fatalf("novel template contains fixed scene heading %q", fixedScene)
		}
	}
}

func TestTemplateByIDNotFound(t *testing.T) {
	_, err := TemplateByID(context.Background(), "missing.v1")
	if !errors.Is(err, ErrTemplateNotFound) {
		t.Fatalf("TemplateByID() error = %v, want ErrTemplateNotFound", err)
	}
}
