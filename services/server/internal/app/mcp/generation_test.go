package mcp

import (
	"context"
	"net/http"
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	servicegeneration "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
)

func TestGenerationServerCreateUsesScopedProject(t *testing.T) {
	service := &generationMCPServiceStub{}
	server := &GenerationServer{service: service, projectID: "project-a"}

	_, err := server.CreateGenerationMessage(context.Background(), "", mediamcp.GenerationMessageInput{
		Prompt: "generate a scene",
	})
	if err != nil {
		t.Fatalf("CreateGenerationMessage returned error: %v", err)
	}
	if len(service.createRequests) != 1 {
		t.Fatalf("create request count = %d, want 1", len(service.createRequests))
	}
	if service.createRequests[0].ProjectID != "project-a" {
		t.Fatalf("project id = %q, want project-a", service.createRequests[0].ProjectID)
	}
}

func TestGenerationServerRejectsProjectScopeOverrides(t *testing.T) {
	tests := []struct {
		name  string
		input mediamcp.GenerationMessageInput
	}{
		{
			name: "top-level project",
			input: mediamcp.GenerationMessageInput{
				ProjectID: "project-b",
				Prompt:    "generate a scene",
			},
		},
		{
			name: "document context project",
			input: mediamcp.GenerationMessageInput{
				DocumentContext: &mediamcp.GenerationDocumentContext{ProjectID: "project-b"},
				Prompt:          "generate a scene",
			},
		},
		{
			name: "notification target project",
			input: mediamcp.GenerationMessageInput{
				NotificationTarget: &mediamcp.GenerationNotificationTarget{ProjectID: "project-b"},
				Prompt:             "generate a scene",
			},
		},
		{
			name: "prompt optimization project",
			input: mediamcp.GenerationMessageInput{
				PromptOptimization: &mediamcp.GenerationPromptOptimizationInput{ProjectID: "project-b"},
				Prompt:             "generate a scene",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := &generationMCPServiceStub{}
			server := &GenerationServer{service: service, projectID: "project-a"}
			if _, err := server.CreateGenerationMessage(context.Background(), "", tt.input); err == nil {
				t.Fatal("CreateGenerationMessage returned nil error, want scope error")
			}
			if len(service.createRequests) != 0 {
				t.Fatalf("create request count = %d, want 0", len(service.createRequests))
			}
		})
	}
}

func TestGenerationServerListRejectsProjectScopeOverride(t *testing.T) {
	service := &generationMCPServiceStub{}
	server := &GenerationServer{service: service, projectID: "project-a"}

	_, err := server.ListGenerationTasks(context.Background(), "", mediamcp.GenerationTaskListInput{
		ProjectID: "project-b",
	})
	if err == nil {
		t.Fatal("ListGenerationTasks returned nil error, want scope error")
	}
	if len(service.listQueries) != 0 {
		t.Fatalf("list query count = %d, want 0", len(service.listQueries))
	}
}

func TestGenerationServerAllowsUnscopedProjectInput(t *testing.T) {
	service := &generationMCPServiceStub{}
	server := &GenerationServer{service: service}

	_, err := server.ListGenerationTasks(context.Background(), "", mediamcp.GenerationTaskListInput{
		ProjectID: "project-b",
	})
	if err != nil {
		t.Fatalf("ListGenerationTasks returned error: %v", err)
	}
	if len(service.listQueries) != 1 {
		t.Fatalf("list query count = %d, want 1", len(service.listQueries))
	}
	if service.listQueries[0].ProjectID != "project-b" {
		t.Fatalf("project id = %q, want project-b", service.listQueries[0].ProjectID)
	}
}

func TestGenerationServerSelectAsset(t *testing.T) {
	service := &generationMCPServiceStub{
		tasks: map[string]servicegeneration.GenerationTaskRecord{
			"task-1": {
				ID:        "task-1",
				ProjectID: "project-a",
				Assets: []servicegeneration.GenerationAsset{
					{Kind: "image", SlotIndex: 0},
					{Kind: "image", SlotIndex: 1},
				},
			},
		},
	}
	server := &GenerationServer{service: service, projectID: "project-a"}

	record, err := server.SelectGenerationAsset(context.Background(), "", mediamcp.GenerationSelectAssetInput{
		TaskID:    "task-1",
		SlotIndex: 1,
		Title:     "定稿",
	})
	if err != nil {
		t.Fatalf("SelectGenerationAsset returned error: %v", err)
	}
	if len(record.Assets) != 2 || !record.Assets[1].Selected || record.Assets[1].Title != "定稿" {
		t.Fatalf("record assets = %#v, want slot 1 selected with title", record.Assets)
	}

	if _, err := server.SelectGenerationAsset(context.Background(), "", mediamcp.GenerationSelectAssetInput{
		TaskID:    "task-1",
		SlotIndex: 9,
	}); err == nil {
		t.Fatal("SelectGenerationAsset returned nil error for missing slot")
	}

	if _, err := server.SelectGenerationAsset(context.Background(), "", mediamcp.GenerationSelectAssetInput{
		TaskID:    "task-missing",
		SlotIndex: 0,
	}); err == nil {
		t.Fatal("SelectGenerationAsset returned nil error for missing task")
	}
}

func TestGenerationServerSelectAssetRespectsProjectScope(t *testing.T) {
	service := &generationMCPServiceStub{
		tasks: map[string]servicegeneration.GenerationTaskRecord{
			"task-b": {
				ID:        "task-b",
				ProjectID: "project-b",
				Assets:    []servicegeneration.GenerationAsset{{Kind: "image", SlotIndex: 0}},
			},
		},
	}
	server := &GenerationServer{service: service, projectID: "project-a"}

	if _, err := server.SelectGenerationAsset(context.Background(), "", mediamcp.GenerationSelectAssetInput{
		TaskID:    "task-b",
		SlotIndex: 0,
	}); err == nil {
		t.Fatal("SelectGenerationAsset returned nil error for out-of-scope task")
	}
}

func TestGenerationServerCreateWithPromptOptimization(t *testing.T) {
	service := &generationMCPServiceStub{}
	server := &GenerationServer{service: service, projectID: "project-a"}

	output, err := server.CreateGenerationMessage(context.Background(), "", mediamcp.GenerationMessageInput{
		Prompt:             "generate a scene",
		PromptOptimization: &mediamcp.GenerationPromptOptimizationInput{RouteID: "text-route"},
	})
	if err != nil {
		t.Fatalf("CreateGenerationMessage returned error: %v", err)
	}
	if len(service.optimizeRequests) != 1 || len(service.createRequests) != 0 {
		t.Fatalf("optimize=%d create=%d, want optimize path only", len(service.optimizeRequests), len(service.createRequests))
	}
	if output.ID != "generation-optimized" || output.OptimizedPrompt != "optimized: generate a scene" {
		t.Fatalf("output = %#v, want optimized generation with optimizedPrompt", output)
	}
}

func TestGenerationServerListModelsIncludesPreferences(t *testing.T) {
	service := &generationMCPServiceStub{
		preference: servicegeneration.GenerationPreferenceRecord{
			RouteIDs:    map[string]string{"image": "jimeng.seedream-5.0"},
			RouteParams: map[string]map[string]any{"jimeng.seedream-5.0": {"aspectRatio": "3:4"}},
		},
		preferenceOK: true,
	}
	server := &GenerationServer{service: service, projectID: "project-a"}

	output, err := server.ListGenerationModels(context.Background())
	if err != nil {
		t.Fatalf("ListGenerationModels returned error: %v", err)
	}
	if output.Preferences == nil || output.Preferences.RouteIDs["image"] != "jimeng.seedream-5.0" {
		t.Fatalf("preferences = %#v, want workbench route defaults", output.Preferences)
	}

	server.service = &generationMCPServiceStub{}
	output, err = server.ListGenerationModels(context.Background())
	if err != nil {
		t.Fatalf("ListGenerationModels returned error: %v", err)
	}
	if output.Preferences != nil {
		t.Fatalf("preferences = %#v, want nil when unset", output.Preferences)
	}
}

type generationMCPServiceStub struct {
	createRequests   []servicegeneration.GenerationMessageRequest
	optimizeRequests []servicegeneration.GenerationMessageRequest
	listQueries      []servicegeneration.GenerationTaskListQuery
	tasks            map[string]servicegeneration.GenerationTaskRecord
	preference       servicegeneration.GenerationPreferenceRecord
	preferenceOK     bool
}

func (service *generationMCPServiceStub) ListGenerationModels() servicegeneration.GenerationModelsResponse {
	return servicegeneration.GenerationModelsResponse{}
}

func (service *generationMCPServiceStub) CreateGenerationMessage(_ context.Context, payload servicegeneration.GenerationMessageRequest) (servicegeneration.GenerationMessageResponse, int, error) {
	service.createRequests = append(service.createRequests, payload)
	return servicegeneration.GenerationMessageResponse{ID: "generation-test", Status: "completed"}, http.StatusOK, nil
}

func (service *generationMCPServiceStub) RetryGenerationTask(_ context.Context, id string) (servicegeneration.GenerationMessageResponse, int, error) {
	return servicegeneration.GenerationMessageResponse{ID: id, Status: "submitted"}, http.StatusOK, nil
}

func (service *generationMCPServiceStub) ListGenerationTasks(query servicegeneration.GenerationTaskListQuery) (servicegeneration.GenerationTasksResponse, error) {
	service.listQueries = append(service.listQueries, query)
	return servicegeneration.GenerationTasksResponse{}, nil
}

func (service *generationMCPServiceStub) GetGenerationTask(id string) (servicegeneration.GenerationTaskRecord, bool, error) {
	if service.tasks == nil {
		return servicegeneration.GenerationTaskRecord{}, false, nil
	}
	task, ok := service.tasks[id]
	return task, ok, nil
}

func (service *generationMCPServiceStub) PollGenerationTask(context.Context, servicegeneration.GenerationTaskRecord) {
}

func (service *generationMCPServiceStub) CreatePromptOptimizedGenerationMessage(_ context.Context, payload servicegeneration.GenerationMessageRequest) (servicegeneration.GenerationOptimizeAndGenerateResponse, int, error) {
	service.optimizeRequests = append(service.optimizeRequests, payload)
	return servicegeneration.GenerationOptimizeAndGenerateResponse{
		Generation:      servicegeneration.GenerationMessageResponse{ID: "generation-optimized", Status: "submitted"},
		OptimizedPrompt: "optimized: " + payload.Prompt,
	}, http.StatusOK, nil
}

func (service *generationMCPServiceStub) GenerationPreferenceForProject(string) (servicegeneration.GenerationPreferenceRecord, bool) {
	return service.preference, service.preferenceOK
}

func (service *generationMCPServiceStub) UpdateGenerationTaskAsset(id string, assetIndex int, patch servicegeneration.UpdateGenerationTaskAssetRequest) (servicegeneration.GenerationTaskRecord, bool, error) {
	task, ok := service.tasks[id]
	if !ok {
		return servicegeneration.GenerationTaskRecord{}, false, nil
	}
	for index := range task.Assets {
		if task.Assets[index].SlotIndex != assetIndex {
			continue
		}
		if patch.Selected != nil {
			task.Assets[index].Selected = *patch.Selected
		}
		if patch.Title != nil {
			task.Assets[index].Title = *patch.Title
		}
		service.tasks[id] = task
		return task, true, nil
	}
	return servicegeneration.GenerationTaskRecord{}, false, nil
}
