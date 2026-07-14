package acp

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	acp "github.com/coder/acp-go-sdk"
)

type thoughtEventCollector struct {
	mu     sync.Mutex
	events []agentEvent
}

func (collector *thoughtEventCollector) publish(event agentEvent) {
	collector.mu.Lock()
	defer collector.mu.Unlock()
	collector.events = append(collector.events, event)
}

func (collector *thoughtEventCollector) snapshot() []agentEvent {
	collector.mu.Lock()
	defer collector.mu.Unlock()
	return append([]agentEvent(nil), collector.events...)
}

func sendThoughtChunk(t *testing.T, client *acpClient, text string) {
	t.Helper()
	if err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.UpdateAgentThoughtText(text),
	}); err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}
}

func sendThoughtChunkWithMessageID(t *testing.T, client *acpClient, messageID string, text string) {
	t.Helper()
	if err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.SessionUpdate{
			AgentThoughtChunk: &acp.SessionUpdateAgentThoughtChunk{
				Content:   acp.TextBlock(text),
				MessageId: &messageID,
			},
		},
	}); err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}
}

func TestACPClientCoalescesThoughtChunksUntilFlush(t *testing.T) {
	collector := &thoughtEventCollector{}
	client := &acpClient{publish: collector.publish}
	client.setAcceptingSessionUpdates(true)

	sendThoughtChunk(t, client, "用户")
	sendThoughtChunk(t, client, "只是打了个")
	sendThoughtChunk(t, client, "招呼")

	if events := collector.snapshot(); len(events) != 0 {
		t.Fatalf("events = %#v, want chunks buffered without publish", events)
	}

	client.flushThoughts()

	events := collector.snapshot()
	if len(events) != 1 {
		t.Fatalf("events = %d, want one merged thought event", len(events))
	}
	event := events[0]
	if event.Type != "agent.acp" || event.ACP == nil || event.ACP.Kind != "thought" {
		t.Fatalf("event = %#v, want merged thought event", event)
	}
	if event.ACP.Thought != "用户只是打了个招呼" {
		t.Fatalf("thought = %q, want merged chunk text", event.ACP.Thought)
	}

	client.flushThoughts()
	if events := collector.snapshot(); len(events) != 1 {
		t.Fatalf("events = %d, want repeated flush to publish nothing new", len(events))
	}
}

func TestACPClientPreservesThoughtMessageIdentityAcrossBufferedChunks(t *testing.T) {
	collector := &thoughtEventCollector{}
	client := &acpClient{publish: collector.publish, runID: "run-1"}
	client.setAcceptingSessionUpdates(true)

	sendThoughtChunkWithMessageID(t, client, "thought-1", "先读")
	sendThoughtChunkWithMessageID(t, client, "thought-1", "文档")
	client.flushThoughts()

	events := collector.snapshot()
	if len(events) != 1 {
		t.Fatalf("events = %#v, want one buffered thought item", events)
	}
	event := events[0]
	if event.TurnID != "run-1" || event.ItemID != "thought-1" || event.Phase != "commentary" {
		t.Fatalf("event semantics = %#v, want thought message identity", event)
	}
}

func TestACPClientFlushesThoughtsBeforeOtherEvents(t *testing.T) {
	collector := &thoughtEventCollector{}
	client := &acpClient{publish: collector.publish}
	client.setAcceptingSessionUpdates(true)

	sendThoughtChunk(t, client, "先看看 README")
	if err := client.SessionUpdate(context.Background(), acp.SessionNotification{
		Update: acp.StartToolCall("call-readme", "读取 README", acp.WithStartKind(acp.ToolKindRead)),
	}); err != nil {
		t.Fatalf("SessionUpdate returned error: %v", err)
	}

	events := collector.snapshot()
	if len(events) != 2 {
		t.Fatalf("events = %d, want thought flushed before tool call", len(events))
	}
	if events[0].ACP == nil || events[0].ACP.Kind != "thought" || events[0].ACP.Thought != "先看看 README" {
		t.Fatalf("first event = %#v, want buffered thought", events[0])
	}
	if events[1].ACP == nil || events[1].ACP.Kind != "toolCall" {
		t.Fatalf("second event = %#v, want tool call after thought", events[1])
	}
}

func TestACPClientFlushesThoughtsOnSizeThreshold(t *testing.T) {
	collector := &thoughtEventCollector{}
	client := &acpClient{publish: collector.publish}
	client.setAcceptingSessionUpdates(true)

	chunk := strings.Repeat("思", thoughtFlushMaxBytes)
	sendThoughtChunk(t, client, chunk)

	events := collector.snapshot()
	if len(events) != 1 {
		t.Fatalf("events = %d, want size threshold to flush immediately", len(events))
	}
	if events[0].ACP == nil || events[0].ACP.Thought != chunk {
		t.Fatalf("event = %#v, want flushed thought chunk", events[0])
	}
}

func TestACPClientFlushesThoughtsAfterInterval(t *testing.T) {
	collector := &thoughtEventCollector{}
	client := &acpClient{publish: collector.publish}
	client.setAcceptingSessionUpdates(true)

	sendThoughtChunk(t, client, "等待定时刷新")

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if events := collector.snapshot(); len(events) == 1 {
			if events[0].ACP == nil || events[0].ACP.Thought != "等待定时刷新" {
				t.Fatalf("event = %#v, want buffered thought", events[0])
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("buffered thought was not flushed by the interval timer")
}
