package prompt

import (
	"fmt"
	"log/slog"
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
	return strings.TrimRight(builder.String(), "\n") + "\n"
}

// TruncateAgentMessage truncates verbose agent messages for event and prompt metadata.
func TruncateAgentMessage(message string) string {
	const maxLength = 360
	if len(message) <= maxLength {
		return message
	}
	return message[:maxLength] + "..."
}
