package prompt

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
)

const maxReferenceIndexItems = 120

const referenceIndexPromptHeading = "# 可用 @ 资源索引"

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

// BuildACPUserPrompt appends a compact workspace @ resource index to storyboard-related user prompts.
func BuildACPUserPrompt(request AgentRunRequest) string {
	userPrompt := strings.TrimSpace(request.Prompt)
	if userPrompt == "" || strings.Contains(userPrompt, referenceIndexPromptHeading) {
		return userPrompt
	}
	if !shouldAttachReferenceIndex(request) {
		return userPrompt
	}

	items := buildReferenceIndexItems(request)
	if len(items) == 0 {
		return userPrompt
	}

	return strings.TrimSpace(userPrompt + "\n\n" + renderReferenceIndexPrompt(items))
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

func shouldAttachReferenceIndex(request AgentRunRequest) bool {
	if request.Document != nil && strings.TrimSpace(request.Document.Category) == "storyboard" {
		return true
	}

	prompt := strings.ToLower(strings.TrimSpace(request.Prompt))
	if prompt == "" {
		return false
	}
	for _, keyword := range []string{"分镜", "镜头脚本", "镜头提示词", "视频脚本", "storyboard"} {
		if strings.Contains(prompt, keyword) {
			return true
		}
	}
	return false
}

func renderReferenceIndexPrompt(items []referenceIndexItem) string {
	var builder strings.Builder
	builder.WriteString(referenceIndexPromptHeading)
	builder.WriteString("\n\n")
	builder.WriteString("以下资源来自当前工作区，只供写分镜时自动 @ 使用。使用规则：\n")
	builder.WriteString("- 不要求字面精确匹配；根据人物身份、别名、剧情关系、场景功能和道具用途判断。\n")
	builder.WriteString("- 命中时写成 `原文实体名 + @ 链接`，例如 `沈阎@[沈阎](mention://...)`，可视效果类似 `沈阎@沈阎`。\n")
	builder.WriteString("- 只能复制下方已有完整 Markdown @ 链接，不要自己拼接或编造 `mention://`、`asset://`。\n")
	builder.WriteString("- 同一镜头同一资源首次出现时 @ 一次；无把握或无可用完整链接时不要硬 @。\n\n")
	builder.WriteString("## 资源\n")
	for _, item := range items {
		builder.WriteString("- ")
		builder.WriteString(item.CategoryLabel)
		builder.WriteString("｜")
		builder.WriteString(item.Title)
		builder.WriteString("｜")
		builder.WriteString(item.MentionMarkdown)
		builder.WriteString("\n")
	}
	return strings.TrimRight(builder.String(), "\n")
}

type referenceSection struct {
	BlockID string
	Level   int
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
			Level:   level,
			Title:   title,
		})
	}

	if len(sections) > 1 &&
		sections[0].Level == 1 &&
		sections[0].Title == normalizeReferenceHeadingText(document.Title) {
		return sections[1:]
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
		return "mention://" + encodeURIComponent(item.DocumentID) + "/" + encodeURIComponent(item.BlockID)
	}
	return "mention://" + encodeURIComponent(item.DocumentID)
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
	case "character", "scene", "prop", "storyboard", "reference":
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
	case "reference":
		return "资料"
	default:
		return category
	}
}
