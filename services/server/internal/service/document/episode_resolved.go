package document

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/model"
)

const (
	episodeFallbackSegmentSeconds = 12
	episodeStoryboardGroupSeconds = 15
)

var (
	episodeDurationPattern         = regexp.MustCompile(`(?m)^duration:\s*(\d+)`)
	episodeFrontmatterPattern      = regexp.MustCompile(`(?s)^---\n.*?\n---\n?`)
	episodeFrontmatterTitlePattern = regexp.MustCompile(`(?m)^title:\s*(.+)$`)
	episodeHeadingPattern          = regexp.MustCompile(`^(#{1,6})\s+(.+)$`)
	episodeMarkdownSectionPattern  = regexp.MustCompile(`^(#{1,3})\s+(.+)$`)
	episodeSentenceEndPattern      = regexp.MustCompile(`[.!?。！？]`)
	episodeCodeFencePattern        = regexp.MustCompile("(?s)```.*?```")
	episodeVideoFencePattern       = regexp.MustCompile("(?s)```video\n(.*?)```")
)

type episodeMarkdownSection struct {
	content string
	title   string
}

type episodeStoryboardSegment struct {
	caption   string
	end       float64
	id        string
	start     float64
	title     string
	video     string
	voiceover string
}

type episodeStoryboardGroup struct {
	notes string
	shots []episodeMarkdownSection
	title string
}

type episodeTimelineSegment struct {
	audio  string
	end    float64
	id     string
	start  float64
	title  string
	visual string
}

// GetResolvedEpisodeTimelineState returns a timeline rebuilt from the latest document content.
func (store *Service) GetResolvedEpisodeTimelineState(projectID string, documentID string) (EpisodeTimelineResolvedResponse, error) {
	if err := store.requireReady(); err != nil {
		return EpisodeTimelineResolvedResponse{}, err
	}
	projectID = domain.CleanProjectID(projectID)
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return EpisodeTimelineResolvedResponse{}, fmt.Errorf("documentId is required")
	}

	state, err := store.load(projectID)
	if err != nil {
		return EpisodeTimelineResolvedResponse{}, err
	}
	document, ok := FindWorkspaceDocumentByID(state.Documents, documentID)
	if !ok {
		return EpisodeTimelineResolvedResponse{}, repository.ErrRecordNotFound
	}

	episode := createEpisodeFromWorkspaceDocument(document)
	persisted, ok, err := store.getEpisodeTimelineState(projectID, documentID)
	if err != nil {
		return EpisodeTimelineResolvedResponse{}, err
	}
	persistedUpdatedAt := ""
	if ok {
		var persistedEpisode model.EpisodeRecord
		if err := json.Unmarshal(persisted.Episode, &persistedEpisode); err != nil {
			return EpisodeTimelineResolvedResponse{}, fmt.Errorf("decoding persisted episode: %w", err)
		}
		episode = mergeEpisodeGeneratedMedia(episode, persistedEpisode)
		persistedUpdatedAt = persisted.UpdatedAt
	}

	return EpisodeTimelineResolvedResponse{
		WorkspaceDir:       state.WorkspaceDir,
		ProjectID:          projectID,
		DocumentID:         document.ID,
		Episode:            episode,
		DocumentUpdatedAt:  document.UpdatedAt,
		PersistedUpdatedAt: persistedUpdatedAt,
	}, nil
}

func createEpisodeFromWorkspaceDocument(document mediamcp.WorkspaceDocument) model.EpisodeRecord {
	segments := readEpisodeTimelineSegments(document.Content)
	if len(segments) > 0 {
		return createEpisodeFromTimelineSegments(document, segments)
	}
	if NormalizeDocumentCategoryValue(document.Category) == "storyboard" {
		return createEpisodeFromStoryboardDocument(document)
	}
	return createEpisodeFromMarkdownHeadings(document)
}

func createEpisodeFromTimelineSegments(document mediamcp.WorkspaceDocument, segments []episodeTimelineSegment) model.EpisodeRecord {
	segmentDuration := 1.0
	for _, segment := range segments {
		segmentDuration = maxFloat(segmentDuration, segment.end)
	}
	duration := maxFloat(readEpisodeDuration(document.Content), segmentDuration)
	sections := make([]model.EpisodeSectionRecord, 0, len(segments))
	videoClips := make([]model.TimelineClipRecord, 0, len(segments))
	voiceoverClips := []model.TimelineClipRecord{}
	captionClips := make([]model.TimelineClipRecord, 0, len(segments))

	for _, segment := range segments {
		sections = append(sections, model.EpisodeSectionRecord{
			ID:      "section-" + segment.id,
			Title:   segment.title,
			Start:   segment.start,
			End:     segment.end,
			Summary: firstNonEmpty(segment.visual, segment.audio, "来自 Markdown 源文档的场景块。"),
		})
		videoClips = append(videoClips, model.TimelineClipRecord{
			ID:      "video-" + segment.id,
			Title:   segment.title,
			Start:   segment.start,
			End:     segment.end,
			Content: firstNonEmpty(segment.visual, "来自 Markdown 源文档的视觉节拍。"),
			Status:  "draft",
			Prompt:  segment.visual,
			Source:  "Markdown 视频块",
		})
		if strings.TrimSpace(segment.audio) != "" {
			voiceoverClips = append(voiceoverClips, model.TimelineClipRecord{
				ID:      "voiceover-" + segment.id,
				Title:   segment.title + " 旁白",
				Start:   segment.start,
				End:     segment.end,
				Content: segment.audio,
				Status:  "draft",
				Source:  "Markdown 音频字段",
			})
		}
		captionClips = append(captionClips, model.TimelineClipRecord{
			ID:      "caption-" + segment.id,
			Title:   segment.title,
			Start:   segment.start,
			End:     minFloat(segment.start+maxFloat((segment.end-segment.start)/2, 3), segment.end),
			Content: captionFromTimelineSegment(segment),
			Status:  "draft",
			Source:  "Markdown 章节标题",
		})
	}

	return model.EpisodeRecord{
		ID:          "episode-" + document.ID,
		Title:       firstNonEmpty(document.Title, readEpisodeTitle(document.Content), "未命名剧集"),
		Duration:    duration,
		AspectRatio: "16:9",
		Sections:    sections,
		Tracks: []model.TimelineTrackRecord{
			{ID: "track-video", Type: "video", Label: "视频", Clips: videoClips},
			{ID: "track-voiceover", Type: "voiceover", Label: "旁白", Clips: voiceoverClips},
			{ID: "track-caption", Type: "caption", Label: "字幕", Clips: captionClips},
			createEpisodeMusicTrack(duration),
			createEpisodeAssetTrack(duration),
		},
	}
}

func readEpisodeTimelineSegments(markdown string) []episodeTimelineSegment {
	sections := regexp.MustCompile(`(?m)^# `).Split(markdown, -1)
	segments := []episodeTimelineSegment{}

	for _, section := range sections {
		title := firstEpisodeLine(section)
		if title == "" {
			title = "未命名"
		}
		fenceMatch := episodeVideoFencePattern.FindStringSubmatch(section)
		if len(fenceMatch) != 2 {
			continue
		}

		fields := parseEpisodeTimelineFields(fenceMatch[1])
		start := parseEpisodeFloatField(fields["start"], 0)
		end := parseEpisodeFloatField(fields["end"], start)
		segments = append(segments, episodeTimelineSegment{
			id:     strconv.Itoa(len(segments)) + "-" + strings.Join(strings.Fields(strings.ToLower(title)), "-"),
			title:  title,
			start:  start,
			end:    end,
			visual: fields["visual"],
			audio:  fields["audio"],
		})
	}

	return segments
}

func parseEpisodeTimelineFields(body string) map[string]string {
	fields := map[string]string{}
	for _, line := range strings.Split(body, "\n") {
		separator := strings.Index(line, ":")
		if separator == -1 {
			continue
		}
		key := strings.TrimSpace(line[:separator])
		value := strings.TrimSpace(line[separator+1:])
		if key != "" {
			fields[key] = value
		}
	}
	return fields
}

func parseEpisodeFloatField(value string, fallback float64) float64 {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func firstEpisodeLine(value string) string {
	line, _, _ := strings.Cut(value, "\n")
	return strings.TrimSpace(line)
}

func captionFromTimelineSegment(segment episodeTimelineSegment) string {
	audio := strings.TrimSpace(segment.audio)
	if audio == "" {
		return segment.title
	}
	sentences := episodeSentenceEndPattern.Split(audio, 2)
	if len(sentences) > 0 && strings.TrimSpace(sentences[0]) != "" {
		return strings.TrimSpace(sentences[0])
	}
	return segment.title
}

func createEpisodeFromStoryboardDocument(document mediamcp.WorkspaceDocument) model.EpisodeRecord {
	groups := readEpisodeStoryboardGroups(document.Content)
	if len(groups) > 0 {
		return createEpisodeFromStoryboardSegments(document, groups)
	}

	return createEpisodeFromMarkdownHeadings(document)
}

func createEpisodeFromStoryboardSegments(
	document mediamcp.WorkspaceDocument,
	segments []episodeStoryboardSegment,
) model.EpisodeRecord {
	durationFromSegments := float64(len(segments) * episodeStoryboardGroupSeconds)
	if durationFromSegments < 1 {
		durationFromSegments = 1
	}
	duration := maxFloat(readEpisodeDuration(document.Content), durationFromSegments)
	sections := make([]model.EpisodeSectionRecord, 0, len(segments))
	videoClips := make([]model.TimelineClipRecord, 0, len(segments))
	voiceoverClips := []model.TimelineClipRecord{}
	captionClips := []model.TimelineClipRecord{}

	for _, segment := range segments {
		sections = append(sections, model.EpisodeSectionRecord{
			ID:      "section-" + segment.id,
			Title:   segment.title,
			Start:   segment.start,
			End:     segment.end,
			Summary: firstNonEmpty(segment.video, segment.voiceover, segment.caption, "待填写的分镜组。"),
		})
		videoClips = append(videoClips, model.TimelineClipRecord{
			ID:      "video-" + segment.id,
			Title:   segment.title,
			Start:   segment.start,
			End:     segment.end,
			Content: firstNonEmpty(segment.video, "（占位：待填写）"),
			Status:  "draft",
			Prompt:  segment.video,
			Source:  "分镜组提示词",
		})
		if strings.TrimSpace(segment.voiceover) != "" {
			voiceoverClips = append(voiceoverClips, model.TimelineClipRecord{
				ID:      "voiceover-" + segment.id,
				Title:   segment.title + " 旁白",
				Start:   segment.start,
				End:     segment.end,
				Content: segment.voiceover,
				Status:  "draft",
				Source:  "分镜组台词",
			})
		}
		if strings.TrimSpace(segment.caption) != "" {
			captionClips = append(captionClips, model.TimelineClipRecord{
				ID:      "caption-" + segment.id,
				Title:   segment.title + " 字幕",
				Start:   segment.start,
				End:     segment.end,
				Content: segment.caption,
				Status:  "draft",
				Source:  "分镜组对白",
			})
		}
	}

	return model.EpisodeRecord{
		ID:          "episode-" + document.ID,
		Title:       firstNonEmpty(document.Title, readEpisodeTitle(document.Content), "未命名分镜"),
		Duration:    duration,
		AspectRatio: "16:9",
		Sections:    sections,
		Tracks: []model.TimelineTrackRecord{
			{ID: "track-video", Type: "video", Label: "视频", Clips: videoClips},
			{ID: "track-voiceover", Type: "voiceover", Label: "旁白", Clips: voiceoverClips},
			{ID: "track-caption", Type: "caption", Label: "字幕", Clips: captionClips},
			createEpisodeMusicTrack(duration),
			createEpisodeAssetTrack(duration),
		},
	}
}

func readEpisodeStoryboardGroups(markdown string) []episodeStoryboardSegment {
	rawGroups := []episodeStoryboardGroup{}
	var currentGroup *episodeStoryboardGroup
	var currentShot *episodeMarkdownSection

	flushShot := func() {
		if currentGroup == nil || currentShot == nil {
			return
		}
		currentGroup.shots = append(currentGroup.shots, episodeMarkdownSection{
			title:   currentShot.title,
			content: strings.TrimSpace(currentShot.content),
		})
		currentShot = nil
	}
	flushGroup := func() {
		if currentGroup == nil {
			return
		}
		flushShot()
		currentGroup.notes = strings.TrimSpace(currentGroup.notes)
		rawGroups = append(rawGroups, *currentGroup)
		currentGroup = nil
	}

	for _, line := range strings.Split(stripEpisodeFrontmatter(markdown), "\n") {
		match := episodeHeadingPattern.FindStringSubmatch(line)
		if len(match) == 3 {
			level := len(match[1])
			title := strings.TrimSpace(match[2])
			switch {
			case level == 1:
				flushGroup()
				continue
			case level == 2:
				flushGroup()
				currentGroup = &episodeStoryboardGroup{title: title}
				continue
			case level == 3 && currentGroup != nil:
				flushShot()
				currentShot = &episodeMarkdownSection{title: title}
				continue
			}
		}
		if currentGroup != nil {
			if currentShot != nil {
				currentShot.content += line + "\n"
			} else {
				currentGroup.notes += line + "\n"
			}
		}
	}
	flushGroup()

	segments := make([]episodeStoryboardSegment, 0, len(rawGroups))
	for index, group := range rawGroups {
		video, voiceover, caption := parseEpisodeStoryboardGroupContent(renderEpisodeStoryboardGroupContent(group))
		start := float64(index * episodeStoryboardGroupSeconds)
		segments = append(segments, episodeStoryboardSegment{
			id:        strconv.Itoa(index) + "-" + slugifyEpisodeValue(group.title),
			title:     group.title,
			start:     start,
			end:       start + episodeStoryboardGroupSeconds,
			video:     video,
			voiceover: voiceover,
			caption:   caption,
		})
	}
	return segments
}

func renderEpisodeStoryboardGroupContent(group episodeStoryboardGroup) string {
	parts := []string{}
	if strings.TrimSpace(group.notes) != "" {
		parts = append(parts, strings.TrimSpace(group.notes))
	}
	for _, shot := range group.shots {
		title := strings.TrimSpace(shot.title)
		content := strings.TrimSpace(shot.content)
		if title == "" && content == "" {
			continue
		}
		if title == "" {
			parts = append(parts, content)
			continue
		}
		if content == "" {
			parts = append(parts, "### "+title)
			continue
		}
		parts = append(parts, "### "+title+"\n"+content)
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}

func parseEpisodeStoryboardGroupContent(content string) (string, string, string) {
	video := []string{}
	voiceover := []string{}
	caption := []string{}

	for _, rawLine := range strings.Split(content, "\n") {
		line := cleanEpisodeStoryboardLine(rawLine)
		if line == "" || isEpisodeHorizontalRule(line) || isEpisodeHTMLComment(line) {
			continue
		}
		video = append(video, line)
		kind, value, ok := parseEpisodeDialogueField(line)
		if ok && value != "" && value != "无" {
			if kind == "caption" {
				caption = append(caption, value)
			} else {
				voiceover = append(voiceover, value)
			}
		}
	}
	return strings.TrimSpace(strings.Join(video, "\n")), strings.TrimSpace(strings.Join(voiceover, "\n")), strings.TrimSpace(strings.Join(caption, "\n"))
}

func createEpisodeFromMarkdownHeadings(document mediamcp.WorkspaceDocument) model.EpisodeRecord {
	sections := readEpisodeMarkdownSections(document.Content)
	if len(sections) == 0 {
		sections = []episodeMarkdownSection{{
			title:   firstNonEmpty(document.Title, "未命名"),
			content: firstNonEmpty(strings.TrimSpace(document.Content), "剧集草稿备注。"),
		}}
	}

	videoClips := make([]model.TimelineClipRecord, 0, len(sections))
	episodeSections := make([]model.EpisodeSectionRecord, 0, len(sections))
	for index, section := range sections {
		start := float64(index * episodeFallbackSegmentSeconds)
		end := start + episodeFallbackSegmentSeconds
		clip := model.TimelineClipRecord{
			ID:      fmt.Sprintf("video-%d-%s", index, slugifyEpisodeValue(section.title)),
			Title:   section.title,
			Start:   start,
			End:     end,
			Content: firstNonEmpty(section.content, "来自 Markdown 备注的草稿场景。"),
			Status:  "draft",
			Prompt:  section.content,
			Source:  "Markdown 标题",
		}
		videoClips = append(videoClips, clip)
		episodeSections = append(episodeSections, model.EpisodeSectionRecord{
			ID:      "section-" + clip.ID,
			Title:   clip.Title,
			Start:   clip.Start,
			End:     clip.End,
			Summary: clip.Content,
		})
	}
	clipDuration := episodeFallbackSegmentSeconds
	if len(videoClips) > 0 {
		clipDuration = int(videoClips[len(videoClips)-1].End)
	}
	duration := maxFloat(readEpisodeDuration(document.Content), float64(clipDuration))
	voiceoverClips := make([]model.TimelineClipRecord, 0, len(videoClips))
	captionClips := make([]model.TimelineClipRecord, 0, len(videoClips))
	for _, clip := range videoClips {
		voiceoverClips = append(voiceoverClips, model.TimelineClipRecord{
			ID:      strings.Replace(clip.ID, "video-", "voiceover-", 1),
			Title:   clip.Title + " 旁白",
			Start:   clip.Start,
			End:     clip.End,
			Content: clip.Content,
			Status:  "draft",
			Source:  "Markdown 段落",
		})
		captionClips = append(captionClips, model.TimelineClipRecord{
			ID:      strings.Replace(clip.ID, "video-", "caption-", 1),
			Title:   clip.Title,
			Start:   clip.Start,
			End:     minFloat(clip.Start+6, clip.End),
			Content: clip.Title,
			Status:  "draft",
			Source:  "Markdown 标题",
		})
	}

	return model.EpisodeRecord{
		ID:          "episode-" + document.ID,
		Title:       firstNonEmpty(document.Title, readEpisodeTitle(document.Content), "未命名剧集"),
		Duration:    duration,
		AspectRatio: "16:9",
		Sections:    episodeSections,
		Tracks: []model.TimelineTrackRecord{
			{ID: "track-video", Type: "video", Label: "视频", Clips: videoClips},
			{ID: "track-voiceover", Type: "voiceover", Label: "旁白", Clips: voiceoverClips},
			{ID: "track-caption", Type: "caption", Label: "字幕", Clips: captionClips},
			createEpisodeMusicTrack(duration),
			createEpisodeAssetTrack(duration),
		},
	}
}

func readEpisodeMarkdownSections(markdown string) []episodeMarkdownSection {
	sections := []episodeMarkdownSection{}
	var current *episodeMarkdownSection

	for _, line := range strings.Split(stripEpisodeFrontmatter(markdown), "\n") {
		match := episodeMarkdownSectionPattern.FindStringSubmatch(line)
		if len(match) == 3 {
			if current != nil {
				sections = append(sections, normalizeEpisodeMarkdownSection(*current))
			}
			current = &episodeMarkdownSection{title: strings.TrimSpace(match[2])}
			continue
		}
		if current != nil {
			current.content += line + "\n"
		}
	}
	if current != nil {
		sections = append(sections, normalizeEpisodeMarkdownSection(*current))
	}

	filtered := []episodeMarkdownSection{}
	for _, section := range sections {
		if section.title != "" || section.content != "" {
			filtered = append(filtered, section)
		}
	}
	return filtered
}

func normalizeEpisodeMarkdownSection(section episodeMarkdownSection) episodeMarkdownSection {
	content := episodeCodeFencePattern.ReplaceAllString(section.content, "")
	lines := strings.Split(content, "\n")
	for index, line := range lines {
		lines[index] = strings.TrimPrefix(line, "- ")
	}
	return episodeMarkdownSection{title: section.title, content: strings.TrimSpace(strings.Join(lines, "\n"))}
}

func mergeEpisodeGeneratedMedia(nextEpisode model.EpisodeRecord, currentEpisode model.EpisodeRecord) model.EpisodeRecord {
	currentClipByID := map[string]model.TimelineClipRecord{}
	currentClipByTitle := map[string]model.TimelineClipRecord{}
	for _, track := range currentEpisode.Tracks {
		for _, clip := range track.Clips {
			currentClipByID[track.Type+":"+clip.ID] = clip
			currentClipByTitle[track.Type+":"+clip.Title] = clip
		}
	}

	for trackIndex := range nextEpisode.Tracks {
		track := &nextEpisode.Tracks[trackIndex]
		for clipIndex := range track.Clips {
			clip := track.Clips[clipIndex]
			previous, ok := currentClipByID[track.Type+":"+clip.ID]
			if !ok {
				previous, ok = currentClipByTitle[track.Type+":"+clip.Title]
			}
			if ok {
				track.Clips[clipIndex] = mergeTimelineClipGeneratedMedia(clip, previous)
			}
		}
	}
	return nextEpisode
}

func mergeTimelineClipGeneratedMedia(clip model.TimelineClipRecord, previous model.TimelineClipRecord) model.TimelineClipRecord {
	hasGeneratedMedia := previous.VideoURL != "" || previous.PosterURL != "" || previous.ThumbnailURL != ""
	if !hasGeneratedMedia && previous.Status == "draft" {
		return clip
	}
	if previous.PosterURL != "" {
		clip.PosterURL = previous.PosterURL
	}
	if previous.ThumbnailURL != "" {
		clip.ThumbnailURL = previous.ThumbnailURL
	}
	if previous.VideoURL != "" {
		clip.VideoURL = previous.VideoURL
	}
	if previous.Status != "" && (hasGeneratedMedia || previous.Status != "draft") {
		clip.Status = previous.Status
	}
	return clip
}

func createEpisodeMusicTrack(duration float64) model.TimelineTrackRecord {
	return model.TimelineTrackRecord{
		ID:    "track-music",
		Type:  "music",
		Label: "音乐",
		Clips: []model.TimelineClipRecord{{
			ID:      "music-bed",
			Title:   "剧集铺底音乐",
			Start:   0,
			End:     duration,
			Content: "与整集对齐的背景音乐铺底。",
			Status:  "draft",
			Source:  "计划混音",
		}},
	}
}

func createEpisodeAssetTrack(duration float64) model.TimelineTrackRecord {
	return model.TimelineTrackRecord{
		ID:    "track-assets",
		Type:  "asset",
		Label: "素材",
		Clips: []model.TimelineClipRecord{
			{
				ID:      "asset-opening",
				Title:   "开场画面",
				Start:   0,
				End:     minFloat(5, duration),
				Content: "剧集开场视觉锚点。",
				Status:  "draft",
				Source:  "计划素材",
			},
			{
				ID:      "asset-export",
				Title:   "导出标记",
				Start:   maxFloat(duration-6, 0),
				End:     duration,
				Content: fmt.Sprintf("最终交接点位于 %s。", formatEpisodeTimelineTime(duration)),
				Status:  "draft",
				Source:  "计划导出",
			},
		},
	}
}

func readEpisodeDuration(markdown string) float64 {
	match := episodeDurationPattern.FindStringSubmatch(markdown)
	if len(match) != 2 {
		return 0
	}
	value, err := strconv.ParseFloat(match[1], 64)
	if err != nil {
		return 0
	}
	return value
}

func readEpisodeTitle(markdown string) string {
	if match := episodeFrontmatterTitlePattern.FindStringSubmatch(markdown); len(match) == 2 {
		if title := strings.TrimSpace(match[1]); title != "" {
			return title
		}
	}
	for _, line := range strings.Split(markdown, "\n") {
		match := regexp.MustCompile(`^#\s+(.+)$`).FindStringSubmatch(line)
		if len(match) == 2 {
			return strings.TrimSpace(match[1])
		}
	}
	return ""
}

func stripEpisodeFrontmatter(markdown string) string {
	return episodeFrontmatterPattern.ReplaceAllString(markdown, "")
}

func cleanEpisodeStoryboardLine(line string) string {
	line = strings.TrimSpace(line)
	line = strings.TrimPrefix(line, "- ")
	line = strings.TrimPrefix(line, "* ")
	for strings.HasPrefix(line, "#") {
		line = strings.TrimPrefix(line, "#")
	}
	line = strings.ReplaceAll(line, "**", "")
	return strings.TrimSpace(line)
}

func parseEpisodeDialogueField(line string) (string, string, bool) {
	if value, ok := strings.CutPrefix(line, "台词："); ok {
		return "voiceover", strings.TrimSpace(value), true
	}
	if value, ok := strings.CutPrefix(line, "台词:"); ok {
		return "voiceover", strings.TrimSpace(value), true
	}
	if value, ok := dialogueValueWithChineseRole(line, "旁白"); ok {
		return "voiceover", value, true
	}
	if value, ok := dialogueValueWithChineseRole(line, "对白"); ok {
		return "caption", value, true
	}
	return "", "", false
}

func dialogueValueWithChineseRole(line string, prefix string) (string, bool) {
	if !strings.HasPrefix(line, prefix+"（") {
		return "", false
	}
	_, value, ok := strings.Cut(line, "：")
	if !ok {
		_, value, ok = strings.Cut(line, ":")
	}
	return strings.TrimSpace(value), ok
}

func isEpisodeHorizontalRule(line string) bool {
	return regexp.MustCompile(`^-{3,}$`).MatchString(line)
}

func isEpisodeHTMLComment(line string) bool {
	return strings.HasPrefix(line, "<!--") && strings.HasSuffix(line, "-->")
}

func slugifyEpisodeValue(value string) string {
	value = strings.ToLower(value)
	builder := strings.Builder{}
	lastDash := false
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteRune('-')
			lastDash = true
		}
	}
	slug := strings.Trim(builder.String(), "-")
	if slug == "" {
		return "section"
	}
	return slug
}

func formatEpisodeTimelineTime(seconds float64) string {
	totalSeconds := int(seconds)
	minutes := totalSeconds / 60
	remainingSeconds := totalSeconds % 60
	return fmt.Sprintf("%02d:%02d", minutes, remainingSeconds)
}

func minFloat(left float64, right float64) float64 {
	if left < right {
		return left
	}
	return right
}

func maxFloat(left float64, right float64) float64 {
	if left > right {
		return left
	}
	return right
}
