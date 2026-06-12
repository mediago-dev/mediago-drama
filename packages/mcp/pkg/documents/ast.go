package documents

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/text"

	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

type documentTextRangeRecord = mediamcp.DocumentTextRange
type documentLineRangeRecord = mediamcp.DocumentLineRange
type documentBlockNode = mediamcp.DocumentBlockNode
type documentHeadingNode = mediamcp.DocumentHeadingNode
type documentStatsRecord = mediamcp.DocumentStats

type Structure struct {
	Blocks     []documentBlockNode
	Outline    []documentHeadingNode
	Stats      documentStatsRecord
	BlockByID  map[string]documentBlockNode
	lineStarts []int
}

type BlockHashConflictError struct {
	BlockID  string
	Expected string
	Current  string
}

func (err BlockHashConflictError) Error() string {
	return fmt.Sprintf(
		"block %s was modified by another agent (expected hash %s, current %s); re-read the document outline before retrying",
		err.BlockID,
		err.Expected,
		err.Current,
	)
}

var markdownParser = goldmark.New(goldmark.WithExtensions(extension.GFM))

func ParseStructure(content string) (Structure, error) {
	source := []byte(content)
	builder := &documentASTBuilder{
		source:     source,
		lineStarts: markdownLineStarts(source),
		ordinals:   map[string]int{},
		blockByID:  map[string]documentBlockNode{},
	}
	root := markdownParser.Parser().Parse(text.NewReader(source))
	blocks, _ := builder.buildSiblingBlocks(root, nil, nil)
	stats := documentStatsRecord{
		BlockCount:   len(flattenDocumentBlocks(blocks)),
		HeadingCount: len(builder.outline),
	}
	for _, block := range flattenDocumentBlocks(blocks) {
		stats.WordCount += estimateWordCount(block.Text)
	}
	return Structure{
		Blocks:     blocks,
		Outline:    builder.outline,
		Stats:      stats,
		BlockByID:  builder.blockByID,
		lineStarts: builder.lineStarts,
	}, nil
}

type documentASTBuilder struct {
	source     []byte
	lineStarts []int
	ordinals   map[string]int
	outline    []documentHeadingNode
	blockByID  map[string]documentBlockNode
}

func (builder *documentASTBuilder) buildSiblingBlocks(parent ast.Node, parentPath []string, headingPath []string) ([]documentBlockNode, []string) {
	blocks := []documentBlockNode{}
	currentHeadingPath := append([]string(nil), headingPath...)
	for child := parent.FirstChild(); child != nil; child = child.NextSibling() {
		if !isMarkdownBlockASTNode(child) {
			continue
		}
		block, nextHeadingPath := builder.blockNode(child, parentPath, currentHeadingPath)
		blocks = append(blocks, block)
		if nextHeadingPath != nil {
			currentHeadingPath = nextHeadingPath
		}
	}
	return blocks, currentHeadingPath
}

func (builder *documentASTBuilder) blockNode(node ast.Node, parentPath []string, headingPath []string) (documentBlockNode, []string) {
	kind := markdownBlockKind(node)
	idPath := append([]string{}, headingPath...)
	idPath = append(idPath, parentPath...)
	id := builder.nextBlockID(idPath, kind)
	markdown := strings.TrimRight(builder.nodeMarkdown(node), "\n")
	textValue := strings.TrimSpace(builder.nodeText(node))
	lineRange := builder.nodeLineRange(node)
	attrs := markdownBlockAttrs(node, builder.source)
	level := 0
	var nextHeadingPath []string
	if heading, ok := node.(*ast.Heading); ok {
		level = heading.Level
		nextHeadingPath = append([]string{}, headingPath...)
		if level <= 0 {
			level = 1
		}
		if len(nextHeadingPath) >= level {
			nextHeadingPath = nextHeadingPath[:level-1]
		}
		nextHeadingPath = append(nextHeadingPath, textValue)
	}

	children, _ := builder.buildSiblingBlocks(node, append(parentPath, id), headingPath)
	if lineRange.StartLine == 0 && len(children) > 0 {
		lineRange.StartLine = children[0].Range.StartLine
		lineRange.EndLine = children[len(children)-1].Range.EndLine
	}
	if markdown == "" && len(children) > 0 {
		markdown = markdownFromChildRange(string(builder.source), lineRange)
	}
	block := documentBlockNode{
		ID:       id,
		Kind:     kind,
		Level:    level,
		Text:     textValue,
		Markdown: markdown,
		Attrs:    attrs,
		Children: children,
		Range:    lineRange,
		Hash:     documentBlockHash(markdown),
	}
	builder.blockByID[id] = block
	if kind == "heading" {
		builder.outline = append(builder.outline, documentHeadingNode{
			ID:    id,
			Text:  textValue,
			Level: level,
			Range: lineRange,
			Hash:  block.Hash,
		})
	}
	return block, nextHeadingPath
}

func (builder *documentASTBuilder) nextBlockID(path []string, kind string) string {
	cleanPath := make([]string, 0, len(path))
	for _, item := range path {
		item = strings.TrimSpace(item)
		if item != "" {
			cleanPath = append(cleanPath, item)
		}
	}
	key := strings.Join(cleanPath, "/") + "|" + kind
	builder.ordinals[key]++
	raw := key + "|" + strconv.Itoa(builder.ordinals[key])
	sum := sha1.Sum([]byte(raw))
	return hex.EncodeToString(sum[:])[:10]
}

func (builder *documentASTBuilder) nodeMarkdown(node ast.Node) string {
	lines := node.Lines()
	if lines != nil && lines.Len() > 0 {
		var out strings.Builder
		for index := 0; index < lines.Len(); index++ {
			segment := lines.At(index)
			out.Write(segment.Value(builder.source))
		}
		return out.String()
	}
	return ""
}

func (builder *documentASTBuilder) nodeText(node ast.Node) string {
	if fenced, ok := node.(*ast.FencedCodeBlock); ok {
		return strings.TrimRight(builder.nodeMarkdown(fenced), "\n")
	}
	if code, ok := node.(*ast.CodeBlock); ok {
		return strings.TrimRight(builder.nodeMarkdown(code), "\n")
	}
	var out strings.Builder
	_ = ast.Walk(node, func(child ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch typed := child.(type) {
		case *ast.Text:
			out.Write(typed.Segment.Value(builder.source))
			if typed.HardLineBreak() || typed.SoftLineBreak() {
				out.WriteByte('\n')
			}
			return ast.WalkSkipChildren, nil
		case *ast.String:
			out.Write(typed.Value)
			return ast.WalkSkipChildren, nil
		case *ast.CodeSpan:
			for codeChild := typed.FirstChild(); codeChild != nil; codeChild = codeChild.NextSibling() {
				if textNode, ok := codeChild.(*ast.Text); ok {
					out.Write(textNode.Segment.Value(builder.source))
				}
			}
			return ast.WalkSkipChildren, nil
		case *ast.FencedCodeBlock, *ast.CodeBlock:
			out.WriteString(builder.nodeMarkdown(child))
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	return out.String()
}

func (builder *documentASTBuilder) nodeLineRange(node ast.Node) documentLineRangeRecord {
	lines := node.Lines()
	if lines == nil || lines.Len() == 0 {
		return documentLineRangeRecord{}
	}
	first := lines.At(0)
	last := lines.At(lines.Len() - 1)
	return documentLineRangeRecord{
		StartLine: builder.lineForOffset(first.Start),
		EndLine:   builder.lineForOffset(maxInt(firstNonNegative(last.Stop-1, last.Start), last.Start)),
	}
}

func (builder *documentASTBuilder) lineForOffset(offset int) int {
	if offset <= 0 {
		return 1
	}
	index := sort.Search(len(builder.lineStarts), func(i int) bool {
		return builder.lineStarts[i] > offset
	})
	if index <= 0 {
		return 1
	}
	return index
}

func markdownLineStarts(source []byte) []int {
	starts := []int{0}
	for index, char := range source {
		if char == '\n' && index+1 < len(source) {
			starts = append(starts, index+1)
		}
	}
	return starts
}

func markdownBlockKind(node ast.Node) string {
	switch node.Kind().String() {
	case "Heading":
		return "heading"
	case "Paragraph":
		return "paragraph"
	case "List":
		return "list"
	case "ListItem":
		return "listItem"
	case "FencedCodeBlock", "CodeBlock":
		return "code"
	case "Blockquote":
		return "quote"
	case "ThematicBreak":
		return "hr"
	case "HTMLBlock":
		return "html"
	case "Table":
		return "table"
	case "TableRow":
		return "tableRow"
	case "TableCell", "TableHeader":
		return "tableCell"
	default:
		return strings.TrimSpace(strings.ToLower(node.Kind().String()))
	}
}

func markdownBlockAttrs(node ast.Node, source []byte) *mediamcp.DocumentBlockAttrs {
	attrs := mediamcp.DocumentBlockAttrs{}
	if fenced, ok := node.(*ast.FencedCodeBlock); ok {
		if language := strings.TrimSpace(string(fenced.Language(source))); language != "" {
			attrs.Language = language
		}
	}
	if list, ok := node.(*ast.List); ok {
		ordered := list.IsOrdered()
		attrs.Ordered = &ordered
	}
	if attrs.IsZero() {
		return nil
	}
	return &attrs
}

func isMarkdownBlockASTNode(node ast.Node) bool {
	if node == nil {
		return false
	}
	switch markdownBlockKind(node) {
	case "heading", "paragraph", "list", "listItem", "code", "quote", "hr", "html", "table", "tableRow", "tableCell":
		return true
	default:
		return false
	}
}

func flattenDocumentBlocks(blocks []documentBlockNode) []documentBlockNode {
	flattened := []documentBlockNode{}
	for _, block := range blocks {
		flattened = append(flattened, block)
		if len(block.Children) > 0 {
			flattened = append(flattened, flattenDocumentBlocks(block.Children)...)
		}
	}
	return flattened
}

func documentBlockHash(markdown string) string {
	sum := sha1.Sum([]byte(strings.TrimSpace(markdown)))
	return hex.EncodeToString(sum[:])[:12]
}

func estimateWordCount(text string) int {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0
	}
	fields := strings.Fields(text)
	if len(fields) > 1 {
		return len(fields)
	}
	count := 0
	for _, r := range text {
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			continue
		}
		count++
	}
	if count == 0 {
		return len(fields)
	}
	return count
}

func markdownFromChildRange(content string, lineRange documentLineRangeRecord) string {
	if lineRange.StartLine <= 0 || lineRange.EndLine <= 0 {
		return ""
	}
	lines := splitMarkdownLines(content)
	start := clampInt(lineRange.StartLine-1, 0, len(lines))
	end := clampInt(lineRange.EndLine, start, len(lines))
	return strings.Join(lines[start:end], "\n")
}

func splitMarkdownLines(content string) []string {
	if content == "" {
		return []string{}
	}
	return strings.Split(content, "\n")
}

func replaceMarkdownLineRange(content string, lineRange documentLineRangeRecord, replacement string) string {
	lines := splitMarkdownLines(content)
	start := clampInt(lineRange.StartLine-1, 0, len(lines))
	end := clampInt(lineRange.EndLine, start, len(lines))
	replacementLines := markdownReplacementLines(replacement)
	next := make([]string, 0, len(lines)-end+start+len(replacementLines))
	next = append(next, lines[:start]...)
	next = append(next, replacementLines...)
	next = append(next, lines[end:]...)
	return normalizeEditedMarkdown(strings.Join(next, "\n"))
}

func insertMarkdownAtLine(content string, lineIndex int, markdown string) string {
	lines := splitMarkdownLines(content)
	lineIndex = clampInt(lineIndex, 0, len(lines))
	replacementLines := markdownReplacementLines(markdown)
	next := make([]string, 0, len(lines)+len(replacementLines))
	next = append(next, lines[:lineIndex]...)
	next = append(next, replacementLines...)
	next = append(next, lines[lineIndex:]...)
	return normalizeEditedMarkdown(strings.Join(next, "\n"))
}

func markdownReplacementLines(markdown string) []string {
	markdown = strings.Trim(markdown, "\n")
	if strings.TrimSpace(markdown) == "" {
		return []string{}
	}
	return strings.Split(markdown, "\n")
}

func normalizeEditedMarkdown(content string) string {
	content = strings.ReplaceAll(content, "\r\n", "\n")
	for strings.Contains(content, "\n\n\n\n") {
		content = strings.ReplaceAll(content, "\n\n\n\n", "\n\n\n")
	}
	return strings.Trim(content, "\n") + "\n"
}

func documentSectionLineRange(structure Structure, heading documentBlockNode) documentLineRangeRecord {
	lineRange := heading.Range
	for _, candidate := range structure.Outline {
		if candidate.Range.StartLine <= heading.Range.StartLine {
			continue
		}
		if candidate.Level > 0 && heading.Level > 0 && candidate.Level <= heading.Level {
			lineRange.EndLine = candidate.Range.StartLine - 1
			return lineRange
		}
	}
	maxLine := heading.Range.EndLine
	for _, block := range flattenDocumentBlocks(structure.Blocks) {
		if block.Range.EndLine > maxLine {
			maxLine = block.Range.EndLine
		}
	}
	lineRange.EndLine = maxLine
	return lineRange
}

func utf16Length(text string) int {
	length := 0
	for _, r := range text {
		if r <= utf8.RuneSelf {
			length++
			continue
		}
		length += len(utf16.Encode([]rune{r}))
	}
	return length
}

func utf16RangeToByteRange(text string, textRange documentTextRangeRecord) (int, int, bool) {
	if textRange.Start < 0 || textRange.End < textRange.Start {
		return 0, 0, false
	}
	current := 0
	startByte := -1
	endByte := -1
	for index, r := range text {
		if current == textRange.Start && startByte < 0 {
			startByte = index
		}
		if current == textRange.End && endByte < 0 {
			endByte = index
			break
		}
		current += len(utf16.Encode([]rune{r}))
	}
	if startByte < 0 && current == textRange.Start {
		startByte = len(text)
	}
	if endByte < 0 && current == textRange.End {
		endByte = len(text)
	}
	return startByte, endByte, startByte >= 0 && endByte >= startByte
}

func selectedUTF16Text(text string, textRange documentTextRangeRecord) (string, bool) {
	start, end, ok := utf16RangeToByteRange(text, textRange)
	if !ok {
		return "", false
	}
	return text[start:end], true
}

func FlattenBlocks(blocks []mediamcp.DocumentBlockNode) []mediamcp.DocumentBlockNode {
	return flattenDocumentBlocks(blocks)
}

func BlockHash(markdown string) string {
	return documentBlockHash(markdown)
}

func ReplaceMarkdownLineRange(content string, lineRange mediamcp.DocumentLineRange, replacement string) string {
	return replaceMarkdownLineRange(content, lineRange, replacement)
}

func InsertMarkdownAtLine(content string, lineIndex int, markdown string) string {
	return insertMarkdownAtLine(content, lineIndex, markdown)
}

func SplitMarkdownLines(content string) []string {
	return splitMarkdownLines(content)
}

func NormalizeEditedMarkdown(content string) string {
	return normalizeEditedMarkdown(content)
}

func SectionLineRange(structure Structure, heading mediamcp.DocumentBlockNode) mediamcp.DocumentLineRange {
	return documentSectionLineRange(structure, heading)
}

func UTF16Length(text string) int {
	return utf16Length(text)
}

func UTF16RangeToByteRange(text string, textRange mediamcp.DocumentTextRange) (int, int, bool) {
	return utf16RangeToByteRange(text, textRange)
}

func SelectedUTF16Text(text string, textRange mediamcp.DocumentTextRange) (string, bool) {
	return selectedUTF16Text(text, textRange)
}

func ClampInt(value int, minValue int, maxValue int) int {
	return clampInt(value, minValue, maxValue)
}

func clampInt(value int, minValue int, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func firstNonNegative(values ...int) int {
	for _, value := range values {
		if value >= 0 {
			return value
		}
	}
	return 0
}

func maxInt(first int, second int) int {
	if first > second {
		return first
	}
	return second
}
