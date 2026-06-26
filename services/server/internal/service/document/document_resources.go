package document

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

const documentResourceDefaultHeadingLevel = 2

var (
	documentResourceStoryboardShotTitlePattern  = regexp.MustCompile(`^(分镜|镜头)(?:\s+|[0-9０-９一二三四五六七八九十百]+|$)`)
	documentResourceStoryboardGroupTitlePattern = regexp.MustCompile(`^第\s*\S+\s*组`)
	documentResourceMentionPattern              = regexp.MustCompile(`@\[([^\]]*)\]\((?:<[^>]+>|[^\s)]+)\)`)
	workspaceMarkdownImagePattern               = regexp.MustCompile(`^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)$`)
	workspacePlaceholderAltPattern              = regexp.MustCompile(`^(?:mediago-drama-section-image-pending|media-cli-section-image-pending):`)
)

type documentResourceHeadingSection struct {
	blockID           string
	headingLevel      int
	headingOccurrence int
	markdown          string
	title             string
}

// ListWorkspaceDocumentResources returns resources parsed from structured workspace documents.
func (store *Service) ListWorkspaceDocumentResources(projectID string) (workspaceDocumentResourcesResponse, error) {
	if err := store.requireReady(); err != nil {
		return workspaceDocumentResourcesResponse{}, err
	}
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return workspaceDocumentResourcesResponse{}, fmt.Errorf("projectId is required")
	}

	state, err := store.load(projectID)
	if err != nil {
		return workspaceDocumentResourcesResponse{}, err
	}

	return workspaceDocumentResourcesResponse{
		ProjectID: projectID,
		Resources: workspaceDocumentResourceRecordsFromDocuments(RegularWorkspaceDocuments(state.Documents)),
	}, nil
}

func workspaceDocumentResourceRecordsFromDocuments(documents []mediamcp.WorkspaceDocument) []workspaceDocumentResourceRecord {
	records := []workspaceDocumentResourceRecord{}
	for _, document := range documents {
		category := NormalizeDocumentCategoryValue(document.Category)
		if !isWorkspaceDocumentResourceCategory(category) {
			continue
		}

		sections := collectWorkspaceDocumentResourceSections(document)
		if category == "storyboard" {
			sections = storyboardDocumentResourceSections(sections)
		} else {
			sections = levelDocumentResourceSections(sections, documentResourceDefaultHeadingLevel)
		}

		for _, section := range sections {
			plainText := workspaceDocumentResourcePlainText(section.markdown)
			prompt := workspaceDocumentResourcePrompt(section.markdown, section.title)
			records = append(records, workspaceDocumentResourceRecord{
				ID:                fmt.Sprintf("%s:%s:%s", category, document.ID, section.blockID),
				Type:              category,
				Title:             section.title,
				Summary:           summarizeWorkspaceDocumentResourceText(plainText, section.title),
				Prompt:            prompt,
				DocumentID:        document.ID,
				DocumentTitle:     document.Title,
				SectionID:         section.blockID,
				BlockID:           section.blockID,
				HeadingLevel:      section.headingLevel,
				HeadingOccurrence: section.headingOccurrence,
				Markdown:          section.markdown,
				PlainText:         plainText,
				CanGenerate:       strings.TrimSpace(prompt) != "",
				SourceCategory:    category,
			})
		}
	}
	return records
}

func isWorkspaceDocumentResourceCategory(category string) bool {
	switch category {
	case "character", "scene", "prop", "storyboard":
		return true
	default:
		return false
	}
}

func collectWorkspaceDocumentResourceSections(document mediamcp.WorkspaceDocument) []documentResourceHeadingSection {
	lines := strings.Split(document.Content, "\n")
	occurrences := map[string]int{}
	seenSectionIDs := map[string]bool{}
	sections := []documentResourceHeadingSection{}
	var fence documentSectionFenceState

	for index, line := range lines {
		if fence.active {
			fence.update(line)
			continue
		}

		match := documentSectionHeadingPattern.FindStringSubmatch(line)
		if len(match) == 0 {
			fence.update(line)
			continue
		}

		headingLevel := len(match[1])
		legacyHeadingText := normalizeWorkspaceHeadingText(match[2])
		title := normalizeDocumentSectionHeading(cleanWorkspaceDocumentResourceInlineMarkdown(match[2]))
		if title == "" {
			fence.update(line)
			continue
		}
		if legacyHeadingText == "" {
			legacyHeadingText = title
		}

		occurrenceKey := strconv.Itoa(headingLevel) + "|" + legacyHeadingText
		occurrences[occurrenceKey]++
		headingOccurrence := occurrences[occurrenceKey]

		declaredSectionID := workspaceDocumentResourceCanonicalIDBeforeHeadingLine(lines, index)
		blockID := ""
		if declaredSectionID != "" && !seenSectionIDs[declaredSectionID] {
			blockID = declaredSectionID
			seenSectionIDs[declaredSectionID] = true
		} else {
			blockID = createWorkspaceSectionBlockID(document.ID, headingLevel, headingOccurrence, legacyHeadingText)
		}

		sectionEnd := documentSectionEndLine(lines, index, headingLevel)
		markdown := strings.TrimSpace(strings.Join(lines[index:sectionEnd], "\n"))
		if markdown == "" {
			fence.update(line)
			continue
		}

		sections = append(sections, documentResourceHeadingSection{
			blockID:           blockID,
			headingLevel:      headingLevel,
			headingOccurrence: headingOccurrence,
			markdown:          markdown,
			title:             title,
		})
		fence.update(line)
	}

	return sections
}

func workspaceDocumentResourceCanonicalIDBeforeHeadingLine(lines []string, headingIndex int) string {
	for index := headingIndex - 1; index >= 0; index-- {
		line := strings.TrimSpace(lines[index])
		if line == "" {
			continue
		}
		sectionID := documentSectionRawIDFromLine(line)
		if documentSectionIDPattern.MatchString(sectionID) {
			return sectionID
		}
		return ""
	}
	return ""
}

func storyboardDocumentResourceSections(sections []documentResourceHeadingSection) []documentResourceHeadingSection {
	shots := []documentResourceHeadingSection{}
	for _, section := range sections {
		if documentResourceStoryboardShotTitlePattern.MatchString(section.title) {
			shots = append(shots, section)
		}
	}
	if len(shots) > 0 {
		return shots
	}

	groups := []documentResourceHeadingSection{}
	for _, section := range sections {
		if section.headingLevel == documentResourceDefaultHeadingLevel &&
			documentResourceStoryboardGroupTitlePattern.MatchString(section.title) {
			groups = append(groups, section)
		}
	}
	return groups
}

func levelDocumentResourceSections(sections []documentResourceHeadingSection, level int) []documentResourceHeadingSection {
	filtered := []documentResourceHeadingSection{}
	for _, section := range sections {
		if section.headingLevel == level {
			filtered = append(filtered, section)
		}
	}
	return filtered
}

func workspaceDocumentResourcePrompt(markdown string, fallbackTitle string) string {
	promptLines := []string{}
	for _, line := range strings.Split(stripWorkspaceDocumentResourceSectionIDCommentLines(markdown), "\n") {
		if _, _, ok := workspaceMarkdownImageFromLine(strings.TrimSpace(line)); ok {
			continue
		}
		promptLines = append(promptLines, line)
	}
	prompt := strings.TrimSpace(compactWorkspaceDocumentResourceBlankLines(strings.Join(promptLines, "\n")))
	if prompt != "" {
		return prompt
	}
	return strings.TrimSpace(fallbackTitle)
}

func workspaceDocumentResourcePlainText(markdown string) string {
	lines := []string{}
	for _, line := range strings.Split(stripWorkspaceDocumentResourceSectionIDCommentLines(markdown), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if _, _, ok := workspaceMarkdownImageFromLine(trimmed); ok {
			continue
		}
		if match := documentSectionHeadingPattern.FindStringSubmatch(trimmed); len(match) == 3 {
			trimmed = match[2]
		}
		trimmed = documentResourceMentionPattern.ReplaceAllString(trimmed, "$1")
		trimmed = strings.ReplaceAll(trimmed, "**", "")
		trimmed = strings.ReplaceAll(trimmed, "`", "")
		trimmed = strings.TrimSpace(trimmed)
		if trimmed != "" {
			lines = append(lines, trimmed)
		}
	}
	return strings.TrimSpace(strings.Join(lines, "\n\n"))
}

func stripWorkspaceDocumentResourceSectionIDCommentLines(markdown string) string {
	lines := strings.Split(markdown, "\n")
	filtered := make([]string, 0, len(lines))
	for _, line := range lines {
		if documentSectionRawIDFromLine(line) != "" {
			continue
		}
		filtered = append(filtered, line)
	}
	return strings.Join(filtered, "\n")
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

func compactWorkspaceDocumentResourceBlankLines(value string) string {
	lines := strings.Split(value, "\n")
	next := make([]string, 0, len(lines))
	blank := 0
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			blank++
			if blank > 2 {
				continue
			}
		} else {
			blank = 0
		}
		next = append(next, line)
	}
	return strings.Join(next, "\n")
}

func summarizeWorkspaceDocumentResourceText(plainText string, title string) string {
	normalizedTitle := normalizeDocumentSectionHeading(title)
	parts := []string{}
	for _, line := range strings.Split(plainText, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || normalizeDocumentSectionHeading(line) == normalizedTitle {
			continue
		}
		parts = append(parts, line)
	}
	text := strings.Join(parts, " ")
	if len([]rune(text)) <= 96 {
		return text
	}
	return strings.TrimSpace(string([]rune(text)[:96])) + "..."
}

func cleanWorkspaceDocumentResourceInlineMarkdown(value string) string {
	value = strings.ReplaceAll(value, "**", "")
	value = strings.ReplaceAll(value, "`", "")
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}
