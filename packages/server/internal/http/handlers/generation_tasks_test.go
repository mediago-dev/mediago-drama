package handlers

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/http/dto"
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
