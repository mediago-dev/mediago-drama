package acp

import (
	"context"
	"slices"
	"strings"

	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
)

// SessionRecapBuilder loads and formats the conversation recap for a run. It
// takes the run context so a cancelled run does not keep blocking on the
// underlying chat-history read.
type SessionRecapBuilder func(ctx context.Context, request AgentRunRequest) string

// Session-recap size bounds: each replayed line is clipped to
// recapMessageRuneLimit runes and the recap keeps the newest lines that fit
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
func (runner *acpAgentRunner) SetSessionRecapBuilder(build SessionRecapBuilder) {
	if runner == nil {
		return
	}
	runner.buildSessionRecap = build
}

func (runner *acpAgentRunner) sessionRecapFor(ctx context.Context, request agentRunRequest) string {
	if runner == nil || runner.buildSessionRecap == nil {
		return ""
	}
	return strings.TrimSpace(runner.buildSessionRecap(ctx, request))
}

// BuildACPSessionRecap formats a prompt preamble for a rebuilt ACP session:
// the user's confirmed decisions (highest priority) plus recent real dialogue.
// currentPrompt is the message being submitted in this very run — the chat
// projection already contains it, so its newest occurrence is excluded to
// avoid the model reading the live request as settled history. Returns ""
// when there is nothing worth replaying.
func BuildACPSessionRecap(
	messages []serviceagent.AgentChatMessageRecord,
	currentPrompt string,
	decisionLines []string,
) string {
	budget := recapTotalRuneBudget

	decisions := []string{}
	for _, line := range decisionLines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		entry := "- " + clipRecapRunes(line, recapMessageRuneLimit)
		length := len([]rune(entry))
		if budget-length < 0 {
			break
		}
		budget -= length
		decisions = append(decisions, entry)
	}

	dialogue := []string{}
	skippedCurrentPrompt := false
	currentPrompt = strings.TrimSpace(currentPrompt)
	for index := len(messages) - 1; index >= 0; index-- {
		message := messages[index]
		if !isRecapDialogueMessage(message) {
			continue
		}
		content := strings.TrimSpace(message.Content)
		// The just-submitted prompt is persisted before the run starts; replay
		// only its PRIOR occurrences so the live request isn't duplicated as
		// already-settled history.
		if !skippedCurrentPrompt && message.Role == "user" && currentPrompt != "" && content == currentPrompt {
			skippedCurrentPrompt = true
			continue
		}
		line := "- " + recapRoleLabel(message.Role) + "：" + clipRecapRunes(content, recapMessageRuneLimit)
		length := len([]rune(line))
		if budget-length < 0 {
			break
		}
		budget -= length
		dialogue = append(dialogue, line)
	}
	// The walk collected newest-first; replay in chronological order.
	slices.Reverse(dialogue)

	if len(decisions) == 0 && len(dialogue) == 0 {
		return ""
	}
	sections := []string{
		"# 会话回顾",
		"ACP 会话已重建，以下是本会话此前的对话与已确认的决定（最近若干条，可能截断）。",
		"其中的决定继续有效，直接沿用，不要重复询问用户。",
	}
	if len(decisions) > 0 {
		sections = append(sections, "", "## 已确认的决定")
		sections = append(sections, decisions...)
	}
	if len(dialogue) > 0 {
		sections = append(sections, "", "## 此前对话")
		sections = append(sections, dialogue...)
	}
	return strings.Join(sections, "\n")
}

// isRecapDialogueMessage keeps only real dialogue: the projection also stores
// tool summaries, runtime logs, thoughts and plans as assistant-role records
// (kinds tool/runtime/thought/plan/...), and interactive-card placeholders
// carry a2ui/form metadata — none of that belongs in a context recap.
func isRecapDialogueMessage(message serviceagent.AgentChatMessageRecord) bool {
	if recapRoleLabel(message.Role) == "" || strings.TrimSpace(message.Content) == "" {
		return false
	}
	kind := strings.TrimSpace(message.Kind)
	if kind != "" && kind != "message" {
		return false
	}
	if message.Status == "error" {
		return false
	}
	if message.Metadata != nil {
		if _, ok := message.Metadata["a2ui"]; ok {
			return false
		}
		if _, ok := message.Metadata["form"]; ok {
			return false
		}
	}
	return true
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
