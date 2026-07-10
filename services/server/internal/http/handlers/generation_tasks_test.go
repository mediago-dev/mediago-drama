package handlers

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/mediago-dev/mediago-drama/services/server/internal/http/dto"
	generationservice "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
)

type fakeGenerationBatchService struct {
	GenerationTaskService
	request dto.GenerationBatchRequest
	batchID string
}

func (service *fakeGenerationBatchService) CreateGenerationBatch(_ context.Context, request dto.GenerationBatchRequest) (dto.GenerationBatchResponse, int, error) {
	service.request = request
	return dto.GenerationBatchResponse{
		ID:       "generation-batch-1",
		Status:   "partial",
		Total:    2,
		Accepted: 1,
		Failed:   1,
		Items: []dto.GenerationBatchItemResponse{
			{ID: "one", Index: 0, TaskID: "task-1", Status: "submitted"},
			{ID: "two", Index: 1, Status: "failed", Error: "bad prompt"},
		},
	}, http.StatusOK, nil
}

func (service *fakeGenerationBatchService) GetGenerationBatch(batchID string) (dto.GenerationBatchTasksResponse, bool, error) {
	service.batchID = batchID
	return dto.GenerationBatchTasksResponse{
		ID:     batchID,
		Status: "running",
		Total:  1,
		Active: 1,
		Tasks: []dto.GenerationTaskRecord{
			{ID: "task-1", BatchID: batchID, Kind: "image", Status: "submitted"},
		},
	}, true, nil
}

func TestHandleCreateGenerationBatch(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	service := &fakeGenerationBatchService{}
	handler := NewGenerationTasks(service)
	router := gin.New()
	router.POST("/generation/batches", handler.HandleCreateGenerationBatch)

	request := httptest.NewRequest(http.MethodPost, "/generation/batches", strings.NewReader(`{
		"projectId":"project-a",
		"scopeId":"project-a",
		"items":[
			{"id":"one","request":{"kind":"image","prompt":"first"}},
			{"id":"two","request":{"kind":"image","prompt":"second"}}
		]
	}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status code = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if service.request.ProjectID != "project-a" || len(service.request.Items) != 2 || service.request.Items[1].ID != "two" {
		t.Fatalf("request = %+v, want decoded batch", service.request)
	}
	if body := response.Body.String(); !strings.Contains(body, "generation-batch-1") || !strings.Contains(body, "bad prompt") {
		t.Fatalf("body = %s, want partial batch response", body)
	}
}

func TestHandleGenerationBatchTasks(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	service := &fakeGenerationBatchService{}
	handler := NewGenerationTasks(service)
	router := gin.New()
	router.GET("/generation/batches/:batchId/tasks", handler.HandleGenerationBatchTasks)

	request := httptest.NewRequest(http.MethodGet, "/generation/batches/generation-batch-1/tasks", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK || service.batchID != "generation-batch-1" {
		t.Fatalf("status = %d batchID = %q body = %s", response.Code, service.batchID, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "task-1") {
		t.Fatalf("body = %s, want task-1", response.Body.String())
	}
}

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
		"/generation/tasks?batchId=batch-1&kind=image&projectId=project-a&limit=25&offset=5",
		nil,
	)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", response.Code, http.StatusOK)
	}
	if service.query.BatchID != "batch-1" || service.query.Kind != "image" || service.query.ProjectID != "project-a" {
		t.Fatalf("query = %+v, want batchId=batch-1 kind=image projectId=project-a", service.query)
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

type fakeSelectedGenerationAssetsService struct {
	GenerationTaskService
	projectID string
	query     generationservice.SelectedGenerationAssetQuery
}

func (service *fakeSelectedGenerationAssetsService) ListSelectedGenerationAssets(projectID string, query generationservice.SelectedGenerationAssetQuery) (dto.SelectedGenerationAssetsResponse, error) {
	service.projectID = projectID
	service.query = query
	return dto.SelectedGenerationAssetsResponse{
		Assets: []dto.SelectedGenerationAssetRecord{
			{
				ID:               "selected-1",
				Kind:             "image",
				ResourceID:       query.ResourceID,
				ResourceType:     query.ResourceType,
				SourceDocumentID: query.SourceDocumentID,
				URL:              "/api/v1/media-assets/selected-1/content",
			},
		},
	}, nil
}

func TestHandleSelectedGenerationAssetsPassesNodeFilters(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)

	service := &fakeSelectedGenerationAssetsService{}
	handler := NewGenerationTasks(service)
	router := gin.New()
	router.GET(
		"/projects/:projectId/generation/selected-assets",
		handler.HandleSelectedGenerationAssets,
	)

	request := httptest.NewRequest(
		http.MethodGet,
		"/projects/project-a/generation/selected-assets?documentId=character-doc&sectionId=section_character&resourceType=character&kind=image",
		nil,
	)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", response.Code, http.StatusOK)
	}
	if service.projectID != "project-a" {
		t.Fatalf("projectID = %q, want project-a", service.projectID)
	}
	if service.query.Kind != "image" ||
		service.query.ResourceType != "character" ||
		service.query.ResourceID != "section_character" ||
		service.query.SourceDocumentID != "character-doc" {
		t.Fatalf("query = %+v, want image character section_character character-doc", service.query)
	}
	bodyBytes, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading response body: %v", err)
	}
	if !strings.Contains(string(bodyBytes), "selected-1") {
		t.Fatalf("body = %s, want selected asset", bodyBytes)
	}
}
