package agent

import (
	"strings"
	"unicode"

	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/official"
)

const (
	agentSessionTitleMaxInputRunes = 1200
	agentSessionTitleMaxRunes      = 18
)

// AgentSessionTitlePrompt builds the text model prompt for session title generation.
func AgentSessionTitlePrompt(userPrompt string) string {
	prompt := truncateRunes(strings.TrimSpace(userPrompt), agentSessionTitleMaxInputRunes)
	template := official.MustInstructionSection("AGENTS", "内部模板（代码读取）", "历史会话标题")
	return renderAgentPromptVariables(template, map[string]string{
		"UserPrompt": prompt,
	})
}

func normalizeAgentSessionTitle(value string) string {
	title := firstNonEmptyLine(strings.TrimSpace(value))
	title = strings.TrimSpace(strings.TrimPrefix(title, "标题"))
	title = strings.TrimLeftFunc(title, func(r rune) bool {
		return unicode.IsSpace(r) || strings.ContainsRune(":：-—「」『』《》[]()（）", r)
	})
	title = strings.Trim(title, "`\"'“”‘’「」『』《》[]()（） \t\r\n")
	title = strings.Join(strings.Fields(title), " ")
	title = strings.TrimRightFunc(title, func(r rune) bool {
		return unicode.IsSpace(r) || strings.ContainsRune("。！？?!，,；;：:、.", r)
	})
	title = truncateRunes(title, agentSessionTitleMaxRunes)
	title = strings.TrimRightFunc(title, func(r rune) bool {
		return unicode.IsSpace(r) || strings.ContainsRune("。！？?!，,；;：:、.", r)
	})
	return title
}

func firstNonEmptyLine(value string) string {
	for _, line := range strings.Split(value, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			return line
		}
	}
	return ""
}

func truncateRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func renderAgentPromptVariables(template string, variables map[string]string) string {
	replacements := make([]string, 0, len(variables)*2)
	for key, value := range variables {
		replacements = append(replacements, "{{."+key+"}}", value)
	}
	return strings.TrimSpace(strings.NewReplacer(replacements...).Replace(template))
}
