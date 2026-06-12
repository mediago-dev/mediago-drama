package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"text/template"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/service/textutil"
)

// UnsetProjectBriefValue is rendered for empty project brief fields.
const UnsetProjectBriefValue = "[未设定]"

// ProjectBrief is the fixed project-level creative context shared by all agents.
type ProjectBrief struct {
	Medium     string `json:"medium"`
	Genre      string `json:"genre"`
	Pacing     string `json:"pacing"`
	Audience   string `json:"audience"`
	Tone       string `json:"tone"`
	Style      string `json:"style"`
	References string `json:"references"`
	Notes      string `json:"notes"`
	UpdatedAt  string `json:"updatedAt"`
}

// ProjectBriefUpdateMask identifies which project brief fields are being updated.
type ProjectBriefUpdateMask struct {
	Medium     bool
	Genre      bool
	Pacing     bool
	Audience   bool
	Tone       bool
	Style      bool
	References bool
	Notes      bool
}

// ProjectBriefPromptInputs carries project brief values into prompt templates.
type ProjectBriefPromptInputs struct {
	UseOverview      bool
	OverviewMarkdown string
	Medium           string
	Genre            string
	Pacing           string
	Audience         string
	Tone             string
	Style            string
	References       string
	Notes            string
}

// ProjectBriefPatch is the sparse HTTP/MCP payload for updating a project brief.
type ProjectBriefPatch struct {
	Medium     *string `json:"medium,omitempty" jsonschema:"项目媒介，自由文本；只在用户已明确回答后传入。"`
	Genre      *string `json:"genre,omitempty" jsonschema:"项目类型，自由文本；只在用户已明确回答后传入。"`
	Pacing     *string `json:"pacing,omitempty" jsonschema:"项目节奏，自由文本；只在用户已明确回答后传入。"`
	Audience   *string `json:"audience,omitempty" jsonschema:"目标受众，自由文本；只在用户已明确回答后传入。"`
	Tone       *string `json:"tone,omitempty" jsonschema:"项目基调，自由文本；只在用户已明确回答后传入。"`
	Style      *string `json:"style,omitempty" jsonschema:"视觉风格，自由文本；图片和视频生成时必须遵循。"`
	References *string `json:"references,omitempty" jsonschema:"参考作品或灵感，自由文本；只在用户已明确回答后传入。"`
	Notes      *string `json:"notes,omitempty" jsonschema:"其他约束，自由文本；只在用户已明确回答后传入。"`
}

// ProjectBriefMutationResult describes a project brief update.
type ProjectBriefMutationResult struct {
	Brief   ProjectBrief
	Changed bool
}

// Render formats the project brief as prompt instructions.
func (brief ProjectBrief) Render() string {
	data := ProjectBriefPromptInputs{
		UseOverview: false,
		Medium:      renderProjectBriefValue(brief.Medium),
		Genre:       renderProjectBriefValue(brief.Genre),
		Pacing:      renderProjectBriefValue(brief.Pacing),
		Audience:    renderProjectBriefValue(brief.Audience),
		Tone:        renderProjectBriefValue(brief.Tone),
		Style:       renderProjectBriefValue(brief.Style),
		References:  renderProjectBriefValue(brief.References),
		Notes:       renderProjectBriefValue(brief.Notes),
	}
	return projectBriefPromptTemplate(data)
}

// Apply returns a copy of the brief with masked fields applied.
func (brief ProjectBrief) Apply(update ProjectBrief, mask ProjectBriefUpdateMask) ProjectBrief {
	if mask.Medium {
		brief.Medium = update.Medium
	}
	if mask.Genre {
		brief.Genre = update.Genre
	}
	if mask.Pacing {
		brief.Pacing = update.Pacing
	}
	if mask.Audience {
		brief.Audience = update.Audience
	}
	if mask.Tone {
		brief.Tone = update.Tone
	}
	if mask.Style {
		brief.Style = update.Style
	}
	if mask.References {
		brief.References = update.References
	}
	if mask.Notes {
		brief.Notes = update.Notes
	}
	return brief
}

// Empty reports whether the mask updates no fields.
func (mask ProjectBriefUpdateMask) Empty() bool {
	return !mask.Medium &&
		!mask.Genre &&
		!mask.Pacing &&
		!mask.Audience &&
		!mask.Tone &&
		!mask.Style &&
		!mask.References &&
		!mask.Notes
}

// ProjectBriefPatchToUpdate converts a sparse patch into a value plus field mask.
func ProjectBriefPatchToUpdate(patch ProjectBriefPatch) (ProjectBrief, ProjectBriefUpdateMask) {
	brief := ProjectBrief{}
	mask := ProjectBriefUpdateMask{}
	if patch.Medium != nil {
		brief.Medium = *patch.Medium
		mask.Medium = true
	}
	if patch.Genre != nil {
		brief.Genre = *patch.Genre
		mask.Genre = true
	}
	if patch.Pacing != nil {
		brief.Pacing = *patch.Pacing
		mask.Pacing = true
	}
	if patch.Audience != nil {
		brief.Audience = *patch.Audience
		mask.Audience = true
	}
	if patch.Tone != nil {
		brief.Tone = *patch.Tone
		mask.Tone = true
	}
	if patch.Style != nil {
		brief.Style = *patch.Style
		mask.Style = true
	}
	if patch.References != nil {
		brief.References = *patch.References
		mask.References = true
	}
	if patch.Notes != nil {
		brief.Notes = *patch.Notes
		mask.Notes = true
	}
	return brief, mask
}

// DecodeProjectBriefJSON decodes a stored project brief JSON string.
func DecodeProjectBriefJSON(projectID string, raw string) (ProjectBrief, error) {
	if strings.TrimSpace(raw) == "" {
		return ProjectBrief{}, nil
	}
	var brief ProjectBrief
	if err := json.Unmarshal([]byte(raw), &brief); err != nil {
		return ProjectBrief{}, fmt.Errorf("decoding project brief for %s: %w", projectID, err)
	}
	return brief, nil
}

// EncodeProjectBriefJSON encodes a project brief for storage.
func EncodeProjectBriefJSON(brief ProjectBrief) (string, error) {
	raw, err := json.Marshal(brief)
	if err != nil {
		return "", fmt.Errorf("encoding project brief: %w", err)
	}
	return string(raw), nil
}

// NowProjectBriefTimestamp returns the canonical UTC update timestamp.
func NowProjectBriefTimestamp() string {
	return timestamp.NowRFC3339Nano()
}

func renderProjectBriefValue(value string) string {
	if strings.TrimSpace(value) == "" {
		return UnsetProjectBriefValue
	}
	return value
}

func projectBriefPromptTemplate(data ProjectBriefPromptInputs) string {
	tmpl, err := template.New("project_brief").Funcs(projectBriefTemplateFuncs()).Parse(projectBriefPromptFallback)
	if err != nil {
		slog.Error("parse project_brief.md failed", "err", err)
		return ""
	}
	var buffer bytes.Buffer
	if err := tmpl.Execute(&buffer, data); err != nil {
		slog.Error("execute project_brief.md failed", "err", err)
		return ""
	}
	return strings.TrimSpace(buffer.String())
}

const projectBriefPromptFallback = `{{if .UseOverview}}{{overviewProjectBrief (truncate .OverviewMarkdown 16384)}}{{else}}# 当前项目设定（Project Brief）

这是本项目所有 agent 共享的创作变量。若与你的任务相关的字段为 [未设定]，请先用一句话向用户确认，
拿到回答后通过项目设定更新能力保存，再开始正式产出文档。

## 使用规则

- 若当前任务依赖某个缺失字段，先向用户确认该字段。
- 得到回答后，更新项目设定，不要创建或编辑 Overview Markdown 文档。
- 完成 Project Brief 更新后，再开始正式产出业务文档。

## 字段

| 字段 | 当前值 |
| --- | --- |
| 媒介 | {{.Medium}} |
| 类型 | {{.Genre}} |
| 节奏 | {{.Pacing}} |
| 受众 | {{.Audience}} |
| 基调 | {{.Tone}} |
| 风格 | {{.Style}} |
| 参考 | {{.References}} |
| 其他约束 | {{.Notes}} |
{{end}}`

func projectBriefTemplateFuncs() template.FuncMap {
	return template.FuncMap{
		"overviewProjectBrief": RenderOverviewProjectBriefPrompt,
		"truncate":             projectBriefTemplateTruncate,
	}
}

func projectBriefTemplateTruncate(content string, maxBytes int) string {
	truncated, _ := textutil.TruncateUTF8(content, maxBytes)
	return truncated
}
