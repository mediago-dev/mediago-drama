package model

import "strings"

// OverviewDocumentID is the stable document ID for a project's overview document.
const OverviewDocumentID = "overview"

// IsOverviewDocumentID reports whether an ID points at the project overview document.
func IsOverviewDocumentID(id string) bool {
	return strings.TrimSpace(id) == OverviewDocumentID
}

// DefaultProjectOverviewMarkdown builds the legacy Overview document for a project.
func DefaultProjectOverviewMarkdown(projectName string, projectDescription string, brief ProjectBrief) string {
	title := strings.TrimSpace(projectName)
	if title == "" {
		title = "未命名项目"
	}
	description := strings.TrimSpace(projectDescription)
	briefMarkdown := ProjectBriefOverviewMarkdown(brief)

	var builder strings.Builder
	builder.WriteString("# ")
	builder.WriteString(markdownSingleLine(title))
	builder.WriteString("\n\n")
	if description != "" {
		builder.WriteString(description)
		builder.WriteString("\n\n")
	}
	builder.WriteString("## Project Brief\n\n")
	builder.WriteString(briefMarkdown)
	builder.WriteString("\n\n")
	builder.WriteString("## 剧本\n\n")
	builder.WriteString("<!-- section-doc-list category=\"screenplay\" -->\n\n")
	builder.WriteString("## 角色\n\n")
	builder.WriteString("<!-- section-doc-list category=\"character\" -->\n\n")
	builder.WriteString("## 场景\n\n")
	builder.WriteString("<!-- section-doc-list category=\"scene\" -->\n\n")
	builder.WriteString("## 分镜\n\n")
	builder.WriteString("<!-- section-doc-list category=\"storyboard\" -->\n\n")
	builder.WriteString("## 素材\n\n")
	builder.WriteString("<!-- section-doc-list category=\"source-material\" -->\n")
	return builder.String()
}

// ProjectBriefOverviewMarkdown renders the project brief section inside an Overview document.
func ProjectBriefOverviewMarkdown(brief ProjectBrief) string {
	fields := []struct {
		label string
		value string
	}{
		{label: "媒介", value: brief.Medium},
		{label: "类型", value: brief.Genre},
		{label: "节奏", value: brief.Pacing},
		{label: "受众", value: brief.Audience},
		{label: "基调", value: brief.Tone},
		{label: "风格", value: brief.Style},
		{label: "参考", value: brief.References},
		{label: "其他约束", value: brief.Notes},
	}
	lines := []string{}
	for _, field := range fields {
		value := strings.TrimSpace(field.value)
		if value == "" {
			continue
		}
		lines = append(lines, "- **"+field.label+"**："+value)
	}
	if len(lines) == 0 {
		return "> 在这里写下项目的定位、媒介、节奏、受众、基调、风格、参考和约束。可以让 Agent 帮忙草拟。"
	}
	return strings.Join(lines, "\n")
}

// RenderOverviewProjectBriefPrompt renders the legacy Overview brief section for ACP prompts.
func RenderOverviewProjectBriefPrompt(markdown string) string {
	brief := ExtractOverviewProjectBriefSection(markdown)
	if brief == "" {
		brief = "[未设定]"
	}

	var builder strings.Builder
	builder.WriteString("## 当前项目设定（Project Brief）\n\n")
	builder.WriteString("这是旧 Overview 文档（documentId: ")
	builder.WriteString(OverviewDocumentID)
	builder.WriteString("）中的 Project Brief 章节，仅用于兼容旧项目。新项目不要创建或编辑 Overview Markdown 文档。\n\n")
	builder.WriteString(brief)
	builder.WriteString("\n")
	return builder.String()
}

// ExtractOverviewProjectBriefSection extracts the Project Brief section from Overview markdown.
func ExtractOverviewProjectBriefSection(markdown string) string {
	lines := strings.Split(strings.ReplaceAll(markdown, "\r\n", "\n"), "\n")
	start := -1
	for index, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.EqualFold(trimmed, "## Project Brief") {
			start = index + 1
			break
		}
	}
	if start < 0 {
		return ""
	}

	end := len(lines)
	for index := start; index < len(lines); index++ {
		trimmed := strings.TrimSpace(lines[index])
		if strings.HasPrefix(trimmed, "## ") {
			end = index
			break
		}
	}
	return strings.TrimSpace(strings.Join(lines[start:end], "\n"))
}

// ReplaceOverviewProjectBriefSection replaces or creates the Project Brief section in Overview markdown.
func ReplaceOverviewProjectBriefSection(markdown string, replacement string) string {
	lines := strings.Split(strings.ReplaceAll(markdown, "\r\n", "\n"), "\n")
	start := -1
	for index, line := range lines {
		if strings.EqualFold(strings.TrimSpace(line), "## Project Brief") {
			start = index + 1
			break
		}
	}
	replacement = strings.TrimSpace(replacement)
	if replacement == "" {
		replacement = ProjectBriefOverviewMarkdown(ProjectBrief{})
	}
	replacementLines := strings.Split(replacement, "\n")
	if start < 0 {
		next := strings.TrimRight(markdown, "\n")
		if next != "" {
			next += "\n\n"
		}
		next += "## Project Brief\n\n" + strings.Join(replacementLines, "\n") + "\n"
		return next
	}

	end := len(lines)
	for index := start; index < len(lines); index++ {
		if strings.HasPrefix(strings.TrimSpace(lines[index]), "## ") {
			end = index
			break
		}
	}

	nextLines := make([]string, 0, len(lines)-end+start+len(replacementLines)+2)
	nextLines = append(nextLines, lines[:start]...)
	if len(nextLines) > 0 && strings.TrimSpace(nextLines[len(nextLines)-1]) != "" {
		nextLines = append(nextLines, "")
	}
	nextLines = append(nextLines, replacementLines...)
	if end < len(lines) && strings.TrimSpace(lines[end]) != "" {
		nextLines = append(nextLines, "")
	}
	nextLines = append(nextLines, lines[end:]...)
	return strings.TrimRight(strings.Join(nextLines, "\n"), "\n") + "\n"
}

func markdownSingleLine(value string) string {
	value = strings.ReplaceAll(value, "\r", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	return strings.TrimSpace(value)
}
