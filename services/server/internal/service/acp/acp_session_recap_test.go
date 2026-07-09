package acp

import (
	"strings"
	"testing"

	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
)

func TestBuildACPSessionRecapKeepsChronologicalUserAssistantMessages(t *testing.T) {
	recap := BuildACPSessionRecap([]serviceagent.AgentChatMessageRecord{
		{Role: "user", Content: "给林墨配一张图"},
		{Role: "assistant", Content: "已选定目标：林墨（高三·契约前），风格：Q版风格。"},
		{Role: "system", Content: "internal marker"},
		{Role: "user", Content: "  "},
		{Role: "user", Content: "只用生成1张就行，不开启提示词优化"},
	})
	if !strings.Contains(recap, "# 会话回顾") {
		t.Fatalf("recap = %q, want header", recap)
	}
	if strings.Contains(recap, "internal marker") {
		t.Fatal("system messages must not be replayed")
	}
	first := strings.Index(recap, "给林墨配一张图")
	second := strings.Index(recap, "已选定目标")
	third := strings.Index(recap, "只用生成1张")
	if first < 0 || second < 0 || third < 0 || !(first < second && second < third) {
		t.Fatalf("recap order wrong: %q", recap)
	}
}

func TestBuildACPSessionRecapClipsAndBudgets(t *testing.T) {
	long := strings.Repeat("长", 900)
	messages := []serviceagent.AgentChatMessageRecord{}
	for i := 0; i < 30; i++ {
		messages = append(messages, serviceagent.AgentChatMessageRecord{Role: "assistant", Content: long})
	}
	messages = append(messages, serviceagent.AgentChatMessageRecord{Role: "user", Content: "最新的一句"})

	recap := BuildACPSessionRecap(messages)
	if !strings.Contains(recap, "最新的一句") {
		t.Fatal("newest message must survive the budget")
	}
	if got := len([]rune(recap)); got > recapTotalRuneBudget+300 {
		t.Fatalf("recap runes = %d, want bounded by budget", got)
	}
	if !strings.Contains(recap, "…") {
		t.Fatal("long messages should be clipped with an ellipsis")
	}
}

func TestBuildACPSessionRecapEmptyWhenNothingReplayable(t *testing.T) {
	if recap := BuildACPSessionRecap(nil); recap != "" {
		t.Fatalf("recap = %q, want empty for no history", recap)
	}
	if recap := BuildACPSessionRecap([]serviceagent.AgentChatMessageRecord{{Role: "tool", Content: "x"}}); recap != "" {
		t.Fatalf("recap = %q, want empty when only non-replayable roles", recap)
	}
}

func TestSessionRecapForIsNilSafe(t *testing.T) {
	runner := &acpAgentRunner{}
	if got := runner.sessionRecapFor(agentRunRequest{}); got != "" {
		t.Fatalf("recap = %q, want empty without builder", got)
	}
	runner.SetSessionRecapBuilder(func(agentRunRequest) string { return "  recap  " })
	if got := runner.sessionRecapFor(agentRunRequest{}); got != "recap" {
		t.Fatalf("recap = %q, want trimmed builder output", got)
	}
}
