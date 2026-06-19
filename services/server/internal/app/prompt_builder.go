package app

import (
	"strings"

	appworkspace "github.com/mediago-dev/mediago-drama/services/server/internal/app/workspace"
	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	servicedocument "github.com/mediago-dev/mediago-drama/services/server/internal/service/document"
	serviceprompt "github.com/mediago-dev/mediago-drama/services/server/internal/service/prompt"
)

type PromptSection = serviceprompt.PromptSection

type promptContext = serviceprompt.PromptContext

func buildACPPrompt(request agentRunRequest) string {
	return buildACPPromptWithMaxSectionChars(request, 0)
}

func buildACPPromptWithMaxSectionChars(request agentRunRequest, maxSectionChars int) string {
	return serviceprompt.BuildACPPrompt(request, promptBuildOptionsWithMaxSectionChars(request, maxSectionChars))
}

func newPromptContext(request agentRunRequest) promptContext {
	return serviceprompt.NewPromptContext(request, promptBuildOptions(request))
}

func promptBuildOptions(request agentRunRequest) serviceprompt.PromptBuildOptions {
	return promptBuildOptionsWithMaxSectionChars(request, 0)
}

func promptBuildOptionsWithMaxSectionChars(request agentRunRequest, maxSectionChars int) serviceprompt.PromptBuildOptions {
	return serviceprompt.PromptBuildOptions{
		ScopedEdit:       serviceagent.ResolveAgentScopedEdit(request),
		OverviewMarkdown: loadPromptOverviewMarkdown(request),
		MaxSectionChars:  maxSectionChars,
	}
}

func loadPromptOverviewMarkdown(request agentRunRequest) string {
	if strings.TrimSpace(request.ProjectID) == "" || strings.TrimSpace(request.WorkspaceDir) == "" {
		return ""
	}
	store := appworkspace.NewStateService(request.WorkspaceDir)
	if store.InitErr() != nil {
		return ""
	}
	document, ok, err := store.GetWorkspaceDocument(request.ProjectID, servicedocument.OverviewDocumentID)
	if err != nil || !ok {
		return ""
	}
	return document.Content
}
