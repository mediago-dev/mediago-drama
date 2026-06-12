package document

import (
	"fmt"
	"regexp"
	"strings"

	docs "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/documents"
	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

var characterFieldLinePattern = regexp.MustCompile(`^\*\*([^*]+)\*\*：.*$`)

var defaultCharacterFieldOrder = []string{"形象定位", "面部特征", "身材气质", "着装造型", "标志性细节"}

// ValidateTemplateDocumentContent rejects malformed Markdown and strict business template content.
func ValidateTemplateDocumentContent(document mediamcp.WorkspaceDocument, content string) error {
	return validateTemplateDocumentContent(document, content)
}

func validateTemplateDocumentContent(document mediamcp.WorkspaceDocument, content string) error {
	if err := ValidateMarkdownDocumentStructure(content); err != nil {
		return fmt.Errorf("文档结构校验失败：%w", err)
	}
	if !isCharacterTemplateDocument(document) {
		return nil
	}
	if err := validateCharacterTemplateContent(content, defaultCharacterFieldOrder); err != nil {
		return fmt.Errorf("角色档案模板校验失败：%w", err)
	}
	return nil
}

func isCharacterTemplateDocument(document mediamcp.WorkspaceDocument) bool {
	return strings.TrimSpace(document.Category) == "character"
}

func validateCharacterTemplateContent(content string, fieldOrder []string) error {
	structure, err := docs.ParseStructure(content)
	if err != nil {
		return err
	}
	if len(fieldOrder) == 0 {
		fieldOrder = defaultCharacterFieldOrder
	}
	if len(structure.Outline) == 0 {
		return fmt.Errorf("至少需要一个二级角色标题")
	}
	lines := docs.SplitMarkdownLines(content)
	seenHeadings := map[string]bool{}
	for index, heading := range structure.Outline {
		if heading.Level != 2 {
			return fmt.Errorf("标题 %q 必须使用二级标题", heading.Text)
		}
		headingText := strings.TrimSpace(heading.Text)
		if headingText == "" {
			return fmt.Errorf("角色标题不能为空")
		}
		if seenHeadings[headingText] {
			return fmt.Errorf("角色标题 %q 重复", headingText)
		}
		seenHeadings[headingText] = true
		start := clampLineIndex(heading.Range.EndLine, 0, len(lines))
		endLine := len(lines)
		if index+1 < len(structure.Outline) {
			endLine = structure.Outline[index+1].Range.StartLine - 1
		}
		end := clampLineIndex(endLine, start, len(lines))
		if err := validateCharacterSectionLines(heading.Text, lines[start:end], fieldOrder); err != nil {
			return err
		}
	}
	return nil
}

func clampLineIndex(value int, minValue int, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func validateCharacterSectionLines(heading string, lines []string, fieldOrder []string) error {
	seen := map[string]bool{}
	nextFieldIndex := 0
	separatorSeen := false
	for _, rawLine := range lines {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue
		}
		if line == "---" {
			if separatorSeen {
				return fmt.Errorf("%q 中分隔线重复", heading)
			}
			if nextFieldIndex < len(fieldOrder) {
				return fmt.Errorf("%q 中分隔线出现在字段填写完成之前", heading)
			}
			separatorSeen = true
			continue
		}
		if separatorSeen {
			return fmt.Errorf("%q 中分隔线之后存在多余内容 %q", heading, line)
		}
		matches := characterFieldLinePattern.FindStringSubmatch(line)
		if len(matches) != 2 {
			return fmt.Errorf("%q 中存在非预期字段行 %q", heading, line)
		}
		field := matches[1]
		if seen[field] {
			return fmt.Errorf("%q 中字段 %q 重复", heading, field)
		}
		if nextFieldIndex >= len(fieldOrder) {
			return fmt.Errorf("%q 中存在多余字段 %q", heading, field)
		}
		expected := fieldOrder[nextFieldIndex]
		if field != expected {
			return fmt.Errorf("%q 中字段顺序错误：需要 %q，实际为 %q", heading, expected, field)
		}
		seen[field] = true
		nextFieldIndex++
	}
	for _, field := range fieldOrder {
		if !seen[field] {
			return fmt.Errorf("%q 缺少字段 `**%s**：`", heading, field)
		}
	}
	return nil
}
