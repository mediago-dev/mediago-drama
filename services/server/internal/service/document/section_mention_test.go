package document

import (
	"strings"
	"testing"
)

func TestUpdateWorkspaceSectionMentionMarkdown(t *testing.T) {
	markdown := strings.Join([]string{
		"# 分镜脚本",
		"",
		"<!-- section-id: section_shot -->",
		"## 分镜 01",
		"",
		"动作描述。",
		"",
		"<!-- section-id: section_next -->",
		"## 分镜 02",
		"",
		"下一镜。",
	}, "\n")
	reference := workspaceSectionMentionReference{
		DocumentID: "character-doc",
		BlockID:    "section_character",
		Title:      "林书彤",
		Category:   "character",
	}

	next, changed, err := updateWorkspaceSectionMentionMarkdown(markdown, "doc-a", "section_shot", reference, true)
	if err != nil {
		t.Fatalf("selecting section mention: %v", err)
	}
	if !changed {
		t.Fatal("changed = false, want true")
	}
	if !strings.Contains(next, "引用资源： @[林书彤](mention://character-doc/section_character)") {
		t.Fatalf("markdown = %q, want inserted mention", next)
	}
	if strings.Contains(next, "kind=") {
		t.Fatalf("markdown = %q, mention should not include kind query", next)
	}
	if strings.Contains(sectionMarkdownForTest(next, "section_next"), "林书彤") {
		t.Fatalf("markdown = %q, inserted mention into wrong section", next)
	}

	again, changed, err := updateWorkspaceSectionMentionMarkdown(next, "doc-a", "section_shot", reference, true)
	if err != nil {
		t.Fatalf("selecting existing section mention: %v", err)
	}
	if changed || again != next {
		t.Fatal("duplicate selection changed markdown")
	}

	removed, changed, err := updateWorkspaceSectionMentionMarkdown(next, "doc-a", "section_shot", reference, false)
	if err != nil {
		t.Fatalf("deselecting section mention: %v", err)
	}
	if !changed {
		t.Fatal("changed = false, want true for removal")
	}
	if strings.Contains(removed, "引用资源") || strings.Contains(removed, "林书彤") {
		t.Fatalf("markdown = %q, want mention and empty reference line removed", removed)
	}
}

func TestUpdateWorkspaceSectionMentionMarkdownRemovesLegacyMentionQueries(t *testing.T) {
	markdown := strings.Join([]string{
		"# 分镜脚本",
		"",
		"<!-- section-id: section_shot -->",
		"## 分镜 01",
		"",
		"引用资源： @[陈远](mention://character-doc/section_character?kind=section&category=character)；@[湖大正校门口](mention://scene-doc/section_scene)",
		"",
		"动作描述。",
	}, "\n")

	next, changed, err := updateWorkspaceSectionMentionMarkdown(markdown, "doc-a", "section_shot", workspaceSectionMentionReference{
		DocumentID: "character-doc",
		BlockID:    "section_character",
		Title:      "陈远",
	}, false)
	if err != nil {
		t.Fatalf("deselecting section mention: %v", err)
	}
	if !changed {
		t.Fatal("changed = false, want true")
	}
	if strings.Contains(next, "陈远") {
		t.Fatalf("markdown = %q, want legacy mention removed", next)
	}
	if !strings.Contains(next, "@[湖大正校门口](mention://scene-doc/section_scene)") {
		t.Fatalf("markdown = %q, want other mention preserved", next)
	}
}

func TestWorkspaceStateServiceUpdateWorkspaceDocumentSectionMention(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-section-mention"
	requireTestProject(t, store, projectID)

	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		Title: "分镜脚本",
		Content: strings.Join([]string{
			"# 分镜脚本",
			"",
			"<!-- section-id: section_shot -->",
			"## 分镜 01",
			"",
			"镜头描述。",
		}, "\n"),
		Category: "storyboard",
	})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}

	updated, state, err := store.UpdateWorkspaceDocumentSectionMention(projectID, document.ID, workspaceDocumentSectionMentionRequest{
		SectionID: "section_shot",
		Reference: workspaceSectionMentionReference{
			DocumentID: "character-doc",
			BlockID:    "section_character",
			Title:      "林书彤",
			Category:   "character",
		},
		Selected:        true,
		ExpectedVersion: &document.Version,
	})
	if err != nil {
		t.Fatalf("updating section mention: %v", err)
	}
	if updated.Version != document.Version+1 {
		t.Fatalf("version = %d, want %d", updated.Version, document.Version+1)
	}
	if !strings.Contains(updated.Content, "引用资源： @[林书彤](mention://character-doc/section_character)") {
		t.Fatalf("content = %q, want inserted section mention", updated.Content)
	}
	saved, ok := FindWorkspaceDocumentByID(state.Documents, document.ID)
	if !ok || saved.Content != updated.Content {
		t.Fatalf("state document = %#v, want updated content", saved)
	}

	_, _, err = store.UpdateWorkspaceDocumentSectionMention(projectID, document.ID, workspaceDocumentSectionMentionRequest{
		SectionID: "section_shot",
		Reference: workspaceSectionMentionReference{
			DocumentID: "prop-doc",
			BlockID:    "section_prop",
			Title:      "道具",
		},
		Selected:        true,
		ExpectedVersion: &document.Version,
	})
	if !IsWorkspaceVersionConflict(err) {
		t.Fatalf("err = %v, want version conflict", err)
	}
}

func TestWorkspaceStateServiceUpdateWorkspaceDocumentSectionMentionReanchorsLegacyCommentID(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-section-mention-legacy-comment"
	requireTestProject(t, store, projectID)

	documentID := "legacy-mention-doc"
	legacyBlockID := createWorkspaceSectionBlockID(documentID, 2, 1, "分镜 01")
	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		ID:    documentID,
		Title: "分镜脚本",
		Content: strings.Join([]string{
			"# 分镜脚本",
			"",
			"<!-- section-id: " + legacyBlockID + " -->",
			"## 分镜 01",
			"",
			"镜头描述。",
		}, "\n"),
		Category: "storyboard",
	})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}

	updated, _, err := store.UpdateWorkspaceDocumentSectionMention(projectID, document.ID, workspaceDocumentSectionMentionRequest{
		SectionID: legacyBlockID,
		Reference: workspaceSectionMentionReference{
			DocumentID: "character-doc",
			BlockID:    "section_character",
			Title:      "林书彤",
		},
		Selected:        true,
		ExpectedVersion: &document.Version,
	})
	if err != nil {
		t.Fatalf("updating legacy comment section mention: %v", err)
	}

	anchoredSectionID := strings.Replace(legacyBlockID, "section-", "section_", 1)
	if strings.Contains(updated.Content, "<!-- section-id: "+legacyBlockID+" -->") {
		t.Fatalf("content = %q, want legacy section id comment removed", updated.Content)
	}
	if !strings.Contains(updated.Content, "<!-- section-id: "+anchoredSectionID+" -->\n## 分镜 01") {
		t.Fatalf("content = %q, want canonical section id next to heading", updated.Content)
	}
	if !strings.Contains(updated.Content, "引用资源： @[林书彤](mention://character-doc/section_character)") {
		t.Fatalf("content = %q, want inserted section mention", updated.Content)
	}
}

func sectionMarkdownForTest(markdown string, sectionID string) string {
	lines := strings.Split(markdown, "\n")
	headingIndex := workspaceSectionHeadingLineByID(lines, sectionID)
	if headingIndex < 0 {
		return ""
	}
	return strings.Join(lines[headingIndex:workspaceSectionEndLine(lines, headingIndex, workspaceHeadingLevel(lines[headingIndex]))], "\n")
}
