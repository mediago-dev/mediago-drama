package documents

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	markdownFenceLinePattern   = regexp.MustCompile("^(```|~~~)")
	markdownHeadingLinePattern = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*$`)
)

// ValidateMarkdownDocumentStructure rejects document-wide Markdown shapes that tend to cause repair edits.
func ValidateMarkdownDocumentStructure(content string) error {
	lines := SplitMarkdownLines(content)
	previousHeadingLevel := 0
	previousMeaningfulWasSeparator := false
	inFence := false
	for index, rawLine := range lines {
		lineNumber := index + 1
		line := strings.TrimSpace(rawLine)
		if markdownFenceLinePattern.MatchString(line) {
			inFence = !inFence
			continue
		}
		if inFence || line == "" {
			continue
		}
		if line == "---" {
			if previousMeaningfulWasSeparator {
				return fmt.Errorf("第 %d 行出现连续分隔线 `---`", lineNumber)
			}
			previousMeaningfulWasSeparator = true
			continue
		}
		previousMeaningfulWasSeparator = false
		matches := markdownHeadingLinePattern.FindStringSubmatch(line)
		if len(matches) != 3 {
			continue
		}
		level := len(matches[1])
		if previousHeadingLevel > 0 && level > previousHeadingLevel+1 {
			return fmt.Errorf("第 %d 行标题层级从 H%d 跳到 H%d", lineNumber, previousHeadingLevel, level)
		}
		previousHeadingLevel = level
	}
	return nil
}
