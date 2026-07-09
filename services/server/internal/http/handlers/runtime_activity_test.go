package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	serviceruntimeactivity "github.com/mediago-dev/mediago-drama/services/server/internal/service/runtimeactivity"
)

func TestHandleGetRuntimeActivity(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	handler := NewRuntimeActivity(func(context.Context) serviceruntimeactivity.Report {
		return serviceruntimeactivity.Report{
			Busy:                   true,
			RunningGenerationTasks: 2,
			ActiveAgentRuns:        1,
			DatabaseFiles:          []string{"/tmp/app.db"},
		}
	})
	router.GET("/runtime/activity", handler.HandleGetRuntimeActivity)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/runtime/activity", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", recorder.Code)
	}
	var envelope struct {
		Data runtimeActivityResponse `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if !envelope.Data.Busy || envelope.Data.RunningGenerationTasks != 2 ||
		envelope.Data.ActiveAgentRuns != 1 || len(envelope.Data.DatabaseFiles) != 1 {
		t.Fatalf("unexpected payload: %+v", envelope.Data)
	}
}
