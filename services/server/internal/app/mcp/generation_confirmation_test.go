package mcp

import (
	"strings"
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	serviceselection "github.com/mediago-dev/mediago-drama/services/server/internal/service/selection"
)

func TestAuthorizeGenerationMatchesCompleteImageSettingsSnapshot(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*mediamcp.GenerationMessageInput)
		wantErr string
	}{
		{name: "exact snapshot"},
		{
			name: "route changed",
			mutate: func(input *mediamcp.GenerationMessageInput) {
				input.RouteID = "route-b"
			},
			wantErr: "route",
		},
		{
			name: "params changed",
			mutate: func(input *mediamcp.GenerationMessageInput) {
				input.Params["n"] = 2
			},
			wantErr: "params",
		},
		{
			name: "reference assets changed",
			mutate: func(input *mediamcp.GenerationMessageInput) {
				input.ReferenceAssetIDs = []string{"asset-a", "asset-c"}
			},
			wantErr: "reference assets",
		},
		{
			name: "prompt supplement id changed",
			mutate: func(input *mediamcp.GenerationMessageInput) {
				input.PromptSupplements[0].ReferenceID = "pack-other"
			},
			wantErr: "prompt supplements",
		},
		{
			name: "prompt supplement name changed",
			mutate: func(input *mediamcp.GenerationMessageInput) {
				input.PromptSupplements[0].ReferenceName = "其他风格"
			},
			wantErr: "prompt supplements",
		},
		{
			name: "prompt supplement prompt changed",
			mutate: func(input *mediamcp.GenerationMessageInput) {
				input.PromptSupplements[0].ReferencePrompt = "different"
			},
			wantErr: "prompt supplements",
		},
		{
			name: "prompt supplements reordered",
			mutate: func(input *mediamcp.GenerationMessageInput) {
				input.PromptSupplements[0], input.PromptSupplements[1] = input.PromptSupplements[1], input.PromptSupplements[0]
			},
			wantErr: "prompt supplements",
		},
		{
			name: "prompt optimization removed",
			mutate: func(input *mediamcp.GenerationMessageInput) {
				input.PromptOptimization = nil
			},
			wantErr: "prompt optimization",
		},
		{
			name: "prompt optimization changed",
			mutate: func(input *mediamcp.GenerationMessageInput) {
				input.PromptOptimization.ReferencePrompt = "different"
			},
			wantErr: "prompt optimization",
		},
		{
			name: "model override",
			mutate: func(input *mediamcp.GenerationMessageInput) {
				input.Model = "unconfirmed-model"
			},
			wantErr: "model overrides",
		},
		{
			name: "reference url override",
			mutate: func(input *mediamcp.GenerationMessageInput) {
				input.ReferenceURLs = []string{"https://example.test/reference.png"}
			},
			wantErr: "only the asset ids",
		},
		{
			name: "reference binding override",
			mutate: func(input *mediamcp.GenerationMessageInput) {
				input.ReferenceBindings = []mediamcp.GenerationReferenceBinding{{AssetID: "asset-a"}}
			},
			wantErr: "only the asset ids",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			record, input := completeImageGenerationConfirmation()
			if tt.mutate != nil {
				tt.mutate(&input)
			}
			server := confirmedGenerationServer(record)

			err := server.authorizeGeneration(input, "image")
			if tt.wantErr == "" && err != nil {
				t.Fatalf("authorizeGeneration() error = %v", err)
			}
			if tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)) {
				t.Fatalf("authorizeGeneration() error = %v, want fragment %q", err, tt.wantErr)
			}
		})
	}
}

func TestAuthorizeGenerationRequiresConfirmationFromSameProject(t *testing.T) {
	record, input := completeImageGenerationConfirmation()
	record.ProjectID = "project-b"

	err := confirmedGenerationServer(record).authorizeGeneration(input, "image")
	if err == nil || !strings.Contains(err.Error(), "different project") {
		t.Fatalf("authorizeGeneration() error = %v, want different-project rejection", err)
	}
}

func TestAuthorizeGenerationRejectsMalformedImageConfirmationContracts(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*serviceselection.Record)
		wantErr string
	}{
		{
			name: "legacy image field",
			mutate: func(record *serviceselection.Record) {
				record.Fields[0].Type = serviceselection.FieldTypeGenerationParams
			},
			wantErr: "kind=video",
		},
		{
			name: "mixed image fields",
			mutate: func(record *serviceselection.Record) {
				record.Fields = append(record.Fields, serviceselection.FormField{ID: "refs", Type: serviceselection.FieldTypeImages})
			},
			wantErr: "cannot mix",
		},
		{
			name: "value kind changed",
			mutate: func(record *serviceselection.Record) {
				record.Decision.Values["generation"].(map[string]any)["kind"] = "video"
			},
			wantErr: "kind=image",
		},
		{
			name: "missing prompt supplements",
			mutate: func(record *serviceselection.Record) {
				delete(record.Decision.Values["generation"].(map[string]any), "promptSupplements")
			},
			wantErr: "promptSupplements",
		},
		{
			name: "submitted without values",
			mutate: func(record *serviceselection.Record) {
				record.Decision.Values = nil
			},
			wantErr: "missing field",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			record, input := completeImageGenerationConfirmation()
			tt.mutate(&record)

			err := confirmedGenerationServer(record).authorizeGeneration(input, "image")
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("authorizeGeneration() error = %v, want fragment %q", err, tt.wantErr)
			}
		})
	}
}

func TestAuthorizeGenerationKeepsLegacyVideoConfirmation(t *testing.T) {
	record := serviceselection.Record{
		ID:        "selection-video",
		ProjectID: "project-a",
		SessionID: "session-a",
		RunID:     "run-a",
		Kind:      serviceselection.KindGenerationPlan,
		Status:    serviceselection.StatusSubmitted,
		Fields: []serviceselection.FormField{
			{ID: "generation", Type: serviceselection.FieldTypeGenerationParams, Kind: "video"},
			{ID: "refs", Type: serviceselection.FieldTypeImages},
			{ID: "optimize", Type: serviceselection.FieldTypePromptOptimization},
		},
		Decision: &serviceselection.Decision{Values: map[string]any{
			"generation": map[string]any{
				"routeId": "route-video",
				"params":  map[string]any{"duration": float64(5)},
			},
			"refs": []any{"asset-first-frame"},
			"optimize": map[string]any{
				"enabled":         true,
				"routeId":         "route-text",
				"referenceName":   "运镜优化",
				"referencePrompt": "强化镜头运动",
			},
		}},
	}
	input := mediamcp.GenerationMessageInput{
		ConfirmationSelectionID: record.ID,
		Kind:                    "video",
		RouteID:                 "route-video",
		Params:                  map[string]any{"duration": 5},
		ReferenceAssetIDs:       []string{"asset-first-frame"},
		PromptOptimization: &mediamcp.GenerationPromptOptimizationInput{
			RouteID:         "route-text",
			ReferenceName:   "运镜优化",
			ReferencePrompt: "强化镜头运动",
		},
	}
	server := confirmedGenerationServer(record)

	if err := server.authorizeGeneration(input, "video"); err != nil {
		t.Fatalf("authorizeGeneration() error = %v", err)
	}
	input.PromptSupplements = []mediamcp.GenerationPromptSupplementInput{{ReferencePrompt: "unconfirmed"}}
	if err := server.authorizeGeneration(input, "video"); err == nil || !strings.Contains(err.Error(), "prompt supplements") {
		t.Fatalf("authorizeGeneration() error = %v, want unconfirmed supplements rejection", err)
	}
}

func completeImageGenerationConfirmation() (serviceselection.Record, mediamcp.GenerationMessageInput) {
	record := serviceselection.Record{
		ID:        "selection-image-complete",
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
				"kind":              "image",
				"routeId":           "route-image",
				"label":             "Seedream 5",
				"params":            map[string]any{"aspectRatio": "3:4", "n": float64(1)},
				"referenceAssetIds": []any{"asset-a", "asset-b"},
				"promptSupplements": []any{
					map[string]any{"referenceId": "pack-style", "referenceName": "二维动画", "referencePrompt": "干净的二维动画线条"},
					map[string]any{"referenceId": "pack-light", "referenceName": "光影", "referencePrompt": "柔和电影光"},
				},
				"promptOptimization": map[string]any{
					"enabled":         true,
					"routeId":         "route-text",
					"label":           "文本优化模型",
					"referenceId":     "pack-optimize",
					"referenceName":   "电影感优化",
					"referencePrompt": "增强镜头语言与光影层次",
				},
			},
		}},
	}
	input := mediamcp.GenerationMessageInput{
		ConfirmationSelectionID: record.ID,
		Kind:                    "image",
		RouteID:                 "route-image",
		Params:                  map[string]any{"aspectRatio": "3:4", "n": 1},
		ReferenceAssetIDs:       []string{"asset-a", "asset-b"},
		PromptSupplements: []mediamcp.GenerationPromptSupplementInput{
			{ReferenceID: "pack-style", ReferenceName: "二维动画", ReferencePrompt: "干净的二维动画线条"},
			{ReferenceID: "pack-light", ReferenceName: "光影", ReferencePrompt: "柔和电影光"},
		},
		PromptOptimization: &mediamcp.GenerationPromptOptimizationInput{
			RouteID:         "route-text",
			ReferenceName:   "电影感优化",
			ReferencePrompt: "增强镜头语言与光影层次",
		},
	}
	return record, input
}

func confirmedGenerationServer(record serviceselection.Record) *GenerationServer {
	return &GenerationServer{
		projectID:  "project-a",
		sessionID:  "session-a",
		runID:      "run-a",
		selections: &generationSelectionStoreStub{record: record},
	}
}
