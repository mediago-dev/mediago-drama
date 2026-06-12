package events

import (
	serverconfig "github.com/torchstellar-team/mediago-drama/packages/server/internal/config"
	serviceevents "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/events"
)

type httpEventPublisherAdapter struct {
	publisher *serviceevents.HTTPEventPublisher
}

// NewHTTPEventPublisherFromEnv creates an HTTP event publisher from internal API env vars.
func NewHTTPEventPublisherFromEnv() EventPublisher {
	return NewHTTPEventPublisherFromConfig(serverconfig.InternalAPIFromEnv())
}

// NewHTTPEventPublisherFromConfig creates an HTTP event publisher from internal API config.
func NewHTTPEventPublisherFromConfig(config serverconfig.InternalAPIConfig) EventPublisher {
	return NewHTTPEventPublisher(config.URL, config.Token)
}

// NewHTTPEventPublisher creates an HTTP event publisher.
func NewHTTPEventPublisher(baseURL string, token string) EventPublisher {
	publisher := serviceevents.NewHTTPEventPublisher(baseURL, token)
	if publisher == nil {
		return nil
	}
	return httpEventPublisherAdapter{publisher: publisher}
}

func (adapter httpEventPublisherAdapter) PublishEvent(event Event) {
	if adapter.publisher == nil {
		return
	}
	adapter.publisher.PublishEvent(event)
}
