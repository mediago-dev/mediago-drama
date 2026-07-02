package document

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
)

var (
	workspaceSectionAnchorIDPattern    = regexp.MustCompile(`^section_[A-Za-z0-9_-]+$`)
	workspaceLegacyBlockIDPattern      = regexp.MustCompile(`^section-[A-Za-z0-9]+$`)
	workspaceSectionIDLinePattern      = regexp.MustCompile(`^\s*<!--\s*section-id:\s*([A-Za-z0-9_-]+)\s*-->\s*$`)
	workspaceMarkdownHeadingPattern    = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*$`)
	workspaceSectionHeadingLinePattern = regexp.MustCompile(`^##\s+(.+?)\s*$`)
)

const workspaceSectionHeadingLevel = 2

type workspaceSectionLocation struct {
	headingIndex            int
	headingLevel            int
	insertedAnchorSectionID string
	replaceAnchorLineIndex  int
}

func workspaceSectionHeadingLineByID(lines []string, sectionID string) int {
	for index, line := range lines {
		if !workspaceSectionHeadingLinePattern.MatchString(line) {
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
			headingLevel:           workspaceSectionHeadingLevel,
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
		headingLevel:            workspaceSectionHeadingLevel,
		insertedAnchorSectionID: insertedAnchorSectionID,
		replaceAnchorLineIndex:  replaceAnchorLineIndex,
	}, true
}

func workspaceSectionHeadingLineByLegacyBlockID(lines []string, documentID string, blockID string) int {
	occurrenceByHeading := map[string]int{}

	for index, line := range lines {
		level := workspaceSectionHeadingLevel
		title := workspaceSectionHeadingText(line)
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
	match := workspaceMarkdownHeadingPattern.FindStringSubmatch(line)
	if len(match) == 0 {
		return 0
	}
	return len(match[1])
}

func workspaceSectionEndLine(lines []string, headingIndex int, headingLevel int) int {
	for index := headingIndex + 1; index < len(lines); index++ {
		match := workspaceMarkdownHeadingPattern.FindStringSubmatch(lines[index])
		if len(match) > 0 && len(match[1]) <= headingLevel {
			return workspaceSectionBoundaryBeforeHeadingLine(lines, headingIndex, index)
		}
	}
	return len(lines)
}

func workspaceSectionHeadingText(line string) string {
	match := workspaceSectionHeadingLinePattern.FindStringSubmatch(line)
	if len(match) < 2 {
		return ""
	}
	return normalizeWorkspaceHeadingText(match[1])
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
