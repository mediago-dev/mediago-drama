package openaichat

import (
	"io"
	"strings"
	"testing"
)

func TestStreamRecvParsesOpenAIChatChunks(t *testing.T) {
	body := io.NopCloser(strings.NewReader(strings.Join([]string{
		`data: {"choices":[{"delta":{"content":"hello "}}]}`,
		"",
		`data: {"choices":[{"delta":{"content":"world"}}]}`,
		"",
		`data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5,"prompt_tokens_details":{"cached_tokens":1},"completion_tokens_details":{"reasoning_tokens":2}}}`,
		"",
		`data: [DONE]`,
		"",
	}, "\n")))
	stream := NewStream(body)
	defer stream.Close()

	event, err := stream.Recv()
	if err != nil {
		t.Fatalf("Recv() error = %v", err)
	}
	if event.Delta != "hello " {
		t.Fatalf("delta = %q, want hello", event.Delta)
	}

	event, err = stream.Recv()
	if err != nil {
		t.Fatalf("Recv() second error = %v", err)
	}
	if event.Delta != "world" {
		t.Fatalf("second delta = %q, want world", event.Delta)
	}

	event, err = stream.Recv()
	if err != nil {
		t.Fatalf("Recv() usage error = %v", err)
	}
	if !event.Done || event.Usage == nil {
		t.Fatalf("usage event = %#v, want done usage", event)
	}
	if event.Usage.TotalTokens != 5 || event.Usage.CachedTokens != 1 || event.Usage.ReasoningTokens != 2 {
		t.Fatalf("usage = %#v", event.Usage)
	}

	if _, err = stream.Recv(); err != io.EOF {
		t.Fatalf("Recv() final error = %v, want EOF", err)
	}
}
