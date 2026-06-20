package generation

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"testing/fstest"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestPreviewGenerationVoiceUsesLocalBundledSample(t *testing.T) {
	store := NewGenerationTaskService(filepath.Join(t.TempDir(), "settings.db"), nil)
	workflow := NewGenerationService(nil, store, nil)
	workflow.voicePreviews = testVoicePreviewStore(t)
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		t.Fatalf("provider should not be called for local voice previews; route=%s", route.ID)
		return nil, nil
	}

	response, status, err := workflow.PreviewGenerationVoice(context.Background(), GenerationVoicePreviewRequest{
		RouteID: coregeneration.RouteOfficialMiniMaxSpeech28Turbo,
		VoiceID: "English_Aussie_Bloke",
		Params:  map[string]any{"speed": 1.2},
	})
	if err != nil || status != 200 {
		t.Fatalf("PreviewGenerationVoice() status = %d error = %v", status, err)
	}
	if response.Asset.Kind != string(coregeneration.KindAudio) {
		t.Fatalf("asset kind = %q, want audio", response.Asset.Kind)
	}
	if response.Asset.Base64 != "" {
		t.Fatalf("asset base64 = %q, want local URL only", response.Asset.Base64)
	}
	wantURL := "/api/v1/generation/voice-previews/official.minimax-speech-2.8-turbo/English_Aussie_Bloke"
	if response.Asset.URL != wantURL || response.Asset.MIMEType != "audio/mpeg" {
		t.Fatalf("response asset = %+v, want local mp3 URL %q", response.Asset, wantURL)
	}

	preview, data, found, err := workflow.GenerationVoicePreviewContent(
		coregeneration.RouteOfficialMiniMaxSpeech28Turbo,
		"English_Aussie_Bloke",
	)
	if err != nil || !found {
		t.Fatalf("GenerationVoicePreviewContent() found = %v error = %v", found, err)
	}
	if preview.URL != wantURL || string(data) != "mp3" {
		t.Fatalf("preview = %+v data = %q, want bundled mp3 content", preview, data)
	}

	catalog := workflow.ListGenerationModels()
	if len(catalog.VoicePreviews) != 1 || catalog.VoicePreviews[0].URL != wantURL {
		t.Fatalf("catalog voice previews = %+v, want bundled preview metadata", catalog.VoicePreviews)
	}

	tasks, err := store.List()
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(tasks) != 0 {
		t.Fatalf("task count = %d, want preview to skip history", len(tasks))
	}
}

func TestPreviewGenerationVoiceMissingLocalSampleReturnsNotFound(t *testing.T) {
	workflow := NewGenerationService(nil, nil, nil)
	workflow.voicePreviews = testVoicePreviewStore(t)
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		t.Fatalf("provider should not be called for missing local voice previews; route=%s", route.ID)
		return nil, nil
	}

	response, status, err := workflow.PreviewGenerationVoice(context.Background(), GenerationVoicePreviewRequest{
		RouteID: coregeneration.RouteOfficialMiniMaxSpeech28Turbo,
		VoiceID: "missing-voice",
	})
	if err == nil || status != 404 {
		t.Fatalf("PreviewGenerationVoice() response = %+v status = %d error = %v, want 404", response, status, err)
	}
}

func testVoicePreviewStore(t *testing.T) *VoicePreviewStore {
	t.Helper()
	return NewVoicePreviewStore(fstest.MapFS{
		"voice-previews/manifest.json": &fstest.MapFile{Data: []byte(fmt.Sprintf(`{
			"schemaVersion": 1,
			"previews": [
				{
					"routeId": %q,
					"voiceId": "English_Aussie_Bloke",
					"path": "minimax/English_Aussie_Bloke.mp3",
					"mimeType": "audio/mpeg"
				}
			]
		}`, coregeneration.RouteOfficialMiniMaxSpeech28Turbo))},
		"voice-previews/minimax/English_Aussie_Bloke.mp3": &fstest.MapFile{Data: []byte("mp3")},
	})
}
