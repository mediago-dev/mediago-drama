// Package workspaceevent provides live workspace change notifications.
package workspaceevent

import (
	"log/slog"
	"sync"
)

// Event types published by the workspace file watcher.
const (
	ConnectedEventType        = "workspace.connected"
	DocumentsChangedEventType = "workspace.documents.changed"
)

// BufferSize is the live event channel buffer size.
const BufferSize = 128

// Event is a live workspace notification payload.
type Event struct {
	ID        string `json:"id,omitempty"`
	Type      string `json:"type"`
	ProjectID string `json:"projectId,omitempty"`
	Message   string `json:"message,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
}

// Broker fans out live workspace events to subscribers.
type Broker struct {
	mu          sync.RWMutex
	subscribers map[chan Event]struct{}
}

// NewBroker returns an initialized workspace event broker.
func NewBroker() *Broker {
	return &Broker{subscribers: map[chan Event]struct{}{}}
}

// Subscribe subscribes to live workspace events.
func (broker *Broker) Subscribe() (<-chan Event, func()) {
	events := make(chan Event, BufferSize)

	broker.mu.Lock()
	broker.subscribers[events] = struct{}{}
	subscriberCount := len(broker.subscribers)
	broker.mu.Unlock()
	slog.Debug("workspace event subscriber added", "subscribers", subscriberCount, "buffer_size", cap(events))

	return events, func() {
		broker.mu.Lock()
		delete(broker.subscribers, events)
		subscriberCount := len(broker.subscribers)
		broker.mu.Unlock()
		slog.Debug("workspace event subscriber removed", "subscribers", subscriberCount)
	}
}

// Publish publishes one workspace event.
func (broker *Broker) Publish(event Event) {
	broker.mu.RLock()
	defer broker.mu.RUnlock()

	for subscriber := range broker.subscribers {
		select {
		case subscriber <- event:
		default:
			slog.Warn("workspace event dropped", "type", event.Type, "project_id", event.ProjectID)
		}
	}
}
