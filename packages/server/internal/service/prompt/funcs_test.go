package prompt

import (
	"strings"
	"testing"
)

func TestMdFenceSelectsSafeFence(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{name: "empty", content: "", want: "```"},
		{name: "single backtick", content: "`code`", want: "```"},
		{name: "triple backticks", content: "```markdown\nbody\n```", want: "````"},
		{name: "four backticks", content: "````\nbody\n````", want: "`````"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := mdFence(test.content); got != test.want {
				t.Fatalf("mdFence() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestTruncatePromptContent(t *testing.T) {
	tests := []struct {
		name    string
		content string
		max     int
		want    string
	}{
		{name: "empty", content: "", max: 8, want: ""},
		{name: "exact", content: "1234", max: 4, want: "1234"},
		{name: "ascii", content: "123456", max: 4, want: "1234\n\n...(已截断 2 字节)"},
		{name: "utf8 safe", content: "你好世界", max: 7, want: "你好\n\n...(已截断 6 字节)"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := truncatePromptContent("test_section", test.content, test.max)
			if got != test.want {
				t.Fatalf("truncatePromptContent() = %q, want %q", got, test.want)
			}
			if !strings.Contains(got, "\ufffd") {
				return
			}
			t.Fatalf("truncatePromptContent() produced replacement rune: %q", got)
		})
	}
}
