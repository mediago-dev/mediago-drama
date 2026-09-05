package jimeng

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

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

func TestGenerateVideoWithHTTPReferenceDownloadsTempFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "image/png")
		_, _ = response.Write([]byte("png-bytes"))
	}))
	defer server.Close()

	var gotArgs []string
	var gotReferenceBasename string
	var gotReferenceContent string
	provider := testProvider(t, CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		gotArgs = append([]string{}, args...)
		if len(args) > 1 && args[0] == "image2video" {
			referencePath := strings.TrimPrefix(args[1], "--image=")
			gotReferenceBasename = filepath.Base(referencePath)
			data, err := os.ReadFile(referencePath)
			if err != nil {
				return nil, err
			}
			gotReferenceContent = string(data)
		}
		return []byte(`{"submit_id":"video_1","gen_status":"querying"}`), nil
	}))

	_, err := provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindVideo,
		RouteID:       generation.RouteJimengSeedance20Fast,
		Prompt:        "镜头慢慢推近",
		ReferenceURLs: []string{server.URL + "/reference.png"},
		Params: map[string]any{
			"duration":        "5",
			"videoResolution": "720p",
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if gotArgs[0] != "image2video" || !strings.HasPrefix(gotArgs[1], "--image=") {
		t.Fatalf("args = %#v", gotArgs)
	}
	if gotReferenceBasename != "reference-01.png" {
		t.Fatalf("reference basename = %q, want reference-01.png", gotReferenceBasename)
	}
	if gotReferenceContent != "png-bytes" {
		t.Fatalf("reference content = %q, want downloaded bytes", gotReferenceContent)
	}
}

func TestGenerateVideoWithMultipleReferencesUsesMultimodalCLI(t *testing.T) {
	var gotArgs []string
	gotImageBasenames := []string{}
	gotAudioBasenames := []string{}
	provider := testProvider(t, CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		gotArgs = append([]string{}, args...)
		for _, arg := range args {
			if path, ok := strings.CutPrefix(arg, "--image="); ok {
				gotImageBasenames = append(gotImageBasenames, filepath.Base(path))
			}
			if path, ok := strings.CutPrefix(arg, "--audio="); ok {
				gotAudioBasenames = append(gotAudioBasenames, filepath.Base(path))
			}
		}
		return []byte(`{"submit_id":"video_2","gen_status":"querying"}`), nil
	}))
	referenceA := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("a"))
	referenceB := "data:audio/mpeg;base64," + base64.StdEncoding.EncodeToString([]byte("voice"))

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
	if countStringPrefix(gotArgs, "--image=") != 1 {
		t.Fatalf("args = %#v, want one image flag", gotArgs)
	}
	if countStringPrefix(gotArgs, "--audio=") != 1 {
		t.Fatalf("args = %#v, want one audio flag", gotArgs)
	}
	if len(gotImageBasenames) != 1 || gotImageBasenames[0] != "reference-01.png" {
		t.Fatalf("image files = %#v, want image temp file", gotImageBasenames)
	}
	if len(gotAudioBasenames) != 1 || gotAudioBasenames[0] != "reference-02.mp3" {
		t.Fatalf("audio files = %#v, want audio temp file", gotAudioBasenames)
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
