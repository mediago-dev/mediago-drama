package document

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

var (
	workspaceMentionLinkPattern    = regexp.MustCompile(`@\[((?:\\.|[^\]\\])*)\]\((?:<([^>]+)>|([^\s)]+))\)`)
	workspaceReferenceLinePattern  = regexp.MustCompile(`^(\s*(?:[-*]\s*)?(?:\*\*)?引用资源(?:\*\*)?\s*[:：]\s*)(.*)$`)
	workspaceMentionSeparatorClean = regexp.MustCompile(`\s*([；;、,，])\s*([；;、,，]\s*)+`)
	workspaceMentionSpaceClean     = regexp.MustCompile(`\s{2,}`)
)

// UpdateWorkspaceDocumentSectionMention selects or deselects a mention in a document section.
func (store *Service) UpdateWorkspaceDocumentSectionMention(projectID string, documentID string, request workspaceDocumentSectionMentionRequest) (mediamcp.WorkspaceDocument, workspaceDocumentsResponse, error) {
	if store.initErr != nil {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, store.initErr
	}

	sectionID := normalizeWorkspaceSectionID(request.SectionID)
	if sectionID == "" {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, fmt.Errorf("sectionId is required")
	}
	reference := workspaceSectionMentionReference{
		DocumentID: strings.TrimSpace(request.Reference.DocumentID),
		BlockID:    strings.TrimSpace(request.Reference.BlockID),
		Title:      strings.TrimSpace(request.Reference.Title),
		Category:   strings.TrimSpace(request.Reference.Category),
	}
	if reference.DocumentID == "" {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, fmt.Errorf("reference.documentId is required")
	}
	if request.Selected && reference.Title == "" {
		return mediamcp.WorkspaceDocument{}, workspaceDocumentsResponse{}, fmt.Errorf("reference.title is required")
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

	nextContent, changed, err := updateWorkspaceSectionMentionMarkdown(document.Content, document.ID, sectionID, reference, request.Selected)
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

func updateWorkspaceSectionMentionMarkdown(markdown string, documentID string, sectionID string, reference workspaceSectionMentionReference, selected bool) (string, bool, error) {
	lines := strings.Split(markdown, "\n")
	location, ok := workspaceSectionLocationByID(lines, documentID, sectionID)
	if !ok {
		return markdown, false, fmt.Errorf("文档 section 不存在：%s", sectionID)
	}

	if location.headingLevel == 0 {
		return markdown, false, fmt.Errorf("文档 section 不存在：%s", sectionID)
	}

	sectionEnd := workspaceSectionEndLine(lines, location.headingIndex, location.headingLevel)
	if selected {
		nextLines, changed := appendWorkspaceSectionMentionLine(lines, location.headingIndex, sectionEnd, reference)
		if !changed {
			return markdown, false, nil
		}
		nextLines = insertWorkspaceSectionAnchor(nextLines, location)
		return strings.Join(nextLines, "\n"), true, nil
	}

	nextLines, changed := removeWorkspaceSectionMentionLine(lines, location.headingIndex, sectionEnd, reference)
	if !changed {
		return markdown, false, nil
	}
	nextLines = insertWorkspaceSectionAnchor(nextLines, location)
	return strings.Join(nextLines, "\n"), true, nil
}

func insertWorkspaceSectionAnchor(lines []string, location workspaceSectionLocation) []string {
	if location.insertedAnchorSectionID == "" {
		return lines
	}
	if location.replaceAnchorLineIndex >= 0 {
		next := append([]string{}, lines[:location.replaceAnchorLineIndex]...)
		next = append(next, fmt.Sprintf("<!-- section-id: %s -->", location.insertedAnchorSectionID))
		next = append(next, lines[location.replaceAnchorLineIndex+1:]...)
		return next
	}
	next := append([]string{}, lines[:location.headingIndex]...)
	next = append(next, fmt.Sprintf("<!-- section-id: %s -->", location.insertedAnchorSectionID))
	next = append(next, lines[location.headingIndex:]...)
	return next
}

func appendWorkspaceSectionMentionLine(lines []string, start int, end int, reference workspaceSectionMentionReference) ([]string, bool) {
	if workspaceSectionContainsMention(lines[start:end], reference) {
		return lines, false
	}

	mention := workspaceSectionMentionMarkdown(reference)
	nextLines := append([]string{}, lines...)
	referenceLineIndex := workspaceReferenceLineIndex(nextLines, start, end)
	if referenceLineIndex >= 0 {
		nextLines[referenceLineIndex] = appendWorkspaceSectionMentionToReferenceLine(nextLines[referenceLineIndex], mention)
		return nextLines, true
	}

	insertAt := workspaceMentionInsertionLineAfterHeading(nextLines, start, end)
	nextLines = append(nextLines[:insertAt], append([]string{"", "引用资源： " + mention}, nextLines[insertAt:]...)...)
	return nextLines, true
}

func removeWorkspaceSectionMentionLine(lines []string, start int, end int, reference workspaceSectionMentionReference) ([]string, bool) {
	referenceKey := workspaceSectionMentionReferenceKey(reference)
	changed := false
	nextLines := make([]string, 0, len(lines))
	for index, line := range lines {
		if index < start || index >= end {
			nextLines = append(nextLines, line)
			continue
		}

		nextLine := removeWorkspaceMentionByKey(line, referenceKey)
		if nextLine != line {
			changed = true
		}
		if nextLine != line && workspaceReferenceLineEmpty(nextLine) {
			continue
		}
		nextLines = append(nextLines, nextLine)
	}
	return nextLines, changed
}

func workspaceSectionContainsMention(lines []string, reference workspaceSectionMentionReference) bool {
	referenceKey := workspaceSectionMentionReferenceKey(reference)
	for _, line := range lines {
		for _, match := range workspaceMentionLinkPattern.FindAllStringSubmatch(line, -1) {
			if workspaceSectionMentionReferenceKeyFromHref(match[2], match[3]) == referenceKey {
				return true
			}
		}
	}
	return false
}

func workspaceReferenceLineIndex(lines []string, start int, end int) int {
	for index := start + 1; index < end; index++ {
		if workspaceReferenceLinePattern.MatchString(lines[index]) {
			return index
		}
	}
	return -1
}

func workspaceMentionInsertionLineAfterHeading(lines []string, start int, end int) int {
	index := start + 1
	for index < end && strings.TrimSpace(lines[index]) == "" {
		index++
	}
	return index
}

func appendWorkspaceSectionMentionToReferenceLine(line string, mention string) string {
	match := workspaceReferenceLinePattern.FindStringSubmatch(line)
	if len(match) < 3 {
		return strings.TrimRight(line, " \t") + "；" + mention
	}

	existing := strings.TrimSpace(match[2])
	if existing == "" {
		return match[1] + mention
	}
	return match[1] + existing + "；" + mention
}

func removeWorkspaceMentionByKey(line string, referenceKey string) string {
	nextLine := workspaceMentionLinkPattern.ReplaceAllStringFunc(line, func(raw string) string {
		match := workspaceMentionLinkPattern.FindStringSubmatch(raw)
		if len(match) < 4 {
			return raw
		}
		if workspaceSectionMentionReferenceKeyFromHref(match[2], match[3]) == referenceKey {
			return ""
		}
		return raw
	})
	nextLine = workspaceMentionSeparatorClean.ReplaceAllString(nextLine, "$1")
	nextLine = regexp.MustCompile(`([:：])\s*[；;、,，]\s*`).ReplaceAllString(nextLine, "$1 ")
	nextLine = regexp.MustCompile(`\s*[；;、,，]\s*$`).ReplaceAllString(nextLine, "")
	nextLine = workspaceMentionSpaceClean.ReplaceAllString(nextLine, " ")
	return strings.TrimRight(nextLine, " \t")
}

func workspaceReferenceLineEmpty(line string) bool {
	match := workspaceReferenceLinePattern.FindStringSubmatch(line)
	return len(match) >= 3 && strings.TrimSpace(match[2]) == ""
}

func workspaceSectionMentionMarkdown(reference workspaceSectionMentionReference) string {
	return "@[" + escapeWorkspaceMentionLabel(reference.Title) + "](" + workspaceSectionMentionHref(reference) + ")"
}

func workspaceSectionMentionHref(reference workspaceSectionMentionReference) string {
	href := "mention://" + url.PathEscape(reference.DocumentID)
	if reference.BlockID != "" {
		href += "/" + url.PathEscape(reference.BlockID)
	}
	return href
}

func workspaceSectionMentionReferenceKey(reference workspaceSectionMentionReference) string {
	return strings.TrimSpace(reference.DocumentID) + "\x00" + strings.TrimSpace(reference.BlockID)
}

func workspaceSectionMentionReferenceKeyFromHref(angleHref string, plainHref string) string {
	href := strings.TrimSpace(angleHref)
	if href == "" {
		href = strings.TrimSpace(plainHref)
	}
	if !strings.HasPrefix(href, "mention://") {
		return ""
	}

	path := strings.TrimPrefix(href, "mention://")
	if queryIndex := strings.Index(path, "?"); queryIndex >= 0 {
		path = path[:queryIndex]
	}
	parts := strings.SplitN(path, "/", 2)
	documentID, _ := url.PathUnescape(parts[0])
	blockID := ""
	if len(parts) > 1 {
		blockID, _ = url.PathUnescape(parts[1])
	}
	return strings.TrimSpace(documentID) + "\x00" + strings.TrimSpace(blockID)
}

func escapeWorkspaceMentionLabel(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `[`, `\[`)
	value = strings.ReplaceAll(value, `]`, `\]`)
	return value
}
