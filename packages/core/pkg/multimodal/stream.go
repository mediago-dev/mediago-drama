package multimodal

import (
	"errors"
	"io"
	"sync"
)

// StreamEventType classifies an incremental provider event.
type StreamEventType string

const (
	// StreamEventStatus reports a non-content state change.
	StreamEventStatus StreamEventType = "status"
	// StreamEventMessageDelta carries a partial model message.
	StreamEventMessageDelta StreamEventType = "message_delta"
	// StreamEventToolCall carries a partial or complete tool call.
	StreamEventToolCall StreamEventType = "tool_call"
	// StreamEventToolResult carries tool execution output.
	StreamEventToolResult StreamEventType = "tool_result"
	// StreamEventError carries a provider or tool error.
	StreamEventError StreamEventType = "error"
	// StreamEventDone marks the stream as complete.
	StreamEventDone StreamEventType = "done"
)

// StreamEvent is the normalized event emitted by streaming providers.
type StreamEvent struct {
	Type       StreamEventType
	Message    *Message
	Delta      string
	ToolCall   *ToolCall
	ToolResult *ToolResult
	Usage      *Usage
	Error      string
	Metadata   map[string]any
}

// StreamReader consumes normalized provider stream events.
type StreamReader struct {
	recv  func() (StreamEvent, error)
	close func() error
	once  sync.Once
	err   error
}

// NewStreamReader creates a StreamReader from adapter-provided receive and close hooks.
func NewStreamReader(recv func() (StreamEvent, error), closeFunc func() error) *StreamReader {
	if recv == nil {
		recv = func() (StreamEvent, error) {
			return StreamEvent{}, io.EOF
		}
	}

	return &StreamReader{
		recv:  recv,
		close: closeFunc,
	}
}

// Recv returns the next stream event.
func (reader *StreamReader) Recv() (StreamEvent, error) {
	if reader == nil || reader.recv == nil {
		return StreamEvent{}, io.EOF
	}

	return reader.recv()
}

// Close releases stream resources.
func (reader *StreamReader) Close() error {
	if reader == nil {
		return nil
	}

	reader.once.Do(func() {
		if reader.close != nil {
			reader.err = reader.close()
		}
	})

	return reader.err
}

// StreamFromEvents creates a reader from an in-memory event slice.
func StreamFromEvents(events []StreamEvent) *StreamReader {
	index := 0

	return NewStreamReader(func() (StreamEvent, error) {
		if index >= len(events) {
			return StreamEvent{}, io.EOF
		}

		event := events[index]
		index++
		if event.Type == "" {
			return event, errors.New("stream event type is empty")
		}

		return event, nil
	}, nil)
}
