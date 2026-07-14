package generation

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
)

func TestCreateGenerationBatchPersistsOrderedChildTasks(t *testing.T) {
	workflow, store := newGenerationBatchTestWorkflow(t)

	response, status, err := workflow.CreateGenerationBatch(context.Background(), GenerationBatchRequest{
		Kind:              string(coregeneration.KindImage),
		ConversationID:    "project-batch-image",
		ConversationTitle: "Batch project · 图片",
		ProjectID:         "project-batch",
		ScopeID:           "agent",
		Items: []GenerationBatchItemRequest{
			{ID: "scene-b", Request: generationBatchImageRequest("second prompt")},
			{ID: "scene-a", Request: generationBatchImageRequest("first prompt")},
		},
	})
	if err != nil || status != http.StatusOK {
		t.Fatalf("CreateGenerationBatch() status = %d error = %v", status, err)
	}
	if response.Status != "submitted" || response.Total != 2 || response.Accepted != 2 || response.Failed != 0 {
		t.Fatalf("response = %+v, want two accepted items", response)
	}
	if len(response.Items) != 2 || response.Items[0].ID != "scene-b" || response.Items[1].ID != "scene-a" {
		t.Fatalf("items = %+v, want input order", response.Items)
	}
	if response.Items[0].TaskID == "" || response.Items[1].TaskID == "" {
		t.Fatalf("items = %+v, want task IDs", response.Items)
	}

	tasks, err := store.ListByBatch(response.ID)
	if err != nil {
		t.Fatalf("ListByBatch() error = %v", err)
	}
	if len(tasks) != 2 || tasks[0].BatchItemID != "scene-b" || tasks[1].BatchItemID != "scene-a" {
		t.Fatalf("tasks = %+v, want persisted input order", tasks)
	}
	for index, task := range tasks {
		if task.BatchID != response.ID || task.BatchIndex != index || task.ProjectID != "project-batch" || task.ConversationID != "project-batch-image" {
			t.Fatalf("task[%d] = %+v, want batch metadata", index, task)
		}
	}
}

func TestCreateGenerationBatchAllowsPartialSuccess(t *testing.T) {
	workflow, _ := newGenerationBatchTestWorkflow(t)

	response, status, err := workflow.CreateGenerationBatch(context.Background(), GenerationBatchRequest{
		Items: []GenerationBatchItemRequest{
			{ID: "valid", Request: generationBatchImageRequest("valid prompt")},
			{ID: "invalid", Request: generationBatchImageRequest("   ")},
		},
	})
	if err != nil || status != http.StatusOK {
		t.Fatalf("CreateGenerationBatch() status = %d error = %v", status, err)
	}
	if response.Status != "partial" || response.Accepted != 1 || response.Failed != 1 {
		t.Fatalf("response = %+v, want partial success", response)
	}
	if response.Items[0].TaskID == "" || response.Items[1].TaskID != "" || !strings.Contains(response.Items[1].Error, "prompt") {
		t.Fatalf("items = %+v, want one task and one prompt error", response.Items)
	}
}

func TestCreateGenerationBatchReportsTrustedPreflightFailurePerItem(t *testing.T) {
	workflow, store := newGenerationBatchTestWorkflow(t)

	response, status, err := workflow.CreateGenerationBatch(context.Background(), GenerationBatchRequest{
		Items: []GenerationBatchItemRequest{
			{ID: "valid", Request: generationBatchImageRequest("valid prompt")},
			{
				ID:             "unconfirmed",
				Request:        generationBatchImageRequest("must not submit"),
				PreflightError: "generation confirmation is missing",
			},
		},
	})
	if err != nil || status != http.StatusOK {
		t.Fatalf("CreateGenerationBatch() status = %d error = %v", status, err)
	}
	if response.Status != "partial" || response.Accepted != 1 || response.Failed != 1 {
		t.Fatalf("response = %+v, want one accepted item and one preflight failure", response)
	}
	if response.Items[0].TaskID == "" || response.Items[1].TaskID != "" ||
		!strings.Contains(response.Items[1].Error, "confirmation is missing") {
		t.Fatalf("items = %+v, want a non-submitted preflight failure", response.Items)
	}
	tasks, err := store.ListByBatch(response.ID)
	if err != nil {
		t.Fatalf("ListByBatch() error = %v", err)
	}
	if len(tasks) != 1 || tasks[0].BatchItemID != "valid" {
		t.Fatalf("tasks = %+v, want only the authorized item persisted", tasks)
	}
}

func TestCreateGenerationBatchValidatesStructureBeforeSubmission(t *testing.T) {
	workflow, store := newGenerationBatchTestWorkflow(t)

	tests := []struct {
		name    string
		request GenerationBatchRequest
	}{
		{name: "empty"},
		{
			name: "duplicate item ids",
			request: GenerationBatchRequest{Items: []GenerationBatchItemRequest{
				{ID: "same", Request: generationBatchImageRequest("one")},
				{ID: "same", Request: generationBatchImageRequest("two")},
			}},
		},
		{
			name: "too many items",
			request: GenerationBatchRequest{Items: func() []GenerationBatchItemRequest {
				items := make([]GenerationBatchItemRequest, 51)
				for index := range items {
					items[index] = GenerationBatchItemRequest{
						ID:      fmt.Sprintf("item-%d", index),
						Request: generationBatchImageRequest("prompt"),
					}
				}
				return items
			}()},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, status, err := workflow.CreateGenerationBatch(context.Background(), test.request)
			if err == nil || status != http.StatusBadRequest {
				t.Fatalf("CreateGenerationBatch() status = %d error = %v, want bad request", status, err)
			}
		})
	}
	tasks, err := store.List()
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(tasks) != 0 {
		t.Fatalf("tasks = %+v, want no submissions after structural errors", tasks)
	}
}

func newGenerationBatchTestWorkflow(t *testing.T) (*GenerationService, *GenerationTaskService) {
	t.Helper()
	db, err := repository.OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	now := domain.TimeFromString("2026-07-11T00:00:00Z")
	if err := db.Create(&domain.WorkspaceProjectModel{
		ID:          "project-batch",
		Name:        "Batch project",
		Category:    "drama",
		Status:      "active",
		RelativeDir: "project-batch",
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("creating project fixture: %v", err)
	}
	repo := repository.NewGenerationTaskRepositoryFromDB(db)
	var idCounter atomic.Int64
	store := NewGenerationTaskServiceFromRepository(repo, nil, func(prefix string) (string, error) {
		return fmt.Sprintf("%s-%d", prefix, idCounter.Add(1)), nil
	})
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{coregeneration.ProviderDMX: "sk-image"},
	})
	workflow := NewGenerationService(settingsSvc, store, nil)
	workflow.generationProviderFactory = func(coregeneration.ModelRoute) (coregeneration.Provider, error) {
		return &stubImageProvider{generateResponse: coregeneration.Response{Status: "completed"}}, nil
	}
	return workflow, store
}

func generationBatchImageRequest(prompt string) GenerationMessageRequest {
	return GenerationMessageRequest{
		Kind:    string(coregeneration.KindImage),
		RouteID: coregeneration.RouteDMXGPTImage2,
		ModelID: coregeneration.ModelGPTImage2,
		Model:   "gpt-image-2-ssvip",
		Prompt:  prompt,
		Params: map[string]any{
			"aspectRatio": "1:1",
			"resolution":  "1K",
		},
	}
}
