package pippit

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestGenerateVideoSubmitsPippitCLIRequest(t *testing.T) {
	binPath := fakeExecutable(t, "pippit-tool-cli")
	var gotArgs []string
	var gotEnv map[string]string
	runner := CommandRunnerFunc(func(_ context.Context, _ string, env map[string]string, args ...string) ([]byte, error) {
		gotArgs = append([]string{}, args...)
		gotEnv = env
		return []byte(`{"thread_id":"thread_123","run_id":"run_456","web_thread_link":"https://xyq.test/thread"}`), nil
	})
	provider, err := NewProvider(Config{
		APIKey:  "xyq-key",
		BaseURL: "https://xyq.example.test/",
		BinPath: binPath,
		Runner:  runner,
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindVideo,
		RouteID: generation.RouteXiaoyunqueSeedance20MiniLite,
		Model:   "Seedance_2.0_mini_lite",
		Prompt:  "make a cat video",
		Params: map[string]any{
			"duration":   "5",
			"ratio":      "9:16",
			"resolution": "720p",
		},
		ParamsResolved: true,
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	wantArgs := []string{
		"generate-video",
		"--prompt=make a cat video",
		"--duration=5",
		"--ratio=9:16",
		"--resolution=720p",
		"--model=Seedance_2.0_mini_lite",
	}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Fatalf("args = %#v, want %#v", gotArgs, wantArgs)
	}
	if gotEnv["XYQ_ACCESS_KEY"] != "xyq-key" ||
		gotEnv["XYQ_OPENAPI_BASE"] != "https://xyq.example.test" ||
		gotEnv["XYQ_BASE_URL"] != "https://xyq.example.test" {
		t.Fatalf("env = %#v, want xyq key and base URL", gotEnv)
	}
	if response.ID != generation.RouteXiaoyunqueSeedance20MiniLite+":thread_123:run_456" ||
		response.Status != "submitted" {
		t.Fatalf("response = %#v, want submitted provider task", response)
	}
	if response.Metadata["web_thread_link"] != "https://xyq.test/thread" {
		t.Fatalf("metadata = %#v, want web thread link", response.Metadata)
	}
}

func TestGenerateVideoUsesSeedance20RouteModel(t *testing.T) {
	binPath := fakeExecutable(t, "pippit-tool-cli")
	var gotArgs []string
	runner := CommandRunnerFunc(func(_ context.Context, _ string, _ map[string]string, args ...string) ([]byte, error) {
		gotArgs = append([]string{}, args...)
		return []byte(`{"thread_id":"thread_123","run_id":"run_456"}`), nil
	})
	provider, err := NewProvider(Config{APIKey: "xyq-key", BinPath: binPath, Runner: runner})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	if _, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindVideo,
		RouteID: generation.RouteXiaoyunqueSeedance20,
		Prompt:  "make a cinematic video",
		Params: map[string]any{
			"aspectRatio": "16:9",
			"resolution":  "1080p",
			"duration":    "5",
		},
	}); err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if !stringSliceContains(gotArgs, "--model=seedance2.0_vision") ||
		!stringSliceContains(gotArgs, "--resolution=1080p") {
		t.Fatalf("args = %#v, want Seedance 2.0 model and 1080p resolution", gotArgs)
	}
}

func TestGenerateVideoPassesReferenceMediaByKind(t *testing.T) {
	binPath := fakeExecutable(t, "pippit-tool-cli")
	dir := t.TempDir()
	imagePath := filepath.Join(dir, "ref.png")
	videoPath := filepath.Join(dir, "ref.mp4")
	audioPath := filepath.Join(dir, "ref.wav")
	for _, path := range []string{imagePath, videoPath, audioPath} {
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatalf("writing reference %s: %v", path, err)
		}
	}
	var gotArgs []string
	runner := CommandRunnerFunc(func(_ context.Context, _ string, _ map[string]string, args ...string) ([]byte, error) {
		gotArgs = append([]string{}, args...)
		return []byte(`{"thread_id":"thread_123","run_id":"run_456"}`), nil
	})
	provider, err := NewProvider(Config{APIKey: "xyq-key", BinPath: binPath, Runner: runner})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	if _, err := provider.Generate(context.Background(), generation.Request{
		Kind:           generation.KindVideo,
		Prompt:         "make a video",
		ReferenceURLs:  []string{imagePath, videoPath, audioPath},
		ParamsResolved: true,
	}); err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if !stringSliceContains(gotArgs, "--image="+imagePath) ||
		!stringSliceContains(gotArgs, "--video="+videoPath) ||
		!stringSliceContains(gotArgs, "--audio="+audioPath) {
		t.Fatalf("args = %#v, want image/video/audio flags", gotArgs)
	}
}

func TestGetQueriesPippitResultAndReturnsVideoAssets(t *testing.T) {
	binPath := fakeExecutable(t, "pippit-tool-cli")
	var gotArgs []string
	runner := CommandRunnerFunc(func(_ context.Context, _ string, _ map[string]string, args ...string) ([]byte, error) {
		gotArgs = append([]string{}, args...)
		return []byte(`{
			"completed": true,
			"thread_id": "thread_123",
			"run_id": "run_456",
			"videos": [
				{"download_url": "https://xyq.test/video.mp4", "output_path": "/tmp/video.mp4"}
			]
		}`), nil
	})
	provider, err := NewProvider(Config{APIKey: "xyq-key", BinPath: binPath, Runner: runner})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Get(context.Background(), generation.RouteXiaoyunqueSeedance20MiniLite+":thread_123:run_456")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}

	if gotArgs[0] != "query-result" ||
		!stringSliceContains(gotArgs, "--thread-id=thread_123") ||
		!stringSliceContains(gotArgs, "--run-id=run_456") {
		t.Fatalf("args = %#v, want query-result thread/run flags", gotArgs)
	}
	if response.Status != "completed" ||
		len(response.Assets) != 1 ||
		response.Assets[0].Kind != generation.KindVideo ||
		response.Assets[0].URL != "https://xyq.test/video.mp4" {
		t.Fatalf("response = %#v, want completed video asset", response)
	}
}

func TestGetReturnsSubmittedWhenPippitResultIsPending(t *testing.T) {
	binPath := fakeExecutable(t, "pippit-tool-cli")
	runner := CommandRunnerFunc(func(_ context.Context, _ string, _ map[string]string, _ ...string) ([]byte, error) {
		return []byte(`{"completed": false, "thread_id": "thread_123", "run_id": "run_456", "videos": []}`), nil
	})
	provider, err := NewProvider(Config{APIKey: "xyq-key", BinPath: binPath, Runner: runner})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Get(context.Background(), generation.RouteXiaoyunqueSeedance20MiniLite+":thread_123:run_456")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if response.Status != "submitted" || len(response.Assets) != 0 {
		t.Fatalf("response = %#v, want submitted without assets", response)
	}
}

func fakeExecutable(t *testing.T, name string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("writing fake executable: %v", err)
	}
	return path
}

func stringSliceContains(values []string, want string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == want {
			return true
		}
	}
	return false
}
