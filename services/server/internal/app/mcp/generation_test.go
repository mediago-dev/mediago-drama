package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	servicegeneration "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
	serviceselection "github.com/mediago-dev/mediago-drama/services/server/internal/service/selection"
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

func TestGenerationMessageRequestFromMCPPreservesPromptSupplements(t *testing.T) {
	input := mediamcp.GenerationMessageInput{
		PromptSupplements: []mediamcp.GenerationPromptSupplementInput{
			{ReferenceID: " pack-style ", ReferenceName: " 电影质感 ", ReferencePrompt: " cinematic lighting "},
			{ReferenceID: "pack-camera", ReferenceName: "镜头", ReferencePrompt: "close-up camera"},
		},
	}

	request := generationMessageRequestFromMCP(input, "project-a")
	want := []servicegeneration.GenerationPromptSupplementRequest{
		{ReferenceID: "pack-style", ReferenceName: "电影质感", ReferencePrompt: "cinematic lighting"},
		{ReferenceID: "pack-camera", ReferenceName: "镜头", ReferencePrompt: "close-up camera"},
	}
	if fmt.Sprint(request.PromptSupplements) != fmt.Sprint(want) {
		t.Fatalf("prompt supplements = %#v, want %#v", request.PromptSupplements, want)
	}
}

func TestGenerationBatchRequestFromMCPPreservesPromptSupplements(t *testing.T) {
	request := generationBatchRequestFromMCP(mediamcp.GenerationBatchInput{
		Items: []mediamcp.GenerationBatchItemInput{
			{
				ID: "character-a",
				Request: mediamcp.GenerationMessageInput{PromptSupplements: []mediamcp.GenerationPromptSupplementInput{
					{ReferenceID: "pack-style", ReferenceName: "电影质感", ReferencePrompt: "cinematic lighting"},
				}},
			},
		},
	}, "project-a")

	if len(request.Items) != 1 || len(request.Items[0].Request.PromptSupplements) != 1 {
		t.Fatalf("batch request = %#v, want one prompt supplement", request)
	}
	if got := request.Items[0].Request.PromptSupplements[0]; got.ReferenceID != "pack-style" || got.ReferencePrompt != "cinematic lighting" {
		t.Fatalf("prompt supplement = %#v", got)
	}
}

func TestGenerationModelsOutputOmitsAgentStylePresets(t *testing.T) {
	output := generationModelsOutputFromService(servicegeneration.GenerationModelsResponse{
		StylePresets: []servicegeneration.GenerationStylePreset{{ID: "style-anime"}},
	})
	payload, err := json.Marshal(output)
	if err != nil {
		t.Fatalf("json.Marshal(output) error = %v", err)
	}
	if strings.Contains(string(payload), "stylePresets") {
		t.Fatalf("Agent generation catalog leaked stylePresets: %s", payload)
	}
}

func TestGenerationServerRequiresSubmittedRunConfirmation(t *testing.T) {
	baseRecord := confirmedGenerationSelectionRecord()
	baseInput := mediamcp.GenerationMessageInput{
		ConfirmationSelectionID: baseRecord.ID,
		Kind:                    "image",
		RouteID:                 "route-a",
		Prompt:                  "generate a portrait",
		Params: map[string]any{
			"aspectRatio": "3:4",
			"n":           1,
		},
	}

	tests := []struct {
		name       string
		mutate     func(*serviceselection.Record, *mediamcp.GenerationMessageInput)
		missing    bool
		lookupErr  error
		wantErr    string
		wantCreate bool
	}{
		{name: "submitted exact plan", wantCreate: true},
		{
			name: "missing confirmation id",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.ConfirmationSelectionID = ""
			},
			wantErr: "confirmationSelectionId",
		},
		{name: "unknown selection", missing: true, wantErr: "was not found"},
		{name: "lookup failure", lookupErr: fmt.Errorf("database offline"), wantErr: "database offline"},
		{
			name: "pending",
			mutate: func(record *serviceselection.Record, _ *mediamcp.GenerationMessageInput) {
				record.Status = serviceselection.StatusPending
				record.Decision = nil
			},
			wantErr: "explicit user submission",
		},
		{
			name: "cancelled",
			mutate: func(record *serviceselection.Record, _ *mediamcp.GenerationMessageInput) {
				record.Status = serviceselection.StatusCancelled
				record.Decision = &serviceselection.Decision{Cancelled: true}
			},
			wantErr: "explicit user submission",
		},
		{
			name: "different run",
			mutate: func(record *serviceselection.Record, _ *mediamcp.GenerationMessageInput) {
				record.RunID = "run-b"
			},
			wantErr: "different agent run",
		},
		{
			name: "different session",
			mutate: func(record *serviceselection.Record, _ *mediamcp.GenerationMessageInput) {
				record.SessionID = "session-b"
			},
			wantErr: "different agent session",
		},
		{
			name: "generic selection kind",
			mutate: func(record *serviceselection.Record, _ *mediamcp.GenerationMessageInput) {
				record.Kind = "form"
			},
			wantErr: "not a generation_plan",
		},
		{
			name: "legacy generic field in generation plan",
			mutate: func(record *serviceselection.Record, _ *mediamcp.GenerationMessageInput) {
				record.Fields = append(record.Fields, serviceselection.FormField{
					ID:   "framing",
					Type: serviceselection.FieldTypeSelect,
				})
			},
			wantErr: "cannot mix",
		},
		{
			name: "different media kind",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.Kind = "video"
			},
			wantErr: "does not match confirmed kind",
		},
		{
			name: "route changed after confirmation",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.RouteID = "route-b"
			},
			wantErr: "does not match confirmed route",
		},
		{
			name: "legacy model override",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.Model = "unconfirmed-model"
			},
			wantErr: "model overrides are not allowed",
		},
		{
			name: "params changed after confirmation",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.Params["n"] = 2
			},
			wantErr: "do not match",
		},
		{
			name: "reference assets without images field",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.ReferenceAssetIDs = []string{"asset-unconfirmed"}
			},
			wantErr: "reference assets do not match",
		},
		{
			name: "optimization without prompt optimization field",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.PromptOptimization = &mediamcp.GenerationPromptOptimizationInput{
					ReferencePrompt: "unconfirmed",
				}
			},
			wantErr: "was not enabled",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			record := confirmedGenerationSelectionRecord()
			input := baseInput
			input.Params = map[string]any{"aspectRatio": "3:4", "n": 1}
			if test.mutate != nil {
				test.mutate(&record, &input)
			}
			service := &generationMCPServiceStub{}
			server := &GenerationServer{
				service:    service,
				projectID:  "project-a",
				sessionID:  "session-a",
				runID:      "run-a",
				selections: &generationSelectionStoreStub{record: record, missing: test.missing, err: test.lookupErr},
			}

			_, err := server.CreateGenerationMessage(context.Background(), "", input)
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("CreateGenerationMessage() error = %v, want fragment %q", err, test.wantErr)
				}
			} else if err != nil {
				t.Fatalf("CreateGenerationMessage() error = %v", err)
			}
			if got := len(service.createRequests); got != boolCount(test.wantCreate) {
				t.Fatalf("create request count = %d, want %d", got, boolCount(test.wantCreate))
			}
		})
	}
}

func confirmedGenerationSelectionRecord() serviceselection.Record {
	return serviceselection.Record{
		ID:        "selection-confirmed",
		ProjectID: "project-a",
		SessionID: "session-a",
		RunID:     "run-a",
		Kind:      serviceselection.KindGenerationPlan,
		Status:    serviceselection.StatusSubmitted,
		Fields: []serviceselection.FormField{{
			ID:   "generation",
			Type: serviceselection.FieldTypeGenerationSettings,
			Kind: "image",
		}},
		Decision: &serviceselection.Decision{Values: map[string]any{
			"generation": map[string]any{
				"kind":    "image",
				"routeId": "route-a",
				"params": map[string]any{
					"aspectRatio": "3:4",
					"n":           float64(1),
				},
				"referenceAssetIds": []any{},
				"promptSupplements": []any{},
				"promptOptimization": map[string]any{
					"enabled": false,
				},
			},
		}},
	}
}

func TestGenerationServerConfirmationCoversReferencesAndPromptOptimization(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*serviceselection.Record, *mediamcp.GenerationMessageInput)
		wantErr string
	}{
		{name: "exact optional settings"},
		{
			name: "different reference asset",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.ReferenceAssetIDs = []string{"asset-a", "asset-c"}
			},
			wantErr: "reference assets do not match",
		},
		{
			name: "unconfirmed reference url",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.ReferenceURLs = []string{"https://example.test/reference.png"}
			},
			wantErr: "must use only the asset ids",
		},
		{
			name: "unconfirmed reference binding",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.ReferenceBindings = []mediamcp.GenerationReferenceBinding{{AssetID: "asset-a"}}
			},
			wantErr: "must use only the asset ids",
		},
		{
			name: "missing enabled prompt optimization",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.PromptOptimization = nil
			},
			wantErr: "prompt optimization does not match",
		},
		{
			name: "changed prompt optimization route",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.PromptOptimization.RouteID = "text-route-b"
			},
			wantErr: "prompt optimization does not match",
		},
		{
			name: "unconfirmed prompt optimization model",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.PromptOptimization.Model = "unconfirmed-model"
			},
			wantErr: "prompt optimization does not match",
		},
		{
			name: "disabled prompt optimization",
			mutate: func(record *serviceselection.Record, _ *mediamcp.GenerationMessageInput) {
				settings := record.Decision.Values["generation"].(map[string]any)
				settings["promptOptimization"] = map[string]any{"enabled": false}
			},
			wantErr: "was not enabled",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			record := confirmedGenerationSelectionRecord()
			settings := record.Decision.Values["generation"].(map[string]any)
			settings["referenceAssetIds"] = []any{"asset-a", "asset-b"}
			settings["promptOptimization"] = map[string]any{
				"enabled":         true,
				"routeId":         "text-route-a",
				"referenceName":   "角色定妆",
				"referencePrompt": "cinematic portrait",
			}
			input := mediamcp.GenerationMessageInput{
				ConfirmationSelectionID: record.ID,
				Kind:                    "image",
				RouteID:                 "route-a",
				Params:                  map[string]any{"aspectRatio": "3:4", "n": 1},
				ReferenceAssetIDs:       []string{"asset-a", "asset-b"},
				PromptOptimization: &mediamcp.GenerationPromptOptimizationInput{
					RouteID:         "text-route-a",
					ReferenceName:   "角色定妆",
					ReferencePrompt: "cinematic portrait",
				},
			}
			if test.mutate != nil {
				test.mutate(&record, &input)
			}
			server := &GenerationServer{
				projectID:  "project-a",
				sessionID:  "session-a",
				runID:      "run-a",
				selections: &generationSelectionStoreStub{record: record},
			}

			err := server.authorizeGeneration(input, "image")
			if test.wantErr == "" && err != nil {
				t.Fatalf("authorizeGeneration() error = %v", err)
			}
			if test.wantErr != "" && (err == nil || !strings.Contains(err.Error(), test.wantErr)) {
				t.Fatalf("authorizeGeneration() error = %v, want fragment %q", err, test.wantErr)
			}
		})
	}
}

func TestGenerationServerBatchReportsUnconfirmedItemWithoutRejectingSiblings(t *testing.T) {
	record := confirmedGenerationSelectionRecord()
	service := &generationMCPServiceStub{}
	server := &GenerationServer{
		service:    service,
		projectID:  "project-a",
		sessionID:  "session-a",
		runID:      "run-a",
		selections: &generationSelectionStoreStub{record: record},
	}

	output, err := server.CreateGenerationBatch(context.Background(), "", mediamcp.GenerationBatchInput{
		Kind: "image",
		Items: []mediamcp.GenerationBatchItemInput{
			{
				ID: "confirmed",
				Request: mediamcp.GenerationMessageInput{
					ConfirmationSelectionID: record.ID,
					Kind:                    "image",
					RouteID:                 "route-a",
					Params:                  map[string]any{"aspectRatio": "3:4", "n": 1},
					Prompt:                  "generate confirmed",
				},
			},
			{
				ID: "missing-confirmation",
				Request: mediamcp.GenerationMessageInput{
					Kind:    "image",
					RouteID: "route-a",
					Params:  map[string]any{"aspectRatio": "3:4", "n": 1},
					Prompt:  "must not generate",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateGenerationBatch() error = %v", err)
	}
	if output.Status != "partial" || output.Accepted != 1 || output.Failed != 1 {
		t.Fatalf("output = %+v, want partial success", output)
	}
	if len(service.batchRequests) != 1 || len(service.batchRequests[0].Items) != 2 {
		t.Fatalf("batch requests = %+v, want both items passed to the batch service", service.batchRequests)
	}
	items := service.batchRequests[0].Items
	if items[0].PreflightError != "" || !strings.Contains(items[1].PreflightError, "confirmationSelectionId") {
		t.Fatalf("batch items = %+v, want only the unconfirmed item rejected", items)
	}
}

func TestGenerationServerCreateLibTVImageUsesExistingPayload(t *testing.T) {
	service := &generationMCPServiceStub{}
	server := &GenerationServer{service: service, projectID: "project-a"}

	_, err := server.CreateGenerationMessage(context.Background(), "", mediamcp.GenerationMessageInput{
		Kind:          string(coregeneration.KindImage),
		RouteID:       coregeneration.RouteLibTVGPTImage2,
		Prompt:        "generate a character portrait",
		ReferenceURLs: []string{"https://example.com/reference.png"},
		Params: map[string]any{
			"aspectRatio": "1:1",
			"resolution":  "2K",
		},
	})
	if err != nil {
		t.Fatalf("CreateGenerationMessage returned error: %v", err)
	}
	if len(service.createRequests) != 1 {
		t.Fatalf("create request count = %d, want 1", len(service.createRequests))
	}
	request := service.createRequests[0]
	if request.Kind != string(coregeneration.KindImage) || request.RouteID != coregeneration.RouteLibTVGPTImage2 {
		t.Fatalf("request = %+v, want LibTV image route", request)
	}
	if len(request.ReferenceURLs) != 1 || request.ReferenceURLs[0] != "https://example.com/reference.png" {
		t.Fatalf("reference URLs = %#v, want existing image reference payload", request.ReferenceURLs)
	}
	if request.Params["aspectRatio"] != "1:1" || request.Params["resolution"] != "2K" {
		t.Fatalf("params = %#v, want existing generation params unchanged", request.Params)
	}
}

func TestGenerationServerCreateBatchUsesScopedProject(t *testing.T) {
	service := &generationMCPServiceStub{}
	server := &GenerationServer{service: service, projectID: "project-a"}

	output, err := server.CreateGenerationBatch(context.Background(), "", mediamcp.GenerationBatchInput{
		Kind:              "image",
		ConversationID:    "project-a-image",
		ConversationTitle: "Project A · 图片",
		ScopeID:           "agent",
		Items: []mediamcp.GenerationBatchItemInput{
			{ID: "scene-1", Request: mediamcp.GenerationMessageInput{Prompt: "generate scene one"}},
			{ID: "scene-2", Request: mediamcp.GenerationMessageInput{Prompt: "generate scene two"}},
		},
	})
	if err != nil {
		t.Fatalf("CreateGenerationBatch returned error: %v", err)
	}
	if len(service.batchRequests) != 1 || service.batchRequests[0].ProjectID != "project-a" {
		t.Fatalf("batch requests = %+v, want scoped project", service.batchRequests)
	}
	if service.batchRequests[0].ConversationID != "project-a-image" || service.batchRequests[0].Kind != "image" {
		t.Fatalf("batch request = %+v, want shared conversation", service.batchRequests[0])
	}
	if len(service.batchRequests[0].Items) != 2 || service.batchRequests[0].Items[1].Request.ProjectID != "project-a" {
		t.Fatalf("batch items = %+v, want inherited project", service.batchRequests[0].Items)
	}
	if output.ID != "generation-batch-test" || len(output.Items) != 2 || output.Items[0].TaskID != "task-1" {
		t.Fatalf("output = %+v, want converted batch response", output)
	}
}

func TestGenerationServerCreateBatchRejectsNestedProjectOverride(t *testing.T) {
	service := &generationMCPServiceStub{}
	server := &GenerationServer{service: service, projectID: "project-a"}

	_, err := server.CreateGenerationBatch(context.Background(), "", mediamcp.GenerationBatchInput{
		Items: []mediamcp.GenerationBatchItemInput{
			{ID: "scene-1", Request: mediamcp.GenerationMessageInput{ProjectID: "project-b", Prompt: "generate"}},
		},
	})
	if err == nil {
		t.Fatal("CreateGenerationBatch returned nil error, want project scope error")
	}
	if len(service.batchRequests) != 0 {
		t.Fatalf("batch request count = %d, want 0", len(service.batchRequests))
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
			RouteIDs:      map[string]string{"image": "jimeng.seedream-5.0"},
			RouteParams:   map[string]map[string]any{"jimeng.seedream-5.0": {"aspectRatio": "3:4"}},
			StylePresetID: "legacy-style-preset",
		},
		preferenceOK: true,
	}
	server := &GenerationServer{service: service, projectID: "project-a"}

	output, err := server.ListGenerationModels(context.Background(), mediamcp.GenerationListModelsInput{})
	if err != nil {
		t.Fatalf("ListGenerationModels returned error: %v", err)
	}
	if output.Preferences == nil || output.Preferences.RouteIDs["image"] != "jimeng.seedream-5.0" {
		t.Fatalf("preferences = %#v, want workbench route defaults", output.Preferences)
	}
	payload, err := json.Marshal(output)
	if err != nil {
		t.Fatalf("json.Marshal(output) error = %v", err)
	}
	if strings.Contains(string(payload), "stylePresetId") {
		t.Fatalf("Agent generation preferences leaked legacy stylePresetId: %s", payload)
	}

	server.service = &generationMCPServiceStub{}
	output, err = server.ListGenerationModels(context.Background(), mediamcp.GenerationListModelsInput{})
	if err != nil {
		t.Fatalf("ListGenerationModels returned error: %v", err)
	}
	if output.Preferences != nil {
		t.Fatalf("preferences = %#v, want nil when unset", output.Preferences)
	}
}

func TestGenerationServerListModelsIncludesLibTVImageRoutes(t *testing.T) {
	routeIDs := []string{
		coregeneration.RouteLibTVGPTImage2,
		coregeneration.RouteLibTVNanoBanana31,
		coregeneration.RouteLibTVSeedream5Lite,
	}
	routes := make([]coregeneration.ModelRoute, 0, len(routeIDs))
	for _, routeID := range routeIDs {
		route, ok := coregeneration.FindRoute(routeID)
		if !ok {
			t.Fatalf("route %q is missing from the core catalog", routeID)
		}
		route.Configured = true
		routes = append(routes, route)
	}
	service := &generationMCPServiceStub{
		models: servicegeneration.GenerationModelsResponse{Routes: routes},
	}
	server := &GenerationServer{service: service, projectID: "project-a"}

	output, err := server.ListGenerationModels(context.Background(), mediamcp.GenerationListModelsInput{
		Kind: string(coregeneration.KindImage),
	})
	if err != nil {
		t.Fatalf("ListGenerationModels returned error: %v", err)
	}
	if len(output.Routes) != len(routeIDs) {
		t.Fatalf("routes = %#v, want three LibTV image routes", output.Routes)
	}
	for index, route := range output.Routes {
		if route.ID != routeIDs[index] || route.Kind != coregeneration.KindImage || !route.Configured {
			t.Errorf("route[%d] = %+v, want configured LibTV image route %q", index, route, routeIDs[index])
		}
	}
}

type generationMCPServiceStub struct {
	batchRequests    []servicegeneration.GenerationBatchRequest
	createRequests   []servicegeneration.GenerationMessageRequest
	optimizeRequests []servicegeneration.GenerationMessageRequest
	listQueries      []servicegeneration.GenerationTaskListQuery
	tasks            map[string]servicegeneration.GenerationTaskRecord
	models           servicegeneration.GenerationModelsResponse
	preference       servicegeneration.GenerationPreferenceRecord
	preferenceOK     bool
}

type generationSelectionStoreStub struct {
	record  serviceselection.Record
	missing bool
	err     error
}

func (store *generationSelectionStoreStub) Get(string, string) (serviceselection.Record, bool, error) {
	if store.err != nil {
		return serviceselection.Record{}, false, store.err
	}
	if store.missing {
		return serviceselection.Record{}, false, nil
	}
	return store.record, true, nil
}

func boolCount(value bool) int {
	if value {
		return 1
	}
	return 0
}

func (service *generationMCPServiceStub) ListGenerationModels() servicegeneration.GenerationModelsResponse {
	return service.models
}

func (service *generationMCPServiceStub) CreateGenerationMessage(_ context.Context, payload servicegeneration.GenerationMessageRequest) (servicegeneration.GenerationMessageResponse, int, error) {
	service.createRequests = append(service.createRequests, payload)
	return servicegeneration.GenerationMessageResponse{ID: "generation-test", Status: "completed"}, http.StatusOK, nil
}

func (service *generationMCPServiceStub) CreateGenerationBatch(_ context.Context, payload servicegeneration.GenerationBatchRequest) (servicegeneration.GenerationBatchResponse, int, error) {
	service.batchRequests = append(service.batchRequests, payload)
	response := servicegeneration.GenerationBatchResponse{
		ID:     "generation-batch-test",
		Status: "submitted",
		Total:  len(payload.Items),
		Items:  make([]servicegeneration.GenerationBatchItemResponse, len(payload.Items)),
	}
	for index, item := range payload.Items {
		result := servicegeneration.GenerationBatchItemResponse{ID: item.ID, Index: index, Status: "submitted"}
		if item.PreflightError != "" {
			result.Status = "failed"
			result.Error = item.PreflightError
			response.Failed++
		} else {
			result.TaskID = fmt.Sprintf("task-%d", index+1)
			response.Accepted++
		}
		response.Items[index] = result
	}
	if response.Failed > 0 {
		response.Status = "partial"
		if response.Accepted == 0 {
			response.Status = "failed"
		}
	}
	return response, http.StatusOK, nil
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

func TestFilterGenerationModelsOutputByKind(t *testing.T) {
	full := mediamcp.GenerationModelsOutput{
		Families: []coregeneration.ModelFamily{
			{ID: "img-family", Kind: coregeneration.KindImage},
			{ID: "audio-family", Kind: coregeneration.KindAudio},
		},
		Versions: []coregeneration.ModelVersion{
			{ID: "img-version", Kind: coregeneration.KindImage},
			{ID: "audio-version", Kind: coregeneration.KindAudio},
		},
		Routes: []coregeneration.ModelRoute{
			{ID: "img-route", Kind: coregeneration.KindImage},
			{ID: "audio-route", Kind: coregeneration.KindAudio},
		},
		Models: []coregeneration.ModelSpec{
			{ID: "img-model", Kind: coregeneration.KindImage},
		},
		VoicePreviews: []mediamcp.GenerationVoicePreviewAsset{{RouteID: "audio-route", VoiceID: "voice-1"}},
	}

	image := filterGenerationModelsOutputByKind(full, "image")
	if len(image.Families) != 1 || image.Families[0].ID != "img-family" ||
		len(image.Versions) != 1 || len(image.Routes) != 1 || len(image.Models) != 1 {
		t.Fatalf("image filter = %+v, want image-only catalog", image)
	}
	if len(image.VoicePreviews) != 0 {
		t.Fatal("image filter should drop voice previews")
	}
	audio := filterGenerationModelsOutputByKind(full, "audio")
	if len(audio.Routes) != 1 || audio.Routes[0].ID != "audio-route" || len(audio.VoicePreviews) != 1 {
		t.Fatalf("audio filter = %+v, want audio routes with voice previews", audio)
	}
	all := filterGenerationModelsOutputByKind(full, "")
	if len(all.Routes) != 2 || len(all.VoicePreviews) != 1 {
		t.Fatalf("empty kind should return the full catalog, got %+v", all)
	}
}
