package acp

import (
	"context"
	"strings"
	"testing"

	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
)

func TestBuildACPSessionRecapKeepsChronologicalDialogueAndDecisions(t *testing.T) {
	recap := BuildACPSessionRecap([]serviceagent.AgentChatMessageRecord{
		{Role: "user", Content: "给林墨配一张图"},
		{Role: "assistant", Content: "已选定目标：林墨（高三·契约前），风格：Q版风格。", Kind: "message"},
		{Role: "system", Content: "internal marker"},
		{Role: "user", Content: "  "},
	}, "", []string{"〔确认生成参数〕张数 1 · 优化提示词 关"})
	if !strings.Contains(recap, "# 会话回顾") || !strings.Contains(recap, "## 已确认的决定") {
		t.Fatalf("recap = %q, want header and decisions section", recap)
	}
	if !strings.Contains(recap, "〔确认生成参数〕张数 1") {
		t.Fatalf("recap = %q, want decision line", recap)
	}
	if strings.Contains(recap, "internal marker") {
		t.Fatal("system messages must not be replayed")
	}
	first := strings.Index(recap, "给林墨配一张图")
	second := strings.Index(recap, "已选定目标")
	if first < 0 || second < 0 || first > second {
		t.Fatalf("recap dialogue order wrong: %q", recap)
	}
}

func TestBuildACPSessionRecapSkipsCurrentPromptOnce(t *testing.T) {
	// 当前这条用户消息在 run 启动前已进投影，只跳过最新一次出现；
	// 更早的相同文本（真实历史）仍应保留。
	recap := BuildACPSessionRecap([]serviceagent.AgentChatMessageRecord{
		{Role: "user", Content: "再生成一张"},
		{Role: "assistant", Content: "好的，已生成。", Kind: "message"},
		{Role: "user", Content: "再生成一张"},
	}, "再生成一张", nil)
	if got := strings.Count(recap, "再生成一张"); got != 1 {
		t.Fatalf("current prompt occurrences = %d, want 1 (only the historical one): %q", got, recap)
	}
}

func TestBuildACPSessionRecapFiltersNonDialogueKinds(t *testing.T) {
	recap := BuildACPSessionRecap([]serviceagent.AgentChatMessageRecord{
		{Role: "user", Content: "开始吧"},
		{Role: "assistant", Content: "状态：completed · 12 lines", Kind: "tool"},
		{Role: "assistant", Content: "运行日志……", Kind: "runtime"},
		{Role: "assistant", Content: "让我想想", Kind: "thought"},
		{Role: "assistant", Content: "需要你确认参数", Kind: "message", Metadata: map[string]any{"form": map[string]any{}}},
		{Role: "assistant", Content: "挂载失败", Kind: "message", Status: "error"},
		{Role: "assistant", Content: "这是真正的回复", Kind: "message"},
		{Role: "assistant", Content: "旧版无 kind 的回复"},
	}, "", nil)
	for _, banned := range []string{"状态：completed", "运行日志", "让我想想", "需要你确认参数", "挂载失败"} {
		if strings.Contains(recap, banned) {
			t.Fatalf("recap = %q, must not contain %q", recap, banned)
		}
	}
	if !strings.Contains(recap, "这是真正的回复") || !strings.Contains(recap, "旧版无 kind 的回复") {
		t.Fatalf("recap = %q, want real dialogue kept (incl. legacy empty kind)", recap)
	}
}

func TestBuildACPSessionRecapClipsAndBudgets(t *testing.T) {
	long := strings.Repeat("长", 900)
	messages := []serviceagent.AgentChatMessageRecord{}
	for i := 0; i < 30; i++ {
		messages = append(messages, serviceagent.AgentChatMessageRecord{Role: "assistant", Content: long, Kind: "message"})
	}
	messages = append(messages, serviceagent.AgentChatMessageRecord{Role: "user", Content: "最新的一句"})

	recap := BuildACPSessionRecap(messages, "", nil)
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
	if recap := BuildACPSessionRecap(nil, "", nil); recap != "" {
		t.Fatalf("recap = %q, want empty for no history", recap)
	}
	if recap := BuildACPSessionRecap([]serviceagent.AgentChatMessageRecord{{Role: "tool", Content: "x"}}, "", nil); recap != "" {
		t.Fatalf("recap = %q, want empty when only non-replayable roles", recap)
	}
}

func TestSessionRecapForIsNilSafe(t *testing.T) {
	runner := &acpAgentRunner{}
	if got := runner.sessionRecapFor(context.Background(), agentRunRequest{}); got != "" {
		t.Fatalf("recap = %q, want empty without builder", got)
	}
	runner.SetSessionRecapBuilder(func(context.Context, AgentRunRequest) string { return "  recap  " })
	if got := runner.sessionRecapFor(context.Background(), agentRunRequest{}); got != "recap" {
		t.Fatalf("recap = %q, want trimmed builder output", got)
	}
}
