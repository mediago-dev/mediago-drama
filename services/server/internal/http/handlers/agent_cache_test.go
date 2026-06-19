package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
)

func TestAgentDynamicGetHandlersDisableBrowserCaching(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)

	router := gin.New()
	chatHandler := NewAgentChat(fakeAgentChatStore{})
	sessionHandler := NewAgentSessions(fakeAgentSessionStore{}, func(prefix string) (string, error) {
		return prefix + "-1", nil
	}, nil)
	router.GET("/agent/chat", chatHandler.HandleGetAgentChat)
	router.GET("/agent/sessions/:sessionId/chat", chatHandler.HandleGetAgentChat)
	router.GET("/agent/sessions", sessionHandler.HandleListAgentSessions)
	router.GET("/agent/sessions/:sessionId/status", sessionHandler.HandleAgentSessionStatus)

	for _, target := range []string{
		"/agent/chat?projectId=project-1",
		"/agent/sessions/session-1/chat?projectId=project-1",
		"/agent/sessions?projectId=project-1",
		"/agent/sessions/session-1/status",
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, target, nil)

		router.ServeHTTP(response, request)

		if response.Code != http.StatusOK {
			t.Fatalf("%s status code = %d, want %d", target, response.Code, http.StatusOK)
		}
		cacheControl := response.Header().Get("Cache-Control")
		if !strings.Contains(cacheControl, "no-store") {
			t.Fatalf("%s Cache-Control = %q, want no-store", target, cacheControl)
		}
		if response.Header().Get("Pragma") != "no-cache" {
			t.Fatalf("%s Pragma = %q, want no-cache", target, response.Header().Get("Pragma"))
		}
	}
}

type fakeAgentChatStore struct{}

func (fakeAgentChatStore) LoadAgentChat(
	projectID string,
	sessionID string,
) (service.AgentChatStateResponse, error) {
	return service.AgentChatStateResponse{
		ProjectID: projectID,
		SessionID: sessionID,
		Messages:  []service.AgentChatMessageRecord{},
		Activity:  []service.AgentChatActivityRecord{},
	}, nil
}

func (fakeAgentChatStore) AppendAgentMessages(
	projectID string,
	request service.AgentChatAppendRequest,
) (service.AgentChatStateResponse, error) {
	return service.AgentChatStateResponse{ProjectID: projectID, Messages: request.Messages}, nil
}

func (fakeAgentChatStore) ClearAgentChat(projectID string) (service.AgentChatStateResponse, error) {
	return service.AgentChatStateResponse{
		ProjectID: projectID,
		Messages:  []service.AgentChatMessageRecord{},
		Activity:  []service.AgentChatActivityRecord{},
	}, nil
}

type fakeAgentSessionStore struct{}

func (fakeAgentSessionStore) Create(string, string) {}

func (fakeAgentSessionStore) ProjectSessionID(string) (string, bool) {
	return "", false
}

func (fakeAgentSessionStore) List(projectID string) []service.AgentSessionSummary {
	return []service.AgentSessionSummary{{SessionID: "session-1", ProjectID: projectID}}
}

func (fakeAgentSessionStore) Status(sessionID string) service.AgentSessionStatus {
	return service.AgentSessionStatus{SessionID: sessionID}
}

func (fakeAgentSessionStore) CancelRun(sessionID string) (service.AgentSessionStatus, bool) {
	return service.AgentSessionStatus{SessionID: sessionID}, false
}
