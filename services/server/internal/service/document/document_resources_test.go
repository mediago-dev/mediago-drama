package document

import (
	"strings"
	"testing"
)

func TestListWorkspaceDocumentResourcesParsesCharacterSections(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-document-resources-character"
	requireTestProject(t, store, projectID)

	document, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{
		ID:    "characters",
		Title: "角色设定",
		Content: strings.Join([]string{
			"# 角色设定",
			"",
			"<!-- section-id: section_lintong -->",
			"## 林书彤",
			"",
			"冷静的调查记者。",
			"",
			"![主角 底层青年 / 低阶散修](</api/v1/media-assets/character-a/content>)",
			"",
			"## 陈远",
			"",
			"从旧城区来的青年。",
		}, "\n"),
		Category: "character",
	})
	if err != nil {
		t.Fatalf("creating character document: %v", err)
	}

	response, err := store.ListWorkspaceDocumentResources(projectID)
	if err != nil {
		t.Fatalf("ListWorkspaceDocumentResources returned error: %v", err)
	}
	if response.ProjectID != projectID {
		t.Fatalf("projectId = %q, want %q", response.ProjectID, projectID)
	}
	if len(response.Resources) != 2 {
		t.Fatalf("resources = %#v, want 2 records", response.Resources)
	}

	first := response.Resources[0]
	if first.ID != "character:characters:section_lintong" {
		t.Fatalf("first id = %q", first.ID)
	}
	if first.Type != "character" || first.SourceCategory != "character" {
		t.Fatalf("first type = %q sourceCategory = %q", first.Type, first.SourceCategory)
	}
	if first.Title != "林书彤" || first.SectionID != "section_lintong" || first.BlockID != "section_lintong" {
		t.Fatalf("first resource = %#v, want declared section id and title", first)
	}
	if first.DocumentID != document.ID || first.DocumentTitle != "角色设定" {
		t.Fatalf("first document fields = %#v", first)
	}
	if first.HeadingLevel != 2 || first.HeadingOccurrence != 1 {
		t.Fatalf("heading = H%d occurrence %d, want H2 occurrence 1", first.HeadingLevel, first.HeadingOccurrence)
	}
	if first.Summary != "冷静的调查记者。" {
		t.Fatalf("summary = %q", first.Summary)
	}
	if !strings.Contains(first.Prompt, "## 林书彤") || strings.Contains(first.Prompt, "media-assets") {
		t.Fatalf("prompt = %q, want section text without selected image", first.Prompt)
	}
	if len(first.SelectedImages) != 1 ||
		first.SelectedImages[0].Src != "/api/v1/media-assets/character-a/content" ||
		first.SelectedImages[0].Title != "主角 底层青年 / 低阶散修" {
		t.Fatalf("selectedImages = %#v", first.SelectedImages)
	}
	if !first.CanGenerate {
		t.Fatal("canGenerate = false, want true")
	}

	second := response.Resources[1]
	wantFallbackID := createWorkspaceSectionBlockID("characters", 2, 1, "陈远")
	if second.SectionID != wantFallbackID || second.BlockID != wantFallbackID {
		t.Fatalf("second sectionId = %q blockId = %q, want fallback %q", second.SectionID, second.BlockID, wantFallbackID)
	}
}

func TestListWorkspaceDocumentResourcesParsesStoryboardShots(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-document-resources-storyboard"
	requireTestProject(t, store, projectID)

	_, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{
		ID:    "storyboard-ep1",
		Title: "第一章分镜",
		Content: strings.Join([]string{
			"# 分镜脚本",
			"",
			"## 第 01 组 总时长：00:07",
			"",
			"<!-- section-id: section_shot_01 -->",
			"### 分镜 01",
			"",
			"动作：林书彤推开门。",
			"",
			"### 分镜 02",
			"",
			"动作：镜头切到走廊。",
			"",
			"```",
			"### 分镜 99",
			"```",
		}, "\n"),
		Category: "storyboard",
	})
	if err != nil {
		t.Fatalf("creating storyboard document: %v", err)
	}

	response, err := store.ListWorkspaceDocumentResources(projectID)
	if err != nil {
		t.Fatalf("ListWorkspaceDocumentResources returned error: %v", err)
	}
	if len(response.Resources) != 2 {
		t.Fatalf("resources = %#v, want only two shot records", response.Resources)
	}
	if response.Resources[0].Title != "分镜 01" || response.Resources[0].SectionID != "section_shot_01" {
		t.Fatalf("first storyboard resource = %#v", response.Resources[0])
	}
	if response.Resources[1].Title != "分镜 02" {
		t.Fatalf("second storyboard title = %q, want 分镜 02", response.Resources[1].Title)
	}
	for _, resource := range response.Resources {
		if resource.Title == "分镜脚本" || strings.HasPrefix(resource.Title, "第 01 组") || resource.Title == "分镜 99" {
			t.Fatalf("unexpected storyboard resource parsed: %#v", resource)
		}
	}
}
