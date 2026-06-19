package prompt

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
)

const maxReferenceIndexItems = 120

var (
	referenceHeadingPattern          = regexp.MustCompile(`^(#{1,3})\s+(.+?)\s*$`)
	referenceSectionIDCommentPattern = regexp.MustCompile(`^\s*<!--\s*section-id:\s*([A-Za-z0-9_-]+)\s*-->\s*$`)
)

type referenceIndexItem struct {
	BlockID         string
	Category        string
	CategoryLabel   string
	DocumentID      string
	DocumentTitle   string
	Kind            string
	MentionMarkdown string
	Title           string
}

func renderReferenceIndexPrompt(request AgentRunRequest) string {
	items := buildReferenceIndexItems(request)
	if len(items) == 0 {
		return ""
	}

	var builder strings.Builder
	builder.WriteString("# 可用 @ 资源索引\n\n")
	builder.WriteString("以下是当前工作区可引用的角色、场景、道具和分镜资源。写分镜时，如果镜头主体、场景或关键道具能明确匹配某个资源，请在 `**引用资源**` 字段复制对应的 Markdown @ 链接；不要臆造不存在的链接，不要把 `mention://` 或 `asset://` 内部链接写入 `**主体**`、`**场景**`、`**动作**` 等视频提示词字段。\n")
	for _, item := range items {
		builder.WriteString("\n- ")
		builder.WriteString(item.CategoryLabel)
		builder.WriteString("｜")
		builder.WriteString(item.Title)
		if item.DocumentTitle != "" {
			builder.WriteString("（来自《")
			builder.WriteString(item.DocumentTitle)
			builder.WriteString("》")
			if item.BlockID != "" {
				builder.WriteString(" · blockId: ")
				builder.WriteString(item.BlockID)
			}
			builder.WriteString("）")
		} else if item.BlockID != "" {
			builder.WriteString("（blockId: ")
			builder.WriteString(item.BlockID)
			builder.WriteString("）")
		}
		builder.WriteString("：")
		builder.WriteString(item.MentionMarkdown)
	}
	return builder.String()
}

func buildReferenceIndexItems(request AgentRunRequest) []referenceIndexItem {
	items := make([]referenceIndexItem, 0)
	seen := map[string]bool{}
	activeDocumentID := ""
	if request.Document != nil {
		activeDocumentID = strings.TrimSpace(request.Document.ID)
	}

	add := func(item referenceIndexItem) {
		if len(items) >= maxReferenceIndexItems {
			return
		}
		item.Title = strings.TrimSpace(item.Title)
		item.DocumentID = strings.TrimSpace(item.DocumentID)
		item.BlockID = strings.TrimSpace(item.BlockID)
		item.Category = strings.TrimSpace(item.Category)
		if item.Title == "" || item.DocumentID == "" || !isReferenceResourceCategory(item.Category) {
			return
		}
		item.Kind = strings.TrimSpace(item.Kind)
		if item.Kind == "" {
			if item.BlockID != "" {
				item.Kind = "section"
			} else {
				item.Kind = "document"
			}
		}
		if item.Kind != "document" && item.Kind != "section" {
			return
		}
		key := referenceItemKey(item)
		if seen[key] {
			return
		}
		seen[key] = true
		item.CategoryLabel = referenceCategoryLabel(item.Category)
		item.MentionMarkdown = mentionMarkdownForReference(item)
		items = append(items, item)
	}

	for _, reference := range request.References {
		add(referenceIndexItem{
			BlockID:       reference.BlockID,
			Category:      reference.Category,
			DocumentID:    reference.DocumentID,
			DocumentTitle: reference.Title,
			Kind:          reference.Kind,
			Title:         reference.Title,
		})
	}

	addDocument := func(document AgentDocumentContext) {
		if activeDocumentID != "" && strings.TrimSpace(document.ID) == activeDocumentID {
			return
		}
		category := strings.TrimSpace(document.Category)
		if !isReferenceResourceCategory(category) {
			return
		}
		sections := referenceSectionsForDocument(document)
		if len(sections) == 0 {
			add(referenceIndexItem{
				Category:      category,
				DocumentID:    document.ID,
				DocumentTitle: document.Title,
				Kind:          "document",
				Title:         document.Title,
			})
			return
		}
		for _, section := range sections {
			add(referenceIndexItem{
				BlockID:       section.BlockID,
				Category:      category,
				DocumentID:    document.ID,
				DocumentTitle: document.Title,
				Kind:          "section",
				Title:         section.Title,
			})
		}
	}

	for _, document := range request.Documents {
		addDocument(document)
	}

	return items
}

type referenceSection struct {
	BlockID string
	Title   string
}

func referenceSectionsForDocument(document AgentDocumentContext) []referenceSection {
	lines := strings.Split(document.Content, "\n")
	occurrenceByHeading := map[string]int{}
	seenSectionIDs := map[string]bool{}
	sections := make([]referenceSection, 0)

	for index, line := range lines {
		match := referenceHeadingPattern.FindStringSubmatch(line)
		if len(match) == 0 {
			continue
		}
		level := len(match[1])
		title := normalizeReferenceHeadingText(match[2])
		if title == "" {
			continue
		}

		key := strconv.Itoa(level) + "|" + title
		occurrenceByHeading[key]++
		blockID := sectionIDBeforeHeadingLine(lines, index)
		if blockID != "" {
			if seenSectionIDs[blockID] {
				blockID = ""
			} else {
				seenSectionIDs[blockID] = true
			}
		}
		if blockID == "" {
			blockID = createReferenceSectionBlockID(document.ID, level, occurrenceByHeading[key], title)
		}

		sections = append(sections, referenceSection{
			BlockID: blockID,
			Title:   title,
		})
	}

	return sections
}

func sectionIDBeforeHeadingLine(lines []string, headingIndex int) string {
	for index := headingIndex - 1; index >= 0; index-- {
		line := strings.TrimSpace(lines[index])
		if line == "" {
			continue
		}
		match := referenceSectionIDCommentPattern.FindStringSubmatch(line)
		if len(match) < 2 {
			return ""
		}
		return strings.TrimSpace(match[1])
	}
	return ""
}

func createReferenceSectionBlockID(documentID string, headingLevel int, headingOccurrence int, headingText string) string {
	raw := strings.Join([]string{
		documentID,
		strconv.Itoa(headingLevel),
		strconv.Itoa(headingOccurrence),
		normalizeReferenceHeadingText(headingText),
	}, "|")
	return "section-" + jsHashBase36(raw)
}

func jsHashBase36(value string) string {
	var hash int32
	for _, codeUnit := range utf16.Encode([]rune(value)) {
		hash = hash*31 + int32(codeUnit)
	}
	if hash < 0 {
		return strconv.FormatInt(-int64(hash), 36)
	}
	return strconv.FormatInt(int64(hash), 36)
}

func mentionMarkdownForReference(item referenceIndexItem) string {
	label := escapeMentionLabel(item.Title)
	href := mentionHrefForReference(item)
	return "@[" + label + "](" + href + ")"
}

func mentionHrefForReference(item referenceIndexItem) string {
	if item.Kind == "section" && item.BlockID != "" {
		return "mention://" + encodeURIComponent(item.DocumentID) + "/" + encodeURIComponent(item.BlockID) + "?kind=section&category=" + encodeURIComponent(item.Category)
	}
	return "mention://" + encodeURIComponent(item.DocumentID) + "?kind=document&category=" + encodeURIComponent(item.Category)
}

func escapeMentionLabel(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `[`, `\[`)
	value = strings.ReplaceAll(value, `]`, `\]`)
	return value
}

func encodeURIComponent(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}

func normalizeReferenceHeadingText(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func referenceItemKey(item referenceIndexItem) string {
	if item.Kind == "section" {
		return item.DocumentID + ":" + item.BlockID
	}
	return item.DocumentID + ":"
}

func isReferenceResourceCategory(category string) bool {
	switch category {
	case "character", "scene", "prop", "storyboard":
		return true
	default:
		return false
	}
}

func referenceCategoryLabel(category string) string {
	switch category {
	case "character":
		return "角色"
	case "scene":
		return "场景"
	case "prop":
		return "道具"
	case "storyboard":
		return "分镜"
	default:
		return category
	}
}
