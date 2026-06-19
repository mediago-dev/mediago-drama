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
	ResolveAgentScopedEdit           = agent.ResolveAgentScopedEdit
	RenderOverviewProjectBriefPrompt = model.RenderOverviewProjectBriefPrompt
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
	return "用户请求：\n" + prompt
}

const defaultAgentIdentityBlock = `你是 MediaGo Drama 内的本地工作区 Agent。
帮助用户处理项目内的 Markdown 文档树。除非客户端文件系统请求明确且安全，否则不要直接编辑文件。
普通问候、闲聊或简单能力说明直接简短回复，不要做文档读写。`

func applyAgentsRuntimeData(text string, data agentsMdData) string {
	text = replaceDefaultSystemPrompt(text, data.SystemPrompt)
	return appendSkillIndex(text, data.SkillIndex)
}

func replaceDefaultSystemPrompt(text string, systemPrompt string) string {
	systemPrompt = strings.TrimSpace(systemPrompt)
	if systemPrompt == "" {
		return text
	}
	if strings.Contains(text, defaultAgentIdentityBlock) {
		return strings.Replace(text, defaultAgentIdentityBlock, systemPrompt, 1)
	}
	return systemPrompt + "\n\n" + strings.TrimSpace(text)
}

func appendSkillIndex(text string, skills []serviceskill.SkillMeta) string {
	var builder strings.Builder
	builder.WriteString(strings.TrimRight(text, "\n"))
	builder.WriteString("\n\n当前可用 Skill：\n")
	if len(skills) == 0 {
		builder.WriteString("- 暂无可用 Skill\n")
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
