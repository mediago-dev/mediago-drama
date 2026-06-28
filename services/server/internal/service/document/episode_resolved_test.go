package document

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestGetResolvedEpisodeTimelineStateParsesLatestStoryboardAndMergesSavedMedia(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-episode-resolved"
	requireTestProject(t, store, projectID)

	document, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{
		ID:    "story-doc",
		Title: "第一章分镜脚本",
		Content: strings.Join([]string{
			"# 第一章分镜脚本",
			"",
			"## 第 01 组 总时长：00:07",
			"",
			"**动作**：沈阁从黑暗水面坠入湖中。",
			"",
			"**台词**：无",
			"",
			"## 第 02 组 总时长：00:05",
			"",
			"**动作**：他猛然睁眼。",
			"",
			"**台词**：沈阁：“我还活着。”",
		}, "\n"),
		Category: "storyboard",
	})
	if err != nil {
		t.Fatalf("creating storyboard document: %v", err)
	}

	_, err = store.SaveEpisodeTimelineState(projectID, document.ID, SaveEpisodeTimelineStateRequest{
		Episode: json.RawMessage(`{
			"id":"episode-story-doc",
			"title":"第一章分镜脚本",
			"duration":15,
			"aspectRatio":"16:9",
			"sections":[],
			"tracks":[{
				"id":"track-video",
				"type":"video",
				"label":"视频",
				"clips":[{
					"id":"video-0-01-00-07",
					"title":"第 01 组 总时长：00:07",
					"start":0,
					"end":15,
					"content":"旧内容",
					"status":"ready",
					"videoUrl":"/api/v1/media-assets/video-a/content",
					"posterUrl":"/api/v1/media-assets/video-a/poster"
				}]
			}]
		}`),
	})
	if err != nil {
		t.Fatalf("saving episode timeline: %v", err)
	}

	response, err := store.GetResolvedEpisodeTimelineState(projectID, document.ID)
	if err != nil {
		t.Fatalf("GetResolvedEpisodeTimelineState returned error: %v", err)
	}
	if response.ProjectID != projectID || response.DocumentID != document.ID {
		t.Fatalf("response project/document = %q/%q", response.ProjectID, response.DocumentID)
	}
	videoTrack := response.Episode.Tracks[0]
	if videoTrack.Type != "video" || len(videoTrack.Clips) != 2 {
		t.Fatalf("video track = %#v, want two document-derived clips", videoTrack)
	}
	if videoTrack.Clips[0].ID != "video-0-01-00-07" || videoTrack.Clips[0].VideoURL != "/api/v1/media-assets/video-a/content" {
		t.Fatalf("first clip = %#v, want saved media merged onto first group", videoTrack.Clips[0])
	}
	if videoTrack.Clips[1].Title != "第 02 组 总时长：00:05" || videoTrack.Clips[1].VideoURL != "" {
		t.Fatalf("second clip = %#v, want new markdown group without saved media", videoTrack.Clips[1])
	}
	voiceoverTrack := response.Episode.Tracks[1]
	if voiceoverTrack.Type != "voiceover" || len(voiceoverTrack.Clips) != 1 ||
		voiceoverTrack.Clips[0].Content != "沈阁：“我还活着。”" {
		t.Fatalf("voiceover track = %#v, want non-empty 台词 extracted", voiceoverTrack)
	}
	if response.PersistedUpdatedAt == "" {
		t.Fatal("persistedUpdatedAt is empty, want saved timeline timestamp")
	}
}

func TestGetResolvedEpisodeTimelineStateUsesH2StoryboardGroups(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-episode-heading-levels"
	requireTestProject(t, store, projectID)

	document, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{
		ID:    "story-heading-doc",
		Title: "层级分镜脚本",
		Content: strings.Join([]string{
			"# 层级分镜脚本",
			"",
			"## 开场落水",
			"",
			"组备注：水面要冷，节奏慢。",
			"",
			"动作：沈阁从黑暗水面坠入湖中。",
			"台词：无",
			"",
			"镜头备注：他在水面短暂停顿后睁眼。",
			"动作：他猛然睁眼。",
			"台词：沈阁：“我还活着。”",
			"",
			"## 情绪反应",
			"",
			"动作：镜头推近他的眼睛。",
		}, "\n"),
		Category: "storyboard",
	})
	if err != nil {
		t.Fatalf("creating storyboard document: %v", err)
	}

	response, err := store.GetResolvedEpisodeTimelineState(projectID, document.ID)
	if err != nil {
		t.Fatalf("GetResolvedEpisodeTimelineState returned error: %v", err)
	}
	videoTrack := response.Episode.Tracks[0]
	if videoTrack.Type != "video" || len(videoTrack.Clips) != 2 {
		t.Fatalf("video track = %#v, want one clip per h2 group", videoTrack)
	}
	if videoTrack.Clips[0].Title != "开场落水" || videoTrack.Clips[1].Title != "情绪反应" {
		t.Fatalf("clip titles = %#v, want h2 group titles", videoTrack.Clips)
	}
	firstPrompt := videoTrack.Clips[0].Prompt
	for _, want := range []string{"组备注：水面要冷，节奏慢。", "镜头备注", "动作：他猛然睁眼。"} {
		if !strings.Contains(firstPrompt, want) {
			t.Fatalf("first prompt missing %q: %s", want, firstPrompt)
		}
	}
	voiceoverTrack := response.Episode.Tracks[1]
	if voiceoverTrack.Type != "voiceover" || len(voiceoverTrack.Clips) != 1 ||
		voiceoverTrack.Clips[0].Content != "沈阁：“我还活着。”" {
		t.Fatalf("voiceover track = %#v, want 台词 extracted from h2 group content", voiceoverTrack)
	}
}

func TestGetResolvedEpisodeTimelineStateParsesVideoCodeBlocks(t *testing.T) {
	store := requireDocumentStore(t)
	projectID := "project-episode-video-blocks"
	requireTestProject(t, store, projectID)

	document, _, err := store.CreateWorkspaceDocument(projectID, CreateWorkspaceDocumentRequest{
		ID:    "video-doc",
		Title: "智能体生成草稿",
		Content: strings.Join([]string{
			"---",
			"title: 智能体生成草稿",
			"duration: 36",
			"---",
			"",
			"# 意图",
			"",
			"```video",
			"start: 0",
			"end: 10",
			"visual: 工作区打开，智能体面板位于 Markdown 源文档旁边。",
			"audio: 介绍目标并确定创作方向。",
			"```",
			"",
			"# 审阅",
			"",
			"```video",
			"start: 10",
			"end: 36",
			"visual: 创作者检查结果并导出第一版剪辑。",
			"audio: 确认下一轮迭代路径并准备导出。",
			"```",
		}, "\n"),
		Category: "screenplay",
	})
	if err != nil {
		t.Fatalf("creating video-block document: %v", err)
	}

	response, err := store.GetResolvedEpisodeTimelineState(projectID, document.ID)
	if err != nil {
		t.Fatalf("GetResolvedEpisodeTimelineState returned error: %v", err)
	}
	if response.Episode.Duration != 36 {
		t.Fatalf("duration = %v, want 36", response.Episode.Duration)
	}
	videoTrack := response.Episode.Tracks[0]
	if videoTrack.Type != "video" || len(videoTrack.Clips) != 2 {
		t.Fatalf("video track = %#v, want two clips from video code blocks", videoTrack)
	}
	if videoTrack.Clips[0].ID != "video-0-意图" || videoTrack.Clips[0].Prompt != "工作区打开，智能体面板位于 Markdown 源文档旁边。" {
		t.Fatalf("first video clip = %#v, want video block fields", videoTrack.Clips[0])
	}
	voiceoverTrack := response.Episode.Tracks[1]
	if voiceoverTrack.Type != "voiceover" || voiceoverTrack.Clips[0].Content != "介绍目标并确定创作方向。" {
		t.Fatalf("voiceover track = %#v, want audio field", voiceoverTrack)
	}
	captionTrack := response.Episode.Tracks[2]
	if captionTrack.Type != "caption" || captionTrack.Clips[0].Content != "介绍目标并确定创作方向" {
		t.Fatalf("caption track = %#v, want first audio sentence without punctuation", captionTrack)
	}
}
