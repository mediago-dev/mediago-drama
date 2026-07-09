package acp

import (
	"strings"

	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
)

// Session-recap size bounds: each replayed message is clipped to
// recapMessageRuneLimit runes and the recap keeps the newest messages that fit
// within recapTotalRuneBudget, so a long conversation cannot blow up the
// prompt of the rebuilt session.
const (
	recapMessageRuneLimit = 400
	recapTotalRuneBudget  = 3500
)

// SetSessionRecapBuilder installs the conversation-history source used when a
// continuation run cannot reuse its previous ACP session (model switch, dead
// upstream session): the rebuilt session would otherwise start from only the
// latest user message and lose every earlier confirmation.
func (runner *acpAgentRunner) SetSessionRecapBuilder(build func(AgentRunRequest) string) {
	if runner == nil {
		return
	}
	runner.buildSessionRecap = build
}

func (runner *acpAgentRunner) sessionRecapFor(request agentRunRequest) string {
	if runner == nil || runner.buildSessionRecap == nil {
		return ""
	}
	return strings.TrimSpace(runner.buildSessionRecap(request))
}

// BuildACPSessionRecap formats recent chat history as a prompt preamble for a
// rebuilt ACP session. It keeps user and assistant text messages (newest
// backwards within the rune budget), clips each one, and returns "" when
// there is nothing worth replaying.
func BuildACPSessionRecap(messages []serviceagent.AgentChatMessageRecord) string {
	lines := []string{}
	total := 0
	for index := len(messages) - 1; index >= 0; index-- {
		message := messages[index]
		role := recapRoleLabel(message.Role)
		content := strings.TrimSpace(message.Content)
		if role == "" || content == "" {
			continue
		}
		line := "- " + role + "：" + clipRecapRunes(content, recapMessageRuneLimit)
		length := len([]rune(line))
		if total+length > recapTotalRuneBudget {
			break
		}
		total += length
		lines = append(lines, line)
	}
	if len(lines) == 0 {
		return ""
	}
	// The walk collected newest-first; replay in chronological order.
	for left, right := 0, len(lines)-1; left < right; left, right = left+1, right-1 {
		lines[left], lines[right] = lines[right], lines[left]
	}
	header := []string{
		"# 会话回顾",
		"ACP 会话已重建，以下是本会话此前的对话记录（最近若干条，可能截断）。",
		"其中已完成的选择、确认和决定继续有效，直接沿用，不要重复询问用户。",
		"",
	}
	return strings.Join(append(header, lines...), "\n")
}

func recapRoleLabel(role string) string {
	switch strings.TrimSpace(role) {
	case "user":
		return "用户"
	case "assistant":
		return "助手"
	default:
		return ""
	}
}

func clipRecapRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}
