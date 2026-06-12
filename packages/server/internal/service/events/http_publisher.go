package events

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

type HTTPEventPublisher struct {
	baseURL string
	token   string
	client  *http.Client
}

var (
	httpEventPublisherRetryDelay     = 100 * time.Millisecond
	httpEventPublisherPublishTimeout = 3 * time.Second
)

// NewHTTPEventPublisher returns an internal event publisher.
func NewHTTPEventPublisher(baseURL string, token string) *HTTPEventPublisher {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	token = strings.TrimSpace(token)
	if baseURL == "" || token == "" {
		return nil
	}
	return &HTTPEventPublisher{
		baseURL: baseURL,
		token:   token,
		client:  &http.Client{Timeout: 750 * time.Millisecond},
	}
}

// PublishEvent publishes an event to the internal API.
func (publisher *HTTPEventPublisher) PublishEvent(event AgentEvent) {
	ctx, cancel := context.WithTimeout(context.Background(), httpEventPublisherPublishTimeout)
	defer cancel()
	publisher.PublishEventContext(ctx, event)
}

// PublishEventContext publishes an event to the internal API with cancellation.
func (publisher *HTTPEventPublisher) PublishEventContext(ctx context.Context, event AgentEvent) {
	if ctx == nil {
		ctx = context.Background()
	}
	if publisher.client == nil {
		return
	}
	payload, err := json.Marshal(event)
	if err != nil {
		slog.Warn("internal event publish encode failed", "type", event.Type, "error", err)
		return
	}

	attempts := 1
	if IsGuaranteedAgentEventPayload(event) {
		attempts = 3
	}
	for attempt := 1; attempt <= attempts; attempt++ {
		if ctx.Err() != nil {
			return
		}
		request, err := publisher.newRequest(ctx, payload)
		if err != nil {
			slog.Warn("internal event publish request creation failed", "type", event.Type, "error", err)
			return
		}
		status, err := publisher.publishRequest(request)
		if err == nil && status >= http.StatusOK && status < http.StatusMultipleChoices {
			return
		}
		if err == nil && status < http.StatusInternalServerError {
			slog.Warn("internal event publish rejected", "type", event.Type, "status", status)
			return
		}
		if attempt == attempts {
			if err != nil {
				slog.Warn("internal event publish request failed", "type", event.Type, "attempts", attempts, "error", err)
			} else {
				slog.Warn("internal event publish rejected", "type", event.Type, "attempts", attempts, "status", status)
			}
			return
		}
		if httpEventPublisherRetryDelay > 0 {
			timer := time.NewTimer(httpEventPublisherRetryDelay)
			select {
			case <-timer.C:
			case <-ctx.Done():
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				return
			}
		}
	}
}

func (publisher *HTTPEventPublisher) newRequest(ctx context.Context, payload []byte) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, publisher.baseURL+InternalEventsPublishPath, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+publisher.token)
	request.Header.Set("Content-Type", "application/json")
	return request, nil
}

func (publisher *HTTPEventPublisher) publishRequest(request *http.Request) (int, error) {
	response, err := publisher.client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	return response.StatusCode, nil
}
