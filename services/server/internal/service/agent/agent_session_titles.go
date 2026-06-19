package agent

import (
	"strings"
	"unicode"
)

const (
	agentSessionTitleMaxInputRunes = 1200
	agentSessionTitleMaxRunes      = 18
)

// AgentSessionTitlePrompt builds the text model prompt for session title generation.
func AgentSessionTitlePrompt(userPrompt string) string {
	prompt := truncateRunes(strings.TrimSpace(userPrompt), agentSessionTitleMaxInputRunes)
	return strings.TrimSpace(`请根据下面的用户任务，生成一个中文历史会话标题。

要求：
- 6 到 12 个中文字符优先
- 不要解释
- 不要引号
- 不要编号
- 不要句号、冒号等标点
- 只输出标题本身

用户任务：
` + prompt)
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
