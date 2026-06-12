package documents

import (
	"fmt"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"strings"
)

// RenderBlockInputs renders a list of structured block inputs as Markdown.
func RenderBlockInputs(blocks []mediamcp.DocumentBlockInput) string {
	rendered := []string{}
	for _, block := range blocks {
		markdown := strings.TrimSpace(RenderBlockInput(block))
		if markdown != "" {
			rendered = append(rendered, markdown)
		}
	}
	if len(rendered) == 0 {
		return ""
	}
	return strings.Join(rendered, "\n\n") + "\n"
}

// RenderBlockInput renders one structured block input as Markdown.
func RenderBlockInput(block mediamcp.DocumentBlockInput) string {
	if strings.TrimSpace(block.Markdown) != "" {
		return strings.Trim(block.Markdown, "\n")
	}
	kind := FirstNonEmpty(strings.TrimSpace(block.Kind), "paragraph")
	text := strings.TrimSpace(block.Text)
	switch kind {
	case "heading":
		level := block.Level
		if level <= 0 || level > 6 {
			level = 2
		}
		return strings.Repeat("#", level) + " " + FirstNonEmpty(text, "未命名")
	case "code":
		language := block.CodeAttrs().Language
		return "```" + language + "\n" + strings.Trim(block.Text, "\n") + "\n```"
	case "quote":
		return prefixMarkdownLines(FirstNonEmpty(text, RenderBlockInputs(childBlockInputs(block.Children))), "> ")
	case "list":
		ordered := block.ListAttrs().Ordered
		items := []string{}
		for index, child := range childBlockInputs(block.Children) {
			itemText := strings.TrimSpace(FirstNonEmpty(child.Text, child.Markdown))
			if itemText == "" {
				continue
			}
			prefix := "- "
			if ordered {
				prefix = fmt.Sprintf("%d. ", index+1)
			}
			items = append(items, prefix+itemText)
		}
		return strings.Join(items, "\n")
	case "listItem":
		return "- " + text
	case "hr":
		return "---"
	case "html":
		return strings.TrimSpace(block.Text)
	default:
		return text
	}
}

func childBlockInputs(children []map[string]any) []mediamcp.DocumentBlockInput {
	blocks := make([]mediamcp.DocumentBlockInput, 0, len(children))
	for _, child := range children {
		blocks = append(blocks, blockInputFromMap(child))
	}
	return blocks
}

func blockInputFromMap(payload map[string]any) mediamcp.DocumentBlockInput {
	block := mediamcp.DocumentBlockInput{
		Kind:     mediamcp.StringAttr(payload, "kind"),
		Text:     mediamcp.StringAttr(payload, "text"),
		Markdown: mediamcp.StringAttr(payload, "markdown"),
		Attrs:    mediamcp.NewDocumentBlockAttrsFromMap(mediamcp.MapAttr(payload, "attrs")),
	}
	if level := mediamcp.IntAttr(payload, "level"); level > 0 {
		block.Level = level
	}
	if rawChildren, ok := payload["children"].([]any); ok {
		for _, rawChild := range rawChildren {
			if child, ok := rawChild.(map[string]any); ok {
				block.Children = append(block.Children, child)
			}
		}
	}
	if rawChildren, ok := payload["children"].([]map[string]any); ok {
		block.Children = append(block.Children, rawChildren...)
	}
	return block
}

// RenderInlineReplacement renders flexible inline replacement input.
func RenderInlineReplacement(value mediamcp.DocumentInlineReplacement) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []mediamcp.DocumentInlineContentInput:
		return RenderInlineContents(typed)
	case []any:
		contents := make([]mediamcp.DocumentInlineContentInput, 0, len(typed))
		for _, item := range typed {
			if payload, ok := item.(map[string]any); ok {
				contents = append(contents, inlineContentFromMap(payload))
			}
		}
		return RenderInlineContents(contents)
	default:
		return fmt.Sprint(value)
	}
}

func inlineContentFromMap(payload map[string]any) mediamcp.DocumentInlineContentInput {
	content := mediamcp.DocumentInlineContentInput{Type: fmt.Sprint(payload["type"])}
	if textValue, ok := payload["text"].(string); ok {
		content.Text = textValue
	}
	content.Attrs = mediamcp.NewMentionAttrsFromMap(mediamcp.MapAttr(payload, "attrs"))
	return content
}

// RenderInlineContents renders inline content inputs as Markdown text.
func RenderInlineContents(contents []mediamcp.DocumentInlineContentInput) string {
	var out strings.Builder
	for _, content := range contents {
		text := content.Text
		if content.Type == "mention" {
			attrs := content.MentionAttrs()
			text = "@" + FirstNonEmpty(attrs.Label, attrs.ID, "mention")
		}
		for _, mark := range content.Marks {
			text = ApplyInlineMark(text, mark, "add")
		}
		out.WriteString(text)
	}
	return out.String()
}

// ApplyInlineMark applies, removes, or toggles one inline mark.
func ApplyInlineMark(text string, mark mediamcp.DocumentInlineMarkInput, op string) string {
	kind := strings.TrimSpace(mark.Kind)
	if op == "remove" {
		return removeInlineMark(text, kind)
	}
	if op == "toggle" && hasInlineMark(text, kind) {
		return removeInlineMark(text, kind)
	}
	switch kind {
	case "bold":
		return "**" + text + "**"
	case "italic":
		return "_" + text + "_"
	case "code":
		return "`" + text + "`"
	case "strike":
		return "~~" + text + "~~"
	case "highlight":
		return "==" + text + "=="
	case "link":
		return "[" + text + "](" + FirstNonEmpty(mark.LinkAttrs().Href, "#") + ")"
	default:
		return text
	}
}

func hasInlineMark(text string, kind string) bool {
	switch kind {
	case "bold":
		return strings.HasPrefix(text, "**") && strings.HasSuffix(text, "**")
	case "italic":
		return strings.HasPrefix(text, "_") && strings.HasSuffix(text, "_")
	case "code":
		return strings.HasPrefix(text, "`") && strings.HasSuffix(text, "`")
	case "strike":
		return strings.HasPrefix(text, "~~") && strings.HasSuffix(text, "~~")
	case "highlight":
		return strings.HasPrefix(text, "==") && strings.HasSuffix(text, "==")
	default:
		return false
	}
}

func removeInlineMark(text string, kind string) string {
	pairs := map[string][2]string{
		"bold":      {"**", "**"},
		"italic":    {"_", "_"},
		"code":      {"`", "`"},
		"strike":    {"~~", "~~"},
		"highlight": {"==", "=="},
	}
	pair, ok := pairs[kind]
	if !ok {
		return text
	}
	if strings.HasPrefix(text, pair[0]) && strings.HasSuffix(text, pair[1]) {
		return strings.TrimSuffix(strings.TrimPrefix(text, pair[0]), pair[1])
	}
	return text
}

// ReplaceTextInBlockMarkdown replaces a UTF-16 text range inside a block.
func ReplaceTextInBlockMarkdown(block mediamcp.DocumentBlockNode, textRange mediamcp.DocumentTextRange, replacement string) (string, error) {
	selected, ok := SelectedUTF16Text(block.Text, textRange)
	if !ok {
		return "", fmt.Errorf("range is outside block %s", block.ID)
	}
	if selected != "" {
		if index := strings.Index(block.Markdown, selected); index >= 0 {
			return block.Markdown[:index] + replacement + block.Markdown[index+len(selected):], nil
		}
	}
	if block.Kind == "heading" {
		prefixEnd := strings.Index(block.Markdown, " ")
		if prefixEnd >= 0 {
			raw := block.Markdown[prefixEnd+1:]
			start, end, ok := UTF16RangeToByteRange(raw, textRange)
			if ok {
				return block.Markdown[:prefixEnd+1] + raw[:start] + replacement + raw[end:], nil
			}
		}
	}
	start, end, ok := UTF16RangeToByteRange(block.Markdown, textRange)
	if !ok {
		return "", fmt.Errorf("range cannot be mapped to block markdown %s", block.ID)
	}
	return block.Markdown[:start] + replacement + block.Markdown[end:], nil
}

// EnsureExpectedBlockHash validates an optimistic block hash.
func EnsureExpectedBlockHash(block mediamcp.DocumentBlockNode, expected string) error {
	expected = strings.TrimSpace(expected)
	if expected == "" {
		return fmt.Errorf("expectedBlockHash is required for block %s", block.ID)
	}
	if expected == block.Hash {
		return nil
	}
	return BlockHashConflictError{BlockID: block.ID, Expected: expected, Current: block.Hash}
}

// ReplaceWorkspaceToolSelection replaces a selected text range inside content.
func ReplaceWorkspaceToolSelection(content string, structure Structure, selection mediamcp.DocumentRangeSelection, replacement string, expectedBlockHash string) (string, error) {
	block, ok := structure.BlockByID[selection.BlockID]
	if !ok {
		return "", fmt.Errorf("目标 blockId 不存在")
	}
	if err := EnsureExpectedBlockHash(block, expectedBlockHash); err != nil {
		return "", err
	}
	nextMarkdown, err := ReplaceTextInBlockMarkdown(block, selection.Range, replacement)
	if err != nil {
		return "", err
	}
	return ReplaceMarkdownLineRange(content, block.Range, nextMarkdown), nil
}

// SelectionFromDocumentContent locates quote inside a document and returns a block-range selection.
func SelectionFromDocumentContent(content string, quote string) (*mediamcp.DocumentRangeSelection, error) {
	quote = strings.TrimSpace(quote)
	if quote == "" {
		return nil, nil
	}
	structure, err := ParseStructure(content)
	if err != nil {
		return nil, err
	}
	for _, block := range FlattenBlocks(structure.Blocks) {
		index := strings.Index(block.Text, quote)
		if index < 0 {
			continue
		}
		start := UTF16Length(block.Text[:index])
		return &mediamcp.DocumentRangeSelection{
			BlockID: block.ID,
			Range: mediamcp.DocumentTextRange{
				Start: start,
				End:   start + UTF16Length(quote),
			},
			Quote: quote,
		}, nil
	}
	return nil, nil
}

// IsEmptyDocumentBlockInput reports whether a block input has no content.
func IsEmptyDocumentBlockInput(block mediamcp.DocumentBlockInput) bool {
	return block.Kind == "" &&
		block.Level == 0 &&
		block.Text == "" &&
		block.Markdown == "" &&
		block.Attrs.Empty() &&
		len(block.Children) == 0
}

// PatchBlockMarkdownAttrs patches Markdown syntax for supported block attrs.
func PatchBlockMarkdownAttrs(block mediamcp.DocumentBlockNode, attrs *mediamcp.DocumentBlockAttrs) (string, error) {
	if attrs.Empty() {
		return block.Markdown, nil
	}
	switch block.Kind {
	case "heading":
		level := attrs.HeadingAttrs().Level
		if level <= 0 || level > 6 {
			return "", fmt.Errorf("heading level must be between 1 and 6")
		}
		return strings.Repeat("#", level) + " " + block.Text, nil
	case "code":
		language := attrs.CodeAttrs().Language
		lines := strings.Split(block.Markdown, "\n")
		if len(lines) == 0 || !strings.HasPrefix(strings.TrimSpace(lines[0]), "```") {
			return "", fmt.Errorf("code block does not use fenced markdown")
		}
		lines[0] = "```" + language
		return strings.Join(lines, "\n"), nil
	case "list":
		ordered := attrs.ListAttrs().Ordered
		lines := strings.Split(block.Markdown, "\n")
		for index, line := range lines {
			trimmed := strings.TrimSpace(line)
			if trimmed == "" {
				continue
			}
			content := strings.TrimSpace(strings.TrimPrefix(strings.TrimLeft(trimmed, "0123456789."), "-"))
			if ordered {
				lines[index] = fmt.Sprintf("%d. %s", index+1, content)
			} else {
				lines[index] = "- " + content
			}
		}
		return strings.Join(lines, "\n"), nil
	default:
		return "", fmt.Errorf("patch_block_attrs does not support %s blocks yet", block.Kind)
	}
}

// InsertionLineIndex returns the line index for inserting around an anchor block.
func InsertionLineIndex(anchor mediamcp.DocumentBlockNode, position string) (int, error) {
	switch strings.TrimSpace(position) {
	case "before":
		return anchor.Range.StartLine - 1, nil
	case "", "after":
		return anchor.Range.EndLine, nil
	case "firstChild":
		return anchor.Range.StartLine, nil
	case "lastChild":
		return anchor.Range.EndLine, nil
	default:
		return 0, fmt.Errorf("unsupported anchor position: %s", position)
	}
}

func prefixMarkdownLines(markdown string, prefix string) string {
	lines := strings.Split(strings.Trim(markdown, "\n"), "\n")
	for index := range lines {
		lines[index] = prefix + lines[index]
	}
	return strings.Join(lines, "\n")
}
