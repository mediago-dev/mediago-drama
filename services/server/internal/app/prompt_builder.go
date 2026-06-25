package app

import serviceprompt "github.com/mediago-dev/mediago-drama/services/server/internal/service/prompt"

func buildACPPrompt(request agentRunRequest) string {
	return buildACPPromptWithMaxSectionChars(request, 0)
}

func buildACPPromptWithMaxSectionChars(request agentRunRequest, maxSectionChars int) string {
	return serviceprompt.BuildACPPrompt(request, promptBuildOptionsWithMaxSectionChars(request, maxSectionChars))
}

func promptBuildOptionsWithMaxSectionChars(_ agentRunRequest, maxSectionChars int) serviceprompt.PromptBuildOptions {
	return serviceprompt.PromptBuildOptions{
		MaxSectionChars: maxSectionChars,
	}
}
