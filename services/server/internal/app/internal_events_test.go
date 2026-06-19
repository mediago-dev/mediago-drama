package app

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	httphandlers "github.com/mediago-dev/mediago-drama/services/server/internal/http/handlers"
)

func TestHandleInternalPublishEvent(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	api := newAPIHandler(Config{
		SettingsDBPath:          filepath.Join(t.TempDir(), "settings.db"),
		WorkspaceDir:            filepath.Join(t.TempDir(), "workspace"),
		AgentBridgeToken:        "test-token",
		DisableGenerationWorker: true,
	})
	router := gin.New()
	internalHandler := httphandlers.NewInternalEvents(api.agentBridgeToken, api)
	router.POST(internalEventsPublishPath, internalHandler.HandleInternalPublishEvent)

	t.Run("requires bearer token", func(t *testing.T) {
		response := internalPublishRequest(router, "", `{"type":"agent.document.edit.completed","projectId":"project-a","message":"done"}`)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("rejects unsupported event type", func(t *testing.T) {
		response := internalPublishRequest(router, "test-token", `{"type":"agent.run.completed","projectId":"project-a","message":"done"}`)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
		}
	})

	t.Run("publishes document edit event", func(t *testing.T) {
		events, unsubscribe := api.events.Subscribe()
		defer unsubscribe()

		response := internalPublishRequest(router, "test-token", `{
			"type":"agent.document.edit.completed",
			"projectId":"project-a",
			"message":"external edit",
			"documentEdit":{"documentId":"doc-1","status":"completed"}
		}`)
		if response.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusNoContent, response.Body.String())
		}

		select {
		case event := <-events:
			if event.Type != "agent.document.edit.completed" || event.ProjectID != "project-a" || event.SessionID != "" {
				t.Fatalf("event = %#v, want external document edit for project-a", event)
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for published event")
		}
	})
}

func internalPublishRequest(handler http.Handler, token string, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, internalEventsPublishPath, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}
