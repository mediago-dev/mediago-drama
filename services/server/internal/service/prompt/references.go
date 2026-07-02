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
const referenceHandlingPromptHeading = "# @ 引用处理要求"

var (
	referenceHeadingPattern          = regexp.MustCompile(`^##\s+(.+?)\s*$`)
	referenceSectionIDCommentPattern = regexp.MustCompile(`^\s*<!--\s*section-id:\s*([A-Za-z0-9_-]+)\s*-->\s*$`)
)

const referenceSectionHeadingLevel = 2

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

// BuildACPUserPrompt appends compact reference guidance to user prompts that need workspace resources.
func BuildACPUserPrompt(request AgentRunRequest) string {
	userPrompt := strings.TrimSpace(request.Prompt)
	if userPrompt == "" ||
		strings.Contains(userPrompt, referenceIndexPromptHeading) ||
		strings.Contains(userPrompt, referenceHandlingPromptHeading) {
		return userPrompt
	}

	sections := []string{userPrompt}
	if shouldAttachReferenceIndex(request) {
		items := buildReferenceIndexItems(request)
		if len(items) > 0 {
			sections = append(sections, renderReferenceIndexPrompt(items))
		}
	}
	if shouldAttachReferenceHandlingPrompt(request) {
		sections = append(sections, renderReferenceHandlingPrompt())
	}

	return strings.TrimSpace(strings.Join(sections, "\n\n"))
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

func shouldAttachReferenceHandlingPrompt(request AgentRunRequest) bool {
	if len(request.References) > 0 {
		return true
	}
	prompt := strings.ToLower(strings.TrimSpace(request.Prompt))
	if !strings.Contains(prompt, "@") {
		return false
	}
	for _, suffix := range []string{".txt", ".md", ".markdown", ".docx", ".pdf"} {
		if strings.Contains(prompt, suffix) {
			return true
		}
	}
	return false
}

func renderReferenceHandlingPrompt() string {
	return strings.Join([]string{
		referenceHandlingPromptHeading,
		"",
		"- 用户消息中的 `@文件名` 是工作区引用；当前工作目录已经是项目文档根目录，先在 `.` 下定位同名或同基名文件。",
		"- 如果存在同基名副本（例如 `素材.txt`、`素材-2.txt`、`素材-3.txt`），优先使用修改时间最新的文件。",
		"- 处理超过 200 行或 8KB 的文本资料时，不要用 `read` 从头到尾反复分页；先定位章节/标题边界，再只读取用户要求的章节或片段。",
		"- 用户要求生成、改写或写入业务文档时，读到足够上下文后必须完成文档写入或输出可应用的最终内容；不要把“下一步继续读取”或 Next Steps 当作最终回答。",
	}, "\n")
}

func renderReferenceIndexPrompt(items []referenceIndexItem) string {
	var builder strings.Builder
	builder.WriteString(referenceIndexPromptHeading)
	builder.WriteString("\n\n")
	builder.WriteString("以下资源来自当前工作区，可供生成内容时引用。\n\n")
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
		level := referenceSectionHeadingLevel
		title := normalizeReferenceHeadingText(match[1])
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
