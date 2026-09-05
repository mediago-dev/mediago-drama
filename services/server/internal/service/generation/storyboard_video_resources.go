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
		reels := storyboardVideoReelsFromDocument(document)
		if len(reels) == 0 {
			continue
		}
		group := StoryboardVideoDocumentGroup{
			DocumentID:    document.ID,
			DocumentTitle: document.Title,
			Reels:         reels,
		}
		groups = append(groups, group)
	}
	return groups
}

func storyboardVideoReelsFromDocument(document mediamcp.WorkspaceDocument) []StoryboardVideoReel {
	sections := storyboardVideoLaneSections(document)
	reels := make([]StoryboardVideoReel, 0, len(sections))
	for _, section := range sections {
		// 分镜拆解阶段通常会把多个 Shot 写在一张 Markdown 表格里。
		// 这里必须把每一行拆成独立的 Reel，否则 UI 会把整张 Shot List
		// 当成一个镜头，生成任务、资产绑定和进度统计都会失真。
		if rows := storyboardVideoShotTableRows(section.markdown); len(rows) > 0 {
			for _, row := range rows {
				blockID := storyboardVideoShotBlockID(section.blockID, row.shotID)
				markdown := storyboardVideoShotMarkdown(row)
				reels = append(reels, storyboardVideoReelFromSection(
					document.ID,
					blockID,
					row.shotID,
					markdown,
				))
			}
			continue
		}

		reels = append(reels, storyboardVideoReelFromSection(
			document.ID,
			section.blockID,
			section.title,
			section.markdown,
		))
	}
	return reels
}

func storyboardVideoReelFromSection(
	documentID string,
	blockID string,
	title string,
	markdown string,
) StoryboardVideoReel {
	plainText := storyboardVideoPlainText(markdown)
	prompt := storyboardVideoPrompt(markdown, title)
	return StoryboardVideoReel{
		ID:                fmt.Sprintf("%s:%s", documentID, blockID),
		BlockID:           blockID,
		SectionID:         blockID,
		Title:             title,
		HeadingLevel:      2,
		HeadingOccurrence: 1,
		Markdown:          markdown,
		PlainText:         plainText,
		Prompt:            prompt,
		CanGenerate:       strings.TrimSpace(prompt) != "",
		Videos:            []StoryboardVideoAsset{},
	}
}

func storyboardVideoLaneSections(document mediamcp.WorkspaceDocument) []storyboardVideoSection {
	lines := strings.Split(stripStoryboardVideoFrontmatter(document.Content), "\n")
	headings := storyboardVideoHeadings(lines)
	isProductionStage := strings.Contains(document.Content, "<!-- production-stage:")
	return collectStoryboardVideoSections(lines, headings, document.ID, func(heading storyboardVideoHeading) bool {
		return heading.level == 2 && (!isProductionStage || !isProductionStageScaffoldVideoHeading(heading.text))
	})
}

func isProductionStageScaffoldVideoHeading(title string) bool {
	title = strings.TrimSpace(title)
	switch title {
	case "本阶段目的", "应交付内容", "输入与已锁定内容", "制作过程", "版本记录", "测试记录", "连续性规则", "问题 / Blocker", "下一步行动":
		return true
	default:
		return strings.HasPrefix(title, "Gate｜进入下一阶段前确认")
	}
}

type storyboardVideoShotTableRow struct {
	shotID   string
	duration string
	framing  string
	action   string
	assets   string
	status   string
}

// storyboardVideoShotTableRows extracts rows from the canonical Shot List table.
// It deliberately requires a Shot/镜头-like first column so unrelated tables in
// production-stage documents are not surfaced as generatable shots.
func storyboardVideoShotTableRows(markdown string) []storyboardVideoShotTableRow {
	lines := strings.Split(stripStoryboardVideoSectionIDCommentLines(markdown), "\n")
	for index := 0; index+1 < len(lines); index++ {
		cells := storyboardVideoMarkdownTableCells(lines[index])
		if len(cells) < 2 || !storyboardVideoShotHeader(cells[0]) {
			continue
		}
		if !storyboardVideoMarkdownTableSeparator(lines[index+1]) {
			continue
		}

		rows := make([]storyboardVideoShotTableRow, 0)
		for rowIndex := index + 2; rowIndex < len(lines); rowIndex++ {
			rowCells := storyboardVideoMarkdownTableCells(lines[rowIndex])
			if len(rowCells) < 2 {
				break
			}
			shotID := strings.TrimSpace(rowCells[0])
			if shotID == "" || storyboardVideoMarkdownTableSeparator(lines[rowIndex]) {
				continue
			}
			// A shot row must have a recognizable ID (S01/P01/镜头01) and
			// at least one meaningful production field.
			if !storyboardVideoShotID(shotID) || strings.TrimSpace(strings.Join(rowCells[1:], "")) == "" {
				continue
			}
			row := storyboardVideoShotTableRow{shotID: shotID}
			if len(rowCells) > 1 {
				row.duration = rowCells[1]
			}
			if len(rowCells) > 2 {
				row.framing = rowCells[2]
			}
			if len(rowCells) > 3 {
				row.action = rowCells[3]
			}
			if len(rowCells) > 4 {
				row.assets = rowCells[4]
			}
			if len(rowCells) > 5 {
				row.status = rowCells[5]
			}
			rows = append(rows, row)
		}
		if len(rows) > 0 {
			return rows
		}
	}
	return nil
}

func storyboardVideoMarkdownTableCells(line string) []string {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "|") || !strings.HasSuffix(trimmed, "|") {
		return nil
	}
	parts := strings.Split(trimmed[1:len(trimmed)-1], "|")
	cells := make([]string, 0, len(parts))
	for _, part := range parts {
		cells = append(cells, storyboardVideoCleanInlineMarkdown(strings.TrimSpace(part)))
	}
	return cells
}

func storyboardVideoMarkdownTableSeparator(line string) bool {
	cells := storyboardVideoMarkdownTableCells(line)
	if len(cells) < 2 {
		return false
	}
	for _, cell := range cells {
		if strings.Trim(cell, "-: ") != "" {
			return false
		}
	}
	return true
}

func storyboardVideoShotHeader(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return value == "shot" || value == "镜头" || strings.Contains(value, "shot")
}

func storyboardVideoShotID(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	for _, prefix := range []string{"S", "P", "镜头"} {
		if strings.HasPrefix(strings.ToUpper(value), prefix) {
			_, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(strings.ToUpper(value), prefix), "镜头")))
			return err == nil
		}
	}
	return false
}

func storyboardVideoShotBlockID(sectionID string, shotID string) string {
	clean := strings.NewReplacer(" ", "_", "｜", "_", "/", "_", "\\", "_").Replace(strings.TrimSpace(shotID))
	return strings.TrimSpace(sectionID) + "__" + clean
}

func storyboardVideoShotMarkdown(row storyboardVideoShotTableRow) string {
	lines := []string{"## " + row.shotID}
	if row.duration != "" {
		lines = append(lines, "时长："+row.duration)
	}
	if row.framing != "" {
		lines = append(lines, "景别 / 机位："+row.framing)
	}
	if row.action != "" {
		lines = append(lines, "核心动作："+row.action)
	}
	if row.assets != "" {
		lines = append(lines, "必须绑定资产："+row.assets)
	}
	if row.status != "" {
		lines = append(lines, "状态："+row.status)
	}
	return strings.Join(lines, "\n")
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
			if nextHeading.level <= heading.level {
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
