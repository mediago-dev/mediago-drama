package jimeng

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestGenerateImageUsesCLIAndParsesAssets(t *testing.T) {
	gotArgs := [][]string{}
	provider := testProvider(t, CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		gotArgs = append(gotArgs, append([]string{}, args...))
		if len(args) > 0 && args[0] == "query_result" {
			return []byte(`{"submit_id":"img_1","gen_status":"success","image_urls":["https://example.test/a-from-query.png"]}`), nil
		}
		return []byte(`{"submit_id":"img_1","gen_status":"success"}`), nil
	}))

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindImage,
		RouteID: generation.RouteJimengSeedream47,
		Prompt:  "一只戴墨镜的橘猫",
		Params: map[string]any{
			"ratio":          "1:1",
			"resolutionType": "2k",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if len(gotArgs) != 2 {
		t.Fatalf("CLI calls = %#v, want text2image then query_result", gotArgs)
	}
	if !reflect.DeepEqual(gotArgs[0], []string{
		"text2image",
		"--prompt=一只戴墨镜的橘猫",
		"--ratio=1:1",
		"--resolution_type=2k",
		"--model_version=4.7",
		"--poll=30",
	}) {
		t.Fatalf("args = %#v", gotArgs)
	}
	if !reflect.DeepEqual(gotArgs[1], []string{"query_result", "--submit_id=img_1"}) {
		t.Fatalf("query args = %#v", gotArgs[1])
	}
	if response.ID != generation.RouteJimengSeedream47+":img_1" || response.Status != "completed" {
		t.Fatalf("response = %#v", response)
	}
	if len(response.Assets) != 1 || response.Assets[0].URL != "https://example.test/a-from-query.png" {
		t.Fatalf("assets = %#v", response.Assets)
	}
}

func TestGenerateImageParsesResultJSONAssets(t *testing.T) {
	provider := testProvider(t, CommandRunnerFunc(func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return []byte(`{
  "submit_id": "77d1b0d4-c2ec-4a75-addb-88ce580c1eba",
  "gen_status": "success",
  "result_json": {
    "images": [
      {
        "image_url": "https://p11-dreamina-sign.byteimg.com/tos-cn-i-tb4s082cfz/746c978e959d43a096929bddb63d9a1e~tplv-tb4s082cfz-aigc_resize:0:0.png?x-expires=1781308800",
        "width": 2048,
        "height": 2048
      }
    ],
    "videos": []
  }
}`), nil
	}))

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindImage,
		RouteID: generation.RouteJimengSeedream50,
		Prompt:  "测试",
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if response.Status != "completed" {
		t.Fatalf("status = %q, want completed", response.Status)
	}
	if len(response.Assets) != 1 {
		t.Fatalf("assets = %#v, want one parsed image asset", response.Assets)
	}
	if response.Assets[0].URL == "" || !strings.Contains(response.Assets[0].URL, "byteimg.com") {
		t.Fatalf("asset url = %q, want dreamina image url", response.Assets[0].URL)
	}
}

func TestGenerateImageKeepsInitialAssetsWhenQueryResultFails(t *testing.T) {
	provider := testProvider(t, CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if len(args) > 0 && args[0] == "query_result" {
			return []byte(`network unavailable`), errors.New("query failed")
		}
		return []byte(`{"submit_id":"img_1","gen_status":"success","image_urls":["https://example.test/initial.png"]}`), nil
	}))

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindImage,
		RouteID: generation.RouteJimengSeedream50,
		Prompt:  "测试",
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if len(response.Assets) != 1 || response.Assets[0].URL != "https://example.test/initial.png" {
		t.Fatalf("assets = %#v, want initial image asset", response.Assets)
	}
}

func TestGenerateImagePollsQueryResultUntilImageAssetIsReady(t *testing.T) {
	queryCalls := 0
	provider := testProvider(t, CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if len(args) > 0 && args[0] == "query_result" {
			queryCalls++
			if queryCalls == 1 {
				return []byte(`{"submit_id":"img_1","gen_status":"querying"}`), nil
			}
			return []byte(`{"submit_id":"img_1","gen_status":"success","image_urls":["https://example.test/ready.png"]}`), nil
		}
		return []byte(`{"submit_id":"img_1","gen_status":"querying"}`), nil
	}))

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindImage,
		RouteID: generation.RouteJimengSeedream50,
		Prompt:  "测试",
		Params:  map[string]any{"resultPoll": 2},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if queryCalls != 2 {
		t.Fatalf("query calls = %d, want initial query plus one poll", queryCalls)
	}
	if len(response.Assets) != 1 || response.Assets[0].URL != "https://example.test/ready.png" {
		t.Fatalf("assets = %#v, want polled image asset", response.Assets)
	}
}

func TestGenerateImageRunsCLIForRequestedCountAndCombinesAssets(t *testing.T) {
	gotArgs := [][]string{}
	generationCalls := 0
	progressEvents := []generation.ProgressEvent{}
	provider := testProvider(t, CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		gotArgs = append(gotArgs, append([]string{}, args...))
		if len(args) > 0 && args[0] == "query_result" {
			submitID := strings.TrimPrefix(args[1], "--submit_id=img_")
			return []byte(`{"submit_id":"img_` + submitID + `","gen_status":"success","image_urls":["https://example.test/generated-` + submitID + `.png"]}`), nil
		}
		generationCalls++
		index := generationCalls
		return []byte(`{"submit_id":"img_` + formatNumber(float64(index)) + `","gen_status":"success"}`), nil
	}))

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindImage,
		RouteID: generation.RouteJimengSeedream50,
		Prompt:  "生成三张同主题角色图",
		Params: map[string]any{
			"aspectRatio": "1:1",
			"resolution":  "2K",
			"n":           3,
		},
		Options: map[string]any{
			generation.ProgressCallbackOption: generation.ProgressCallback(
				func(_ context.Context, event generation.ProgressEvent) {
					progressEvents = append(progressEvents, event)
				},
			),
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if len(gotArgs) != 6 {
		t.Fatalf("CLI calls = %d, want 3 text2image and 3 query_result calls", len(gotArgs))
	}
	text2imageCalls := [][]string{}
	queryCalls := [][]string{}
	for _, args := range gotArgs {
		if len(args) > 0 && args[0] == "query_result" {
			queryCalls = append(queryCalls, args)
			continue
		}
		text2imageCalls = append(text2imageCalls, args)
	}
	for _, args := range text2imageCalls {
		if !reflect.DeepEqual(args, []string{
			"text2image",
			"--prompt=生成三张同主题角色图",
			"--ratio=1:1",
			"--resolution_type=2k",
			"--model_version=5.0",
			"--poll=30",
		}) {
			t.Fatalf("args = %#v", args)
		}
	}
	if !reflect.DeepEqual(queryCalls, [][]string{
		{"query_result", "--submit_id=img_1"},
		{"query_result", "--submit_id=img_2"},
		{"query_result", "--submit_id=img_3"},
	}) {
		t.Fatalf("query calls = %#v", queryCalls)
	}
	if response.ID != generation.RouteJimengSeedream50+":img_1" || response.Status != "completed" {
		t.Fatalf("response = %#v", response)
	}
	if len(response.Assets) != 3 {
		t.Fatalf("assets = %#v, want three combined image assets", response.Assets)
	}
	if len(progressEvents) != 3 {
		t.Fatalf("progress events = %#v, want one event per generated image", progressEvents)
	}
	for index, event := range progressEvents {
		if event.Completed != index+1 || event.Total != 3 || len(event.Response.Assets) != index+1 {
			t.Fatalf("progress event[%d] = %#v, want cumulative %d/3 assets", index, event, index+1)
		}
	}
	for index, asset := range response.Assets {
		wantURL := "https://example.test/generated-" + formatNumber(float64(index+1)) + ".png"
		if asset.URL != wantURL {
			t.Fatalf("asset[%d] url = %q, want %q", index, asset.URL, wantURL)
		}
	}
}

func TestGenerateVideoWithReferenceWritesTempFile(t *testing.T) {
	var gotArgs []string
	provider := testProvider(t, CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		gotArgs = append([]string{}, args...)
		return []byte(`log line
{"submit_id":"video_1","gen_status":"querying"}`), nil
	}))
	reference := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("png"))

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindVideo,
		RouteID:       generation.RouteJimengSeedance20Fast,
		Prompt:        "镜头慢慢推近",
		ReferenceURLs: []string{reference},
		Params: map[string]any{
			"duration":        "5",
			"ratio":           "16:9",
			"videoResolution": "720p",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if len(gotArgs) != 6 || gotArgs[0] != "image2video" || !strings.HasPrefix(gotArgs[1], "--image=") {
		t.Fatalf("args = %#v", gotArgs)
	}
	if stringSliceContainsPrefix(gotArgs, "--ratio=") {
		t.Fatalf("image2video args should not include ratio: %#v", gotArgs)
	}
	if filepath.Base(strings.TrimPrefix(gotArgs[1], "--image=")) != "reference-01.png" {
		t.Fatalf("image arg = %q", gotArgs[1])
	}
	if response.ID != generation.RouteJimengSeedance20Fast+":video_1" || response.Status != "submitted" {
		t.Fatalf("response = %#v", response)
	}
}

func TestGenerateVideoWithMultipleReferencesUsesMultimodalCLI(t *testing.T) {
	var gotArgs []string
	provider := testProvider(t, CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		gotArgs = append([]string{}, args...)
		return []byte(`{"submit_id":"video_2","gen_status":"querying"}`), nil
	}))
	referenceA := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("a"))
	referenceB := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("b"))

	_, err := provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindVideo,
		RouteID:       generation.RouteJimengSeedance20Fast,
		Prompt:        "保持人物一致，镜头推进",
		ReferenceURLs: []string{referenceA, referenceB},
		Params: map[string]any{
			"duration":        "5",
			"ratio":           "16:9",
			"videoResolution": "720p",
			"poll":            10,
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if gotArgs[0] != "multimodal2video" {
		t.Fatalf("args = %#v, want multimodal2video", gotArgs)
	}
	if countStringPrefix(gotArgs, "--image=") != 2 {
		t.Fatalf("args = %#v, want two repeated image flags", gotArgs)
	}
	assertContainsArg(t, gotArgs, "--ratio=16:9")
	assertContainsArg(t, gotArgs, "--video_resolution=720p")
	assertContainsArg(t, gotArgs, "--model_version=seedance2.0fast")
	assertContainsArg(t, gotArgs, "--poll=10")
}

func TestGenerateVideoUsesMiniRouteModel(t *testing.T) {
	var gotArgs []string
	provider := testProvider(t, CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		gotArgs = append([]string{}, args...)
		return []byte(`{"submit_id":"video_1","gen_status":"querying"}`), nil
	}))

	_, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindVideo,
		RouteID: generation.RouteJimengSeedance20Mini,
		Prompt:  "更快生成一个720p短镜头",
		Params: map[string]any{
			"aspectRatio": "16:9",
			"duration":    "5",
			"resolution":  "720p",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	assertContainsArg(t, gotArgs, "--model_version=seedance2.0mini")
	assertContainsArg(t, gotArgs, "--video_resolution=720p")
}

func TestGenerateVideoPreservesLegacyModelVersionParam(t *testing.T) {
	var gotArgs []string
	provider := testProvider(t, CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		gotArgs = append([]string{}, args...)
		return []byte(`{"submit_id":"video_1","gen_status":"querying"}`), nil
	}))

	_, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindVideo,
		RouteID: generation.RouteJimengSeedance20Fast,
		Prompt:  "兼容旧模型通道",
		Params: map[string]any{
			"duration":        "5",
			"videoResolution": "720p",
			"modelVersion":    "seedance2.0_vip",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	assertContainsArg(t, gotArgs, "--model_version=seedance2.0_vip")
}

func TestGenerateImagePreservesLegacyPollParam(t *testing.T) {
	gotArgs := [][]string{}
	provider := testProvider(t, CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		gotArgs = append(gotArgs, append([]string{}, args...))
		if len(args) > 0 && args[0] == "query_result" {
			return []byte(`{"submit_id":"img_1","gen_status":"success","image_urls":["https://example.test/a.png"]}`), nil
		}
		return []byte(`{"submit_id":"img_1","gen_status":"success","image_urls":["https://example.test/a.png"]}`), nil
	}))

	_, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindImage,
		RouteID: generation.RouteJimengSeedream47,
		Prompt:  "兼容旧等待秒数",
		Params: map[string]any{
			"poll": 45,
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if len(gotArgs) == 0 {
		t.Fatal("CLI was not called")
	}
	assertContainsArg(t, gotArgs[0], "--poll=45")
}

func TestGetQueriesResult(t *testing.T) {
	var gotArgs []string
	provider := testProvider(t, CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		gotArgs = append([]string{}, args...)
		return []byte(`{"submit_id":"video_1","gen_status":"success","video_url":"https://example.test/out.mp4"}`), nil
	}))

	response, err := provider.Get(context.Background(), generation.RouteJimengSeedance20Fast+":video_1")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !reflect.DeepEqual(gotArgs, []string{"query_result", "--submit_id=video_1"}) {
		t.Fatalf("args = %#v", gotArgs)
	}
	if response.Status != "completed" || len(response.Assets) != 1 {
		t.Fatalf("response = %#v", response)
	}
}

func assertContainsArg(t *testing.T, args []string, want string) {
	t.Helper()
	for _, arg := range args {
		if arg == want {
			return
		}
	}
	t.Fatalf("args = %#v, want %q", args, want)
}

func stringSliceContainsPrefix(values []string, prefix string) bool {
	return countStringPrefix(values, prefix) > 0
}

func countStringPrefix(values []string, prefix string) int {
	count := 0
	for _, value := range values {
		if strings.HasPrefix(value, prefix) {
			count++
		}
	}
	return count
}

func testProvider(t *testing.T, runner CommandRunner) *Provider {
	t.Helper()
	path := filepath.Join(t.TempDir(), "dreamina")
	if err := osWriteExecutable(path); err != nil {
		t.Fatalf("writing fake binary: %v", err)
	}
	provider, err := NewProvider(Config{BinPath: path, Runner: runner})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}
	return provider
}

func osWriteExecutable(path string) error {
	return os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0o755)
}
