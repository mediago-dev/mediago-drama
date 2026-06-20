package generation

import (
	"context"
	"path/filepath"
	"testing"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
)

func TestPreviewGenerationVoiceGeneratesSampleWithoutPersistingTask(t *testing.T) {
	store := NewGenerationTaskService(filepath.Join(t.TempDir(), "settings.db"), nil)
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{
			coregeneration.ProviderMiniMax: "sk-minimax",
		},
	})
	provider := &recordingAudioPreviewProvider{
		response: coregeneration.Response{
			Status: "completed",
			Assets: []coregeneration.Asset{{
				Kind:     coregeneration.KindAudio,
				Base64:   "bXAz",
				MIMEType: "audio/mpeg",
			}},
		},
	}
	workflow := NewGenerationService(settingsSvc, store, nil)
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		if route.ID != coregeneration.RouteOfficialMiniMaxSpeech28Turbo {
			t.Fatalf("route = %q, want MiniMax speech turbo", route.ID)
		}
		return provider, nil
	}

	response, status, err := workflow.PreviewGenerationVoice(context.Background(), GenerationVoicePreviewRequest{
		RouteID: coregeneration.RouteOfficialMiniMaxSpeech28Turbo,
		VoiceID: "English_Aussie_Bloke",
		Params:  map[string]any{"speed": 1.2},
	})
	if err != nil || status != 200 {
		t.Fatalf("PreviewGenerationVoice() status = %d error = %v", status, err)
	}
	if response.Asset.Kind != string(coregeneration.KindAudio) || response.Asset.Base64 != "bXAz" {
		t.Fatalf("response asset = %+v, want audio base64 preview", response.Asset)
	}
	if provider.request == nil {
		t.Fatal("provider was not called")
	}
	if provider.request.Prompt != generationVoicePreviewPrompt {
		t.Fatalf("provider prompt = %q, want preview prompt", provider.request.Prompt)
	}
	if provider.request.Params["voiceId"] != "English_Aussie_Bloke" {
		t.Fatalf("provider params = %#v, want selected voiceId", provider.request.Params)
	}
	if provider.request.Params["speed"] != 1.2 {
		t.Fatalf("provider params = %#v, want requested speed", provider.request.Params)
	}
	tasks, err := store.List()
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(tasks) != 0 {
		t.Fatalf("task count = %d, want preview to skip history", len(tasks))
	}
}

type recordingAudioPreviewProvider struct {
	request  *coregeneration.Request
	response coregeneration.Response
}

func (provider *recordingAudioPreviewProvider) Name() string {
	return "recording-audio-preview"
}

func (provider *recordingAudioPreviewProvider) Generate(_ context.Context, request coregeneration.Request) (coregeneration.Response, error) {
	provider.request = &request
	return provider.response, nil
}

func (provider *recordingAudioPreviewProvider) Get(context.Context, string) (coregeneration.Response, error) {
	return coregeneration.Response{}, nil
}
