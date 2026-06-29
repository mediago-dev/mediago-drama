package workspaceevent

import (
	"reflect"
	"testing"
	"time"
)

func TestBrokerPublishesEventsToSubscribers(t *testing.T) {
	broker := NewBroker()
	events, unsubscribe := broker.Subscribe()
	defer unsubscribe()

	want := Event{ID: "event-1", Type: DocumentsChangedEventType, ProjectID: "project-a"}
	broker.Publish(want)

	select {
	case got := <-events:
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("event = %#v, want %#v", got, want)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for workspace event")
	}
}

func TestBrokerUnsubscribeRemovesSubscriber(t *testing.T) {
	broker := NewBroker()
	events, unsubscribe := broker.Subscribe()
	unsubscribe()

	if len(broker.subscribers) != 0 {
		t.Fatalf("subscribers = %d, want 0 after unsubscribe", len(broker.subscribers))
	}
	broker.Publish(Event{ID: "event-1", Type: DocumentsChangedEventType})

	select {
	case event := <-events:
		t.Fatalf("received event after unsubscribe: %#v", event)
	default:
	}
}

func TestBrokerDropsEventsForFullSlowSubscriber(t *testing.T) {
	broker := NewBroker()
	events, unsubscribe := broker.Subscribe()
	defer unsubscribe()

	for index := 0; index < BufferSize; index++ {
		broker.Publish(Event{ID: "event", Type: DocumentsChangedEventType})
	}
	if got := len(events); got != BufferSize {
		t.Fatalf("buffered events = %d, want %d", got, BufferSize)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		broker.Publish(Event{ID: "dropped", Type: DocumentsChangedEventType})
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Publish blocked on a full slow subscriber")
	}
	if got := len(events); got != BufferSize {
		t.Fatalf("buffered events after drop = %d, want %d", got, BufferSize)
	}
}
