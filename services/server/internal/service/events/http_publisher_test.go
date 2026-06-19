package events

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
)

func TestHTTPEventPublisherRetriesGuaranteedEvents(t *testing.T) {
	previousDelay := httpEventPublisherRetryDelay
	httpEventPublisherRetryDelay = 0
	defer func() {
		httpEventPublisherRetryDelay = previousDelay
	}()

	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		attempts++
		if attempts == 1 {
			http.Error(writer, "try again", http.StatusInternalServerError)
			return
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	publisher := NewHTTPEventPublisher(server.URL, "token")
	publisher.PublishEvent(AgentEvent{Type: "agent.message.completed"})

	if attempts != 2 {
		t.Fatalf("attempts = %d, want 2", attempts)
	}
}

func TestHTTPEventPublisherRetriesACPPermissionRequestEvents(t *testing.T) {
	previousDelay := httpEventPublisherRetryDelay
	httpEventPublisherRetryDelay = 0
	defer func() {
		httpEventPublisherRetryDelay = previousDelay
	}()

	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		attempts++
		if attempts == 1 {
			http.Error(writer, "try again", http.StatusInternalServerError)
			return
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	publisher := NewHTTPEventPublisher(server.URL, "token")
	publisher.PublishEvent(AgentEvent{
		Type: "agent.acp",
		ACP:  &serviceagent.AgentACPEvent{Kind: "permissionRequest"},
	})

	if attempts != 2 {
		t.Fatalf("attempts = %d, want 2", attempts)
	}
}

func TestHTTPEventPublisherDoesNotRetryBestEffortEvents(t *testing.T) {
	previousDelay := httpEventPublisherRetryDelay
	httpEventPublisherRetryDelay = 0
	defer func() {
		httpEventPublisherRetryDelay = previousDelay
	}()

	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		attempts++
		http.Error(writer, "try again", http.StatusInternalServerError)
	}))
	defer server.Close()

	publisher := NewHTTPEventPublisher(server.URL, "token")
	publisher.PublishEvent(AgentEvent{Type: "agent.activity"})

	if attempts != 1 {
		t.Fatalf("attempts = %d, want 1", attempts)
	}
}

func TestHTTPEventPublisherStopsRetryDelayWhenContextIsCancelled(t *testing.T) {
	previousDelay := httpEventPublisherRetryDelay
	httpEventPublisherRetryDelay = time.Hour
	defer func() {
		httpEventPublisherRetryDelay = previousDelay
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		attempts++
		cancel()
		http.Error(writer, "try again", http.StatusInternalServerError)
	}))
	defer server.Close()

	publisher := NewHTTPEventPublisher(server.URL, "token")
	startedAt := time.Now()
	publisher.PublishEventContext(ctx, AgentEvent{Type: "agent.message.completed"})

	if attempts != 1 {
		t.Fatalf("attempts = %d, want 1", attempts)
	}
	if elapsed := time.Since(startedAt); elapsed > time.Second {
		t.Fatalf("PublishEventContext took %s, want cancellation to skip retry delay", elapsed)
	}
}
