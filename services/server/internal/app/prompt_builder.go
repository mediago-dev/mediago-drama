package app

import (
	"context"
	"log/slog"

	serviceprompt "github.com/mediago-dev/mediago-drama/services/server/internal/service/prompt"
	serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"
)

func buildACPPrompt(request agentRunRequest) string {
	return buildACPPromptWithMaxSectionChars(request, 0)
}

func buildACPPromptWithMaxSectionChars(request agentRunRequest, maxSectionChars int) string {
	return serviceprompt.BuildACPPrompt(request, promptBuildOptionsWithMaxSectionChars(request, maxSectionChars))
}

func promptBuildOptionsWithMaxSectionChars(_ agentRunRequest, maxSectionChars int) serviceprompt.PromptBuildOptions {
	skills, err := serviceskill.NewRegistry().List(context.Background())
	if err != nil {
		slog.Warn("agent skill index unavailable", "error", err)
	}
	descriptors := make([]serviceprompt.SkillDescriptor, 0, len(skills))
	for _, skill := range skills {
		descriptors = append(descriptors, serviceprompt.SkillDescriptor{
			Name:        skill.Name,
			Description: skill.Description,
		})
	}
	return serviceprompt.PromptBuildOptions{
		MaxSectionChars: maxSectionChars,
		Skills:          descriptors,
	}
}
