package handlers

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/mediago-dev/mediago-drama/services/server/internal/http/dto"
	generationservice "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
)

type fakeGenerationTaskAssetService struct {
	GenerationTaskService
	assetIndex int
	taskID     string
}

func (service *fakeGenerationTaskAssetService) DeleteGenerationTaskAsset(id string, assetIndex int) (dto.GenerationTaskRecord, bool, error) {
	service.taskID = id
	service.assetIndex = assetIndex

	return dto.GenerationTaskRecord{
		ID:     id,
		Kind:   "image",
		Status: "completed",
		Assets: []dto.GenerationAsset{
			{Kind: "image", URL: "/api/v1/media-assets/image-b/content"},
		},
	}, true, nil
}

func TestHandleDeleteGenerationTaskAsset(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)

	service := &fakeGenerationTaskAssetService{}
	handler := NewGenerationTasks(service)
	router := gin.New()
	router.DELETE(
		"/generation/tasks/:taskId/assets/:assetIndex",
		handler.HandleDeleteGenerationTaskAsset,
	)

	request := httptest.NewRequest(
		http.MethodDelete,
		"/generation/tasks/task-1/assets/2",
		nil,
	)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", response.Code, http.StatusOK)
	}
	if service.taskID != "task-1" || service.assetIndex != 2 {
		t.Fatalf("service called with taskID=%q assetIndex=%d, want task-1/2", service.taskID, service.assetIndex)
	}
	bodyBytes, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading response body: %v", err)
	}
	body := string(bodyBytes)
	if !strings.Contains(body, "/api/v1/media-assets/image-b/content") {
		t.Fatalf("body = %s, want updated task assets", body)
	}
}

type fakeGenerationTaskListService struct {
	GenerationTaskService
	query generationservice.GenerationTaskListQuery
}

func (service *fakeGenerationTaskListService) ListGenerationTasks(query generationservice.GenerationTaskListQuery) (dto.GenerationTasksResponse, error) {
	service.query = query
	return dto.GenerationTasksResponse{
		Tasks: []dto.GenerationTaskRecord{
			{ID: "task-project", Kind: "image", ProjectID: query.ProjectID, Status: "running"},
		},
	}, nil
}

func TestHandleGenerationTasksPassesProjectIDFilter(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)

	service := &fakeGenerationTaskListService{}
	handler := NewGenerationTasks(service)
	router := gin.New()
	router.GET("/generation/tasks", handler.HandleGenerationTasks)

	request := httptest.NewRequest(
		http.MethodGet,
		"/generation/tasks?kind=image&projectId=project-a&limit=25&offset=5",
		nil,
	)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", response.Code, http.StatusOK)
	}
	if service.query.Kind != "image" || service.query.ProjectID != "project-a" {
		t.Fatalf("query = %+v, want kind=image projectId=project-a", service.query)
	}
	if service.query.Limit != 25 || service.query.Offset != 5 {
		t.Fatalf("query = %+v, want limit=25 offset=5", service.query)
	}
	bodyBytes, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading response body: %v", err)
	}
	if !strings.Contains(string(bodyBytes), "task-project") {
		t.Fatalf("body = %s, want task-project", bodyBytes)
	}
}
