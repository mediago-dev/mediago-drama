package document

import (
	"strings"
	"testing"
)

func TestUpdateWorkspaceSectionImageMarkdown(t *testing.T) {
	markdown := strings.Join([]string{
		"# 角色册",
		"",
		"<!-- section-id: section_lintong -->",
		"## 林书彤",
		"",
		"角色描述。",
		"",
		"<!-- section-id: section_chenyuan -->",
		"## 陈远",
		"",
		"陈远描述。",
	}, "\n")

	image := workspaceSectionImage{
		Src:   "/api/v1/media-assets/asset-lin/content",
		Title: "林书彤",
	}
	next, changed, err := updateWorkspaceSectionImageMarkdown(markdown, "doc-a", "section_lintong", image, true)
	if err != nil {
		t.Fatalf("selecting section image: %v", err)
	}
	if !changed {
		t.Fatal("changed = false, want true")
	}
	if !strings.Contains(next, "![林书彤](</api/v1/media-assets/asset-lin/content>)") {
		t.Fatalf("markdown = %q, want inserted image", next)
	}
	if strings.Contains(sectionMarkdownForTest(next, "section_chenyuan"), "asset-lin") {
		t.Fatalf("markdown = %q, inserted image into wrong section", next)
	}

	again, changed, err := updateWorkspaceSectionImageMarkdown(next, "doc-a", "section_lintong", image, true)
	if err != nil {
		t.Fatalf("selecting existing section image: %v", err)
	}
	if changed {
		t.Fatal("changed = true, want false for duplicate image")
	}
	if again != next {
		t.Fatal("duplicate selection changed markdown")
	}

	removed, changed, err := updateWorkspaceSectionImageMarkdown(next, "doc-a", "section_lintong", image, false)
	if err != nil {
		t.Fatalf("deselecting section image: %v", err)
	}
	if !changed {
		t.Fatal("changed = false, want true for removal")
	}
	if strings.Contains(removed, "asset-lin") {
		t.Fatalf("markdown = %q, want image removed", removed)
	}
}

func TestUpdateWorkspaceSectionImageMarkdownRequiresSectionID(t *testing.T) {
	_, _, err := updateWorkspaceSectionImageMarkdown("# 标题\n", "doc-a", "section_missing", workspaceSectionImage{Src: "/image.png"}, true)
	if err == nil || !strings.Contains(err.Error(), "文档 section 不存在") {
		t.Fatalf("err = %v, want missing section error", err)
	}
}

func TestUpdateWorkspaceSectionMediaMarkdown(t *testing.T) {
	markdown := strings.Join([]string{
		"# 分镜脚本",
		"",
		"<!-- section-id: section_shot -->",
		"## 分镜 01",
		"",
		"镜头描述。",
		"",
		"<!-- section-id: section_next -->",
		"## 分镜 02",
		"",
		"下一镜。",
	}, "\n")
	media := workspaceSectionMedia{
		Kind:  "video",
		Src:   "/api/v1/media-assets/video-1/content",
		Title: "分镜 01",
	}

	next, changed, err := updateWorkspaceSectionMediaMarkdown(markdown, "doc-a", "section_shot", media, true)
	if err != nil {
		t.Fatalf("selecting section media: %v", err)
	}
	if !changed {
		t.Fatal("changed = false, want true")
	}
	if !strings.Contains(next, "[章节视频：分镜 01](</api/v1/media-assets/video-1/content>)") {
		t.Fatalf("markdown = %q, want inserted media", next)
	}
	if strings.Contains(sectionMarkdownForTest(next, "section_next"), "video-1") {
		t.Fatalf("markdown = %q, inserted media into wrong section", next)
	}

	again, changed, err := updateWorkspaceSectionMediaMarkdown(next, "doc-a", "section_shot", media, true)
	if err != nil {
		t.Fatalf("selecting existing section media: %v", err)
	}
	if changed || again != next {
		t.Fatal("duplicate selection changed markdown")
	}

	removed, changed, err := updateWorkspaceSectionMediaMarkdown(next, "doc-a", "section_shot", media, false)
	if err != nil {
		t.Fatalf("deselecting section media: %v", err)
	}
	if !changed {
		t.Fatal("changed = false, want true for removal")
	}
	if strings.Contains(removed, "video-1") {
		t.Fatalf("markdown = %q, want media removed", removed)
	}
}

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

func TestWorkspaceStateServiceUpdateWorkspaceDocumentSectionImage(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-section-image"
	requireTestProject(t, store, projectID)

	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		Title: "角色册",
		Content: strings.Join([]string{
			"# 角色册",
			"",
			"<!-- section-id: section_lintong -->",
			"## 林书彤",
			"",
			"角色描述。",
		}, "\n"),
		Category: "reference",
	})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}

	updated, state, err := store.UpdateWorkspaceDocumentSectionImage(projectID, document.ID, workspaceDocumentSectionImageRequest{
		SectionID: "section_lintong",
		Image: workspaceSectionImage{
			Src:   "/api/v1/media-assets/asset-lin/content",
			Title: "林书彤",
		},
		Selected:        true,
		ExpectedVersion: &document.Version,
	})
	if err != nil {
		t.Fatalf("updating section image: %v", err)
	}
	if updated.Version != document.Version+1 {
		t.Fatalf("version = %d, want %d", updated.Version, document.Version+1)
	}
	if updated.IsDirty {
		t.Fatal("updated document should be clean after save")
	}
	if !strings.Contains(updated.Content, "![林书彤](</api/v1/media-assets/asset-lin/content>)") {
		t.Fatalf("content = %q, want inserted section image", updated.Content)
	}
	saved, ok := FindWorkspaceDocumentByID(state.Documents, document.ID)
	if !ok || saved.Content != updated.Content {
		t.Fatalf("state document = %#v, want updated content", saved)
	}

	_, _, err = store.UpdateWorkspaceDocumentSectionImage(projectID, document.ID, workspaceDocumentSectionImageRequest{
		SectionID:       "section_lintong",
		Image:           workspaceSectionImage{Src: "/api/v1/media-assets/asset-other/content"},
		Selected:        true,
		ExpectedVersion: &document.Version,
	})
	if !IsWorkspaceVersionConflict(err) {
		t.Fatalf("err = %v, want version conflict", err)
	}
}

func TestWorkspaceStateServiceUpdateWorkspaceDocumentSectionImageAnchorsLegacyBlockID(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-section-image-legacy-block"
	requireTestProject(t, store, projectID)

	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		Title: "角色册",
		Content: strings.Join([]string{
			"# 角色册",
			"",
			"## 林书彤",
			"",
			"角色描述。",
		}, "\n"),
		Category: "reference",
	})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}

	legacyBlockID := createWorkspaceSectionBlockID(document.ID, 2, 1, "林书彤")
	updated, _, err := store.UpdateWorkspaceDocumentSectionImage(projectID, document.ID, workspaceDocumentSectionImageRequest{
		SectionID: legacyBlockID,
		Image: workspaceSectionImage{
			Src:   "/api/v1/media-assets/asset-lin/content",
			Title: "林书彤",
		},
		Selected:        true,
		ExpectedVersion: &document.Version,
	})
	if err != nil {
		t.Fatalf("updating legacy block section image: %v", err)
	}

	anchoredSectionID := strings.Replace(legacyBlockID, "section-", "section_", 1)
	if !strings.Contains(updated.Content, "<!-- section-id: "+anchoredSectionID+" -->\n## 林书彤") {
		t.Fatalf("content = %q, want anchored section id %s", updated.Content, anchoredSectionID)
	}
	if !strings.Contains(updated.Content, "![林书彤](</api/v1/media-assets/asset-lin/content>)") {
		t.Fatalf("content = %q, want inserted section image", updated.Content)
	}
}

func TestWorkspaceStateServiceUpdateWorkspaceDocumentSectionImageReanchorsLegacyCommentID(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-section-image-legacy-comment"
	requireTestProject(t, store, projectID)

	documentID := "legacy-comment-doc"
	legacyBlockID := createWorkspaceSectionBlockID(documentID, 2, 1, "林书彤")
	document, _, err := store.createDocument(projectID, createWorkspaceDocumentRequest{
		ID:    documentID,
		Title: "角色册",
		Content: strings.Join([]string{
			"# 角色册",
			"",
			"<!-- section-id: " + legacyBlockID + " -->",
			"## 林书彤",
			"",
			"角色描述。",
		}, "\n"),
		Category: "reference",
	})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}

	updated, _, err := store.UpdateWorkspaceDocumentSectionImage(projectID, document.ID, workspaceDocumentSectionImageRequest{
		SectionID: legacyBlockID,
		Image: workspaceSectionImage{
			Src:   "/api/v1/media-assets/asset-lin/content",
			Title: "林书彤",
		},
		Selected:        true,
		ExpectedVersion: &document.Version,
	})
	if err != nil {
		t.Fatalf("updating legacy comment section image: %v", err)
	}

	anchoredSectionID := strings.Replace(legacyBlockID, "section-", "section_", 1)
	if strings.Contains(updated.Content, "<!-- section-id: "+legacyBlockID+" -->") {
		t.Fatalf("content = %q, want legacy section id comment removed", updated.Content)
	}
	if !strings.Contains(updated.Content, "<!-- section-id: "+anchoredSectionID+" -->\n## 林书彤") {
		t.Fatalf("content = %q, want canonical section id next to heading", updated.Content)
	}
	if !strings.Contains(updated.Content, "![林书彤](</api/v1/media-assets/asset-lin/content>)") {
		t.Fatalf("content = %q, want inserted section image", updated.Content)
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

func TestWorkspaceStateServiceUpdateWorkspaceDocumentSectionMedia(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-section-media"
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
		Category: "reference",
	})
	if err != nil {
		t.Fatalf("creating document: %v", err)
	}

	updated, state, err := store.UpdateWorkspaceDocumentSectionMedia(projectID, document.ID, workspaceDocumentSectionMediaRequest{
		SectionID: "section_shot",
		Media: workspaceSectionMedia{
			Kind:  "video",
			Src:   "/api/v1/media-assets/video-1/content",
			Title: "分镜 01",
		},
		Selected:        true,
		ExpectedVersion: &document.Version,
	})
	if err != nil {
		t.Fatalf("updating section media: %v", err)
	}
	if updated.Version != document.Version+1 {
		t.Fatalf("version = %d, want %d", updated.Version, document.Version+1)
	}
	if !strings.Contains(updated.Content, "[章节视频：分镜 01](</api/v1/media-assets/video-1/content>)") {
		t.Fatalf("content = %q, want inserted section media", updated.Content)
	}
	saved, ok := FindWorkspaceDocumentByID(state.Documents, document.ID)
	if !ok || saved.Content != updated.Content {
		t.Fatalf("state document = %#v, want updated content", saved)
	}

	_, _, err = store.UpdateWorkspaceDocumentSectionMedia(projectID, document.ID, workspaceDocumentSectionMediaRequest{
		SectionID:       "section_shot",
		Media:           workspaceSectionMedia{Kind: "video", Src: "/api/v1/media-assets/video-2/content", Title: "分镜 01"},
		Selected:        true,
		ExpectedVersion: &document.Version,
	})
	if !IsWorkspaceVersionConflict(err) {
		t.Fatalf("err = %v, want version conflict", err)
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
