package prompt

import (
	"fmt"
	"log/slog"
	"sort"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/model"
)

type AgentRunRequest = agent.AgentRunRequest
type AgentDocumentContext = agent.AgentDocumentContext
type AgentReference = agent.AgentReference
type ProjectBrief = model.ProjectBrief
type ProjectBriefUpdateMask = model.ProjectBriefUpdateMask

// DefaultMaxSectionChars caps each rendered prompt section by default.
const DefaultMaxSectionChars = 12000

// MediaGoDramaMCPToolName returns a fully qualified MediaGo Drama MCP tool name.
func MediaGoDramaMCPToolName(toolName string) string {
	return mediamcp.ToolName(toolName)
}

// PromptBuildOptions supplies fixed prompt rendering options.
type PromptBuildOptions struct {
	MaxSectionChars int
	Skills          []SkillDescriptor
}

// SkillDescriptor is the lightweight Skill metadata loaded when an Agent starts.
type SkillDescriptor struct {
	Name        string
	Description string
}

// BuildWorkspaceACPPrompt renders fixed ACP runtime instructions.
func BuildWorkspaceACPPrompt(request AgentRunRequest) string {
	return BuildACPPrompt(request, WorkspacePromptBuildOptions(request))
}

// WorkspacePromptBuildOptions returns the default fixed prompt options.
func WorkspacePromptBuildOptions(_ AgentRunRequest) PromptBuildOptions {
	return PromptBuildOptions{
		MaxSectionChars: DefaultMaxSectionChars,
	}
}

// BuildACPPrompt renders fixed runtime instructions for an ACP agent run.
func BuildACPPrompt(_ AgentRunRequest, options PromptBuildOptions) string {
	descriptors := SectionDescriptors()
	maxSectionChars := options.MaxSectionChars
	if maxSectionChars <= 0 {
		maxSectionChars = DefaultMaxSectionChars
	}

	var builder strings.Builder
	for _, descriptor := range descriptors {
		rendered, err := renderSection(descriptor.ID)
		if err != nil {
			slog.Error("prompt section render failed", "id", descriptor.ID, "err", err)
			rendered = fmt.Sprintf("<!-- prompt section %q render error -->", descriptor.ID)
		}
		text := strings.TrimRight(rendered, "\n")
		text = truncatePromptContent(descriptor.ID, text, maxSectionChars)
		if text == "" {
			continue
		}
		builder.WriteString(text)
		builder.WriteString("\n\n")
	}
	if skillIndex := renderSkillIndex(options.Skills); skillIndex != "" {
		builder.WriteString(truncatePromptContent("SKILLS", skillIndex, maxSectionChars))
		builder.WriteString("\n\n")
	}
	return strings.TrimRight(builder.String(), "\n") + "\n"
}

func renderSkillIndex(skills []SkillDescriptor) string {
	items := append([]SkillDescriptor(nil), skills...)
	sort.SliceStable(items, func(first, second int) bool {
		return strings.TrimSpace(items[first].Name) < strings.TrimSpace(items[second].Name)
	})

	var builder strings.Builder
	for _, item := range items {
		name := strings.TrimSpace(item.Name)
		description := strings.Join(strings.Fields(item.Description), " ")
		if name == "" || description == "" {
			continue
		}
		if builder.Len() == 0 {
			builder.WriteString("# 可用 Skills\n\n")
			builder.WriteString("Agent 启动时加载以下 Skill 索引。根据名称与描述判断当前任务需要的 Skill，再调用 MCP `load_skill` 装载正文；不要预先装载全部 Skill。\n\n")
		}
		builder.WriteString("- `")
		builder.WriteString(strings.ReplaceAll(name, "`", ""))
		builder.WriteString("`：")
		builder.WriteString(description)
		builder.WriteByte('\n')
	}
	return strings.TrimSpace(builder.String())
}

// TruncateAgentMessage truncates verbose agent messages for event and prompt metadata.
func TruncateAgentMessage(message string) string {
	const maxLength = 360
	if len(message) <= maxLength {
		return message
	}
	return message[:maxLength] + "..."
}
