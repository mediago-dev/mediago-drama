package agent

import (
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

func TestHasAgentMessageWork(t *testing.T) {
	tests := []struct {
		name    string
		payload AgentMessageRequest
		want    bool
	}{
		{
			name:    "empty message",
			payload: AgentMessageRequest{},
			want:    false,
		},
		{
			name: "prompt",
			payload: AgentMessageRequest{
				Prompt: "帮我改写",
			},
			want: true,
		},
		{
			name: "references",
			payload: AgentMessageRequest{
				References: []AgentReference{
					{
						Kind:       "section",
						DocumentID: "doc-1",
						BlockID:    "section-1",
						Title:      "林武",
						Category:   "character",
					},
				},
			},
			want: true,
		},
		{
			name: "unresolved comment",
			payload: AgentMessageRequest{
				Comments: []mediamcp.DocumentComment{{Resolved: false}},
			},
			want: true,
		},
		{
			name: "resolved comment",
			payload: AgentMessageRequest{
				Comments: []mediamcp.DocumentComment{{Resolved: true}},
			},
			want: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := HasAgentMessageWork(test.payload); got != test.want {
				t.Fatalf("HasAgentMessageWork() = %v, want %v", got, test.want)
			}
		})
	}
}
