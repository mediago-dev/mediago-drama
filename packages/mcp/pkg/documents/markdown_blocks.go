package documents

import (
	"regexp"
	"strings"
)

var markdownBlankLinePattern = regexp.MustCompile(`\n[ \t]*\n`)

func findMarkdownBlockForAnchor(content string, anchorText string) (string, bool) {
	start, end, ok := findMarkdownBlockRangeForAnchor(content, anchorText)
	if !ok {
		return "", false
	}
	block := strings.TrimSpace(content[start:end])
	if block == "" {
		return "", false
	}
	return block, true
}

func replaceMarkdownBlockForAnchor(content string, anchorText string, replacement string) (string, bool) {
	start, end, ok := findMarkdownBlockRangeForAnchor(content, anchorText)
	if !ok {
		return "", false
	}

	markdown := strings.TrimSpace(replacement)
	if markdown == "" {
		return "", false
	}

	before := strings.TrimRight(content[:start], "\n")
	after := strings.TrimLeft(content[end:], "\n")
	if before == "" && after == "" {
		return markdown, true
	}
	if before == "" {
		return markdown + "\n\n" + after, true
	}
	if after == "" {
		return before + "\n\n" + markdown, true
	}
	return before + "\n\n" + markdown + "\n\n" + after, true
}

func FindMarkdownBlockForAnchor(content string, anchorText string) (string, bool) {
	return findMarkdownBlockForAnchor(content, anchorText)
}

func ReplaceMarkdownBlockForAnchor(content string, anchorText string, replacement string) (string, bool) {
	return replaceMarkdownBlockForAnchor(content, anchorText, replacement)
}

func findMarkdownBlockRangeForAnchor(content string, anchorText string) (int, int, bool) {
	quote := strings.TrimSpace(anchorText)
	if quote == "" {
		return 0, 0, false
	}

	index := strings.Index(content, quote)
	if index < 0 {
		return 0, 0, false
	}

	return findMarkdownBlockStart(content, index), findMarkdownBlockEnd(content, index+len(quote)), true
}

func findMarkdownBlockStart(content string, index int) int {
	start := 0
	for _, match := range markdownBlankLinePattern.FindAllStringIndex(content, -1) {
		if match[0] >= index {
			break
		}
		start = match[1]
	}
	return start
}

func findMarkdownBlockEnd(content string, index int) int {
	for _, match := range markdownBlankLinePattern.FindAllStringIndex(content, -1) {
		if match[0] >= index {
			return match[0]
		}
	}
	return len(content)
}
