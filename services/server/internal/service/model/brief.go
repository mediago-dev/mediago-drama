package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"text/template"

	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/official"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/textutil"
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
	source := official.MustInstructionSection("AGENTS", "内部模板（代码读取）", "Project Brief 提示")
	tmpl, err := template.New("project_brief").Funcs(projectBriefTemplateFuncs()).Parse(source)
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
