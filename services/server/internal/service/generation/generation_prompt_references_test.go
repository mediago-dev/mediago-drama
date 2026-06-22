package generation

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"path/filepath"
	"strings"
	"testing"
	"time"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
)

func TestProviderPromptForGenerationRewritesReferenceNamesByAssetOrder(t *testing.T) {
	mediaAssets := media.NewMediaAssets(filepath.Join(t.TempDir(), "settings.db"), t.TempDir())
	roleAsset := saveNamedPNGReferenceAsset(t, mediaAssets, "沈言角色.png")
	styleAsset := saveNamedPNGReferenceAsset(t, mediaAssets, "宿舍风格.png")
	workflow := NewGenerationService(nil, nil, mediaAssets)
	route, ok := coregeneration.FindRoute(coregeneration.RouteJimengSeedance20Fast)
	if !ok {
		t.Fatal("jimeng seedance route is missing")
	}

	prompt := workflow.providerPromptForGeneration(route, generationMessageRequest{
		Prompt:            "沈言 @沈言角色 参考图，场景参考 @宿舍风格。",
		ReferenceAssetIDs: []string{roleAsset.ID, styleAsset.ID},
	})

	if prompt != "沈言 @图片1 参考图，场景参考 @图片2。" {
		t.Fatalf("provider prompt = %q", prompt)
	}
}

func TestProviderPromptForGenerationRewritesDocumentMentions(t *testing.T) {
	mediaAssets := media.NewMediaAssets(filepath.Join(t.TempDir(), "settings.db"), t.TempDir())
	asset := saveNamedPNGReferenceAsset(t, mediaAssets, "reference.png")
	workflow := NewGenerationService(nil, nil, mediaAssets)
	workflow.SetDocumentResolver(fakeGenerationDocumentResolver{
		documents: map[string]mediamcp.WorkspaceDocument{
			"character-doc": {
				ID: "character-doc",
				Content: strings.Join([]string{
					"<!-- section-id: section_shenyan -->",
					"# 沈言角色",
					"",
					"![沈言图](" + asset.URL + ")",
				}, "\n"),
			},
		},
	})
	route, ok := coregeneration.FindRoute(coregeneration.RouteJimengSeedance20Fast)
	if !ok {
		t.Fatal("jimeng seedance route is missing")
	}

	prompt := workflow.providerPromptForGeneration(route, generationMessageRequest{
		ProjectID:         "project-a",
		Prompt:            "沈言 @[沈言角色](mention://character-doc/section_shenyan?kind=section&category=character) 参考图。",
		ReferenceAssetIDs: []string{asset.ID},
	})

	if prompt != "沈言 @图片1 参考图。" {
		t.Fatalf("provider prompt = %q", prompt)
	}
}

func TestProviderPromptForGenerationNumbersSlotsByReferenceKind(t *testing.T) {
	workflow := NewGenerationService(nil, nil, nil)
	route, ok := coregeneration.FindRoute(coregeneration.RouteJimengSeedance20Fast)
	if !ok {
		t.Fatal("jimeng seedance route is missing")
	}

	prompt := workflow.providerPromptForGeneration(route, generationMessageRequest{
		Prompt: "角色参考 @shenyan.png，音色参考 @shenyan-voice.wav，动作参考 @walk.mp4。",
		ReferenceURLs: []string{
			"https://example.test/shenyan.png",
			"https://example.test/shenyan-voice.wav",
			"https://example.test/walk.mp4",
		},
	})

	if prompt != "角色参考 @图片1，音色参考 @音频1，动作参考 @视频1。" {
		t.Fatalf("provider prompt = %q", prompt)
	}
}

func TestCreateVideoGenerationKeepsStoredPromptAndRewritesProviderPrompt(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	repo, err := repository.NewGenerationTaskRepository(dbPath)
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, nil)
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{
			coregeneration.ProviderDMX: "sk-video",
		},
	})
	mediaAssets := media.NewMediaAssets(dbPath, t.TempDir())
	asset := saveNamedPNGReferenceAsset(t, mediaAssets, "沈言角色.png")
	provider := &blockingVideoGenerateProvider{
		started:  make(chan struct{}),
		release:  make(chan struct{}),
		response: coregeneration.Response{ID: "dmx.seedance-2.0-fast:cgt-reference", Status: "submitted"},
	}
	workflow := NewGenerationService(settingsSvc, store, mediaAssets)
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		return provider, nil
	}

	response, status, err := workflow.CreateGenerationMessage(context.Background(), GenerationMessageRequest{
		Kind:              string(coregeneration.KindVideo),
		RouteID:           coregeneration.RouteDMXSeedance20Fast,
		ModelID:           coregeneration.ModelJimengSeedance2Fast,
		Model:             "doubao-seedance-2-0-fast-260128",
		Prompt:            "沈言 @沈言角色 参考图",
		ReferenceAssetIDs: []string{asset.ID},
		Params: map[string]any{
			"duration":   "5",
			"ratio":      "16:9",
			"resolution": "720p",
		},
	})
	if err != nil || status != 200 {
		t.Fatalf("CreateGenerationMessage() status = %d error = %v", status, err)
	}

	select {
	case <-provider.started:
	case <-time.After(2 * time.Second):
		t.Fatal("provider submission did not start")
	}
	if provider.request == nil || provider.request.Prompt != "沈言 @图片1 参考图" {
		t.Fatalf("provider request = %+v", provider.request)
	}

	task, ok, err := store.Get(response.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok || task.Prompt != "沈言 @沈言角色 参考图" {
		t.Fatalf("task = %+v, want original prompt persisted", task)
	}

	close(provider.release)
}

func saveNamedPNGReferenceAsset(t *testing.T, mediaAssets *media.MediaAssets, filename string) media.MediaAsset {
	t.Helper()

	source := image.NewRGBA(image.Rect(0, 0, 320, 180))
	for y := range 180 {
		for x := range 320 {
			source.SetRGBA(x, y, color.RGBA{
				R: uint8((x*31 + y*17) % 256),
				G: uint8((x*11 + y*23) % 256),
				B: uint8((x*7 + y*5) % 256),
				A: 255,
			})
		}
	}

	var output bytes.Buffer
	if err := png.Encode(&output, source); err != nil {
		t.Fatalf("encoding source image: %v", err)
	}

	asset, err := mediaAssets.SaveReader(
		context.Background(),
		bytes.NewReader(output.Bytes()),
		filename,
		"image/png",
		"",
	)
	if err != nil {
		t.Fatalf("saving reference image: %v", err)
	}
	if asset.ID == "" {
		t.Fatal("saved reference asset has empty id")
	}
	return asset
}
