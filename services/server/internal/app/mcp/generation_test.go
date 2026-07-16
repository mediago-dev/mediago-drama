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
	server := &GenerationServer{
		service:    service,
		projectID:  "project-a",
		callerMode: GenerationCallerTrustedManual,
	}

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
		{name: "lookup failure", lookupErr: fmt.Errorf("database offline"), wantErr: "reading generation confirmation"},
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
			wantErr: "no longer valid",
		},
		{
			name: "different media kind",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.Kind = "video"
			},
			wantErr: "does not exactly match",
		},
		{
			name: "route changed after confirmation",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.RouteID = "route-b"
			},
			wantErr: "does not exactly match",
		},
		{
			name: "legacy model override",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.Model = "unconfirmed-model"
			},
			wantErr: "does not exactly match",
		},
		{
			name: "params changed after confirmation",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.Params["n"] = 2
			},
			wantErr: "does not exactly match",
		},
		{
			name: "reference assets without images field",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.ReferenceAssetIDs = []string{"asset-unconfirmed"}
			},
			wantErr: "does not exactly match",
		},
		{
			name: "optimization without prompt optimization field",
			mutate: func(_ *serviceselection.Record, input *mediamcp.GenerationMessageInput) {
				input.PromptOptimization = &mediamcp.GenerationPromptOptimizationInput{
					ReferencePrompt: "unconfirmed",
				}
			},
			wantErr: "does not exactly match",
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
				callerMode: GenerationCallerAgent,
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
		Intent: &serviceselection.GenerationPlanIntent{
			Version:   serviceselection.GenerationPlanIntentVersion,
			Operation: serviceselection.GenerationPlanOperationCreateSingle,
			Items: []serviceselection.GenerationPlanIntentItem{{
				ID:     "item-1",
				Kind:   "image",
				Prompt: "generate a portrait",
			}},
		},
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

func confirmedGenerationInput() mediamcp.GenerationMessageInput {
	return mediamcp.GenerationMessageInput{
		ConfirmationSelectionID: "selection-confirmed",
		Kind:                    "image",
		RouteID:                 "route-a",
		Prompt:                  "generate a portrait",
		Params: map[string]any{
			"aspectRatio": "3:4",
			"n":           1,
		},
	}
}

func TestGenerationServerAgentCreateClaimsAndReplaysOutcome(t *testing.T) {
	record := confirmedGenerationSelectionRecord()
	input := confirmedGenerationInput()
	firstStore := &generationSelectionStoreStub{record: record}
	firstService := &generationMCPServiceStub{}
	firstServer := &GenerationServer{
		service:    firstService,
		projectID:  "project-a",
		callerMode: GenerationCallerAgent,
		sessionID:  "session-a",
		runID:      "run-a",
		selections: firstStore,
	}

	first, err := firstServer.CreateGenerationMessage(context.Background(), "", input)
	if err != nil {
		t.Fatalf("first CreateGenerationMessage() error = %v", err)
	}
	if len(firstService.createRequests) != 1 || len(firstStore.claimedFingerprints) != 1 || len(firstStore.completedOutcomes) != 1 {
		t.Fatalf(
			"create=%d claims=%d outcomes=%d, want one of each",
			len(firstService.createRequests),
			len(firstStore.claimedFingerprints),
			len(firstStore.completedOutcomes),
		)
	}

	replayStore := &generationSelectionStoreStub{
		record: record,
		claimResult: serviceselection.GenerationUseClaimResult{
			Status:  serviceselection.GenerationUseReplay,
			Outcome: firstStore.completedOutcomes[0],
		},
	}
	replayService := &generationMCPServiceStub{}
	replayServer := &GenerationServer{
		service:    replayService,
		projectID:  "project-a",
		callerMode: GenerationCallerAgent,
		sessionID:  "session-a",
		runID:      "run-a",
		selections: replayStore,
	}
	replayed, err := replayServer.CreateGenerationMessage(context.Background(), "", input)
	if err != nil {
		t.Fatalf("replayed CreateGenerationMessage() error = %v", err)
	}
	if replayed.ID != first.ID || replayed.Status != first.Status {
		t.Fatalf("replayed output = %+v, want %+v", replayed, first)
	}
	if len(replayService.createRequests) != 0 || len(replayStore.completedOutcomes) != 0 {
		t.Fatalf(
			"replay create=%d outcomes=%d, want no repeated side effect",
			len(replayService.createRequests),
			len(replayStore.completedOutcomes),
		)
	}
}

func TestGenerationServerAgentCreateBlocksUnsafeClaimStates(t *testing.T) {
	tests := []struct {
		name    string
		status  string
		wantErr string
	}{
		{name: "different fingerprint", status: serviceselection.GenerationUseConflict, wantErr: "already been consumed"},
		{name: "in progress", status: serviceselection.GenerationUseInProgressOrUnknown, wantErr: "processing or unknown"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &generationMCPServiceStub{}
			store := &generationSelectionStoreStub{
				record:      confirmedGenerationSelectionRecord(),
				claimResult: serviceselection.GenerationUseClaimResult{Status: test.status},
			}
			server := &GenerationServer{
				service:    service,
				projectID:  "project-a",
				callerMode: GenerationCallerAgent,
				sessionID:  "session-a",
				runID:      "run-a",
				selections: store,
			}

			_, err := server.CreateGenerationMessage(context.Background(), "", confirmedGenerationInput())
			if err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("CreateGenerationMessage() error = %v, want fragment %q", err, test.wantErr)
			}
			if len(service.createRequests) != 0 || len(store.completedOutcomes) != 0 {
				t.Fatalf("create=%d outcomes=%d, want no side effect", len(service.createRequests), len(store.completedOutcomes))
			}
		})
	}
}

func TestGenerationServerAgentCreateFailsClosedWithoutRunContext(t *testing.T) {
	tests := []struct {
		name       string
		projectID  string
		sessionID  string
		runID      string
		selections GenerationSelectionStore
	}{
		{name: "project", sessionID: "session-a", runID: "run-a", selections: &generationSelectionStoreStub{}},
		{name: "session", projectID: "project-a", runID: "run-a", selections: &generationSelectionStoreStub{}},
		{name: "run", projectID: "project-a", sessionID: "session-a", selections: &generationSelectionStoreStub{}},
		{name: "selection store", projectID: "project-a", sessionID: "session-a", runID: "run-a"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &generationMCPServiceStub{}
			server := &GenerationServer{
				service:    service,
				projectID:  test.projectID,
				callerMode: GenerationCallerAgent,
				sessionID:  test.sessionID,
				runID:      test.runID,
				selections: test.selections,
			}

			_, err := server.CreateGenerationMessage(context.Background(), "", confirmedGenerationInput())
			if err == nil || !strings.Contains(err.Error(), string(GenerationConfirmationContextMissing)) {
				t.Fatalf("CreateGenerationMessage() error = %v, want fail-closed context error", err)
			}
			if len(service.createRequests) != 0 {
				t.Fatalf("create request count = %d, want 0", len(service.createRequests))
			}
		})
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
				callerMode: GenerationCallerAgent,
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

func TestGenerationServerBatchUsesOneConfirmedOrderedIntent(t *testing.T) {
	record := confirmedGenerationSelectionRecord()
	record.Intent.Operation = serviceselection.GenerationPlanOperationCreateBatch
	record.Intent.Items = []serviceselection.GenerationPlanIntentItem{
		{ID: "scene-1", Kind: "image", Prompt: "generate scene one"},
		{ID: "scene-2", Kind: "image", Prompt: "generate scene two"},
	}
	service := &generationMCPServiceStub{}
	store := &generationSelectionStoreStub{record: record}
	server := &GenerationServer{
		service:    service,
		projectID:  "project-a",
		callerMode: GenerationCallerAgent,
		sessionID:  "session-a",
		runID:      "run-a",
		selections: store,
	}

	output, err := server.CreateGenerationBatch(context.Background(), "", mediamcp.GenerationBatchInput{
		ConfirmationSelectionID: record.ID,
		Kind:                    "image",
		Items: []mediamcp.GenerationBatchItemInput{
			{
				ID: "scene-1",
				Request: mediamcp.GenerationMessageInput{
					Kind:    "image",
					RouteID: "route-a",
					Params:  map[string]any{"aspectRatio": "3:4", "n": 1},
					Prompt:  "generate scene one",
				},
			},
			{
				ID: "scene-2",
				Request: mediamcp.GenerationMessageInput{
					Kind:    "image",
					RouteID: "route-a",
					Params:  map[string]any{"aspectRatio": "3:4", "n": 1},
					Prompt:  "generate scene two",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateGenerationBatch() error = %v", err)
	}
	if output.Status != "submitted" || output.Accepted != 2 || output.Failed != 0 {
		t.Fatalf("output = %+v, want complete batch submission", output)
	}
	if len(service.batchRequests) != 1 || len(service.batchRequests[0].Items) != 2 {
		t.Fatalf("batch requests = %+v, want the complete ordered batch", service.batchRequests)
	}
	if len(store.claimedFingerprints) != 1 || len(store.completedOutcomes) != 1 {
		t.Fatalf("claims=%d outcomes=%d, want one of each", len(store.claimedFingerprints), len(store.completedOutcomes))
	}
	if service.batchRequests[0].Items[0].ID != "scene-1" || service.batchRequests[0].Items[1].ID != "scene-2" {
		t.Fatalf("batch item order = %+v, want confirmed order", service.batchRequests[0].Items)
	}
}

func TestGenerationServerCreateLibTVImageUsesExistingPayload(t *testing.T) {
	service := &generationMCPServiceStub{}
	server := &GenerationServer{service: service, projectID: "project-a", callerMode: GenerationCallerTrustedManual}

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
	server := &GenerationServer{service: service, projectID: "project-a", callerMode: GenerationCallerTrustedManual}

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
	server := &GenerationServer{service: service, projectID: "project-a", callerMode: GenerationCallerTrustedManual}

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
			server := &GenerationServer{service: service, projectID: "project-a", callerMode: GenerationCallerTrustedManual}
			if _, err := server.CreateGenerationMessage(context.Background(), "", tt.input); err == nil {
				t.Fatal("CreateGenerationMessage returned nil error, want scope error")
			}
			if len(service.createRequests) != 0 {
				t.Fatalf("create request count = %d, want 0", len(service.createRequests))
			}
		})
	}
}

func TestGenerationServerCreateWithPromptOptimization(t *testing.T) {
	service := &generationMCPServiceStub{}
	server := &GenerationServer{service: service, projectID: "project-a", callerMode: GenerationCallerTrustedManual}

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

type generationMCPServiceStub struct {
	batchRequests    []servicegeneration.GenerationBatchRequest
	createRequests   []servicegeneration.GenerationMessageRequest
	optimizeRequests []servicegeneration.GenerationMessageRequest
}

type generationSelectionStoreStub struct {
	record              serviceselection.Record
	missing             bool
	err                 error
	claimResult         serviceselection.GenerationUseClaimResult
	claimErr            error
	completeErr         error
	claimedFingerprints []string
	completedOutcomes   []json.RawMessage
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

func (store *generationSelectionStoreStub) ClaimGenerationUse(
	projectID string,
	sessionID string,
	runID string,
	selectionID string,
	fingerprint string,
) (serviceselection.GenerationUseClaimResult, error) {
	store.claimedFingerprints = append(store.claimedFingerprints, fingerprint)
	if store.claimErr != nil {
		return serviceselection.GenerationUseClaimResult{}, store.claimErr
	}
	if store.claimResult.Status == "" {
		return serviceselection.GenerationUseClaimResult{Status: serviceselection.GenerationUseClaimed}, nil
	}
	return store.claimResult, nil
}

func (store *generationSelectionStoreStub) CompleteGenerationUse(
	projectID string,
	selectionID string,
	fingerprint string,
	outcome json.RawMessage,
) error {
	store.completedOutcomes = append(store.completedOutcomes, append(json.RawMessage(nil), outcome...))
	return store.completeErr
}

func boolCount(value bool) int {
	if value {
		return 1
	}
	return 0
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

func (service *generationMCPServiceStub) CreatePromptOptimizedGenerationMessage(_ context.Context, payload servicegeneration.GenerationMessageRequest) (servicegeneration.GenerationOptimizeAndGenerateResponse, int, error) {
	service.optimizeRequests = append(service.optimizeRequests, payload)
	return servicegeneration.GenerationOptimizeAndGenerateResponse{
		Generation:      servicegeneration.GenerationMessageResponse{ID: "generation-optimized", Status: "submitted"},
		OptimizedPrompt: "optimized: " + payload.Prompt,
	}, http.StatusOK, nil
}
