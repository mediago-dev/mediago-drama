package acp

import (
	"strings"
	"time"
)

const (
	// thoughtFlushInterval bounds how long buffered thought text may stay
	// hidden from the UI when no other event forces a flush.
	thoughtFlushInterval = 250 * time.Millisecond
	// thoughtFlushMaxBytes flushes long thinking streams in readable blocks
	// instead of one event per token-level chunk.
	thoughtFlushMaxBytes = 2048
)

// bufferThought coalesces token-level thought chunks into larger blocks before
// publishing. Each published event costs persistence, SSE fan-out, and a
// frontend store update, so per-chunk publishing floods the whole pipeline.
func (client *acpClient) bufferThought(text string) {
	if text == "" {
		return
	}

	var flushed string
	client.thoughtMu.Lock()
	client.thoughtBuf.WriteString(text)
	if client.thoughtBuf.Len() >= thoughtFlushMaxBytes {
		flushed = client.takeThoughtsLocked()
	} else if client.thoughtTimer == nil {
		client.thoughtTimer = time.AfterFunc(thoughtFlushInterval, client.flushThoughts)
	}
	client.thoughtMu.Unlock()

	client.publishThought(flushed)
}

// flushThoughts publishes any buffered thought text. Callers publishing other
// event kinds flush first so event ordering matches the agent's output.
func (client *acpClient) flushThoughts() {
	client.thoughtMu.Lock()
	flushed := client.takeThoughtsLocked()
	client.thoughtMu.Unlock()

	client.publishThought(flushed)
}

func (client *acpClient) takeThoughtsLocked() string {
	if client.thoughtTimer != nil {
		client.thoughtTimer.Stop()
		client.thoughtTimer = nil
	}
	text := client.thoughtBuf.String()
	client.thoughtBuf.Reset()
	return text
}

func (client *acpClient) publishThought(text string) {
	if strings.TrimSpace(text) == "" {
		return
	}
	client.publish(agentEvent{
		Type:    "agent.acp",
		Message: "思考：" + TruncateAgentMessage(text),
		ACP: &agentACPEvent{
			Kind:    "thought",
			Thought: text,
		},
	})
}
