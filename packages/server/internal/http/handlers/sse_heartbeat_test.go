package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/http/dto"
	serviceagent "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/agent"
	serviceworkspaceevent "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/workspaceevent"
)

type fakeAgentEventService struct {
	events chan serviceagent.AgentEvent
}

func (service *fakeAgentEventService) LoadAgentEvents(string, string, int64, int) ([]serviceagent.AgentEvent, error) {
	return nil, nil
}

func (service *fakeAgentEventService) SubscribeAgentEvents() (<-chan serviceagent.AgentEvent, func()) {
	return service.events, func() {}
}

func (service *fakeAgentEventService) NewEventID() string {
	return "test-event"
}

type fakeWorkspaceEventService struct {
	events chan serviceworkspaceevent.Event
}

func (service *fakeWorkspaceEventService) SubscribeWorkspaceEvents() (<-chan serviceworkspaceevent.Event, func()) {
	return service.events, func() {}
}

func (service *fakeWorkspaceEventService) NewWorkspaceEventID() string {
	return "test-workspace-event"
}

type fakeGenerationNotificationService struct {
	GenerationTaskService
	events chan dto.GenerationNotificationEvent
}

func (service *fakeGenerationNotificationService) SubscribeGenerationNotifications() (<-chan dto.GenerationNotificationEvent, func()) {
	return service.events, func() {}
}

func (service *fakeGenerationNotificationService) GenerationNotificationConnectedEvent(projectID string) dto.GenerationNotificationEvent {
	return dto.GenerationNotificationEvent{Type: "generation.notification.connected", ProjectID: projectID}
}

// serveSSEUntilIdleHeartbeats runs an SSE route with a shortened heartbeat
// interval, keeps the stream idle long enough for several ticks, then cancels
// the request and returns the body written so far.
func serveSSEUntilIdleHeartbeats(t *testing.T, register func(router *gin.Engine), path string) string {
	t.Helper()
	gin.SetMode(gin.ReleaseMode)

	previousInterval := sseHeartbeatInterval
	sseHeartbeatInterval = 5 * time.Millisecond
	defer func() { sseHeartbeatInterval = previousInterval }()

	router := gin.New()
	register(router)

	requestContext, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodGet, path, nil).WithContext(requestContext)
	response := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		router.ServeHTTP(response, request)
		close(done)
	}()
	time.Sleep(100 * time.Millisecond)
	cancel()
	<-done

	return response.Body.String()
}

func assertSSEHeartbeat(t *testing.T, body string) {
	t.Helper()
	if !strings.Contains(body, ": ping\n") {
		t.Fatalf("body = %q, want idle stream to carry ping comments", body)
	}
	if !strings.Contains(body, "event: stream.ping\ndata: {}\n\n") {
		t.Fatalf("body = %q, want idle stream to carry stream.ping events", body)
	}
}

func TestHandleAgentEventsEmitsHeartbeatWhenIdle(t *testing.T) {
	handler := NewAgentEvents(&fakeAgentEventService{events: make(chan serviceagent.AgentEvent)})
	body := serveSSEUntilIdleHeartbeats(t, func(router *gin.Engine) {
		router.GET("/projects/:projectId/agent/sessions/:sessionId/events", handler.HandleAgentEvents)
	}, "/projects/project-a/agent/sessions/session-1/events")

	if !strings.Contains(body, "event: agent.session.connected\n") {
		t.Fatalf("body = %q, want connected event before heartbeats", body)
	}
	assertSSEHeartbeat(t, body)
}

func TestHandleWorkspaceEventsEmitsHeartbeatWhenIdle(t *testing.T) {
	handler := NewWorkspaceEvents(&fakeWorkspaceEventService{events: make(chan serviceworkspaceevent.Event)})
	body := serveSSEUntilIdleHeartbeats(t, func(router *gin.Engine) {
		router.GET("/projects/:projectId/workspace/events", handler.HandleWorkspaceEvents)
	}, "/projects/project-a/workspace/events")

	assertSSEHeartbeat(t, body)
}

func TestHandleGenerationNotificationEventsEmitsHeartbeatWhenIdle(t *testing.T) {
	handler := NewGenerationTasks(&fakeGenerationNotificationService{
		events: make(chan dto.GenerationNotificationEvent),
	})
	body := serveSSEUntilIdleHeartbeats(t, func(router *gin.Engine) {
		router.GET("/generation/notifications/events", handler.HandleGenerationNotificationEvents)
	}, "/generation/notifications/events")

	assertSSEHeartbeat(t, body)
}
