package generation

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/model"
)

var (
	storyboardVideoHeadingPattern     = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*$`)
	storyboardVideoGroupNumberPattern = regexp.MustCompile(`^第\s*([0-9０-９一二三四五六七八九十百]+)\s*组`)
	storyboardVideoSectionIDPattern   = regexp.MustCompile(`^section_[A-Za-z0-9_-]+$`)
	storyboardVideoSectionIDComment   = regexp.MustCompile(`^\s*<!--\s*section-id:\s*([A-Za-z0-9_-]+)\s*-->\s*$`)
	storyboardVideoPlaceholderComment = regexp.MustCompile(`^\s*<!--\s*PLACEHOLDER\s*-->\s*$`)
	storyboardVideoMarkdownLink       = regexp.MustCompile(`^\[([^\]]+)\]\((?:<([^>]+)>|([^\s)]+))\)$`)
	storyboardVideoSectionMediaPrefix = regexp.MustCompile(`^(章节视频)[：:]\s*(.+)$`)
)

type generationWorkspaceDocumentsResolver interface {
	ListWorkspaceDocuments(projectID string) (model.WorkspaceDocumentsResponse, error)
}

type storyboardVideoHeading struct {
	level     int
	lineIndex int
	text      string
}

type storyboardVideoSection struct {
	blockID           string
	headingLevel      int
	headingOccurrence int
	markdown          string
	title             string
}

// ListStoryboardVideoResources returns storyboard group video assets for a project.
func (workflow *GenerationService) ListStoryboardVideoResources(projectID string) (StoryboardVideoResourcesResponse, error) {
	projectID = GenerationProjectIDForRequest(projectID, "")
	if projectID == "" {
		return StoryboardVideoResourcesResponse{}, fmt.Errorf("project id is required")
	}
	resolver, ok := workflow.documents.(generationWorkspaceDocumentsResolver)
	if !ok || resolver == nil {
		return StoryboardVideoResourcesResponse{}, fmt.Errorf("workspace document resolver is not configured")
	}

	documents, err := resolver.ListWorkspaceDocuments(projectID)
	if err != nil {
		return StoryboardVideoResourcesResponse{}, err
	}
	selectedAssets, err := workflow.ListSelectedGenerationAssets(projectID, SelectedGenerationAssetQuery{})
	if err != nil {
		return StoryboardVideoResourcesResponse{}, err
	}
	generatedCounts, err := workflow.generationTasks.CountGeneratedAssetsBySection(projectID, "video")
	if err != nil {
		return StoryboardVideoResourcesResponse{}, err
	}

	groups := storyboardVideoDocumentGroupsFromDocuments(documents.Documents)
	storyboardVideoApplySelectedAssets(groups, selectedAssets.Assets)
	storyboardVideoUniqueReels(groups)
	// After reel dedup so counts land on the surviving reel (rebuilds its own index).
	storyboardVideoApplyGeneratedCounts(groups, generatedCounts)
	storyboardVideoUniqueVideos(groups)

	return StoryboardVideoResourcesResponse{
		ProjectID: projectID,
		Groups:    groups,
	}, nil
}

func storyboardVideoDocumentGroupsFromDocuments(documents []mediamcp.WorkspaceDocument) []StoryboardVideoDocumentGroup {
	groups := []StoryboardVideoDocumentGroup{}
	for _, document := range documents {
		if model.NormalizeDocumentCategoryValue(document.Category) != "storyboard" {
			continue
		}
		group := StoryboardVideoDocumentGroup{
			DocumentID:    document.ID,
			DocumentTitle: document.Title,
			Reels:         storyboardVideoReelsFromDocument(document),
		}
		groups = append(groups, group)
	}
	return groups
}

func storyboardVideoReelsFromDocument(document mediamcp.WorkspaceDocument) []StoryboardVideoReel {
	sections := storyboardVideoLaneSections(document)
	reels := make([]StoryboardVideoReel, 0, len(sections))
	for _, section := range sections {
		plainText := storyboardVideoPlainText(section.markdown)
		prompt := storyboardVideoPrompt(section.markdown, section.title)
		reels = append(reels, StoryboardVideoReel{
			ID:                fmt.Sprintf("%s:%s", document.ID, section.blockID),
			BlockID:           section.blockID,
			SectionID:         section.blockID,
			Title:             section.title,
			HeadingLevel:      section.headingLevel,
			HeadingOccurrence: section.headingOccurrence,
			Markdown:          section.markdown,
			PlainText:         plainText,
			Prompt:            prompt,
			CanGenerate:       strings.TrimSpace(prompt) != "",
			Videos:            []StoryboardVideoAsset{},
		})
	}
	return reels
}

func storyboardVideoLaneSections(document mediamcp.WorkspaceDocument) []storyboardVideoSection {
	lines := strings.Split(stripStoryboardVideoFrontmatter(document.Content), "\n")
	headings := storyboardVideoHeadings(lines)
	return collectStoryboardVideoSections(lines, headings, document.ID, func(heading storyboardVideoHeading) bool {
		return heading.level == 2
	})
}

func collectStoryboardVideoSections(
	lines []string,
	headings []storyboardVideoHeading,
	documentID string,
	shouldStart func(storyboardVideoHeading) bool,
) []storyboardVideoSection {
	sections := []storyboardVideoSection{}
	occurrences := map[string]int{}

	for headingIndex, heading := range headings {
		if !shouldStart(heading) {
			continue
		}
		key := strconv.Itoa(heading.level) + "|" + heading.text
		occurrences[key]++
		occurrence := occurrences[key]

		endLine := len(lines)
		for nextIndex := headingIndex + 1; nextIndex < len(headings); nextIndex++ {
			nextHeading := headings[nextIndex]
			if nextHeading.level <= heading.level && shouldStart(nextHeading) {
				endLine = nextHeading.lineIndex
				break
			}
		}

		markdown := strings.TrimSpace(strings.Join(lines[heading.lineIndex:endLine], "\n"))
		if markdown == "" {
			continue
		}
		blockID := storyboardVideoSectionIDBeforeHeadingLine(lines, heading.lineIndex)
		if blockID == "" {
			blockID = storyboardVideoSectionBlockID(documentID, heading.level, occurrence, heading.text)
		}

		sections = append(sections, storyboardVideoSection{
			blockID:           blockID,
			headingLevel:      heading.level,
			headingOccurrence: occurrence,
			markdown:          markdown,
			title:             heading.text,
		})
	}
	return sections
}

func storyboardVideoHeadings(lines []string) []storyboardVideoHeading {
	headings := []storyboardVideoHeading{}
	for index, line := range lines {
		match := storyboardVideoHeadingPattern.FindStringSubmatch(line)
		if len(match) != 3 {
			continue
		}
		title := storyboardVideoCleanInlineMarkdown(match[2])
		if title == "" {
			continue
		}
		headings = append(headings, storyboardVideoHeading{
			level:     len(match[1]),
			lineIndex: index,
			text:      title,
		})
	}
	return headings
}

func storyboardVideoApplySelectedAssets(groups []StoryboardVideoDocumentGroup, assets []SelectedGenerationAssetRecord) {
	reelByDocumentSection, reelsBySection := storyboardVideoReelIndexes(groups)
	for _, asset := range assets {
		if asset.Kind != "video" || asset.ResourceType != "storyboard" {
			continue
		}
		reel := storyboardVideoReelForSection(asset.SourceDocumentID, asset.ResourceID, reelByDocumentSection, reelsBySection)
		if reel == nil {
			continue
		}
		source := storyboardVideoSelectedAssetSource(asset)
		if source == "" {
			continue
		}
		sectionTitle := firstNonEmpty(asset.ResourceTitle, reel.Title)
		reel.Videos = append(reel.Videos, StoryboardVideoAsset{
			ID:           "selected:" + asset.ID,
			MIMEType:     asset.MIMEType,
			SectionTitle: sectionTitle,
			SourceLabel:  "已选成片",
			Src:          source,
			PosterURL:    firstNonEmpty(asset.PosterURL, storyboardVideoPosterURLFromSource(source)),
			Title:        firstNonEmpty(asset.Title, sectionTitle, "成片"),
		})
	}
}

func storyboardVideoApplyGeneratedCounts(groups []StoryboardVideoDocumentGroup, counts []repository.GenerationSectionAssetCount) {
	if len(counts) == 0 {
		return
	}
	reelByDocumentSection, _ := storyboardVideoReelIndexes(groups)
	for _, count := range counts {
		documentID := strings.TrimSpace(count.DocumentID)
		sectionID := strings.TrimSpace(count.SectionID)
		if documentID == "" || sectionID == "" {
			continue
		}
		if reel, ok := reelByDocumentSection[storyboardVideoDocumentSectionKey(documentID, sectionID)]; ok {
			reel.GeneratedVideoCount = count.Count
		}
	}
}

func storyboardVideoReelIndexes(groups []StoryboardVideoDocumentGroup) (map[string]*StoryboardVideoReel, map[string][]*StoryboardVideoReel) {
	reelByDocumentSection := map[string]*StoryboardVideoReel{}
	reelsBySection := map[string][]*StoryboardVideoReel{}
	for groupIndex := range groups {
		for reelIndex := range groups[groupIndex].Reels {
			reel := &groups[groupIndex].Reels[reelIndex]
			sectionID := strings.TrimSpace(reel.SectionID)
			if sectionID == "" {
				sectionID = strings.TrimSpace(reel.BlockID)
			}
			if sectionID == "" {
				continue
			}
			reelByDocumentSection[storyboardVideoDocumentSectionKey(groups[groupIndex].DocumentID, sectionID)] = reel
			reelsBySection[sectionID] = append(reelsBySection[sectionID], reel)
		}
	}
	return reelByDocumentSection, reelsBySection
}

func storyboardVideoReelForSection(
	documentID string,
	sectionID string,
	reelByDocumentSection map[string]*StoryboardVideoReel,
	reelsBySection map[string][]*StoryboardVideoReel,
) *StoryboardVideoReel {
	sectionID = strings.TrimSpace(sectionID)
	if sectionID == "" {
		return nil
	}
	documentID = strings.TrimSpace(documentID)
	if documentID != "" {
		return reelByDocumentSection[storyboardVideoDocumentSectionKey(documentID, sectionID)]
	}
	reels := reelsBySection[sectionID]
	if len(reels) == 1 {
		return reels[0]
	}
	return nil
}

func storyboardVideoUniqueVideos(groups []StoryboardVideoDocumentGroup) {
	for groupIndex := range groups {
		for reelIndex := range groups[groupIndex].Reels {
			videos := groups[groupIndex].Reels[reelIndex].Videos
			seen := map[string]bool{}
			next := make([]StoryboardVideoAsset, 0, len(videos))
			for _, video := range videos {
				key := strings.TrimSpace(video.Src)
				if key == "" || seen[key] {
					continue
				}
				seen[key] = true
				next = append(next, video)
			}
			groups[groupIndex].Reels[reelIndex].Videos = next
		}
	}
}

func storyboardVideoUniqueReels(groups []StoryboardVideoDocumentGroup) {
	for groupIndex := range groups {
		seen := map[string]int{}
		reels := make([]StoryboardVideoReel, 0, len(groups[groupIndex].Reels))
		for _, reel := range groups[groupIndex].Reels {
			key := storyboardVideoReelDedupeKey(reel)
			if key == "" {
				reels = append(reels, reel)
				continue
			}
			existingIndex, ok := seen[key]
			if !ok {
				seen[key] = len(reels)
				reels = append(reels, reel)
				continue
			}

			previous := reels[existingIndex]
			reels[existingIndex] = storyboardVideoMergeDuplicateReel(previous, reel)
		}
		groups[groupIndex].Reels = reels
	}
}

func storyboardVideoMergeDuplicateReel(previous StoryboardVideoReel, latest StoryboardVideoReel) StoryboardVideoReel {
	latest.Videos = append(previous.Videos, latest.Videos...)
	if storyboardVideoReelHasPromptBody(latest) || !storyboardVideoReelHasPromptBody(previous) {
		return latest
	}

	latest.Markdown = previous.Markdown
	latest.PlainText = previous.PlainText
	latest.Prompt = previous.Prompt
	latest.CanGenerate = previous.CanGenerate
	return latest
}

func storyboardVideoReelHasPromptBody(reel StoryboardVideoReel) bool {
	return storyboardVideoPromptBody(reel.Prompt, reel.Title) != ""
}

func storyboardVideoPromptBody(prompt string, title string) string {
	title = storyboardVideoCleanInlineMarkdown(title)
	lines := []string{}
	for _, line := range strings.Split(stripStoryboardVideoSectionIDCommentLines(prompt), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || storyboardVideoPlaceholderComment.MatchString(trimmed) {
			continue
		}
		if _, ok := storyboardVideoMediaFromLine(trimmed); ok {
			continue
		}
		if match := storyboardVideoHeadingPattern.FindStringSubmatch(trimmed); len(match) == 3 {
			if storyboardVideoCleanInlineMarkdown(match[2]) == title {
				continue
			}
		}
		lines = append(lines, trimmed)
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func storyboardVideoReelDedupeKey(reel StoryboardVideoReel) string {
	match := storyboardVideoGroupNumberPattern.FindStringSubmatch(reel.Title)
	if len(match) == 2 {
		return "group:" + storyboardVideoNormalizeGroupNumber(match[1])
	}
	if sectionID := strings.TrimSpace(firstNonEmpty(reel.SectionID, reel.BlockID)); sectionID != "" {
		return "section:" + sectionID
	}
	return ""
}

func storyboardVideoNormalizeGroupNumber(value string) string {
	value = strings.Map(func(r rune) rune {
		if r >= '０' && r <= '９' {
			return '0' + (r - '０')
		}
		return r
	}, strings.TrimSpace(value))
	if number, err := strconv.Atoi(value); err == nil {
		return strconv.Itoa(number)
	}
	return value
}

func storyboardVideoMediaFromLine(line string) (model.WorkspaceSectionMedia, bool) {
	match := storyboardVideoMarkdownLink.FindStringSubmatch(line)
	if len(match) == 0 {
		return model.WorkspaceSectionMedia{}, false
	}
	labelMatch := storyboardVideoSectionMediaPrefix.FindStringSubmatch(match[1])
	if len(labelMatch) != 3 {
		return model.WorkspaceSectionMedia{}, false
	}
	source := strings.TrimSpace(match[2])
	if source == "" {
		source = strings.TrimSpace(match[3])
	}
	if source == "" {
		return model.WorkspaceSectionMedia{}, false
	}
	return model.WorkspaceSectionMedia{
		Kind:  "video",
		Src:   source,
		Title: strings.TrimSpace(labelMatch[2]),
	}, true
}

func storyboardVideoSelectedAssetSource(asset SelectedGenerationAssetRecord) string {
	if strings.TrimSpace(asset.URL) != "" {
		return strings.TrimSpace(asset.URL)
	}
	if strings.TrimSpace(asset.Base64) == "" {
		return ""
	}
	mimeType := firstNonEmpty(asset.MIMEType, "video/mp4")
	return "data:" + mimeType + ";base64," + strings.TrimSpace(asset.Base64)
}

func storyboardVideoPosterURLFromSource(source string) string {
	source = strings.TrimSpace(source)
	if !strings.HasSuffix(source, "/content") {
		return ""
	}
	return strings.TrimSuffix(source, "/content") + "/poster"
}

func storyboardVideoPlainText(markdown string) string {
	lines := []string{}
	for _, line := range strings.Split(stripStoryboardVideoSectionIDCommentLines(markdown), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if storyboardVideoPlaceholderComment.MatchString(trimmed) {
			continue
		}
		if _, ok := storyboardVideoMediaFromLine(trimmed); ok {
			continue
		}
		if match := storyboardVideoHeadingPattern.FindStringSubmatch(trimmed); len(match) == 3 {
			trimmed = match[2]
		}
		trimmed = storyboardVideoCleanInlineMarkdown(trimmed)
		if trimmed != "" {
			lines = append(lines, trimmed)
		}
	}
	return strings.TrimSpace(strings.Join(lines, "\n\n"))
}

func storyboardVideoPrompt(markdown string, fallbackTitle string) string {
	lines := []string{}
	for _, line := range strings.Split(stripStoryboardVideoSectionIDCommentLines(markdown), "\n") {
		trimmed := strings.TrimSpace(line)
		if storyboardVideoPlaceholderComment.MatchString(trimmed) {
			continue
		}
		if _, ok := storyboardVideoMediaFromLine(trimmed); ok {
			continue
		}
		lines = append(lines, line)
	}
	prompt := strings.TrimSpace(strings.Join(lines, "\n"))
	if prompt != "" {
		return prompt
	}
	return strings.TrimSpace(fallbackTitle)
}

func storyboardVideoSectionIDBeforeHeadingLine(lines []string, headingIndex int) string {
	for index := headingIndex - 1; index >= 0; index-- {
		line := strings.TrimSpace(lines[index])
		if line == "" {
			continue
		}
		match := storyboardVideoSectionIDComment.FindStringSubmatch(line)
		if len(match) == 2 && storyboardVideoSectionIDPattern.MatchString(match[1]) {
			return match[1]
		}
		return ""
	}
	return ""
}

func stripStoryboardVideoSectionIDCommentLines(markdown string) string {
	lines := strings.Split(markdown, "\n")
	filtered := make([]string, 0, len(lines))
	for _, line := range lines {
		if storyboardVideoSectionIDComment.MatchString(strings.TrimSpace(line)) {
			continue
		}
		filtered = append(filtered, line)
	}
	return strings.Join(filtered, "\n")
}

func stripStoryboardVideoFrontmatter(markdown string) string {
	markdown = strings.TrimPrefix(markdown, "\ufeff")
	if !strings.HasPrefix(markdown, "---\n") {
		return markdown
	}
	if index := strings.Index(markdown[4:], "\n---\n"); index >= 0 {
		return markdown[index+9:]
	}
	return markdown
}

func storyboardVideoCleanInlineMarkdown(value string) string {
	value = strings.ReplaceAll(value, "**", "")
	value = strings.ReplaceAll(value, "`", "")
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func storyboardVideoSectionBlockID(documentID string, headingLevel int, headingOccurrence int, headingText string) string {
	raw := strings.Join([]string{
		documentID,
		strconv.Itoa(headingLevel),
		strconv.Itoa(headingOccurrence),
		storyboardVideoCleanInlineMarkdown(headingText),
	}, "|")
	return "section-" + storyboardVideoJSHashBase36(raw)
}

func storyboardVideoJSHashBase36(value string) string {
	var hash int32
	for _, codeUnit := range utf16.Encode([]rune(value)) {
		hash = hash*31 + int32(codeUnit)
	}
	if hash < 0 {
		return strconv.FormatInt(-int64(hash), 36)
	}
	return strconv.FormatInt(int64(hash), 36)
}

func storyboardVideoDocumentSectionKey(documentID string, sectionID string) string {
	return strings.TrimSpace(documentID) + ":" + strings.TrimSpace(sectionID)
}
