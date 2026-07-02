package libtv

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestGenerateVideoCreatesAndRunsLibTVNode(t *testing.T) {
	binPath := fakeExecutable(t, "libtv")
	var gotArgs []string
	runner := CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		gotArgs = append([]string{}, args...)
		return []byte(`{"id":"node_123","name":"generated"}`), nil
	})
	provider, err := NewProvider(Config{
		BinPath:   binPath,
		ProjectID: "project-123",
		Runner:    runner,
		Now:       func() time.Time { return time.Unix(1, 234) },
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindVideo,
		RouteID: generation.RouteLibTVSeedance20Mini,
		Model:   "Seedance 2.0 Mini",
		Prompt:  "make a video",
		Params: map[string]any{
			"ratio":       "9:16",
			"resolution":  "720p",
			"duration":    "5",
			"enableSound": "off",
		},
		ParamsResolved: true,
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	wantArgs := []string{
		"node",
		"--project=project-123",
		"create",
		"mediago-video-1000000234",
		"--type=video",
		"--prompt=make a video",
		"--set=model=Seedance 2.0 Mini",
		"--set=ratio=9:16",
		"--set=resolution=720p",
		"--set=duration=5",
		"--set=enableSound=off",
		"--run",
	}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Fatalf("args = %#v, want %#v", gotArgs, wantArgs)
	}
	if response.ID != generation.RouteLibTVSeedance20Mini+":project-123:node_123" ||
		response.Status != "submitted" {
		t.Fatalf("response = %#v, want submitted LibTV task", response)
	}
}

func TestGetDownloadsLibTVResultAsBase64Assets(t *testing.T) {
	binPath := fakeExecutable(t, "libtv")
	var gotArgs []string
	runner := CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		gotArgs = append([]string{}, args...)
		downloadDir := flagValue(args, "--out=")
		if downloadDir == "" {
			t.Fatalf("args = %#v, missing --out", args)
		}
		if err := os.WriteFile(filepath.Join(downloadDir, "result.mp4"), []byte("video-bytes"), 0o600); err != nil {
			t.Fatalf("writing fake download: %v", err)
		}
		return []byte(`downloaded result.mp4`), nil
	})
	provider, err := NewProvider(Config{BinPath: binPath, Runner: runner})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Get(context.Background(), generation.RouteLibTVSeedance20Mini+":project-123:node_123")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}

	if gotArgs[0] != "download" ||
		!stringSliceContains(gotArgs, "--node=node_123") ||
		!stringSliceContains(gotArgs, "--project=project-123") ||
		!stringSliceContains(gotArgs, "--without-ai-watermark") {
		t.Fatalf("args = %#v, want download flags", gotArgs)
	}
	if response.Status != "completed" ||
		len(response.Assets) != 1 ||
		response.Assets[0].Kind != generation.KindVideo ||
		response.Assets[0].MIMEType != "video/mp4" ||
		response.Assets[0].Base64 != base64.StdEncoding.EncodeToString([]byte("video-bytes")) {
		t.Fatalf("response = %#v, want completed base64 video asset", response)
	}
}

func TestGetReturnsSubmittedWhenLibTVDownloadIsPending(t *testing.T) {
	binPath := fakeExecutable(t, "libtv")
	runner := CommandRunnerFunc(func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return []byte(`节点仍在生成中，暂无可下载资源`), errors.New("not ready")
	})
	provider, err := NewProvider(Config{BinPath: binPath, Runner: runner})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Get(context.Background(), generation.RouteLibTVSeedance20Mini+":node_123")
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

func flagValue(values []string, prefix string) string {
	for _, value := range values {
		if strings.HasPrefix(value, prefix) {
			return strings.TrimPrefix(value, prefix)
		}
	}
	return ""
}
