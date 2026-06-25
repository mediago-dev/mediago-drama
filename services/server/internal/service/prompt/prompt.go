package prompt

import (
	"fmt"
	"log/slog"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/model"
	serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"
)

type AgentRunRequest = agent.AgentRunRequest
type AgentScopedEditContext = agent.AgentScopedEditContext
type AgentDocumentContext = agent.AgentDocumentContext
type AgentReference = agent.AgentReference
type ProjectBrief = model.ProjectBrief
type ProjectBriefUpdateMask = model.ProjectBriefUpdateMask

// DefaultMaxSectionChars caps each rendered prompt section by default.
const DefaultMaxSectionChars = 12000

var (
	ResolveAgentScopedEdit = agent.ResolveAgentScopedEdit
)

// MediaGoDramaMCPToolName returns a fully qualified MediaGo Drama MCP tool name.
func MediaGoDramaMCPToolName(toolName string) string {
	return mediamcp.ToolName(toolName)
}

// PromptSection renders one ACP prompt section from context.
type PromptSection func(ctx PromptContext) string

// PromptBuildOptions supplies dependencies and preloaded context for ACP prompt rendering.
type PromptBuildOptions struct {
	ScopedEdit       AgentScopedEditContext
	OverviewMarkdown string
	MaxSectionChars  int
}

// PromptContext is the immutable context passed to prompt sections.
type PromptContext struct {
	Request          AgentRunRequest
	ScopedEdit       AgentScopedEditContext
	OverviewMarkdown string
	MaxSectionChars  int
}

// BuildWorkspaceACPPrompt renders an ACP prompt with workspace-local context.
func BuildWorkspaceACPPrompt(request AgentRunRequest) string {
	return BuildACPPrompt(request, WorkspacePromptBuildOptions(request))
}

// WorkspacePromptBuildOptions resolves workspace-local prompt dependencies.
func WorkspacePromptBuildOptions(request AgentRunRequest) PromptBuildOptions {
	return PromptBuildOptions{
		ScopedEdit:       ResolveAgentScopedEdit(request),
		OverviewMarkdown: LoadPromptOverviewMarkdown(request),
		MaxSectionChars:  DefaultMaxSectionChars,
	}
}

// LoadPromptOverviewMarkdown loads the project Overview document for prompt context.
func LoadPromptOverviewMarkdown(request AgentRunRequest) string {
	for _, document := range request.Documents {
		if strings.TrimSpace(document.ID) == model.OverviewDocumentID {
			return document.Content
		}
	}
	return ""
}

// BuildACPPrompt renders the full system prompt for an ACP agent run.
func BuildACPPrompt(request AgentRunRequest, options PromptBuildOptions) string {
	ctx := NewPromptContext(request, options)
	descriptors := SectionDescriptors()

	var builder strings.Builder
	for _, descriptor := range descriptors {
		if descriptor.Condition != nil && !descriptor.Condition(ctx) {
			continue
		}
		data := any(ctx)
		if descriptor.DataFn != nil {
			data = descriptor.DataFn(ctx)
		}
		rendered, err := renderSection(descriptor.ID, data)
		if err != nil {
			slog.Error("prompt section render failed", "id", descriptor.ID, "err", err)
			rendered = fmt.Sprintf("<!-- prompt section %q render error -->", descriptor.ID)
		}
		text := rendered
		if descriptor.ID == "AGENTS" {
			if agentData, ok := data.(agentsMdData); ok {
				text = applyAgentsRuntimeData(text, agentData)
			}
		}
		text = strings.TrimRight(text, "\n")
		text = truncatePromptContent(descriptor.ID, text, ctx.MaxSectionChars)
		if text == "" {
			continue
		}
		builder.WriteString(text)
		builder.WriteString("\n\n")
	}
	if referencePrompt := renderReferenceIndexPrompt(ctx.Request); referencePrompt != "" {
		text := truncatePromptContent("REFERENCES", strings.TrimRight(referencePrompt, "\n"), ctx.MaxSectionChars)
		if text != "" {
			builder.WriteString(text)
			builder.WriteString("\n\n")
		}
	}
	if userPrompt := renderUserRequestPrompt(ctx); userPrompt != "" {
		builder.WriteString(userPrompt)
		builder.WriteString("\n\n")
	}
	return strings.TrimRight(builder.String(), "\n") + "\n"
}

// NewPromptContext builds the normalized prompt context from a request and options.
func NewPromptContext(request AgentRunRequest, options PromptBuildOptions) PromptContext {
	scopedEdit := options.ScopedEdit
	if isZeroAgentScopedEditContext(scopedEdit) {
		scopedEdit = ResolveAgentScopedEdit(request)
	}

	maxSectionChars := options.MaxSectionChars
	if maxSectionChars <= 0 {
		maxSectionChars = DefaultMaxSectionChars
	}

	return PromptContext{
		Request:          request,
		ScopedEdit:       scopedEdit,
		OverviewMarkdown: options.OverviewMarkdown,
		MaxSectionChars:  maxSectionChars,
	}
}

// TruncateAgentMessage truncates verbose agent messages for event and prompt metadata.
func TruncateAgentMessage(message string) string {
	const maxLength = 360
	if len(message) <= maxLength {
		return message
	}
	return message[:maxLength] + "..."
}

func activeAgentDocumentID(request AgentRunRequest) string {
	if request.Document != nil {
		return request.Document.ID
	}
	return ""
}

func isZeroAgentScopedEditContext(context AgentScopedEditContext) bool {
	return !context.Active &&
		strings.TrimSpace(context.AnchorText) == "" &&
		strings.TrimSpace(context.BlockMarkdown) == "" &&
		strings.TrimSpace(context.Instruction) == "" &&
		strings.TrimSpace(context.SelectionText) == "" &&
		len(context.Comments) == 0
}

func renderUserRequestPrompt(ctx PromptContext) string {
	prompt := strings.TrimSpace(ctx.Request.Prompt)
	if prompt == "" {
		return ""
	}
	template, ok := InstructionTemplateSection("TOOLS", "内部模板（代码读取）", "用户请求包裹模板")
	if !ok || strings.TrimSpace(template) == "" {
		return prompt
	}
	return renderPromptVariables(template, map[string]string{
		"UserPrompt": prompt,
	})
}

func applyAgentsRuntimeData(text string, data agentsMdData) string {
	text = replaceDefaultSystemPrompt(text, data.SystemPrompt)
	return appendSkillIndex(text, data.SkillIndex)
}

func replaceDefaultSystemPrompt(text string, systemPrompt string) string {
	systemPrompt = strings.TrimSpace(systemPrompt)
	if systemPrompt == "" {
		return text
	}
	return systemPrompt + "\n\n" + strings.TrimSpace(text)
}

func appendSkillIndex(text string, skills []serviceskill.SkillMeta) string {
	var builder strings.Builder
	builder.WriteString(strings.TrimRight(text, "\n"))
	if heading, ok := InstructionTemplateSection("AGENTS", "内部模板（代码读取）", "Skill 索引标题"); ok {
		builder.WriteString("\n\n")
		builder.WriteString(strings.TrimSpace(heading))
		builder.WriteString("\n")
	}
	if len(skills) == 0 {
		if empty, ok := InstructionTemplateSection("AGENTS", "内部模板（代码读取）", "空 Skill 提示"); ok {
			builder.WriteString(strings.TrimSpace(empty))
			builder.WriteString("\n")
		}
		return builder.String()
	}
	for _, skill := range skills {
		builder.WriteString("- ")
		builder.WriteString(skill.Name)
		builder.WriteString(": ")
		builder.WriteString(skill.Description)
		builder.WriteString("\n")
	}
	return builder.String()
}

func renderPromptVariables(template string, variables map[string]string) string {
	replacements := make([]string, 0, len(variables)*2)
	for key, value := range variables {
		replacements = append(replacements, "{{."+key+"}}", value)
	}
	return strings.TrimSpace(strings.NewReplacer(replacements...).Replace(template))
}
