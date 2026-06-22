package document

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

var (
	workspaceSectionAnchorIDPattern = regexp.MustCompile(`^section_[A-Za-z0-9_-]+$`)
	workspaceLegacyBlockIDPattern   = regexp.MustCompile(`^section-[A-Za-z0-9]+$`)
	workspaceSectionIDLinePattern   = regexp.MustCompile(`^\s*<!--\s*section-id:\s*([A-Za-z0-9_-]+)\s*-->\s*$`)
	workspaceHeadingLinePattern     = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*$`)
	workspaceMarkdownImagePattern   = regexp.MustCompile(`^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)$`)
	workspaceMarkdownLinkPattern    = regexp.MustCompile(`^\[((?:\\.|[^\]\\])*)\]\((?:<([^>]+)>|([^\s)]+))\)$`)
	workspacePlaceholderAltPattern  = regexp.MustCompile(`^(?:mediago-drama-section-image-pending|media-cli-section-image-pending):`)
)

// UpdateWorkspaceDocumentSectionImage selects or deselects an image in a document section.
func (store *Service) UpdateWorkspaceDocumentSectionImage(projectID string, documentID string, request workspaceDocumentSectionImageRequest) (mediamcp.WorkspaceDocument, workspaceDocumentsResponse, error) {
	if store.initErr != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, store.initErr
	}

	sectionID := normalizeWorkspaceSectionID(request.SectionID)
	if sectionID == "" {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, fmt.Errorf("sectionId is required")
	}
	image := workspaceSectionImage{
		Src:   strings.TrimSpace(request.Image.Src),
		Title: strings.TrimSpace(request.Image.Title),
	}
	if image.Src == "" {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, fmt.Errorf("image.src is required")
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	state, err := store.loadUnlocked(projectID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, err
	}
	documentID = strings.TrimSpace(documentID)
	index := FindWorkspaceDocumentIndexByID(state.Documents, documentID)
	if index < 0 {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, repository.ErrRecordNotFound
	}

	document := state.Documents[index]
	document.Version = NormalizedDocumentVersion(document.Version)
	if request.ExpectedVersion != nil && *request.ExpectedVersion != document.Version {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, workspaceVersionConflictError{
			DocumentID: document.ID,
			Expected:   *request.ExpectedVersion,
			Current:    document.Version,
		}
	}

	nextContent, changed, err := updateWorkspaceSectionImageMarkdown(document.Content, document.ID, sectionID, image, request.Selected)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, err
	}
	if !changed {
		return document, WorkspaceDocumentsFromState(state), nil
	}

	document.Content = nextContent
	document.Comments = NormalizeCommentRecordsForDocument(document.ID, document.Content, document.Comments)
	document.IsDirty = true
	document.UpdatedAt = timestamp.NowRFC3339Nano()
	document.Version++
	state.Documents[index] = document

	savedState, err := store.saveUnlocked(projectID, workspaceStateRequest{
		Documents:    state.Documents,
		OperationLog: state.OperationLog,
	})
	if err != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, err
	}
	if saved, ok := FindWorkspaceDocumentByID(savedState.Documents, document.ID); ok {
		document = saved
	}
	return document, WorkspaceDocumentsFromState(savedState), nil
}

// UpdateWorkspaceDocumentSectionMedia selects or deselects media in a document section.
func (store *Service) UpdateWorkspaceDocumentSectionMedia(projectID string, documentID string, request workspaceDocumentSectionMediaRequest) (mediamcp.WorkspaceDocument, workspaceDocumentsResponse, error) {
	if store.initErr != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, store.initErr
	}

	sectionID := normalizeWorkspaceSectionID(request.SectionID)
	if sectionID == "" {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, fmt.Errorf("sectionId is required")
	}
	media := workspaceSectionMedia{
		Kind:  strings.TrimSpace(request.Media.Kind),
		Src:   strings.TrimSpace(request.Media.Src),
		Title: strings.TrimSpace(request.Media.Title),
	}
	if !isWorkspaceSectionMediaKind(media.Kind) {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, fmt.Errorf("media.kind must be audio or video")
	}
	if media.Src == "" {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, fmt.Errorf("media.src is required")
	}
	if request.Selected && media.Title == "" {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, fmt.Errorf("media.title is required")
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	state, err := store.loadUnlocked(projectID)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, err
	}
	documentID = strings.TrimSpace(documentID)
	index := FindWorkspaceDocumentIndexByID(state.Documents, documentID)
	if index < 0 {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, repository.ErrRecordNotFound
	}

	document := state.Documents[index]
	document.Version = NormalizedDocumentVersion(document.Version)
	if request.ExpectedVersion != nil && *request.ExpectedVersion != document.Version {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, workspaceVersionConflictError{
			DocumentID: document.ID,
			Expected:   *request.ExpectedVersion,
			Current:    document.Version,
		}
	}

	nextContent, changed, err := updateWorkspaceSectionMediaMarkdown(document.Content, document.ID, sectionID, media, request.Selected)
	if err != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, err
	}
	if !changed {
		return document, WorkspaceDocumentsFromState(state), nil
	}

	document.Content = nextContent
	document.Comments = NormalizeCommentRecordsForDocument(document.ID, document.Content, document.Comments)
	document.IsDirty = true
	document.UpdatedAt = timestamp.NowRFC3339Nano()
	document.Version++
	state.Documents[index] = document

	savedState, err := store.saveUnlocked(projectID, workspaceStateRequest{
		Documents:    state.Documents,
		OperationLog: state.OperationLog,
	})
	if err != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, err
	}
	if saved, ok := FindWorkspaceDocumentByID(savedState.Documents, document.ID); ok {
		document = saved
	}
	return document, WorkspaceDocumentsFromState(savedState), nil
}

func updateWorkspaceSectionImageMarkdown(markdown string, documentID string, sectionID string, image workspaceSectionImage, selected bool) (string, bool, error) {
	lines := strings.Split(markdown, "\n")
	location, ok := workspaceSectionLocationByID(lines, documentID, sectionID)
	if !ok {
		return markdown, false, fmt.Errorf("文档 section 不存在：%s", sectionID)
	}

	if location.headingLevel == 0 {
		return markdown, false, fmt.Errorf("文档 section 不存在：%s", sectionID)
	}

	sectionEnd := workspaceSectionEndLine(lines, location.headingIndex, location.headingLevel)
	sectionLines := lines[location.headingIndex:sectionEnd]
	if selected {
		nextSectionLines, changed := appendWorkspaceSectionImageLine(sectionLines, image)
		if !changed {
			return markdown, false, nil
		}
		return joinWorkspaceSectionLines(lines, location, sectionEnd, nextSectionLines), true, nil
	}

	nextSectionLines, changed := removeWorkspaceSectionImageLine(sectionLines, image.Src)
	if !changed {
		return markdown, false, nil
	}
	return joinWorkspaceSectionLines(lines, location, sectionEnd, nextSectionLines), true, nil
}

func updateWorkspaceSectionMediaMarkdown(markdown string, documentID string, sectionID string, media workspaceSectionMedia, selected bool) (string, bool, error) {
	lines := strings.Split(markdown, "\n")
	location, ok := workspaceSectionLocationByID(lines, documentID, sectionID)
	if !ok {
		return markdown, false, fmt.Errorf("文档 section 不存在：%s", sectionID)
	}

	if location.headingLevel == 0 {
		return markdown, false, fmt.Errorf("文档 section 不存在：%s", sectionID)
	}

	sectionEnd := workspaceSectionEndLine(lines, location.headingIndex, location.headingLevel)
	sectionLines := lines[location.headingIndex:sectionEnd]
	if selected {
		nextSectionLines, changed := appendWorkspaceSectionMediaLine(sectionLines, media)
		if !changed {
			return markdown, false, nil
		}
		return joinWorkspaceSectionLines(lines, location, sectionEnd, nextSectionLines), true, nil
	}

	nextSectionLines, changed := removeWorkspaceSectionMediaLine(sectionLines, media)
	if !changed {
		return markdown, false, nil
	}
	return joinWorkspaceSectionLines(lines, location, sectionEnd, nextSectionLines), true, nil
}

type workspaceSectionLocation struct {
	headingIndex            int
	headingLevel            int
	insertedAnchorSectionID string
	replaceAnchorLineIndex  int
}

func workspaceSectionHeadingLineByID(lines []string, sectionID string) int {
	for index, line := range lines {
		if !workspaceHeadingLinePattern.MatchString(line) {
			continue
		}
		if workspaceSectionIDBeforeHeadingLine(lines, index) == sectionID {
			return index
		}
	}
	return -1
}

func workspaceSectionLocationByID(lines []string, documentID string, sectionID string) (workspaceSectionLocation, bool) {
	headingIndex := workspaceSectionHeadingLineByID(lines, sectionID)
	if headingIndex >= 0 {
		return workspaceSectionLocation{
			headingIndex:           headingIndex,
			headingLevel:           workspaceHeadingLevel(lines[headingIndex]),
			replaceAnchorLineIndex: -1,
		}, true
	}

	if !workspaceLegacyBlockIDPattern.MatchString(sectionID) {
		return workspaceSectionLocation{}, false
	}

	headingIndex = workspaceSectionHeadingLineByLegacyBlockID(lines, documentID, sectionID)
	if headingIndex < 0 {
		return workspaceSectionLocation{}, false
	}

	insertedAnchorSectionID := ""
	replaceAnchorLineIndex := -1
	if workspaceSectionIDBeforeHeadingLine(lines, headingIndex) == "" {
		insertedAnchorSectionID = workspaceSectionIDFromLegacyBlockID(sectionID, workspaceSectionIDs(lines))
		replaceAnchorLineIndex = workspaceLegacySectionIDLineBeforeHeading(lines, headingIndex, sectionID)
	}

	return workspaceSectionLocation{
		headingIndex:            headingIndex,
		headingLevel:            workspaceHeadingLevel(lines[headingIndex]),
		insertedAnchorSectionID: insertedAnchorSectionID,
		replaceAnchorLineIndex:  replaceAnchorLineIndex,
	}, true
}

func workspaceSectionHeadingLineByLegacyBlockID(lines []string, documentID string, blockID string) int {
	occurrenceByHeading := map[string]int{}

	for index, line := range lines {
		match := workspaceHeadingLinePattern.FindStringSubmatch(line)
		if len(match) == 0 {
			continue
		}
		level := len(match[1])
		title := normalizeWorkspaceHeadingText(match[2])
		if title == "" {
			continue
		}

		key := strconv.Itoa(level) + "|" + title
		occurrenceByHeading[key]++
		if createWorkspaceSectionBlockID(documentID, level, occurrenceByHeading[key], title) == blockID {
			return index
		}
	}

	return -1
}

func workspaceSectionIDs(lines []string) map[string]bool {
	sectionIDs := map[string]bool{}
	for _, line := range lines {
		match := workspaceSectionIDLinePattern.FindStringSubmatch(strings.TrimSpace(line))
		if len(match) == 2 {
			sectionID := normalizeWorkspaceSectionAnchorID(match[1])
			if sectionID != "" {
				sectionIDs[sectionID] = true
			}
		}
	}
	return sectionIDs
}

func workspaceSectionIDFromLegacyBlockID(blockID string, existing map[string]bool) string {
	base := "section_" + strings.TrimPrefix(blockID, "section-")
	candidate := base
	for suffix := 2; existing[candidate]; suffix++ {
		candidate = fmt.Sprintf("%s_%d", base, suffix)
	}
	return candidate
}

func workspaceLegacySectionIDLineBeforeHeading(lines []string, headingIndex int, sectionID string) int {
	for index := headingIndex - 1; index >= 0; index-- {
		line := strings.TrimSpace(lines[index])
		if line == "" {
			continue
		}
		match := workspaceSectionIDLinePattern.FindStringSubmatch(line)
		if len(match) == 2 && strings.TrimSpace(match[1]) == sectionID {
			return index
		}
		return -1
	}
	return -1
}

func workspaceSectionIDBeforeHeadingLine(lines []string, headingIndex int) string {
	for index := headingIndex - 1; index >= 0; index-- {
		line := strings.TrimSpace(lines[index])
		if line == "" {
			continue
		}
		match := workspaceSectionIDLinePattern.FindStringSubmatch(line)
		if len(match) == 2 {
			return normalizeWorkspaceSectionAnchorID(match[1])
		}
		return ""
	}
	return ""
}

func workspaceHeadingLevel(line string) int {
	match := workspaceHeadingLinePattern.FindStringSubmatch(line)
	if len(match) == 0 {
		return 0
	}
	return len(match[1])
}

func workspaceSectionEndLine(lines []string, headingIndex int, headingLevel int) int {
	for index := headingIndex + 1; index < len(lines); index++ {
		match := workspaceHeadingLinePattern.FindStringSubmatch(lines[index])
		if len(match) > 0 && len(match[1]) <= headingLevel {
			return workspaceSectionBoundaryBeforeHeadingLine(lines, headingIndex, index)
		}
	}
	return len(lines)
}

func workspaceSectionBoundaryBeforeHeadingLine(lines []string, headingIndex int, nextHeadingIndex int) int {
	for index := nextHeadingIndex - 1; index > headingIndex; index-- {
		line := strings.TrimSpace(lines[index])
		if line == "" {
			continue
		}
		if workspaceSectionIDLinePattern.MatchString(line) {
			return index
		}
		break
	}
	return nextHeadingIndex
}

func appendWorkspaceSectionImageLine(sectionLines []string, image workspaceSectionImage) ([]string, bool) {
	for _, line := range sectionLines {
		_, source, ok := workspaceMarkdownImageFromLine(strings.TrimSpace(line))
		if ok && source == image.Src {
			return sectionLines, false
		}
	}

	imageLine := workspaceSectionImageMarkdown(image)
	next := append([]string{}, sectionLines...)
	for len(next) > 0 && strings.TrimSpace(next[len(next)-1]) == "" {
		next = next[:len(next)-1]
	}
	if len(next) > 0 {
		next = append(next, "")
	}
	next = append(next, imageLine)
	return next, true
}

func removeWorkspaceSectionImageLine(sectionLines []string, source string) ([]string, bool) {
	next := make([]string, 0, len(sectionLines))
	changed := false
	for _, line := range sectionLines {
		_, currentSource, ok := workspaceMarkdownImageFromLine(strings.TrimSpace(line))
		if ok && currentSource == source {
			changed = true
			continue
		}
		next = append(next, line)
	}
	if !changed {
		return sectionLines, false
	}
	for len(next) > 0 && strings.TrimSpace(next[len(next)-1]) == "" {
		next = next[:len(next)-1]
	}
	return next, true
}

func appendWorkspaceSectionMediaLine(sectionLines []string, media workspaceSectionMedia) ([]string, bool) {
	for _, line := range sectionLines {
		current, ok := workspaceSectionMediaFromLine(strings.TrimSpace(line))
		if ok && current.Kind == media.Kind && current.Src == media.Src {
			return sectionLines, false
		}
	}

	mediaLine := workspaceSectionMediaMarkdown(media)
	next := append([]string{}, sectionLines...)
	for len(next) > 0 && strings.TrimSpace(next[len(next)-1]) == "" {
		next = next[:len(next)-1]
	}
	if len(next) > 0 {
		next = append(next, "")
	}
	next = append(next, mediaLine)
	return next, true
}

func removeWorkspaceSectionMediaLine(sectionLines []string, media workspaceSectionMedia) ([]string, bool) {
	next := make([]string, 0, len(sectionLines))
	changed := false
	for _, line := range sectionLines {
		current, ok := workspaceSectionMediaFromLine(strings.TrimSpace(line))
		if ok && current.Kind == media.Kind && current.Src == media.Src {
			changed = true
			continue
		}
		next = append(next, line)
	}
	if !changed {
		return sectionLines, false
	}
	for len(next) > 0 && strings.TrimSpace(next[len(next)-1]) == "" {
		next = next[:len(next)-1]
	}
	return next, true
}

func workspaceMarkdownImageFromLine(line string) (string, string, bool) {
	match := workspaceMarkdownImagePattern.FindStringSubmatch(line)
	if len(match) == 0 {
		return "", "", false
	}
	source := strings.TrimSpace(match[2])
	if source == "" {
		source = strings.TrimSpace(match[3])
	}
	if source == "" || workspacePlaceholderAltPattern.MatchString(match[1]) {
		return "", "", false
	}
	return match[1], source, true
}

func workspaceSectionMediaFromLine(line string) (workspaceSectionMedia, bool) {
	match := workspaceMarkdownLinkPattern.FindStringSubmatch(line)
	if len(match) == 0 {
		return workspaceSectionMedia{}, false
	}
	kind, title, ok := workspaceSectionMediaLabel(match[1])
	if !ok {
		return workspaceSectionMedia{}, false
	}
	source := strings.TrimSpace(match[2])
	if source == "" {
		source = strings.TrimSpace(match[3])
	}
	if source == "" {
		return workspaceSectionMedia{}, false
	}
	return workspaceSectionMedia{
		Kind:  kind,
		Src:   source,
		Title: title,
	}, true
}

func workspaceSectionImageMarkdown(image workspaceSectionImage) string {
	title := strings.TrimSpace(image.Title)
	if title == "" {
		title = "章节图片"
	}
	return fmt.Sprintf("![%s](<%s>)", escapeWorkspaceMarkdownAlt(title), image.Src)
}

func workspaceSectionMediaMarkdown(media workspaceSectionMedia) string {
	prefix := workspaceSectionMediaLabelPrefix(media.Kind)
	title := strings.TrimSpace(media.Title)
	return fmt.Sprintf("[%s](<%s>)", escapeWorkspaceMarkdownAlt(prefix+"："+title), media.Src)
}

func workspaceSectionMediaLabel(label string) (string, string, bool) {
	for _, kind := range []string{"audio", "video"} {
		prefix := workspaceSectionMediaLabelPrefix(kind)
		separator := ""
		switch {
		case strings.HasPrefix(label, prefix+"："):
			separator = "："
		case strings.HasPrefix(label, prefix+":"):
			separator = ":"
		}
		if separator != "" {
			title := strings.TrimSpace(label[len(prefix)+len(separator):])
			if title == "" {
				return "", "", false
			}
			return kind, title, true
		}
	}
	return "", "", false
}

func workspaceSectionMediaLabelPrefix(kind string) string {
	if kind == "audio" {
		return "章节音频"
	}
	return "章节视频"
}

func isWorkspaceSectionMediaKind(kind string) bool {
	return kind == "audio" || kind == "video"
}

func escapeWorkspaceMarkdownAlt(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `[`, `\[`, `]`, `\]`)
	return replacer.Replace(value)
}

func joinWorkspaceSectionLines(lines []string, location workspaceSectionLocation, sectionEnd int, sectionLines []string) string {
	next := make([]string, 0, len(lines)-sectionEnd+location.headingIndex+len(sectionLines)+1)
	if location.insertedAnchorSectionID != "" && location.replaceAnchorLineIndex >= 0 {
		next = append(next, lines[:location.replaceAnchorLineIndex]...)
		next = append(next, fmt.Sprintf("<!-- section-id: %s -->", location.insertedAnchorSectionID))
		next = append(next, lines[location.replaceAnchorLineIndex+1:location.headingIndex]...)
	} else {
		next = append(next, lines[:location.headingIndex]...)
	}
	if location.insertedAnchorSectionID != "" {
		if location.replaceAnchorLineIndex < 0 {
			next = append(next, fmt.Sprintf("<!-- section-id: %s -->", location.insertedAnchorSectionID))
		}
	}
	next = append(next, sectionLines...)
	next = append(next, lines[sectionEnd:]...)
	return strings.Join(next, "\n")
}

func normalizeWorkspaceSectionID(value string) string {
	value = strings.TrimSpace(value)
	if !workspaceSectionAnchorIDPattern.MatchString(value) && !workspaceLegacyBlockIDPattern.MatchString(value) {
		return ""
	}
	return value
}

func normalizeWorkspaceSectionAnchorID(value string) string {
	value = strings.TrimSpace(value)
	if !workspaceSectionAnchorIDPattern.MatchString(value) {
		return ""
	}
	return value
}

func createWorkspaceSectionBlockID(documentID string, headingLevel int, headingOccurrence int, headingText string) string {
	raw := strings.Join([]string{
		documentID,
		strconv.Itoa(headingLevel),
		strconv.Itoa(headingOccurrence),
		normalizeWorkspaceHeadingText(headingText),
	}, "|")
	return "section-" + workspaceJSHashBase36(raw)
}

func workspaceJSHashBase36(value string) string {
	var hash int32
	for _, codeUnit := range utf16.Encode([]rune(value)) {
		hash = hash*31 + int32(codeUnit)
	}
	if hash < 0 {
		return strconv.FormatInt(-int64(hash), 36)
	}
	return strconv.FormatInt(int64(hash), 36)
}

func normalizeWorkspaceHeadingText(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}
