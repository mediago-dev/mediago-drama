package handlers

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
)

type pagingAgentEventService struct {
	events    []service.AgentEvent
	live      chan service.AgentEvent
	loadCalls int
}

func (svc *pagingAgentEventService) LoadAgentEvents(_ string, _ string, afterSequence int64, limit int) ([]service.AgentEvent, error) {
	svc.loadCalls++
	page := []service.AgentEvent{}
	for _, event := range svc.events {
		if event.Sequence > afterSequence {
			page = append(page, event)
			if len(page) >= limit {
				break
			}
		}
	}
	return page, nil
}

func (svc *pagingAgentEventService) SubscribeAgentEvents() (<-chan service.AgentEvent, func()) {
	if svc.live == nil {
		svc.live = make(chan service.AgentEvent)
	}
	return svc.live, func() {}
}

func (svc *pagingAgentEventService) NewEventID() string { return "control" }

func TestHandleAgentEventsReplaysEveryPage(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const total = 2500
	events := make([]service.AgentEvent, total)
	for index := range events {
		events[index] = service.AgentEvent{
			Sequence:  int64(index + 1),
			SessionID: "session-1",
			ProjectID: "project-1",
			Type:      "agent.activity",
		}
	}
	svc := &pagingAgentEventService{events: events}
	handler := NewAgentEvents(svc)

	recorder := httptest.NewRecorder()
	ginContext, _ := gin.CreateTestContext(recorder)
	requestContext, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	ginContext.Request = httptest.NewRequest(http.MethodGet, "/", nil).WithContext(requestContext)
	ginContext.Params = gin.Params{
		{Key: "projectId", Value: "project-1"},
		{Key: "sessionId", Value: "session-1"},
	}

	handler.HandleAgentEvents(ginContext)

	body := recorder.Body.String()
	if svc.loadCalls != 3 {
		t.Fatalf("load calls = %d, want 3 (1000 + 1000 + 500)", svc.loadCalls)
	}
	for _, sequence := range []int64{1, 1000, 1001, 2500} {
		if !strings.Contains(body, fmt.Sprintf("id: %d\n", sequence)) {
			t.Fatalf("replay missing event id %d", sequence)
		}
	}
	if !strings.Contains(body, "agent.session.replay.completed") {
		t.Fatal("replay did not complete")
	}
}

func TestHandleAgentEventsSkipsBufferedEventsAlreadyCoveredByReplay(t *testing.T) {
	gin.SetMode(gin.TestMode)

	replay := []service.AgentEvent{
		{Sequence: 1, SessionID: "session-1", ProjectID: "project-1", Type: "agent.run.started"},
		{Sequence: 2, SessionID: "session-1", ProjectID: "project-1", Type: "agent.run.completed"},
	}
	live := make(chan service.AgentEvent, 4)
	live <- replay[0]
	live <- replay[1]
	live <- service.AgentEvent{
		SessionID: "session-1",
		ProjectID: "project-1",
		Type:      "agent.message.delta",
		Delta:     "实时增量",
	}
	live <- service.AgentEvent{
		Sequence:  3,
		SessionID: "session-1",
		ProjectID: "project-1",
		Type:      "agent.activity",
		Message:   "回放后的实时事件",
	}
	svc := &pagingAgentEventService{events: replay, live: live}
	handler := NewAgentEvents(svc)

	recorder := httptest.NewRecorder()
	ginContext, _ := gin.CreateTestContext(recorder)
	requestContext, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	ginContext.Request = httptest.NewRequest(http.MethodGet, "/", nil).WithContext(requestContext)
	ginContext.Params = gin.Params{
		{Key: "projectId", Value: "project-1"},
		{Key: "sessionId", Value: "session-1"},
	}

	handler.HandleAgentEvents(ginContext)

	body := recorder.Body.String()
	if count := strings.Count(body, "id: 1\n"); count != 1 {
		t.Fatalf("event 1 count = %d, want 1", count)
	}
	if count := strings.Count(body, "id: 2\n"); count != 1 {
		t.Fatalf("event 2 count = %d, want 1", count)
	}
	if count := strings.Count(body, "id: 3\n"); count != 1 {
		t.Fatalf("event 3 count = %d, want 1", count)
	}
	if !strings.Contains(body, `"delta":"实时增量"`) {
		t.Fatalf("body = %q, want unpersisted live delta", body)
	}
}

func TestAgentEventMatchesSubscriptionAllowsExternalProjectEvents(t *testing.T) {
	if !agentEventMatchesSubscription(service.AgentEvent{ProjectID: "project-a"}, "session-1", "project-a") {
		t.Fatal("external project event should match a subscriber for the same project")
	}
	if agentEventMatchesSubscription(service.AgentEvent{ProjectID: "project-a"}, "session-1", "project-b") {
		t.Fatal("external project event should not match another project")
	}
	if agentEventMatchesSubscription(service.AgentEvent{SessionID: "session-2", ProjectID: "project-a"}, "session-1", "project-a") {
		t.Fatal("session-scoped event should not match another session")
	}
	if !agentEventMatchesSubscription(service.AgentEvent{Type: service.ProjectBriefUpdatedEventType, SessionID: "session-2", ProjectID: "project-a"}, "session-1", "project-a") {
		t.Fatal("project brief update should match another session in the same project")
	}
	if agentEventMatchesSubscription(service.AgentEvent{Type: service.ProjectBriefUpdatedEventType, SessionID: "session-2", ProjectID: "project-a"}, "session-1", "project-b") {
		t.Fatal("project brief update should not match another project")
	}
}

func TestMaxAgentEventSequenceUsesNewestCursor(t *testing.T) {
	if got := maxAgentEventSequence(parseAgentEventSequence("12"), parseAgentEventSequence("15")); got != 15 {
		t.Fatalf("maxAgentEventSequence = %d, want 15", got)
	}
	if got := maxAgentEventSequence(parseAgentEventSequence("bad"), parseAgentEventSequence("7")); got != 7 {
		t.Fatalf("maxAgentEventSequence with invalid query = %d, want 7", got)
	}
}
