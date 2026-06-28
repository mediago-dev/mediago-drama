package generation

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/model"
)

type fakeStoryboardVideoDocumentResolver struct {
	documents []mediamcp.WorkspaceDocument
}

func (resolver fakeStoryboardVideoDocumentResolver) RequireWorkspaceDocument(projectID string, documentID string) (mediamcp.WorkspaceDocument, error) {
	for _, document := range resolver.documents {
		if document.ID == documentID {
			return document, nil
		}
	}
	return mediamcp.WorkspaceDocument{}, fmt.Errorf("document not found: %s", documentID)
}

func (resolver fakeStoryboardVideoDocumentResolver) ListWorkspaceDocuments(projectID string) (model.WorkspaceDocumentsResponse, error) {
	return model.WorkspaceDocumentsResponse{
		ProjectID: projectID,
		Documents: resolver.documents,
	}, nil
}

func TestGenerationServiceListStoryboardVideoResourcesUsesStoryboardGroups(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	projectID := "project-storyboard-video-resources"
	seedGenerationTaskProject(t, dbPath, projectID)
	seedGenerationTaskAsset(t, dbPath, "video-task", "video", projectID)
	seedGenerationTaskAsset(t, dbPath, "video-selected", "video", projectID)
	taskStore := NewGenerationTaskService(dbPath, nil)
	workflow := NewGenerationService(nil, taskStore, nil)
	workflow.SetDocumentResolver(fakeStoryboardVideoDocumentResolver{
		documents: []mediamcp.WorkspaceDocument{
			{
				ID:       "storyboard-a",
				Title:    "第一章分镜脚本",
				Category: "storyboard",
				Content: joinStoryboardVideoTestLines(
					"# 第一章分镜脚本",
					"",
					"<!-- section-id: section_reel_01 -->",
					"## 开场落水",
					"",
					"沈阁从黑暗水面坠入湖中。",
					"",
					"[章节视频：落水镜头](</api/v1/media-assets/video-1/content>)",
					"",
					"<!-- section-id: section_reel_02 -->",
					"## 苏醒反应",
					"",
					"他猛然睁眼。",
					"",
					"[章节视频：苏醒镜头](</api/v1/media-assets/video-2/content>)",
				),
			},
			{
				ID:       "storyboard-b",
				Title:    "第二章分镜脚本",
				Category: "storyboard",
				Content: joinStoryboardVideoTestLines(
					"# 第二章分镜脚本",
					"",
					"<!-- section-id: section_reel_b_01 -->",
					"## 门外异动",
					"",
					"门外传来脚步声。",
				),
			},
		},
	})
	if err := taskStore.Upsert(GenerationTaskRecord{
		ID:         "task-video-b",
		ProjectID:  projectID,
		DocumentID: "storyboard-b",
		SectionID:  "section_reel_b_01",
		Kind:       "video",
		Status:     "running",
		Prompt:     "门外传来脚步声。",
		Assets: []GenerationAsset{
			{
				AssetID:   "video-task",
				Kind:      "video",
				MIMEType:  "video/mp4",
				Title:     "门外脚步成片",
				URL:       "/api/v1/media-assets/video-task/content",
				PosterURL: "/api/v1/media-assets/video-task/poster",
			},
		},
	}); err != nil {
		t.Fatalf("upserting video task: %v", err)
	}
	if _, ok, err := taskStore.UpsertSelectedAsset(projectID, UpdateSelectedGenerationAssetRequest{
		ResourceType:     "storyboard",
		ResourceID:       "section_reel_01",
		ResourceTitle:    "开场落水",
		MediaAssetID:     "video-selected",
		Kind:             "video",
		Title:            "已选落水镜头",
		URL:              "/api/v1/media-assets/video-selected/content",
		PosterURL:        "/api/v1/media-assets/video-selected/poster",
		MIMEType:         "video/mp4",
		SourceType:       "generated",
		SourceDocumentID: "storyboard-a",
	}); err != nil || !ok {
		t.Fatalf("upserting selected video ok=%v error=%v", ok, err)
	}

	response, err := workflow.ListStoryboardVideoResources(projectID)
	if err != nil {
		t.Fatalf("ListStoryboardVideoResources returned error: %v", err)
	}
	if response.ProjectID != projectID || len(response.Groups) != 2 {
		t.Fatalf("response = %+v, want two storyboard document groups", response)
	}

	first := response.Groups[0]
	if first.DocumentID != "storyboard-a" || len(first.Reels) != 2 {
		t.Fatalf("first group = %+v, want two storyboard group reels", first)
	}
	if first.Reels[0].Title != "开场落水" || first.Reels[0].SectionID != "section_reel_01" {
		t.Fatalf("first reel = %+v, want first storyboard group section", first.Reels[0])
	}
	if first.Reels[1].Title != "苏醒反应" || first.Reels[1].SectionID != "section_reel_02" {
		t.Fatalf("second reel = %+v, want second storyboard group section", first.Reels[1])
	}
	if len(first.Reels[0].Videos) != 1 ||
		first.Reels[0].Videos[0].Title != "开场落水" ||
		first.Reels[0].Videos[0].Src != "/api/v1/media-assets/video-selected/content" ||
		first.Reels[0].Videos[0].PosterURL != "/api/v1/media-assets/video-selected/poster" ||
		first.Reels[0].Videos[0].SourceLabel != "已选成片" {
		t.Fatalf("first reel videos = %+v, want selected video only", first.Reels[0].Videos)
	}
	if len(first.Reels[1].Videos) != 0 {
		t.Fatalf("second reel videos = %+v, want markdown video ignored until selected", first.Reels[1].Videos)
	}

	second := response.Groups[1]
	if second.DocumentID != "storyboard-b" || len(second.Reels) != 1 {
		t.Fatalf("second group = %+v, want one storyboard group reel", second)
	}
	reel := second.Reels[0]
	if reel.Title != "门外异动" || reel.SectionID != "section_reel_b_01" {
		t.Fatalf("task reel = %+v, want storyboard group section", reel)
	}
	if len(reel.Videos) != 0 {
		t.Fatalf("task reel videos = %+v, want generation history ignored until selected", reel.Videos)
	}
}

func TestGenerationServiceListStoryboardVideoResourcesDeduplicatesGroupNumbers(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	projectID := "project-storyboard-video-duplicates"
	seedGenerationTaskProject(t, dbPath, projectID)
	taskStore := NewGenerationTaskService(dbPath, nil)
	workflow := NewGenerationService(nil, taskStore, nil)
	workflow.SetDocumentResolver(fakeStoryboardVideoDocumentResolver{
		documents: []mediamcp.WorkspaceDocument{
			{
				ID:       "storyboard-duplicate",
				Title:    "第一章分镜脚本",
				Category: "storyboard",
				Content: joinStoryboardVideoTestLines(
					"# 第一章分镜脚本",
					"",
					"<!-- section-id: section_old_01 -->",
					"## 第 01 组 总时长：00:08",
					"",
					"旧版第 01 组。",
					"",
					"[章节视频：旧版成片](</api/v1/media-assets/old-video/content>)",
					"",
					"<!-- section-id: section_group_02 -->",
					"## 第 02 组 总时长：00:06",
					"",
					"第 02 组。",
					"",
					"<!-- section-id: section_new_01 -->",
					"## 第 01 组 总时长：00:09",
					"",
					"<!-- PLACEHOLDER -->",
					"",
					"<!-- section-id: section_group_03 -->",
					"## 第 03 组 总时长：00:07",
					"",
					"第 03 组。",
				),
			},
		},
	})

	response, err := workflow.ListStoryboardVideoResources(projectID)
	if err != nil {
		t.Fatalf("ListStoryboardVideoResources returned error: %v", err)
	}
	if len(response.Groups) != 1 || len(response.Groups[0].Reels) != 3 {
		t.Fatalf("groups = %+v, want one document with three unique storyboard groups", response.Groups)
	}
	reels := response.Groups[0].Reels
	if reels[0].Title != "第 01 组 总时长：00:09" || reels[0].SectionID != "section_new_01" {
		t.Fatalf("deduped first reel = %+v, want latest group 01 metadata", reels[0])
	}
	if !strings.Contains(reels[0].Prompt, "旧版第 01 组。") ||
		strings.Contains(reels[0].Prompt, "PLACEHOLDER") {
		t.Fatalf("deduped first reel prompt = %q, want full previous prompt without placeholder", reels[0].Prompt)
	}
	if !strings.Contains(reels[0].Markdown, "旧版第 01 组。") ||
		strings.Contains(reels[0].Markdown, "PLACEHOLDER") {
		t.Fatalf("deduped first reel markdown = %q, want h2 markdown without placeholder", reels[0].Markdown)
	}
	if len(reels[0].Videos) != 0 {
		t.Fatalf("deduped first reel videos = %+v, want markdown videos ignored until selected", reels[0].Videos)
	}
	if reels[1].Title != "第 02 组 总时长：00:06" || reels[2].Title != "第 03 组 总时长：00:07" {
		t.Fatalf("reels = %+v, want group order 01/02/03", reels)
	}
}

func joinStoryboardVideoTestLines(lines ...string) string {
	return strings.Join(lines, "\n")
}
