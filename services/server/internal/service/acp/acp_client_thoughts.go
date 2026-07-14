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
func (client *acpClient) bufferThought(text string, itemID string) {
	if text == "" {
		return
	}

	flushed := []bufferedThought{}
	client.thoughtMu.Lock()
	itemID = strings.TrimSpace(itemID)
	if itemID != "" && client.thoughtItemID != "" && client.thoughtItemID != itemID {
		flushed = append(flushed, client.takeThoughtsLocked(false))
	}
	if itemID != "" {
		client.thoughtItemID = itemID
	}
	if client.thoughtItemID == "" {
		client.thoughtItemID = MustRandomID("thought")
	}
	client.thoughtBuf.WriteString(text)
	if client.thoughtBuf.Len() >= thoughtFlushMaxBytes {
		flushed = append(flushed, client.takeThoughtsLocked(false))
	} else if client.thoughtTimer == nil {
		client.thoughtTimer = time.AfterFunc(thoughtFlushInterval, client.flushThoughts)
	}
	client.thoughtMu.Unlock()

	for _, thought := range flushed {
		client.publishThought(thought)
	}
}

// flushThoughts publishes buffered text while keeping the current item open for
// later chunks from the timer or size-threshold path.
func (client *acpClient) flushThoughts() {
	client.thoughtMu.Lock()
	flushed := client.takeThoughtsLocked(false)
	client.thoughtMu.Unlock()

	client.publishThought(flushed)
}

// finishThoughts publishes buffered text and closes the current thought item
// before a different event kind or prompt boundary.
func (client *acpClient) finishThoughts() {
	client.thoughtMu.Lock()
	flushed := client.takeThoughtsLocked(true)
	client.thoughtMu.Unlock()

	client.publishThought(flushed)
}

type bufferedThought struct {
	text   string
	itemID string
}

func (client *acpClient) takeThoughtsLocked(resetItem bool) bufferedThought {
	if client.thoughtTimer != nil {
		client.thoughtTimer.Stop()
		client.thoughtTimer = nil
	}
	thought := bufferedThought{
		text:   client.thoughtBuf.String(),
		itemID: client.thoughtItemID,
	}
	client.thoughtBuf.Reset()
	if resetItem {
		client.thoughtItemID = ""
	}
	return thought
}

func (client *acpClient) publishThought(thought bufferedThought) {
	if strings.TrimSpace(thought.text) == "" {
		return
	}
	client.publishEvent(agentEvent{
		Type:    "agent.acp",
		Message: "思考：" + TruncateAgentMessage(thought.text),
		ItemID:  thought.itemID,
		ACP: &agentACPEvent{
			Kind:    "thought",
			Thought: thought.text,
		},
	})
}
