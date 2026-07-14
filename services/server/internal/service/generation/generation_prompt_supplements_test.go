package generation

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
)

func TestNormalizeGenerationPromptSupplements(t *testing.T) {
	input := []GenerationPromptSupplementRequest{
		{ReferenceID: " pack-style ", ReferenceName: " 电影质感 ", ReferencePrompt: " cinematic lighting "},
		{ReferenceID: "", ReferenceName: "空内容", ReferencePrompt: "  "},
		{ReferenceID: "pack-style", ReferenceName: "重复 ID", ReferencePrompt: "different snapshot"},
		{ReferenceID: "pack-camera", ReferenceName: "镜头", ReferencePrompt: "cinematic lighting"},
		{ReferenceID: "pack-detail", ReferenceName: " 细节 ", ReferencePrompt: " detailed textures "},
	}

	want := []GenerationPromptSupplementRequest{
		{ReferenceID: "pack-style", ReferenceName: "电影质感", ReferencePrompt: "cinematic lighting"},
		{ReferenceID: "pack-detail", ReferenceName: "细节", ReferencePrompt: "detailed textures"},
	}
	if got := NormalizeGenerationPromptSupplements(input); !reflect.DeepEqual(got, want) {
		t.Fatalf("NormalizeGenerationPromptSupplements() = %#v, want %#v", got, want)
	}
}

func TestApplyGenerationPromptSupplements(t *testing.T) {
	tests := []struct {
		name        string
		prompt      string
		supplements []GenerationPromptSupplementRequest
		want        string
	}{
		{
			name:   "appends in order",
			prompt: "base prompt",
			supplements: []GenerationPromptSupplementRequest{
				{ReferencePrompt: "first supplement"},
				{ReferencePrompt: "second supplement"},
			},
			want: "base prompt\n\nfirst supplement\n\nsecond supplement",
		},
		{
			name:   "does not append a supplement already contained in full",
			prompt: "base prompt\n\nfirst supplement",
			supplements: []GenerationPromptSupplementRequest{
				{ReferencePrompt: "first supplement"},
				{ReferencePrompt: "second supplement"},
			},
			want: "base prompt\n\nfirst supplement\n\nsecond supplement",
		},
		{
			name:        "supplements can provide the entire prompt",
			prompt:      "  ",
			supplements: []GenerationPromptSupplementRequest{{ReferencePrompt: "only supplement"}},
			want:        "only supplement",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := ApplyGenerationPromptSupplements(test.prompt, test.supplements); got != test.want {
				t.Fatalf("ApplyGenerationPromptSupplements() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestCreateGenerationMessageAppliesPromptSupplements(t *testing.T) {
	workflow := newPromptSupplementsTestWorkflow(t)
	provider := &recordingPromptSupplementsProvider{started: make(chan coregeneration.Request, 1)}
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		if route.ID != coregeneration.RouteDMXGPTImage2 {
			return nil, fmt.Errorf("unexpected route %q", route.ID)
		}
		return provider, nil
	}

	_, status, err := workflow.CreateGenerationMessage(context.Background(), GenerationMessageRequest{
		Kind:    string(coregeneration.KindImage),
		RouteID: coregeneration.RouteDMXGPTImage2,
		Prompt:  "base prompt",
		PromptSupplements: []GenerationPromptSupplementRequest{
			{ReferenceID: "pack-style", ReferencePrompt: "cinematic lighting"},
			{ReferenceID: "pack-camera", ReferencePrompt: "close-up camera"},
		},
		Params: map[string]any{
			"aspectRatio": "1:1",
			"resolution":  "1K",
			"n":           1,
		},
	})
	if err != nil || status != http.StatusOK {
		t.Fatalf("CreateGenerationMessage() status = %d error = %v", status, err)
	}
	request := waitForPromptSupplementsProviderRequest(t, provider.started)
	if request.Prompt != "base prompt\n\ncinematic lighting\n\nclose-up camera" {
		t.Fatalf("provider prompt = %q", request.Prompt)
	}
}

func TestCreatePromptOptimizedGenerationMessageAppliesPromptSupplementsBeforeOptimization(t *testing.T) {
	workflow := newPromptSupplementsTestWorkflow(t)
	imageProvider := &recordingPromptSupplementsProvider{started: make(chan coregeneration.Request, 1)}
	var textRequest coregeneration.Request
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		switch route.ID {
		case coregeneration.RouteDMXGPT41MiniText:
			return fakeTextStreamProvider{
				request: &textRequest,
				events: []coregeneration.TextStreamEvent{
					{Delta: "optimized prompt"},
					{Done: true},
				},
			}, nil
		case coregeneration.RouteDMXGPTImage2:
			return imageProvider, nil
		default:
			return nil, fmt.Errorf("unexpected route %q", route.ID)
		}
	}

	response, status, err := workflow.CreatePromptOptimizedGenerationMessage(context.Background(), GenerationMessageRequest{
		Kind:    string(coregeneration.KindImage),
		RouteID: coregeneration.RouteDMXGPTImage2,
		Prompt:  "base prompt",
		PromptSupplements: []GenerationPromptSupplementRequest{
			{ReferenceID: "pack-style", ReferencePrompt: "cinematic lighting"},
		},
		PromptOptimization: &GenerationPromptOptimizationRequest{
			RouteID:         coregeneration.RouteDMXGPT41MiniText,
			ReferencePrompt: "high quality",
		},
		Params: map[string]any{
			"aspectRatio": "1:1",
			"resolution":  "1K",
			"n":           1,
		},
	})
	if err != nil || status != http.StatusOK {
		t.Fatalf("CreatePromptOptimizedGenerationMessage() status = %d error = %v", status, err)
	}
	if !strings.Contains(textRequest.Prompt, "用户的输入：\nbase prompt\n\ncinematic lighting") {
		t.Fatalf("optimization prompt = %q, want appended supplement", textRequest.Prompt)
	}
	imageRequest := waitForPromptSupplementsProviderRequest(t, imageProvider.started)
	if response.OptimizedPrompt != "optimized prompt" || imageRequest.Prompt != "optimized prompt" {
		t.Fatalf("response = %+v, image prompt = %q", response, imageRequest.Prompt)
	}
	if strings.Contains(imageRequest.Prompt, "cinematic lighting") {
		t.Fatalf("image prompt = %q, supplement was applied twice", imageRequest.Prompt)
	}
}

func waitForPromptSupplementsProviderRequest(t *testing.T, started <-chan coregeneration.Request) coregeneration.Request {
	t.Helper()
	select {
	case request := <-started:
		return request
	case <-time.After(2 * time.Second):
		t.Fatal("generation provider did not start")
		return coregeneration.Request{}
	}
}

func newPromptSupplementsTestWorkflow(t *testing.T) *GenerationService {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	repo, err := repository.NewGenerationTaskRepository(dbPath)
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, nil)
	settingsService := settings.NewSettings(&generationTestAPIKeyStore{values: map[string]string{
		coregeneration.ProviderDMX: "sk-test",
	}})
	return NewGenerationService(settingsService, store, media.NewMediaAssets(dbPath, t.TempDir()))
}

type recordingPromptSupplementsProvider struct {
	started chan coregeneration.Request
}

func (provider *recordingPromptSupplementsProvider) Name() string {
	return "recording-prompt-supplements"
}

func (provider *recordingPromptSupplementsProvider) Generate(_ context.Context, request coregeneration.Request) (coregeneration.Response, error) {
	provider.started <- request
	return coregeneration.Response{
		ID:     "prompt-supplements-response",
		Model:  request.Model,
		Status: "completed",
	}, nil
}

func (provider *recordingPromptSupplementsProvider) Get(context.Context, string) (coregeneration.Response, error) {
	return coregeneration.Response{}, nil
}
