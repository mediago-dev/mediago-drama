package agent

import (
	"strings"
	"testing"
)

func TestNormalizeAgentSessionTitle(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "strips label quotes and punctuation",
			input: "标题：「整理素材清单。」",
			want:  "整理素材清单",
		},
		{
			name:  "uses first non-empty line",
			input: "\n\n雨夜追逐分镜\n说明：这个标题来自用户任务",
			want:  "雨夜追逐分镜",
		},
		{
			name:  "limits length",
			input: "这是一个特别特别特别长的历史会话标题名称",
			want:  "这是一个特别特别特别长的历史会话标题",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeAgentSessionTitle(tt.input); got != tt.want {
				t.Fatalf("normalizeAgentSessionTitle() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestAgentSessionTitlePromptTruncatesUserPrompt(t *testing.T) {
	prompt := AgentSessionTitlePrompt(strings.Repeat("镜头", 800))
	if len([]rune(prompt)) > agentSessionTitleMaxInputRunes+200 {
		t.Fatalf("prompt length = %d, want compact title prompt", len([]rune(prompt)))
	}
	if !strings.Contains(prompt, "只输出标题本身") {
		t.Fatalf("prompt = %q, want title-only instruction", prompt)
	}
}
