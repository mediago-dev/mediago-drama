package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func performRuntimeActivityRequest(t *testing.T, sources RuntimeActivitySources) runtimeActivityResponse {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/runtime/activity", NewRuntimeActivity(sources).HandleGetRuntimeActivity)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/runtime/activity", nil)
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", recorder.Code)
	}
	var envelope struct {
		Data runtimeActivityResponse `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	return envelope.Data
}

func TestHandleGetRuntimeActivity(t *testing.T) {
	databaseFiles := []string{"/tmp/app.db", "/tmp/settings.db"}

	testCases := []struct {
		name          string
		tasks         int64
		tasksErr      error
		agentRuns     int
		expectBusy    bool
		expectedTasks int64
		expectedRuns  int
	}{
		{name: "idle", tasks: 0, agentRuns: 0, expectBusy: false},
		{name: "generation task running", tasks: 2, agentRuns: 0, expectBusy: true, expectedTasks: 2},
		{name: "agent run active", tasks: 0, agentRuns: 1, expectBusy: true, expectedRuns: 1},
		{name: "both active", tasks: 1, agentRuns: 3, expectBusy: true, expectedTasks: 1, expectedRuns: 3},
		{name: "task count error fails busy", tasksErr: errors.New("db closed"), expectBusy: true},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			response := performRuntimeActivityRequest(t, RuntimeActivitySources{
				ActiveGenerationTasks: func() (int64, error) {
					return testCase.tasks, testCase.tasksErr
				},
				ActiveAgentRuns: func() int { return testCase.agentRuns },
				DatabaseFiles:   func() []string { return databaseFiles },
			})

			if response.Busy != testCase.expectBusy {
				t.Fatalf("busy = %v, want %v", response.Busy, testCase.expectBusy)
			}
			if testCase.tasksErr == nil {
				if response.RunningGenerationTasks != testCase.expectedTasks {
					t.Fatalf("runningGenerationTasks = %d, want %d", response.RunningGenerationTasks, testCase.expectedTasks)
				}
				if response.ActiveAgentRuns != testCase.expectedRuns {
					t.Fatalf("activeAgentRuns = %d, want %d", response.ActiveAgentRuns, testCase.expectedRuns)
				}
			}
			if len(response.DatabaseFiles) != len(databaseFiles) {
				t.Fatalf("databaseFiles = %v, want %v", response.DatabaseFiles, databaseFiles)
			}
		})
	}
}

func TestHandleGetRuntimeActivityWithoutSources(t *testing.T) {
	response := performRuntimeActivityRequest(t, RuntimeActivitySources{})
	if response.Busy {
		t.Fatalf("busy = true, want false when no sources are wired")
	}
	if response.DatabaseFiles == nil || len(response.DatabaseFiles) != 0 {
		t.Fatalf("databaseFiles = %v, want empty slice", response.DatabaseFiles)
	}
}
