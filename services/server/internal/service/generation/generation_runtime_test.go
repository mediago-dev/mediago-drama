package generation

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/runtime"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/multimodal"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
)

func TestCacheGenerationResponseAssetsSavesBase64Locally(t *testing.T) {
	mediaDir := t.TempDir()
	mediaAssets := media.NewMediaAssets(filepath.Join(t.TempDir(), "settings.db"), mediaDir)
	workflow := NewGenerationService(nil, nil, mediaAssets)

	response := workflow.CacheGenerationResponseAssets(context.Background(), coregeneration.Response{
		ID:    "resp-test",
		Model: "doubao-seedream-5.0-lite",
		Assets: []coregeneration.Asset{
			{
				Kind:     coregeneration.KindImage,
				Base64:   base64.StdEncoding.EncodeToString([]byte("image-bytes")),
				MIMEType: "image/png",
			},
		},
	})

	if len(response.Assets) != 1 {
		t.Fatalf("asset count = %d, want 1", len(response.Assets))
	}
	if !strings.HasPrefix(response.Assets[0].URL, "/api/v1/media-assets/") {
		t.Fatalf("asset url = %q, want local media asset url", response.Assets[0].URL)
	}
	if response.Assets[0].Base64 != "" {
		t.Fatalf("asset base64 should be cleared after local cache")
	}

	files, err := os.ReadDir(mediaDir)
	if err != nil {
		t.Fatalf("reading media dir: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("cached files = %d, want 1", len(files))
	}

	assets, err := mediaAssets.List("")
	if err != nil {
		t.Fatalf("listing media assets: %v", err)
	}
	if len(assets) != 1 || assets[0].URL != response.Assets[0].URL {
		t.Fatalf("assets = %+v, want cached asset record", assets)
	}
}

func TestCacheGenerationResponseAssetsRecordsWarnings(t *testing.T) {
	mediaAssets := media.NewMediaAssets(filepath.Join(t.TempDir(), "settings.db"), t.TempDir())
	workflow := NewGenerationService(nil, nil, mediaAssets)

	response := workflow.CacheGenerationResponseAssets(context.Background(), coregeneration.Response{
		ID:    "resp-test",
		Model: "doubao-seedream-5.0-lite",
		Assets: []coregeneration.Asset{
			{
				Kind: coregeneration.KindImage,
				URL:  "ftp://example.test/image.png",
			},
		},
	})

	warnings := StringSliceFromMetadata(response.Metadata, "asset_cache_warnings")
	if len(warnings) != 1 || !strings.Contains(warnings[0], "unsupported generated asset url") {
		t.Fatalf("warnings = %#v, want unsupported url warning", warnings)
	}
}

func TestCacheGenerationResponseAssetsSkipsLocalMediaAssetURLs(t *testing.T) {
	mediaAssets := media.NewMediaAssets(filepath.Join(t.TempDir(), "settings.db"), t.TempDir())
	workflow := NewGenerationService(nil, nil, mediaAssets)

	response := workflow.CacheGenerationResponseAssets(context.Background(), coregeneration.Response{
		ID:    "resp-test",
		Model: "doubao-seedream-5.0-lite",
		Assets: []coregeneration.Asset{
			{
				Kind: coregeneration.KindImage,
				URL:  "http://localhost:5173/api/v1/projects/project-a/media-assets/image-1/content",
			},
		},
	})

	if warnings := StringSliceFromMetadata(response.Metadata, "asset_cache_warnings"); len(warnings) != 0 {
		t.Fatalf("warnings = %#v, want local media URL skipped without warning", warnings)
	}
	if response.Assets[0].URL != "http://localhost:5173/api/v1/projects/project-a/media-assets/image-1/content" {
		t.Fatalf("asset url = %q, want unchanged local media URL", response.Assets[0].URL)
	}
}

func TestResolveGenerationReferencesCompressesImageAssets(t *testing.T) {
	mediaAssets := media.NewMediaAssets(filepath.Join(t.TempDir(), "settings.db"), t.TempDir())
	asset := savePNGReferenceAsset(t, mediaAssets, 1800, 900)
	workflow := NewGenerationService(nil, nil, mediaAssets)
	route, ok := coregeneration.FindRoute(coregeneration.RouteDMXGPTImage2)
	if !ok {
		t.Fatal("dmx gpt image route is missing")
	}

	references, err := workflow.resolveGenerationReferences(route, generationMessageRequest{
		ReferenceAssetIDs: []string{asset.ID},
	})
	if err != nil {
		t.Fatalf("resolving references: %v", err)
	}
	if len(references) != 1 {
		t.Fatalf("references = %d, want 1", len(references))
	}
	if !strings.HasPrefix(references[0], "data:image/jpeg;base64,") {
		t.Fatalf("reference = %q, want compressed jpeg data uri", references[0][:min(64, len(references[0]))])
	}

	_, encoded, _ := strings.Cut(references[0], ",")
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decoding reference data uri: %v", err)
	}
	imageValue, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decoding compressed reference: %v", err)
	}
	if format != "jpeg" {
		t.Fatalf("format = %q, want jpeg", format)
	}
	bounds := imageValue.Bounds()
	if max(bounds.Dx(), bounds.Dy()) > 512 {
		t.Fatalf("reference size = %dx%d, want long side <= 512", bounds.Dx(), bounds.Dy())
	}
}

func TestResolveGenerationReferencesReadsLocalMediaReferenceURLs(t *testing.T) {
	mediaAssets := media.NewMediaAssets(filepath.Join(t.TempDir(), "settings.db"), t.TempDir())
	asset := savePNGReferenceAsset(t, mediaAssets, 320, 180)
	workflow := NewGenerationService(nil, nil, mediaAssets)
	route, ok := coregeneration.FindRoute(coregeneration.RouteJimengSeedance20Fast)
	if !ok {
		t.Fatal("jimeng seedance route is missing")
	}

	references, err := workflow.resolveGenerationReferences(route, generationMessageRequest{
		ReferenceURLs: []string{
			asset.URL,
			"/api/v1/media-assets/" + asset.ID + "/content",
			"http://localhost:5173/api/v1/projects/project-alpha/media-assets/" + asset.ID + "/content",
			"api/v1/media-assets/" + asset.ID + "/content",
		},
	})
	if err != nil {
		t.Fatalf("resolving references: %v", err)
	}
	if len(references) != 1 {
		t.Fatalf("references = %d, want one deduplicated local media reference", len(references))
	}
	if !strings.HasPrefix(references[0], "data:image/png;base64,") {
		t.Fatalf("reference = %q, want local media data uri", references[0][:min(64, len(references[0]))])
	}
}

func TestResolveGenerationReferencesIncludesAudioAssetsForJimengVideoRoutes(t *testing.T) {
	mediaAssets := media.NewMediaAssets(filepath.Join(t.TempDir(), "settings.db"), t.TempDir())
	imageAsset := savePNGReferenceAsset(t, mediaAssets, 320, 180)
	audioAsset, err := mediaAssets.SaveBase64(
		media.MediaKindAudio,
		"audio/mpeg",
		base64.StdEncoding.EncodeToString([]byte("audio-bytes")),
		"",
		"",
	)
	if err != nil {
		t.Fatalf("saving audio reference: %v", err)
	}
	workflow := NewGenerationService(nil, nil, mediaAssets)
	route, ok := coregeneration.FindRoute(coregeneration.RouteJimengSeedance20Fast)
	if !ok {
		t.Fatal("jimeng seedance route is missing")
	}

	references, err := workflow.resolveGenerationReferences(route, generationMessageRequest{
		ReferenceAssetIDs: []string{imageAsset.ID, audioAsset.ID},
	})
	if err != nil {
		t.Fatalf("resolving references: %v", err)
	}
	if len(references) != 2 {
		t.Fatalf("references = %d, want image and audio provider references", len(references))
	}
	if !strings.HasPrefix(references[0], "data:image/png;base64,") {
		t.Fatalf("reference = %q, want local image data uri", references[0][:min(64, len(references[0]))])
	}
	if !strings.HasPrefix(references[1], "data:audio/mpeg;base64,") {
		t.Fatalf("reference = %q, want local audio data uri", references[1][:min(64, len(references[1]))])
	}
}

func TestResolveGenerationReferencesReadsLinkedVoicePreviewAudioForJimengVideoRoutes(t *testing.T) {
	mediaAssets := media.NewMediaAssets(filepath.Join(t.TempDir(), "settings.db"), t.TempDir())
	previewURL := "/api/v1/generation/voice-previews/official.minimax-speech-2.8-turbo/English_Aussie_Bloke"
	audioAsset, err := mediaAssets.SaveLinkedAssetWithOptions(
		media.MediaKindAudio,
		previewURL,
		"English_Aussie_Bloke",
		"audio/mpeg",
		media.MediaAssetSaveOptions{Source: media.MediaSourcePreview},
	)
	if err != nil {
		t.Fatalf("saving linked audio reference: %v", err)
	}
	if audioAsset.FilePath != "" {
		t.Fatalf("linked audio file path = %q, want empty", audioAsset.FilePath)
	}
	workflow := NewGenerationService(nil, nil, mediaAssets)
	workflow.voicePreviews = testVoicePreviewStore(t)
	route, ok := coregeneration.FindRoute(coregeneration.RouteJimengSeedance20Fast)
	if !ok {
		t.Fatal("jimeng seedance route is missing")
	}

	references, err := workflow.resolveGenerationReferences(route, generationMessageRequest{
		ReferenceAssetIDs: []string{audioAsset.ID},
	})
	if err != nil {
		t.Fatalf("resolving references: %v", err)
	}
	if len(references) != 1 {
		t.Fatalf("references = %d, want linked audio provider reference", len(references))
	}
	if references[0] != "data:audio/mpeg;base64,bXAz" {
		t.Fatalf("reference = %q, want bundled voice preview audio data uri", references[0])
	}
}

func TestResolveGenerationReferencesSkipsAudioAssetsForUnsupportedVideoRoutes(t *testing.T) {
	mediaAssets := media.NewMediaAssets(filepath.Join(t.TempDir(), "settings.db"), t.TempDir())
	imageAsset := savePNGReferenceAsset(t, mediaAssets, 320, 180)
	audioAsset, err := mediaAssets.SaveBase64(
		media.MediaKindAudio,
		"audio/mpeg",
		base64.StdEncoding.EncodeToString([]byte("audio-bytes")),
		"",
		"",
	)
	if err != nil {
		t.Fatalf("saving audio reference: %v", err)
	}
	workflow := NewGenerationService(nil, nil, mediaAssets)
	route, ok := coregeneration.FindRoute(coregeneration.RouteOfficialSeedance20Fast)
	if !ok {
		t.Fatal("official seedance route is missing")
	}

	references, err := workflow.resolveGenerationReferences(route, generationMessageRequest{
		ReferenceAssetIDs: []string{imageAsset.ID, audioAsset.ID},
	})
	if err != nil {
		t.Fatalf("resolving references: %v", err)
	}
	if len(references) != 1 {
		t.Fatalf("references = %d, want only the image provider reference", len(references))
	}
	if !strings.HasPrefix(references[0], "data:image/png;base64,") {
		t.Fatalf("reference = %q, want local image data uri", references[0][:min(64, len(references[0]))])
	}
}

func TestImportGenerationMediaAssetsCreatesReferenceHistoryTasks(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	seedGenerationTaskProject(t, dbPath, "project-alpha")
	mediaAssets := media.NewMediaAssets(dbPath, t.TempDir())
	generatedID := 0
	generationTasks := NewGenerationTaskService(dbPath, func(prefix string) (string, error) {
		generatedID++
		return fmt.Sprintf("%s-%d", prefix, generatedID), nil
	})
	workflow := NewGenerationService(nil, generationTasks, mediaAssets)
	asset := savePNGReferenceAsset(t, mediaAssets, 320, 180)

	response, status, err := workflow.ImportGenerationMediaAssets(ImportGenerationMediaAssetsRequest{
		Kind:              "image",
		ConversationID:    "project-alpha-image",
		ScopeID:           "agent",
		ConversationTitle: "Project image session",
		ProjectID:         "project-alpha",
		DocumentID:        "story-doc",
		SectionID:         "section-a",
		CapabilityID:      "scene",
		AssetIDs:          []string{asset.ID},
		AssetTitle:        "场景图",
	})
	if err != nil {
		t.Fatalf("importing media assets: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}
	if len(response.Tasks) != 1 {
		t.Fatalf("tasks = %+v, want one imported task", response.Tasks)
	}
	task := response.Tasks[0]
	if task.ID != "media-library-1" ||
		task.ConversationID != "project-alpha-image" ||
		task.ProjectID != "project-alpha" ||
		task.DocumentID != "story-doc" ||
		task.SectionID != "section-a" ||
		task.CapabilityID != "scene" ||
		task.RouteID != importedMediaGenerationRouteID ||
		task.Status != "completed" {
		t.Fatalf("task = %+v, want completed imported media task", task)
	}
	if len(task.ReferenceAssetIDs) != 1 || task.ReferenceAssetIDs[0] != asset.ID {
		t.Fatalf("reference asset ids = %#v, want imported media asset id", task.ReferenceAssetIDs)
	}
	if len(task.Assets) != 1 ||
		task.Assets[0].URL != asset.URL ||
		task.Assets[0].Title != asset.Filename ||
		task.Assets[0].Selected {
		t.Fatalf("assets = %+v, want unselected reference to media asset", task.Assets)
	}

	conversation, ok, err := generationTasks.GetConversation("project-alpha-image")
	if err != nil {
		t.Fatalf("getting created conversation: %v", err)
	}
	if !ok || conversation.ScopeID != "agent" || conversation.Kind != "image" {
		t.Fatalf("conversation = %+v ok=%v, want imported image conversation", conversation, ok)
	}
}

func TestSanitizedGenerationRequestOmitsReferenceBase64(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString([]byte("secret-reference-bytes"))
	logValue := sanitizedGenerationRequest(coregeneration.Request{
		Kind:          coregeneration.KindImage,
		RouteID:       coregeneration.RouteDMXGPTImage2,
		Model:         "gpt-image-2-ssvip",
		Prompt:        "make an image",
		ReferenceURLs: []string{"data:image/png;base64," + encoded},
	})

	references, ok := logValue["reference_urls"].([]map[string]any)
	if !ok || len(references) != 1 {
		t.Fatalf("reference_urls = %#v, want one sanitized reference", logValue["reference_urls"])
	}
	if value := references[0]["value"]; value != "data:image/png;base64,<omitted>" {
		t.Fatalf("reference value = %#v, want omitted data uri", value)
	}
	if got := references[0]["base64_chars"]; got != len(encoded) {
		t.Fatalf("base64_chars = %#v, want %d", got, len(encoded))
	}
	if strings.Contains(fmt.Sprint(logValue), encoded) {
		t.Fatal("sanitized request still contains base64 data")
	}
}

func TestResponseFormatForRouteUsesURLForDMXResponsesImages(t *testing.T) {
	route, ok := coregeneration.FindRoute(coregeneration.RouteDMXSeedream5Lite)
	if !ok {
		t.Fatal("dmx seedream route is missing")
	}
	if got := ResponseFormatForRoute(route); got != "url" {
		t.Fatalf("responseFormatForRoute() = %q, want url", got)
	}

	route, ok = coregeneration.FindRoute(coregeneration.RouteDMXGPTImage2)
	if !ok {
		t.Fatal("dmx gpt image route is missing")
	}
	if got := ResponseFormatForRoute(route); got != "url" {
		t.Fatalf("responseFormatForRoute() = %q, want url", got)
	}
}

func TestShouldPersistGenerationTaskIncludesImages(t *testing.T) {
	route, ok := coregeneration.FindRoute(coregeneration.RouteDMXSeedream5Lite)
	if !ok {
		t.Fatal("dmx seedream route is missing")
	}
	if !ShouldPersistGenerationTask(route) {
		t.Fatal("image generation route should be persisted")
	}
}

func TestGenerationTaskFromMessageRecordsFailureReason(t *testing.T) {
	route, ok := coregeneration.FindRoute(coregeneration.RouteDMXGPTImage2)
	if !ok {
		t.Fatal("dmx gpt image route is missing")
	}

	task := GenerationTaskFromMessage(GenerationMessageRequest{
		Kind:    string(coregeneration.KindImage),
		RouteID: route.ID,
		Model:   route.Model,
		Prompt:  "make an image",
	}, route, GenerationMessageResponse{
		ID:        "generation_failed",
		Role:      "assistant",
		Status:    "failed",
		Message:   "Generation request failed.",
		Error:     "dmx request failed with status 400: bad prompt",
		ErrorCode: "invalid_parameter",
		ErrorType: "invalid_parameter",
		Retryable: false,
		Assets:    []GenerationAsset{},
		Usage:     GenerationUsage{},
	})

	if task.Status != "failed" {
		t.Fatalf("status = %q, want failed", task.Status)
	}
	if task.CapabilityID != "image.generate" {
		t.Fatalf("capability id = %q, want image.generate", task.CapabilityID)
	}
	if !strings.Contains(task.Error, "bad prompt") {
		t.Fatalf("error = %q, want provider failure reason", task.Error)
	}
	if task.ErrorCode != "invalid_parameter" || task.ErrorType != "invalid_parameter" || task.Retryable {
		t.Fatalf("failure fields = %+v, want invalid parameter failure", task)
	}
}

func TestFailedGenerationResponseMapsProviderFailure(t *testing.T) {
	response := FailedGenerationResponse("task_failed", &coregeneration.HTTPError{
		Provider:   coregeneration.ProviderDMX,
		StatusCode: 400,
		Body:       "raw provider error",
		Code:       "policy_violation",
		Reason:     coregeneration.FailurePolicyViolation,
		Message:    "Provider policy rejected the generation request or result.",
		Retryable:  false,
	})

	if response.Message != "生成结果触发供应商内容安全策略，未返回可用结果。" {
		t.Fatalf("message = %q, want policy failure message", response.Message)
	}
	if response.Error != "raw provider error" ||
		response.ErrorCode != "policy_violation" ||
		response.ErrorType != "policy_violation" ||
		response.Retryable {
		t.Fatalf("response = %+v, want structured policy failure", response)
	}
}

func TestGenerationTaskFromMessagePreservesExplicitCapabilityID(t *testing.T) {
	route, ok := coregeneration.FindRoute(coregeneration.RouteDMXGPT41MiniText)
	if !ok {
		t.Fatal("dmx text route is missing")
	}

	task := GenerationTaskFromMessage(GenerationMessageRequest{
		CapabilityID: "novel.understand",
		Kind:         string(coregeneration.KindText),
		RouteID:      route.ID,
		Model:        route.Model,
		Prompt:       "read this",
	}, route, GenerationMessageResponse{
		ID:      "generation_text",
		Role:    "assistant",
		Status:  "completed",
		Message: "done",
		Usage:   GenerationUsage{InputTokens: 1, TotalTokens: 1},
	})

	if task.CapabilityID != "novel.understand" {
		t.Fatalf("capability id = %q, want explicit capability", task.CapabilityID)
	}
}

func savePNGReferenceAsset(
	t *testing.T,
	mediaAssets *media.MediaAssets,
	width int,
	height int,
) media.MediaAsset {
	t.Helper()

	source := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
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
		"reference.png",
		"image/png",
		"",
	)
	if err != nil {
		t.Fatalf("saving reference image: %v", err)
	}
	return asset
}

func TestSubmittedGenerationTaskClearsPreviousError(t *testing.T) {
	task := GenerationTaskRecord{
		ID:      "generation_1",
		Status:  "failed",
		Message: "Generation request failed.",
		Error:   "previous failure",
	}

	nextTask := GenerationTaskWithMessage(
		task,
		SubmittedGenerationResponse(task.ID, coregeneration.KindImage),
	)

	if nextTask.Status != "submitted" {
		t.Fatalf("status = %q, want submitted", nextTask.Status)
	}
	if nextTask.Error != "" {
		t.Fatalf("error = %q, want cleared error", nextTask.Error)
	}
	if !strings.Contains(nextTask.Message, "正在服务器上运行") {
		t.Fatalf("message = %q, want server-side running message", nextTask.Message)
	}
}

func TestListGenerationTasksUsesScopeDefaultConversation(t *testing.T) {
	repo, err := repository.NewGenerationTaskRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, nil)
	workflow := NewGenerationService(nil, store, nil)
	kind := string(coregeneration.KindImage)

	conversation, status, err := workflow.resolveGenerationConversation("", "section-a", kind)
	if err != nil || status != 200 {
		t.Fatalf("resolveGenerationConversation() status = %d error = %v", status, err)
	}
	if conversation.ID != DefaultGenerationConversationID("section-a", kind) {
		t.Fatalf("default conversation id = %q, want scoped default", conversation.ID)
	}

	tasks := []GenerationTaskRecord{
		{
			ID:             "generation-section-a",
			ConversationID: DefaultGenerationConversationID("section-a", kind),
			Kind:           kind,
			RouteID:        coregeneration.RouteDMXSeedream5Lite,
			FamilyID:       coregeneration.FamilySeedream,
			VersionID:      coregeneration.VersionSeedream5Lite,
			Provider:       coregeneration.ProviderDMX,
			Model:          "seedream-5.0-lite",
			Prompt:         "section a prompt",
			Status:         "completed",
			Message:        "done",
		},
		{
			ID:             "generation-section-b",
			ConversationID: DefaultGenerationConversationID("section-b", kind),
			Kind:           kind,
			RouteID:        coregeneration.RouteDMXSeedream5Lite,
			FamilyID:       coregeneration.FamilySeedream,
			VersionID:      coregeneration.VersionSeedream5Lite,
			Provider:       coregeneration.ProviderDMX,
			Model:          "seedream-5.0-lite",
			Prompt:         "section b prompt",
			Status:         "completed",
			Message:        "done",
		},
	}
	for _, task := range tasks {
		if err := store.Upsert(task); err != nil {
			t.Fatalf("Upsert(%s) error = %v", task.ID, err)
		}
	}

	response, err := workflow.ListGenerationTasks(GenerationTaskListQuery{
		Kind:    kind,
		ScopeID: "section-a",
	})
	if err != nil {
		t.Fatalf("ListGenerationTasks(section-a) error = %v", err)
	}
	if got := generationTaskIDs(response.Tasks); !sameStringSet(got, []string{"generation-section-a"}) {
		t.Fatalf("section-a tasks = %v, want only generation-section-a", got)
	}
}

func TestListGenerationTasksTreatsUnknownSessionAsScope(t *testing.T) {
	repo, err := repository.NewGenerationTaskRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, nil)
	workflow := NewGenerationService(nil, store, nil)
	kind := string(coregeneration.KindImage)

	// v1 路由把 sessionId 透传为 ConversationID；未命中已命名会话时应回退到该 scope 的默认会话。
	conversation, status, err := workflow.resolveGenerationConversationWithScopeFilter("section-a", "", kind, false)
	if err != nil || status != 200 {
		t.Fatalf("resolveGenerationConversationWithScopeFilter() status = %d error = %v", status, err)
	}
	if conversation.ID != DefaultGenerationConversationID("section-a", kind) {
		t.Fatalf("conversation id = %q, want scoped default", conversation.ID)
	}
	if conversation.ScopeID != "section-a" {
		t.Fatalf("conversation scope = %q, want section-a", conversation.ScopeID)
	}

	tasks := []GenerationTaskRecord{
		{
			ID:             "generation-section-a",
			ConversationID: DefaultGenerationConversationID("section-a", kind),
			Kind:           kind,
			RouteID:        coregeneration.RouteDMXSeedream5Lite,
			FamilyID:       coregeneration.FamilySeedream,
			VersionID:      coregeneration.VersionSeedream5Lite,
			Provider:       coregeneration.ProviderDMX,
			Model:          "seedream-5.0-lite",
			Prompt:         "section a prompt",
			Status:         "completed",
			Message:        "done",
		},
		{
			ID:             "generation-section-b",
			ConversationID: DefaultGenerationConversationID("section-b", kind),
			Kind:           kind,
			RouteID:        coregeneration.RouteDMXSeedream5Lite,
			FamilyID:       coregeneration.FamilySeedream,
			VersionID:      coregeneration.VersionSeedream5Lite,
			Provider:       coregeneration.ProviderDMX,
			Model:          "seedream-5.0-lite",
			Prompt:         "section b prompt",
			Status:         "completed",
			Message:        "done",
		},
	}
	for _, task := range tasks {
		if err := store.Upsert(task); err != nil {
			t.Fatalf("Upsert(%s) error = %v", task.ID, err)
		}
	}

	response, err := workflow.ListGenerationTasks(GenerationTaskListQuery{
		Kind:           kind,
		ConversationID: "section-a",
	})
	if err != nil {
		t.Fatalf("ListGenerationTasks(session section-a) error = %v", err)
	}
	if got := generationTaskIDs(response.Tasks); !sameStringSet(got, []string{"generation-section-a"}) {
		t.Fatalf("session section-a tasks = %v, want only generation-section-a", got)
	}
}

func TestCreateVideoGenerationSubmitsProviderTaskInBackground(t *testing.T) {
	repo, err := repository.NewGenerationTaskRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, nil)
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{
			coregeneration.ProviderDMX: "sk-video",
		},
	})
	provider := &blockingVideoGenerateProvider{
		started:  make(chan struct{}),
		release:  make(chan struct{}),
		response: coregeneration.Response{ID: "dmx.seedance-2.0-fast:cgt-background", Status: "submitted"},
	}
	workflow := NewGenerationService(settingsSvc, store, nil)
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		if route.ID != coregeneration.RouteDMXSeedance20Fast {
			t.Fatalf("route = %q, want seedance video route", route.ID)
		}
		return provider, nil
	}

	requestCtx, cancel := context.WithCancel(context.Background())
	cancel()
	response, status, err := workflow.CreateGenerationMessage(requestCtx, GenerationMessageRequest{
		Kind:    string(coregeneration.KindVideo),
		RouteID: coregeneration.RouteDMXSeedance20Fast,
		ModelID: coregeneration.ModelJimengSeedance2Fast,
		Model:   "doubao-seedance-2-0-fast-260128",
		Prompt:  "make a short flower field video",
		Params: map[string]any{
			"duration":   "5",
			"ratio":      "16:9",
			"resolution": "720p",
		},
	})
	if err != nil || status != 200 {
		t.Fatalf("CreateGenerationMessage() status = %d error = %v", status, err)
	}
	if response.Status != "submitting" {
		t.Fatalf("response status = %q, want submitting", response.Status)
	}
	if strings.Contains(response.ID, ":") {
		t.Fatalf("response id = %q, want local task id", response.ID)
	}

	select {
	case <-provider.started:
	case <-time.After(2 * time.Second):
		t.Fatal("provider submission did not start")
	}
	task, ok, err := store.Get(response.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok || task.Status != "submitting" || task.ProviderTaskID != "" {
		t.Fatalf("task = %+v, want local submitting task without provider id", task)
	}

	close(provider.release)
	task = waitForGenerationTask(t, store, response.ID, func(task GenerationTaskRecord) bool {
		return task.ProviderTaskID == "dmx.seedance-2.0-fast:cgt-background"
	})
	if task.Status != "submitted" {
		t.Fatalf("task status = %q, want submitted", task.Status)
	}
	if provider.request == nil || provider.request.Prompt != "make a short flower field video" {
		t.Fatalf("provider request = %+v, want submitted prompt", provider.request)
	}
}

func TestCreateJimengImageGenerationPersistsOneTaskForRequestedCount(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	repo, err := repository.NewGenerationTaskRepository(dbPath)
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, nil)
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{
			coregeneration.ProviderJimeng: "logged-in",
		},
	})
	provider := &blockingMultiAssetImageGenerateProvider{
		started: make(chan coregeneration.Request, 3),
		release: make(chan struct{}),
	}
	mediaAssets := media.NewMediaAssets(dbPath, t.TempDir())
	workflow := NewGenerationService(settingsSvc, store, mediaAssets)
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		if route.ID != coregeneration.RouteJimengSeedream50 {
			t.Fatalf("route = %q, want jimeng seedream route", route.ID)
		}
		return provider, nil
	}

	response, status, err := workflow.CreateGenerationMessage(context.Background(), GenerationMessageRequest{
		Kind:    string(coregeneration.KindImage),
		RouteID: coregeneration.RouteJimengSeedream50,
		ModelID: coregeneration.ModelSeedream50,
		Model:   "5.0",
		Prompt:  "生成三张同主题角色图",
		Params: map[string]any{
			"aspectRatio": "1:1",
			"resolution":  "2K",
			"n":           3,
		},
	})
	if err != nil || status != 200 {
		t.Fatalf("CreateGenerationMessage() status = %d error = %v", status, err)
	}
	if response.Status != "submitted" {
		t.Fatalf("response status = %q, want submitted", response.Status)
	}

	var request coregeneration.Request
	select {
	case request = <-provider.started:
	case <-time.After(2 * time.Second):
		t.Fatal("provider request did not start")
	}
	if request.Prompt != "生成三张同主题角色图" {
		t.Fatalf("provider prompt = %q", request.Prompt)
	}
	if request.Params["n"] != 3 {
		t.Fatalf("provider request params = %#v, want n=3 on the single request", request.Params)
	}
	task := waitForGenerationTask(t, store, response.ID, func(task GenerationTaskRecord) bool {
		return task.Status == "running" || task.Status == "submitted"
	})
	if task.RouteID != coregeneration.RouteJimengSeedream50 || task.Provider != coregeneration.ProviderJimeng {
		t.Fatalf("task = %+v, want jimeng seedream task", task)
	}
	tasks, err := store.List()
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("task count = %d, want one history task", len(tasks))
	}
	task = waitForGenerationTask(t, store, response.ID, func(task GenerationTaskRecord) bool {
		return task.Status == "running" && len(task.Assets) == 2
	})
	if len(task.Assets) != 2 {
		t.Fatalf("running task assets = %#v, want two partial generated images", task.Assets)
	}

	close(provider.release)
	task = waitForGenerationTask(t, store, response.ID, func(task GenerationTaskRecord) bool {
		return task.Status == "completed" && len(task.Assets) == 3
	})
	if len(task.Assets) != 3 {
		t.Fatalf("task assets = %#v, want three generated images on one task", task.Assets)
	}
}

func TestCreatePromptOptimizedGenerationMessageRecordsOptimizationAndImageTasks(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	repo, err := repository.NewGenerationTaskRepository(dbPath)
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, nil)
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{
			coregeneration.ProviderDMX: "sk-test",
		},
	})
	imageProvider := &blockingMultiAssetImageGenerateProvider{
		started: make(chan coregeneration.Request, 1),
		release: make(chan struct{}),
	}
	workflow := NewGenerationService(settingsSvc, store, media.NewMediaAssets(dbPath, t.TempDir()))
	var textRequest coregeneration.Request
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		switch route.ID {
		case coregeneration.RouteDMXGPT41MiniText:
			return fakeTextStreamProvider{
				request: &textRequest,
				events: []coregeneration.TextStreamEvent{
					{Delta: "optimized "},
					{Delta: "prompt"},
					{Done: true},
				},
			}, nil
		case coregeneration.RouteDMXGPTImage2:
			return imageProvider, nil
		default:
			t.Fatalf("route = %q, want prompt optimization text or image route", route.ID)
			return nil, fmt.Errorf("unexpected route")
		}
	}

	imageRoute, ok := coregeneration.FindRoute(coregeneration.RouteDMXGPTImage2)
	if !ok {
		t.Fatal("dmx gpt image route is missing")
	}
	response, status, err := workflow.CreatePromptOptimizedGenerationMessage(context.Background(), GenerationMessageRequest{
		Kind:    string(coregeneration.KindImage),
		RouteID: imageRoute.ID,
		ModelID: imageRoute.LegacyModelID,
		Model:   imageRoute.Model,
		Prompt:  "原始角色提示词",
		PromptOptimization: &GenerationPromptOptimizationRequest{
			ConversationID:  "prompt-optimize-session",
			RouteID:         coregeneration.RouteDMXGPT41MiniText,
			Model:           "text-model",
			ReferenceName:   "电影质感",
			ReferencePrompt: "cinematic lighting, detailed composition",
		},
		Params: map[string]any{"n": 1},
	})
	if err != nil || status != http.StatusOK {
		t.Fatalf("CreatePromptOptimizedGenerationMessage() status = %d error = %v", status, err)
	}
	if response.Optimization.Status != "completed" || response.OptimizedPrompt != "optimized prompt" {
		t.Fatalf("optimization response = %+v, optimizedPrompt = %q; want completed optimized prompt", response.Optimization, response.OptimizedPrompt)
	}
	if response.Generation.Status != "submitted" {
		t.Fatalf("generation response = %+v, want submitted image generation", response.Generation)
	}

	var imageRequest coregeneration.Request
	select {
	case imageRequest = <-imageProvider.started:
	case <-time.After(2 * time.Second):
		t.Fatal("image provider request did not start")
	}
	if imageRequest.Prompt != "optimized prompt" {
		t.Fatalf("image prompt = %q, want optimized prompt", imageRequest.Prompt)
	}
	if !strings.Contains(textRequest.Prompt, "根据优化 prompt 优化用户的输入。") ||
		!strings.Contains(textRequest.Prompt, "优化 prompt：\ncinematic lighting, detailed composition") ||
		!strings.Contains(textRequest.Prompt, "用户的输入：\n原始角色提示词") ||
		strings.Contains(textRequest.Prompt, "## 输出要求") ||
		strings.Contains(textRequest.Prompt, "不要输出 JSON") {
		t.Fatalf("text prompt = %q, want concise optimization prompt", textRequest.Prompt)
	}

	optimizationTask, ok, err := store.Get(response.Optimization.ID)
	if err != nil {
		t.Fatalf("Get(optimization) error = %v", err)
	}
	if !ok ||
		optimizationTask.Kind != string(coregeneration.KindText) ||
		optimizationTask.Text != "optimized prompt" ||
		optimizationTask.ConversationID != "prompt-optimize-session" {
		t.Fatalf("optimization task = %+v, want persisted text task", optimizationTask)
	}
	optimizationConversation, ok, err := store.GetConversation("prompt-optimize-session")
	if err != nil {
		t.Fatalf("GetConversation(optimization) error = %v", err)
	}
	if !ok || optimizationConversation.Title != "项目 · 提示词生成" {
		t.Fatalf("optimization conversation = %+v, want project prompt generation title", optimizationConversation)
	}
	imageTask, ok, err := store.Get(response.Generation.ID)
	if err != nil {
		t.Fatalf("Get(generation) error = %v", err)
	}
	if !ok || imageTask.Kind != string(coregeneration.KindImage) || imageTask.Prompt != "optimized prompt" {
		t.Fatalf("image task = %+v, want persisted image task using optimized prompt", imageTask)
	}

	close(imageProvider.release)
	waitForGenerationTask(t, store, response.Generation.ID, func(task GenerationTaskRecord) bool {
		return task.Status == "completed" && len(task.Assets) == 3
	})
	tasks, err := store.List()
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(tasks) != 2 {
		t.Fatalf("task count = %d, want optimization and image generation tasks", len(tasks))
	}
	kinds := map[string]bool{}
	for _, task := range tasks {
		kinds[task.Kind] = true
	}
	if !kinds[string(coregeneration.KindText)] || !kinds[string(coregeneration.KindImage)] {
		t.Fatalf("task kinds = %#v, want text and image records", kinds)
	}
}

func TestPromptOptimizationConversationTitle(t *testing.T) {
	tests := []struct {
		name      string
		projectID string
		want      string
	}{
		{
			name:      "project scoped",
			projectID: "舔狗金",
			want:      "舔狗金 · 提示词生成",
		},
		{
			name: "fallback",
			want: "项目 · 提示词生成",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := promptOptimizationConversationTitle(test.projectID); got != test.want {
				t.Fatalf("promptOptimizationConversationTitle(%q) = %q, want %q", test.projectID, got, test.want)
			}
		})
	}
}

func TestCreateJimengImageDocumentContextDoesNotUseCurrentSectionImagesAsReferences(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	repo, err := repository.NewGenerationTaskRepository(dbPath)
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, nil)
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{
			coregeneration.ProviderJimeng: "logged-in",
		},
	})
	provider := &blockingMultiAssetImageGenerateProvider{
		started: make(chan coregeneration.Request, 1),
		release: make(chan struct{}),
	}
	workflow := NewGenerationService(settingsSvc, store, media.NewMediaAssets(dbPath, t.TempDir()))
	workflow.SetDocumentResolver(fakeGenerationDocumentResolver{
		documents: map[string]mediamcp.WorkspaceDocument{
			"story-doc": {
				ID: "story-doc",
				Content: strings.Join([]string{
					"# 第一集",
					"",
					"<!-- section-id: section_chenyuan -->",
					"## 陈远",
					"",
					"![已有插图](/api/v1/media-assets/existing-image/content)",
					"",
					"形象定位：21岁男性大三学生。",
				}, "\n"),
			},
		},
	})
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		if route.ID != coregeneration.RouteJimengSeedream50 {
			t.Fatalf("route = %q, want jimeng seedream route", route.ID)
		}
		return provider, nil
	}

	response, status, err := workflow.CreateGenerationMessage(context.Background(), GenerationMessageRequest{
		Kind:    string(coregeneration.KindImage),
		RouteID: coregeneration.RouteJimengSeedream50,
		ModelID: coregeneration.ModelSeedream50,
		Model:   "5.0",
		Prompt:  "重新生成角色视觉素材。",
		DocumentContext: &GenerationDocumentContext{
			DocumentID: "story-doc",
			SectionID:  "section_chenyuan",
		},
	})
	if err != nil || status != 200 {
		t.Fatalf("CreateGenerationMessage() status = %d error = %v", status, err)
	}
	if response.Status != "submitted" {
		t.Fatalf("response status = %q, want submitted", response.Status)
	}

	var request coregeneration.Request
	select {
	case request = <-provider.started:
	case <-time.After(2 * time.Second):
		t.Fatal("provider request did not start")
	}
	if len(request.ReferenceURLs) != 0 {
		t.Fatalf("provider reference urls = %#v, want none", request.ReferenceURLs)
	}

	close(provider.release)
	waitForGenerationTask(t, store, response.ID, func(task GenerationTaskRecord) bool {
		return task.Status == "completed"
	})
}

func TestCreateJimengImageGenerationPreservesPartialAssetsOnFailure(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	repo, err := repository.NewGenerationTaskRepository(dbPath)
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, nil)
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{
			coregeneration.ProviderJimeng: "logged-in",
		},
	})
	provider := &blockingMultiAssetImageGenerateProvider{
		started: make(chan coregeneration.Request, 3),
		release: make(chan struct{}),
		err:     fmt.Errorf("third image failed"),
	}
	mediaAssets := media.NewMediaAssets(dbPath, t.TempDir())
	workflow := NewGenerationService(settingsSvc, store, mediaAssets)
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		return provider, nil
	}

	response, status, err := workflow.CreateGenerationMessage(context.Background(), GenerationMessageRequest{
		Kind:    string(coregeneration.KindImage),
		RouteID: coregeneration.RouteJimengSeedream50,
		ModelID: coregeneration.ModelSeedream50,
		Model:   "5.0",
		Prompt:  "生成三张同主题角色图",
		Params:  map[string]any{"n": 3},
	})
	if err != nil || status != 200 {
		t.Fatalf("CreateGenerationMessage() status = %d error = %v", status, err)
	}

	select {
	case <-provider.started:
	case <-time.After(2 * time.Second):
		t.Fatal("provider request did not start")
	}
	waitForGenerationTask(t, store, response.ID, func(task GenerationTaskRecord) bool {
		return task.Status == "running" && len(task.Assets) == 2
	})

	close(provider.release)
	task := waitForGenerationTask(t, store, response.ID, func(task GenerationTaskRecord) bool {
		return task.Status == "failed" && len(task.Assets) == 2
	})
	if len(task.Assets) != 2 {
		t.Fatalf("failed task assets = %#v, want partial generated images preserved", task.Assets)
	}
}

func TestGetGenerationVideoPollsProviderTaskID(t *testing.T) {
	repo, err := repository.NewGenerationTaskRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, nil)
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{
			coregeneration.ProviderDMX: "sk-video",
		},
	})
	provider := &recordingVideoProvider{
		response: coregeneration.Response{
			ID:     "dmx.seedance-2.0-fast:cgt-provider",
			Status: "completed",
			Assets: []coregeneration.Asset{{
				Kind: coregeneration.KindVideo,
				URL:  "https://example.com/generated.mp4",
			}},
		},
	}
	workflow := NewGenerationService(settingsSvc, store, nil)
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		if route.ID != coregeneration.RouteDMXSeedance20Fast {
			t.Fatalf("route = %q, want seedance video route", route.ID)
		}
		return provider, nil
	}

	if err := store.Upsert(GenerationTaskRecord{
		ID:             "generation-local",
		ProviderTaskID: "dmx.seedance-2.0-fast:cgt-provider",
		Kind:           string(coregeneration.KindVideo),
		RouteID:        coregeneration.RouteDMXSeedance20Fast,
		FamilyID:       coregeneration.FamilySeedance,
		VersionID:      coregeneration.VersionSeedance20Fast,
		Provider:       coregeneration.ProviderDMX,
		ModelID:        coregeneration.ModelJimengSeedance2Fast,
		Model:          "doubao-seedance-2-0-fast-260128",
		Prompt:         "make a video",
		Status:         "submitted",
		Message:        "视频生成任务已提交，完成后请再次检查状态。",
	}); err != nil {
		t.Fatalf("Upsert() error = %v", err)
	}

	response, status, err := workflow.GetGenerationVideo(context.Background(), "generation-local")
	if err != nil || status != 200 {
		t.Fatalf("GetGenerationVideo() status = %d error = %v", status, err)
	}
	if provider.getID != "dmx.seedance-2.0-fast:cgt-provider" {
		t.Fatalf("provider get id = %q, want provider task id", provider.getID)
	}
	if response.ID != "generation-local" || response.Status != "completed" {
		t.Fatalf("response = %+v, want local completed response", response)
	}
	task, ok, err := store.Get("generation-local")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok || task.Status != "completed" || task.ProviderTaskID != "dmx.seedance-2.0-fast:cgt-provider" {
		t.Fatalf("task = %+v, want completed local task with provider id", task)
	}
}

func TestGetGenerationVideoCachesRemoteAssetWithTaskAssetTitle(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	seedGenerationTaskProject(t, dbPath, "project-alpha")
	repo, err := repository.NewGenerationTaskRepository(dbPath)
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, nil)
	mediaRepo, err := repository.NewMediaAssetRepository(dbPath)
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	workspaceRoot := t.TempDir()
	mediaAssets := media.NewMediaAssetsFromRepository(mediaRepo, filepath.Join(workspaceRoot, "library"), workspaceRoot, nil, nil)
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{
			coregeneration.ProviderDMX: "sk-video",
		},
	})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "video/mp4")
		_, _ = response.Write([]byte("video-bytes"))
	}))
	defer server.Close()
	remoteURL := server.URL + "/oYHvcbgRRZZwJQjqSegmI9QeVXH5ABACQx.mp4"
	legacyAsset, err := mediaAssets.SaveRemoteAssetWithOptions(
		context.Background(),
		media.MediaKindVideo,
		remoteURL,
		media.MediaAssetSaveOptions{
			ProjectID:      "project-alpha",
			Source:         media.MediaSourceGeneration,
			ConversationID: "project-alpha-video",
			SectionID:      "section_reel_01",
		},
	)
	if err != nil {
		t.Fatalf("SaveRemoteAssetWithOptions(legacy) error = %v", err)
	}
	if legacyAsset.Filename != "oYHvcbgRRZZwJQjqSegmI9QeVXH5ABACQx.mp4" {
		t.Fatalf("legacy filename = %q, want remote basename before title is known", legacyAsset.Filename)
	}
	provider := &recordingVideoProvider{
		response: coregeneration.Response{
			ID:     "dmx.seedance-2.0-fast:cgt-provider",
			Status: "completed",
			Assets: []coregeneration.Asset{{
				Kind: coregeneration.KindVideo,
				URL:  remoteURL,
			}},
		},
	}
	workflow := NewGenerationService(settingsSvc, store, mediaAssets)
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		return provider, nil
	}

	const blockTitle = "顾南衣·状态A 落魄寻食少女（十年前·第一幕）"
	if err := store.Upsert(GenerationTaskRecord{
		ID:             "generation-local",
		ProviderTaskID: "dmx.seedance-2.0-fast:cgt-provider",
		ConversationID: "project-alpha-video",
		ProjectID:      "project-alpha",
		DocumentID:     "story-doc",
		SectionID:      "section_reel_01",
		Kind:           string(coregeneration.KindVideo),
		RouteID:        coregeneration.RouteDMXSeedance20Fast,
		FamilyID:       coregeneration.FamilySeedance,
		VersionID:      coregeneration.VersionSeedance20Fast,
		Provider:       coregeneration.ProviderDMX,
		ModelID:        coregeneration.ModelJimengSeedance2Fast,
		Model:          "doubao-seedance-2-0-fast-260128",
		Prompt:         "make a video",
		Params: map[string]any{
			generationAssetTitleRequestOption: blockTitle,
		},
		Status:  "submitted",
		Message: "视频生成任务已提交，完成后请再次检查状态。",
	}); err != nil {
		t.Fatalf("Upsert() error = %v", err)
	}

	response, status, err := workflow.GetGenerationVideo(context.Background(), "generation-local")
	if err != nil || status != http.StatusOK {
		t.Fatalf("GetGenerationVideo() status = %d error = %v", status, err)
	}
	if len(response.Assets) != 1 || response.Assets[0].AssetID == "" {
		t.Fatalf("response assets = %+v, want cached media asset", response.Assets)
	}

	task, ok, err := store.Get("generation-local")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok || len(task.Assets) != 1 {
		t.Fatalf("task = %+v, want one cached video asset", task)
	}
	expectedFilename := blockTitle + ".mp4"
	if task.Assets[0].Title != expectedFilename {
		t.Fatalf("asset title = %q, want %q", task.Assets[0].Title, expectedFilename)
	}
	asset, ok, err := mediaAssets.Get(task.Assets[0].AssetID)
	if err != nil {
		t.Fatalf("Get(media asset) error = %v", err)
	}
	if !ok || asset.ID != legacyAsset.ID || asset.Filename != expectedFilename {
		t.Fatalf("media asset = %+v, want reused asset renamed to block title", asset)
	}
}

func TestGenerationTaskDurationUsesCreatedAndUpdatedAt(t *testing.T) {
	start := time.Date(2026, 5, 18, 10, 0, 0, 0, time.UTC)
	task := GenerationTaskRecord{
		Status:    "completed",
		CreatedAt: start.Format(time.RFC3339Nano),
		UpdatedAt: start.Add(75 * time.Second).Format(time.RFC3339Nano),
	}

	if got := GenerationTaskDurationMS(task); got != 75000 {
		t.Fatalf("duration = %d, want 75000", got)
	}
}

func waitForGenerationTask(
	t *testing.T,
	store *GenerationTaskService,
	id string,
	matches func(GenerationTaskRecord) bool,
) GenerationTaskRecord {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		task, ok, err := store.Get(id)
		if err != nil {
			t.Fatalf("Get() error = %v", err)
		}
		if ok && matches(task) {
			return task
		}
		time.Sleep(10 * time.Millisecond)
	}
	task, ok, err := store.Get(id)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok {
		t.Fatalf("generation task %q was not found", id)
	}
	t.Fatalf("generation task %q did not reach expected state: %+v", id, task)
	return GenerationTaskRecord{}
}

func generationTaskIDs(tasks []GenerationTaskRecord) []string {
	ids := make([]string, 0, len(tasks))
	for _, task := range tasks {
		ids = append(ids, task.ID)
	}
	return ids
}

func sameStringSet(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	counts := make(map[string]int, len(left))
	for _, value := range left {
		counts[value]++
	}
	for _, value := range right {
		counts[value]--
		if counts[value] < 0 {
			return false
		}
	}
	return true
}

func TestStreamGenerationTextPersistsFinalText(t *testing.T) {
	repo, err := repository.NewGenerationTaskRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	idCounts := map[string]int{}
	store := NewGenerationTaskServiceFromRepository(repo, nil, func(prefix string) (string, error) {
		idCounts[prefix]++
		return prefix + "-test-" + strconv.Itoa(idCounts[prefix]), nil
	})
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{
			coregeneration.ProviderDMX: "sk-test",
		},
	})
	workflow := NewGenerationService(settingsSvc, store, nil)
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		if route.ID != coregeneration.RouteDMXGPT41MiniText {
			t.Fatalf("route = %q, want text route", route.ID)
		}
		return fakeTextStreamProvider{
			events: []coregeneration.TextStreamEvent{
				{Delta: "hello "},
				{Delta: "world"},
				{Usage: &coregeneration.Usage{
					InputTokens:     1,
					OutputTokens:    2,
					TotalTokens:     3,
					ReasoningTokens: 4,
					CachedTokens:    5,
				}, Done: true},
			},
		}, nil
	}

	events := []GenerationTextStreamEvent{}
	status, err := workflow.StreamGenerationText(context.Background(), GenerationMessageRequest{
		Kind:    string(coregeneration.KindText),
		RouteID: coregeneration.RouteDMXGPT41MiniText,
		Prompt:  "write",
	}, func(event GenerationTextStreamEvent) error {
		events = append(events, event)
		return nil
	})
	if err != nil || status != 200 {
		t.Fatalf("StreamGenerationText() status = %d error = %v", status, err)
	}
	if len(events) != 4 {
		t.Fatalf("events = %#v, want start, delta, delta, done", events)
	}
	if events[0].Type != "start" || events[1].Delta != "hello " || events[2].Delta != "world" || events[3].Type != "done" {
		t.Fatalf("events = %#v", events)
	}
	if events[3].Message == nil || events[3].Message.Text != "hello world" {
		t.Fatalf("done message = %#v, want final text", events[3].Message)
	}

	task, ok, err := store.Get(events[0].TaskID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok {
		t.Fatal("stream task was not persisted")
	}
	if task.Kind != string(coregeneration.KindText) || task.Status != "completed" || task.Text != "hello world" {
		t.Fatalf("task = %#v", task)
	}
	if task.Usage.TotalTokens != 3 || task.Usage.ReasoningTokens != 4 || task.Usage.CachedTokens != 5 {
		t.Fatalf("usage = %#v", task.Usage)
	}
}

func TestStreamGenerationTextCanUseMultimodalRuntimeFactory(t *testing.T) {
	repo, err := repository.NewGenerationTaskRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, func(prefix string) (string, error) {
		return prefix + "-multimodal", nil
	})
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{
			coregeneration.ProviderDMX: "sk-multimodal",
		},
	})
	workflow := NewGenerationService(settingsSvc, store, nil)
	factoryCredentials := runtime.RouteCredentials{}
	workflow.multimodalTextProviderFactory = func(
		_ context.Context,
		route coregeneration.ModelRoute,
		credentials runtime.RouteCredentials,
	) (multimodal.Provider, error) {
		if route.ID != coregeneration.RouteDMXGPT41MiniText {
			t.Fatalf("route = %q, want text route", route.ID)
		}
		factoryCredentials = credentials
		return fakeMultimodalStreamProvider{
			events: []multimodal.StreamEvent{
				{Type: multimodal.StreamEventMessageDelta, Delta: "multi"},
				{Type: multimodal.StreamEventMessageDelta, Delta: "modal"},
				{Type: multimodal.StreamEventDone},
			},
		}, nil
	}

	events := []GenerationTextStreamEvent{}
	status, err := workflow.StreamGenerationText(context.Background(), GenerationMessageRequest{
		Kind:    string(coregeneration.KindText),
		RouteID: coregeneration.RouteDMXGPT41MiniText,
		Prompt:  "write",
	}, func(event GenerationTextStreamEvent) error {
		events = append(events, event)
		return nil
	})
	if err != nil || status != 200 {
		t.Fatalf("StreamGenerationText() status = %d error = %v", status, err)
	}
	if got := factoryCredentials[coregeneration.ProviderDMX]; got != "sk-multimodal" {
		t.Fatalf("factory credential = %q, want sk-multimodal", got)
	}
	if len(events) != 4 || events[3].Message == nil || events[3].Message.Text != "multimodal" {
		t.Fatalf("events = %#v, want final multimodal text", events)
	}
}

func TestStreamGenerationTextFallsBackToNonStreamingProvider(t *testing.T) {
	repo, err := repository.NewGenerationTaskRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, func(prefix string) (string, error) {
		return prefix + "-fallback", nil
	})
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{
			coregeneration.ProviderDMX: "sk-fallback",
		},
	})
	workflow := NewGenerationService(settingsSvc, store, nil)
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		if route.ID != coregeneration.RouteDMXGPT41MiniText {
			t.Fatalf("route = %q, want text route", route.ID)
		}
		return fakeUnsupportedTextStreamProvider{
			response: coregeneration.Response{
				Text: "fallback text",
				Usage: coregeneration.Usage{
					InputTokens:  3,
					OutputTokens: 4,
					TotalTokens:  7,
				},
			},
		}, nil
	}

	events := []GenerationTextStreamEvent{}
	status, err := workflow.StreamGenerationText(context.Background(), GenerationMessageRequest{
		Kind:    string(coregeneration.KindText),
		RouteID: coregeneration.RouteDMXGPT41MiniText,
		Prompt:  "write",
	}, func(event GenerationTextStreamEvent) error {
		events = append(events, event)
		return nil
	})
	if err != nil || status != 200 {
		t.Fatalf("StreamGenerationText() status = %d error = %v", status, err)
	}
	if len(events) != 2 || events[0].Type != "start" || events[1].Type != "done" {
		t.Fatalf("events = %#v, want start and done", events)
	}
	if events[1].TaskID != "generation-fallback" ||
		events[1].Message == nil ||
		events[1].Message.ID != "generation-fallback" ||
		events[1].Message.Text != "fallback text" {
		t.Fatalf("done event = %#v, want fallback text with stable task id", events[1])
	}

	task, ok, err := store.Get("generation-fallback")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok || task.Status != "completed" || task.Text != "fallback text" || task.Usage.TotalTokens != 7 {
		t.Fatalf("task = %#v, want persisted fallback text", task)
	}
}

func TestCompleteTextUsesConfiguredTextRoute(t *testing.T) {
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{
			"openai": "sk-openai",
		},
	})
	workflow := NewGenerationService(settingsSvc, nil, nil)
	var captured coregeneration.Request
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		if route.ID != coregeneration.RouteOfficialGPT55Text {
			t.Fatalf("route = %q, want official text route", route.ID)
		}
		return fakeTextStreamProvider{
			request: &captured,
			events: []coregeneration.TextStreamEvent{
				{Delta: `{"ok":`},
				{Delta: `true}`},
				{Done: true},
			},
		}, nil
	}

	text, err := workflow.CompleteText(context.Background(), TextCompletionRequest{
		Prompt: "extract",
		Params: map[string]any{"temperature": 0},
	})
	if err != nil {
		t.Fatalf("CompleteText() error = %v", err)
	}
	if text != `{"ok":true}` {
		t.Fatalf("text = %q, want collected stream", text)
	}
	if captured.RouteID != coregeneration.RouteOfficialGPT55Text ||
		captured.Model != "gpt-5.5" ||
		captured.Params["temperature"] != 0 {
		t.Fatalf("captured request = %#v", captured)
	}
}

func TestCompleteTextFallsBackToNonStreamingProvider(t *testing.T) {
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{
			"openai": "sk-openai",
		},
	})
	workflow := NewGenerationService(settingsSvc, nil, nil)
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		if route.ID != coregeneration.RouteOfficialGPT55Text {
			t.Fatalf("route = %q, want official text route", route.ID)
		}
		return fakeUnsupportedTextStreamProvider{
			response: coregeneration.Response{Text: "non-stream text"},
		}, nil
	}

	text, err := workflow.CompleteText(context.Background(), TextCompletionRequest{
		Prompt: "extract",
	})
	if err != nil {
		t.Fatalf("CompleteText() error = %v", err)
	}
	if text != "non-stream text" {
		t.Fatalf("text = %q, want non-stream text", text)
	}
}

func TestCompleteTextRequiresConfiguredTextRoute(t *testing.T) {
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{values: map[string]string{}})
	workflow := NewGenerationService(settingsSvc, nil, nil)
	_, err := workflow.CompleteText(context.Background(), TextCompletionRequest{Prompt: "extract"})
	if err == nil || !strings.Contains(err.Error(), "API Key 尚未配置") {
		t.Fatalf("CompleteText() error = %v, want missing API key", err)
	}
}

type generationTestAPIKeyStore struct {
	values map[string]string
}

func (store *generationTestAPIKeyStore) Get(keyName string) (string, string, error) {
	value := store.values[keyName]
	source := ""
	if value != "" {
		source = "test"
	}
	return value, source, nil
}

func (store *generationTestAPIKeyStore) Set(keyName string, value string) error {
	store.values[keyName] = value
	return nil
}

func (store *generationTestAPIKeyStore) Clear(keyName string) error {
	delete(store.values, keyName)
	return nil
}

type fakeTextStreamProvider struct {
	request *coregeneration.Request
	events  []coregeneration.TextStreamEvent
}

func (provider fakeTextStreamProvider) Name() string {
	return "fake-text-stream"
}

func (provider fakeTextStreamProvider) Generate(context.Context, coregeneration.Request) (coregeneration.Response, error) {
	return coregeneration.Response{}, nil
}

func (provider fakeTextStreamProvider) Get(context.Context, string) (coregeneration.Response, error) {
	return coregeneration.Response{}, nil
}

func (provider fakeTextStreamProvider) GenerateTextStream(_ context.Context, request coregeneration.Request) (coregeneration.TextStream, error) {
	if provider.request != nil {
		*provider.request = request
	}
	return &fakeTextStream{events: provider.events}, nil
}

type fakeMultimodalStreamProvider struct {
	events []multimodal.StreamEvent
}

func (provider fakeMultimodalStreamProvider) Name() string {
	return "fake-multimodal"
}

func (provider fakeMultimodalStreamProvider) Generate(
	context.Context,
	multimodal.GenerateRequest,
) (multimodal.GenerateResponse, error) {
	return multimodal.GenerateResponse{}, nil
}

func (provider fakeMultimodalStreamProvider) Stream(
	context.Context,
	multimodal.GenerateRequest,
) (*multimodal.StreamReader, error) {
	return multimodal.StreamFromEvents(provider.events), nil
}

type fakeTextStream struct {
	events []coregeneration.TextStreamEvent
	index  int
}

func (stream *fakeTextStream) Recv() (coregeneration.TextStreamEvent, error) {
	if stream.index >= len(stream.events) {
		return coregeneration.TextStreamEvent{}, io.EOF
	}
	event := stream.events[stream.index]
	stream.index++
	return event, nil
}

func (stream *fakeTextStream) Close() error {
	return nil
}

type fakeUnsupportedTextStreamProvider struct {
	request  *coregeneration.Request
	response coregeneration.Response
}

type blockingVideoGenerateProvider struct {
	request  *coregeneration.Request
	started  chan struct{}
	release  chan struct{}
	response coregeneration.Response
	err      error
}

type blockingMultiAssetImageGenerateProvider struct {
	started chan coregeneration.Request
	release chan struct{}
	err     error
}

func (provider *blockingMultiAssetImageGenerateProvider) Name() string {
	return "blocking-image"
}

func (provider *blockingMultiAssetImageGenerateProvider) Generate(ctx context.Context, request coregeneration.Request) (coregeneration.Response, error) {
	provider.started <- request
	if callback, ok := coregeneration.ProgressCallbackFromOptions(request.Options); ok {
		callback(ctx, coregeneration.ProgressEvent{
			Response: coregeneration.Response{
				ID:     "image-batch",
				Status: "completed",
				Assets: []coregeneration.Asset{
					{Kind: coregeneration.KindImage, MIMEType: "image/png", Base64: base64.StdEncoding.EncodeToString([]byte("generated-1"))},
					{Kind: coregeneration.KindImage, MIMEType: "image/png", Base64: base64.StdEncoding.EncodeToString([]byte("generated-2"))},
				},
			},
			Completed: 2,
			Total:     3,
		})
	}
	select {
	case <-provider.release:
	case <-ctx.Done():
		return coregeneration.Response{}, ctx.Err()
	}
	return coregeneration.Response{
		ID:     "image-batch",
		Status: "completed",
		Assets: []coregeneration.Asset{
			{Kind: coregeneration.KindImage, MIMEType: "image/png", Base64: base64.StdEncoding.EncodeToString([]byte("generated-1"))},
			{Kind: coregeneration.KindImage, MIMEType: "image/png", Base64: base64.StdEncoding.EncodeToString([]byte("generated-2"))},
			{Kind: coregeneration.KindImage, MIMEType: "image/png", Base64: base64.StdEncoding.EncodeToString([]byte("generated-3"))},
		},
	}, provider.err
}

func (provider *blockingMultiAssetImageGenerateProvider) Get(context.Context, string) (coregeneration.Response, error) {
	return coregeneration.Response{}, nil
}

func (provider *blockingVideoGenerateProvider) Name() string {
	return "blocking-video"
}

func (provider *blockingVideoGenerateProvider) Generate(ctx context.Context, request coregeneration.Request) (coregeneration.Response, error) {
	provider.request = &request
	close(provider.started)
	select {
	case <-provider.release:
	case <-ctx.Done():
		return coregeneration.Response{}, ctx.Err()
	}
	return provider.response, provider.err
}

func (provider *blockingVideoGenerateProvider) Get(context.Context, string) (coregeneration.Response, error) {
	return coregeneration.Response{}, nil
}

type recordingVideoProvider struct {
	getID    string
	response coregeneration.Response
	err      error
}

func (provider *recordingVideoProvider) Name() string {
	return "recording-video"
}

func (provider *recordingVideoProvider) Generate(context.Context, coregeneration.Request) (coregeneration.Response, error) {
	return coregeneration.Response{}, nil
}

func (provider *recordingVideoProvider) Get(_ context.Context, id string) (coregeneration.Response, error) {
	provider.getID = id
	return provider.response, provider.err
}

func (provider fakeUnsupportedTextStreamProvider) Name() string {
	return "fake-unsupported-text-stream"
}

func (provider fakeUnsupportedTextStreamProvider) Generate(_ context.Context, request coregeneration.Request) (coregeneration.Response, error) {
	if provider.request != nil {
		*provider.request = request
	}
	return provider.response, nil
}

func (provider fakeUnsupportedTextStreamProvider) Get(context.Context, string) (coregeneration.Response, error) {
	return coregeneration.Response{}, nil
}

func (provider fakeUnsupportedTextStreamProvider) GenerateTextStream(context.Context, coregeneration.Request) (coregeneration.TextStream, error) {
	return nil, fmt.Errorf("fake stream unsupported: %w", coregeneration.ErrTextStreamingUnsupported)
}

type stubImageProvider struct {
	generateResponse coregeneration.Response
	generateErr      error
	getResponse      coregeneration.Response
	getErr           error
	getID            string
}

func (provider *stubImageProvider) Name() string { return "stub-image" }

func (provider *stubImageProvider) Generate(context.Context, coregeneration.Request) (coregeneration.Response, error) {
	return provider.generateResponse, provider.generateErr
}

func (provider *stubImageProvider) Get(_ context.Context, id string) (coregeneration.Response, error) {
	provider.getID = id
	return provider.getResponse, provider.getErr
}

func jimengImageTaskRecord(id string) GenerationTaskRecord {
	return GenerationTaskRecord{
		ID:        id,
		Kind:      string(coregeneration.KindImage),
		RouteID:   coregeneration.RouteJimengSeedream50,
		FamilyID:  coregeneration.FamilySeedream,
		VersionID: coregeneration.VersionSeedream5Lite,
		Provider:  coregeneration.ProviderJimeng,
		Model:     coregeneration.ModelSeedream50,
		Prompt:    "a cat",
		Status:    "submitted",
	}
}

func TestCompleteSubmittedGenerationHandsOffPendingImage(t *testing.T) {
	repo, err := repository.NewGenerationTaskRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, nil)
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{coregeneration.ProviderJimeng: "configured"},
	})
	workflow := NewGenerationService(settingsSvc, store, nil)

	// The provider ran out of its inline poll budget while jimeng was still "querying".
	provider := &stubImageProvider{
		generateResponse: coregeneration.Response{
			ID:     "jimeng.seedream-5.0:submit-1",
			Status: "submitted",
		},
	}
	task := jimengImageTaskRecord("generation-img-1")
	// The task is created before the background worker runs, matching production where the
	// handler persists it prior to launching completeSubmittedGeneration.
	if err := store.Upsert(task); err != nil {
		t.Fatalf("Upsert() error = %v", err)
	}
	workflow.completeSubmittedGeneration(
		context.Background(),
		task,
		provider,
		coregeneration.Request{Kind: coregeneration.KindImage, Prompt: "a cat"},
		"create",
		"",
		"",
	)

	stored, ok, err := store.Get("generation-img-1")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok || stored.Status != "submitted" ||
		stored.ProviderTaskID != "jimeng.seedream-5.0:submit-1" {
		t.Fatalf("task = %+v, want submitted handoff carrying the provider task id", stored)
	}

	pending, err := store.ListPending(10)
	if err != nil {
		t.Fatalf("ListPending() error = %v", err)
	}
	if !slicesContainsTaskID(pending, "generation-img-1") {
		t.Fatalf("ListPending = %+v, want the handed-off image task", pending)
	}
}

func TestPollGenerationTaskCompletesHandedOffImage(t *testing.T) {
	repo, err := repository.NewGenerationTaskRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, nil)
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{coregeneration.ProviderJimeng: "configured"},
	})
	provider := &stubImageProvider{
		getResponse: coregeneration.Response{
			ID:     "jimeng.seedream-5.0:submit-1",
			Status: "completed",
		},
	}
	workflow := NewGenerationService(settingsSvc, store, nil)
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		if route.ID != coregeneration.RouteJimengSeedream50 {
			t.Fatalf("route = %q, want jimeng seedream image route", route.ID)
		}
		return provider, nil
	}

	handedOff := jimengImageTaskRecord("generation-img-2")
	handedOff.ProviderTaskID = "jimeng.seedream-5.0:submit-1"
	if err := store.Upsert(handedOff); err != nil {
		t.Fatalf("Upsert() error = %v", err)
	}

	task, ok, err := store.Get("generation-img-2")
	if err != nil || !ok {
		t.Fatalf("Get() ok = %v error = %v", ok, err)
	}
	workflow.PollGenerationTask(context.Background(), task)

	if provider.getID != "jimeng.seedream-5.0:submit-1" {
		t.Fatalf("provider get id = %q, want the handed-off provider task id", provider.getID)
	}
	completed, ok, err := store.Get("generation-img-2")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok || completed.Status != "completed" {
		t.Fatalf("task = %+v, want completed image task", completed)
	}
}

func TestPollGenerationTaskTimesOutExpiredHandedOffImage(t *testing.T) {
	repo, err := repository.NewGenerationTaskRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	store := NewGenerationTaskServiceFromRepository(repo, nil, nil)
	settingsSvc := settings.NewSettings(&generationTestAPIKeyStore{
		values: map[string]string{coregeneration.ProviderJimeng: "configured"},
	})
	// The provider is still "querying" — jimeng never returned a result.
	provider := &stubImageProvider{
		getResponse: coregeneration.Response{
			ID:     "jimeng.seedream-5.0:submit-1",
			Status: "submitted",
		},
	}
	workflow := NewGenerationService(settingsSvc, store, nil)
	workflow.generationProviderFactory = func(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
		return provider, nil
	}

	handedOff := jimengImageTaskRecord("generation-img-3")
	handedOff.ProviderTaskID = "jimeng.seedream-5.0:submit-1"
	handedOff.CreatedAt = time.Now().UTC().Add(-20 * time.Minute).Format(time.RFC3339Nano)
	if err := store.Upsert(handedOff); err != nil {
		t.Fatalf("Upsert() error = %v", err)
	}

	task, ok, err := store.Get("generation-img-3")
	if err != nil || !ok {
		t.Fatalf("Get() ok = %v error = %v", ok, err)
	}
	workflow.PollGenerationTask(context.Background(), task)

	failed, ok, err := store.Get("generation-img-3")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok || failed.Status != "failed" {
		t.Fatalf("task = %+v, want failed after exceeding the background poll cap", failed)
	}
	if !strings.Contains(failed.Error, "超时") {
		t.Fatalf("error = %q, want a timeout message", failed.Error)
	}
}

func slicesContainsTaskID(tasks []GenerationTaskRecord, id string) bool {
	for _, task := range tasks {
		if task.ID == id {
			return true
		}
	}
	return false
}
