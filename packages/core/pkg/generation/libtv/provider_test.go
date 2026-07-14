package libtv

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestResolveImageModelNameUsesExactModelKey(t *testing.T) {
	tests := []struct {
		name      string
		routeID   string
		modelKey  string
		modelName string
	}{
		{
			name:      "gpt image 2",
			routeID:   generation.RouteLibTVGPTImage2,
			modelKey:  "lib-image-2",
			modelName: "Lib Image Current",
		},
		{
			name:      "nano banana 31",
			routeID:   generation.RouteLibTVNanoBanana31,
			modelKey:  "nebula-2-flash",
			modelName: "Lib Navo 2 Current",
		},
		{
			name:      "seedream 5 lite",
			routeID:   generation.RouteLibTVSeedream5Lite,
			modelKey:  "seedream-5",
			modelName: "Seedream 5.0 Current",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			binPath := fakeExecutable(t, "libtv")
			var calls [][]string
			runner := CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
				calls = append(calls, append([]string{}, args...))
				return []byte(fmt.Sprintf(
					"checking models\n{\"matches\":[{\"modelKey\":\"other\",\"modelName\":\"Other\"},{\"modelKey\":%q,\"modelName\":%q}]}\n",
					test.modelKey,
					test.modelName,
				)), nil
			})
			provider, err := NewProvider(Config{BinPath: binPath, Runner: runner})
			if err != nil {
				t.Fatalf("NewProvider() error = %v", err)
			}

			got, err := provider.resolveImageModelName(context.Background(), test.routeID)
			if err != nil {
				t.Fatalf("resolveImageModelName() error = %v", err)
			}
			if got != test.modelName {
				t.Fatalf("resolveImageModelName() = %q, want %q", got, test.modelName)
			}
			if !reflect.DeepEqual(calls, [][]string{{"model", "search", "--type=image"}}) {
				t.Fatalf("calls = %#v, want one exact image model search", calls)
			}
		})
	}
}

func TestResolveImageModelNameRejectsUnavailableOrInvalidResults(t *testing.T) {
	tests := []struct {
		name       string
		routeID    string
		output     string
		runErr     error
		wantErrors []string
	}{
		{
			name:       "model key absent",
			routeID:    generation.RouteLibTVGPTImage2,
			output:     `{"matches":[{"modelKey":"lib-image","modelName":"Different"}]}`,
			wantErrors: []string{"lib-image-2", "Lib Image"},
		},
		{
			name:       "matched model name empty",
			routeID:    generation.RouteLibTVNanoBanana31,
			output:     `{"matches":[{"modelKey":"nebula-2-flash","modelName":"  "}]}`,
			wantErrors: []string{"nebula-2-flash", "modelName"},
		},
		{
			name:       "malformed output",
			routeID:    generation.RouteLibTVSeedream5Lite,
			output:     `not json`,
			wantErrors: []string{"seedream-5", "JSON"},
		},
		{
			name:       "command failure",
			routeID:    generation.RouteLibTVGPTImage2,
			output:     `not logged in`,
			runErr:     errors.New("exit status 1"),
			wantErrors: []string{"lib-image-2", "model search", "not logged in"},
		},
		{
			name:       "unknown route",
			routeID:    "libtv.unknown-image",
			output:     `{"matches":[]}`,
			wantErrors: []string{"libtv.unknown-image", "not configured"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			binPath := fakeExecutable(t, "libtv")
			calls := 0
			runner := CommandRunnerFunc(func(_ context.Context, _ string, _ ...string) ([]byte, error) {
				calls++
				return []byte(test.output), test.runErr
			})
			provider, err := NewProvider(Config{BinPath: binPath, Runner: runner})
			if err != nil {
				t.Fatalf("NewProvider() error = %v", err)
			}

			_, err = provider.resolveImageModelName(context.Background(), test.routeID)
			if err == nil {
				t.Fatal("resolveImageModelName() error = nil, want failure")
			}
			for _, want := range test.wantErrors {
				if !strings.Contains(err.Error(), want) {
					t.Fatalf("error = %q, missing %q", err.Error(), want)
				}
			}
			if test.routeID == "libtv.unknown-image" && calls != 0 {
				t.Fatalf("calls = %d, want unknown route to fail before CLI", calls)
			}
		})
	}
}

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

func TestGenerateVideoUsesSeedance20RouteModel(t *testing.T) {
	withWorkingDir(t, t.TempDir())
	binPath := fakeExecutable(t, "libtv")
	var gotArgs []string
	runner := CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		gotArgs = append([]string{}, args...)
		return []byte(`{"id":"node_456","name":"generated"}`), nil
	})
	provider, err := NewProvider(Config{
		BinPath:   binPath,
		ProjectID: "project-456",
		Runner:    runner,
		Now:       func() time.Time { return time.Unix(2, 345) },
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:    generation.KindVideo,
		RouteID: generation.RouteLibTVSeedance20,
		Prompt:  "make a 4k video",
		Params: map[string]any{
			"aspectRatio":   "16:9",
			"resolution":    "4k",
			"duration":      "5",
			"generateAudio": true,
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	for _, want := range []string{
		"--set=model=Seedance 2.0 VIP",
		"--set=resolution=4k",
		"--set=enableSound=on",
	} {
		if !stringSliceContains(gotArgs, want) {
			t.Fatalf("args = %#v, missing %q", gotArgs, want)
		}
	}
	if response.ID != generation.RouteLibTVSeedance20+":project-456:node_456" ||
		response.Status != "submitted" {
		t.Fatalf("response = %#v, want submitted LibTV Seedance 2.0 task", response)
	}
}

func TestGenerateVideoUploadsReferencesWithBoundProjectFile(t *testing.T) {
	binPath := fakeExecutable(t, "libtv")
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, ".libtv"), 0o700); err != nil {
		t.Fatalf("creating .libtv dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".libtv", "project.json"), []byte(`{"projectId":"project-bound-123"}`), 0o600); err != nil {
		t.Fatalf("writing project.json: %v", err)
	}
	childDir := filepath.Join(dir, "server")
	if err := os.MkdirAll(childDir, 0o700); err != nil {
		t.Fatalf("creating child dir: %v", err)
	}
	withWorkingDir(t, childDir)

	imagePath := filepath.Join(dir, "style.png")
	if err := os.WriteFile(imagePath, []byte("image-bytes"), 0o600); err != nil {
		t.Fatalf("writing image reference: %v", err)
	}

	var calls [][]string
	runner := CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		calls = append(calls, append([]string{}, args...))
		switch args[0] {
		case "upload":
			return []byte(`{"id":"ref_image"}`), nil
		case "node":
			return []byte(`{"id":"node_bound","name":"generated"}`), nil
		default:
			t.Fatalf("unexpected args = %#v", args)
			return nil, nil
		}
	})
	provider, err := NewProvider(Config{
		BinPath: binPath,
		Runner:  runner,
		Now:     func() time.Time { return time.Unix(4, 567) },
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindVideo,
		RouteID:       generation.RouteLibTVSeedance20Mini,
		Prompt:        "make a video with bound project",
		ReferenceURLs: []string{imagePath},
		Params: map[string]any{
			"aspectRatio":   "16:9",
			"resolution":    "720p",
			"duration":      "5",
			"generateAudio": false,
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if len(calls) != 2 {
		t.Fatalf("calls = %#v, want upload and node create", calls)
	}
	for _, call := range calls {
		if !stringSliceContains(call, "--project=project-bound-123") {
			t.Fatalf("call = %#v, want bound project flag", call)
		}
	}
	if response.ID != generation.RouteLibTVSeedance20Mini+":project-bound-123:node_bound" ||
		response.Status != "submitted" {
		t.Fatalf("response = %#v, want submitted LibTV task with bound project", response)
	}
}

func TestGenerateVideoWithReferencesCreatesProjectWhenMissing(t *testing.T) {
	dir := t.TempDir()
	withWorkingDir(t, dir)
	imagePath := filepath.Join(dir, "style.png")
	if err := os.WriteFile(imagePath, []byte("image-bytes"), 0o600); err != nil {
		t.Fatalf("writing image reference: %v", err)
	}
	binPath := fakeExecutable(t, "libtv")
	var calls [][]string
	runner := CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		calls = append(calls, append([]string{}, args...))
		switch {
		case len(args) >= 3 && args[0] == "project" && args[1] == "create":
			return []byte(`{"data":{"projectUuid":"11111111-2222-3333-4444-555555555555"}}`), nil
		case args[0] == "upload":
			return []byte(`{"id":"ref_image"}`), nil
		case args[0] == "node":
			return []byte(`{"id":"node_auto","name":"generated"}`), nil
		default:
			t.Fatalf("unexpected args = %#v", args)
			return nil, nil
		}
	})
	provider, err := NewProvider(Config{
		BinPath: binPath,
		Runner:  runner,
		Now:     func() time.Time { return time.Unix(5, 678) },
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindVideo,
		RouteID:       generation.RouteLibTVSeedance20Mini,
		Prompt:        "make a video with an auto project",
		ReferenceURLs: []string{imagePath},
		Params: map[string]any{
			"aspectRatio":   "16:9",
			"resolution":    "720p",
			"duration":      "5",
			"generateAudio": false,
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if len(calls) != 3 {
		t.Fatalf("calls = %#v, want project create, upload and node create", calls)
	}
	if !reflect.DeepEqual(calls[0][:3], []string{"project", "create", "MediaGo Drama 1970-01-01 00:00:05"}) {
		t.Fatalf("project create call = %#v", calls[0])
	}
	for _, call := range calls[1:] {
		if !stringSliceContains(call, "--project=11111111-2222-3333-4444-555555555555") {
			t.Fatalf("call = %#v, want auto project flag", call)
		}
	}
	if response.ID != generation.RouteLibTVSeedance20Mini+":11111111-2222-3333-4444-555555555555:node_auto" ||
		response.Status != "submitted" {
		t.Fatalf("response = %#v, want submitted LibTV task with auto project", response)
	}
}

func TestGenerateVideoCreatesAndStoresProjectForInternalProject(t *testing.T) {
	withWorkingDir(t, t.TempDir())
	binPath := fakeExecutable(t, "libtv")
	store := &memoryProjectStore{bindings: map[string]ProjectBinding{}}
	var calls [][]string
	runner := CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		calls = append(calls, append([]string{}, args...))
		switch {
		case len(args) >= 3 && args[0] == "project" && args[1] == "create":
			return []byte(`created 22222222-3333-4444-5555-666666666666`), nil
		case args[0] == "node":
			return []byte(`{"id":"node_internal","name":"generated"}`), nil
		default:
			t.Fatalf("unexpected args = %#v", args)
			return nil, nil
		}
	})
	provider, err := NewProvider(Config{
		BinPath:      binPath,
		ProjectStore: store,
		Runner:       runner,
		Now:          func() time.Time { return time.Unix(6, 789) },
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:        generation.KindVideo,
		RouteID:     generation.RouteLibTVSeedance20Mini,
		ProjectID:   "project-alpha",
		ProjectName: "天机阁：赛博拍卖场与旧天残简",
		Prompt:      "make a video with an internal project",
		Params: map[string]any{
			"aspectRatio":   "16:9",
			"resolution":    "720p",
			"duration":      "5",
			"generateAudio": false,
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if len(calls) != 2 {
		t.Fatalf("calls = %#v, want project create and node create", calls)
	}
	if !reflect.DeepEqual(calls[0][:3], []string{"project", "create", "MediaGo - 天机阁：赛博拍卖场与旧天残简"}) {
		t.Fatalf("project create call = %#v", calls[0])
	}
	description := flagValue(calls[0], "--description=")
	if !strings.Contains(description, "project-alpha") || !strings.Contains(description, "天机阁") {
		t.Fatalf("project description = %q, want internal project context", description)
	}
	if !stringSliceContains(calls[1], "--project=22222222-3333-4444-5555-666666666666") {
		t.Fatalf("node call = %#v, want stored project flag", calls[1])
	}
	if response.ID != generation.RouteLibTVSeedance20Mini+":22222222-3333-4444-5555-666666666666:node_internal" ||
		response.Status != "submitted" {
		t.Fatalf("response = %#v, want submitted LibTV task with stored project", response)
	}

	binding, ok, err := store.GetLibTVProjectBinding(context.Background(), "project-alpha")
	if err != nil || !ok {
		t.Fatalf("stored binding ok=%v err=%v, want binding", ok, err)
	}
	if binding.ProjectID != "22222222-3333-4444-5555-666666666666" ||
		binding.InternalProjectName != "天机阁：赛博拍卖场与旧天残简" ||
		binding.ProjectName != "MediaGo - 天机阁：赛博拍卖场与旧天残简" {
		t.Fatalf("stored binding = %#v, want internal project mapping", binding)
	}

	var reuseCalls [][]string
	reuseRunner := CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		reuseCalls = append(reuseCalls, append([]string{}, args...))
		if args[0] != "node" {
			t.Fatalf("unexpected reuse args = %#v", args)
		}
		return []byte(`{"id":"node_reuse","name":"generated"}`), nil
	})
	reuseProvider, err := NewProvider(Config{
		BinPath:      binPath,
		ProjectStore: store,
		Runner:       reuseRunner,
		Now:          func() time.Time { return time.Unix(7, 890) },
	})
	if err != nil {
		t.Fatalf("NewProvider() reuse error = %v", err)
	}

	reuseResponse, err := reuseProvider.Generate(context.Background(), generation.Request{
		Kind:        generation.KindVideo,
		RouteID:     generation.RouteLibTVSeedance20Mini,
		ProjectID:   "project-alpha",
		ProjectName: "天机阁：赛博拍卖场与旧天残简",
		Prompt:      "make another video",
		Params: map[string]any{
			"aspectRatio":   "16:9",
			"resolution":    "720p",
			"duration":      "5",
			"generateAudio": false,
		},
	})
	if err != nil {
		t.Fatalf("Generate() reuse error = %v", err)
	}
	if len(reuseCalls) != 1 || !stringSliceContains(reuseCalls[0], "--project=22222222-3333-4444-5555-666666666666") {
		t.Fatalf("reuse calls = %#v, want node create with stored project", reuseCalls)
	}
	if reuseResponse.ID != generation.RouteLibTVSeedance20Mini+":22222222-3333-4444-5555-666666666666:node_reuse" {
		t.Fatalf("reuse response = %#v, want stored project id", reuseResponse)
	}
}

func TestProjectIDFromCreateOutputReadsProjectMetaUUID(t *testing.T) {
	output := []byte(`{"projectMeta":{"id":6055145,"uuid":"514bae19e89e4e5598bee5b8cf77e403","name":"MediaGo - 太虚"}}`)

	if got := projectIDFromCreateOutput(output); got != "514bae19e89e4e5598bee5b8cf77e403" {
		t.Fatalf("projectIDFromCreateOutput() = %q, want projectMeta.uuid", got)
	}
}

func TestGenerateVideoUploadsAndLinksReferenceMedia(t *testing.T) {
	binPath := fakeExecutable(t, "libtv")
	dir := t.TempDir()
	imagePath := filepath.Join(dir, "style.png")
	videoPath := filepath.Join(dir, "motion.mp4")
	audioPath := filepath.Join(dir, "voice.wav")
	for path, data := range map[string][]byte{
		imagePath: []byte("image-bytes"),
		videoPath: []byte("video-bytes"),
		audioPath: []byte("audio-bytes"),
	} {
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatalf("writing %s: %v", path, err)
		}
	}

	var calls [][]string
	runner := CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		calls = append(calls, append([]string{}, args...))
		switch args[0] {
		case "upload":
			return []byte(fmt.Sprintf(`{"id":"ref_%s"}`, flagValue(args, "--type="))), nil
		case "node":
			return []byte(`{"id":"node_789","name":"generated"}`), nil
		default:
			t.Fatalf("unexpected args = %#v", args)
			return nil, nil
		}
	})
	provider, err := NewProvider(Config{
		BinPath:   binPath,
		ProjectID: "project-123",
		Runner:    runner,
		Now:       func() time.Time { return time.Unix(3, 456) },
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindVideo,
		RouteID:       generation.RouteLibTVSeedance20Mini,
		Prompt:        "make a video with references",
		ReferenceURLs: []string{imagePath, videoPath, audioPath},
		Params: map[string]any{
			"aspectRatio":   "16:9",
			"resolution":    "720p",
			"duration":      "5",
			"generateAudio": true,
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if len(calls) != 4 {
		t.Fatalf("calls = %#v, want 3 uploads and 1 node create", calls)
	}
	expectedUploads := []struct {
		kind string
		path string
	}{
		{"image", imagePath},
		{"video", videoPath},
		{"audio", audioPath},
	}
	for index, expected := range expectedUploads {
		call := calls[index]
		if call[0] != "upload" ||
			!stringSliceContains(call, "--project=project-123") ||
			!stringSliceContains(call, "--resource="+expected.path) ||
			!stringSliceContains(call, "--type="+expected.kind) {
			t.Fatalf("upload call %d = %#v, want %s resource", index, call, expected.kind)
		}
	}
	nodeCall := calls[3]
	for _, want := range []string{
		"--left-add=ref_image",
		"--left-add=ref_video",
		"--left-add=ref_audio",
		"--set=model=Seedance 2.0 Mini",
		"--set=enableSound=on",
		"--set=modeType=mixed2video",
	} {
		if !stringSliceContains(nodeCall, want) {
			t.Fatalf("node call = %#v, missing %q", nodeCall, want)
		}
	}
	if response.ID != generation.RouteLibTVSeedance20Mini+":project-123:node_789" ||
		response.Status != "submitted" {
		t.Fatalf("response = %#v, want submitted LibTV task with references", response)
	}
}

func TestGenerateVideoRetriesFetchFailedReferenceUpload(t *testing.T) {
	binPath := fakeExecutable(t, "libtv")
	dir := t.TempDir()
	imagePath := filepath.Join(dir, "style.png")
	if err := os.WriteFile(imagePath, []byte("image-bytes"), 0o600); err != nil {
		t.Fatalf("writing image reference: %v", err)
	}

	uploadAttempts := 0
	var calls [][]string
	runner := CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		calls = append(calls, append([]string{}, args...))
		switch args[0] {
		case "upload":
			uploadAttempts++
			if uploadAttempts < 3 {
				return []byte(`fetch failed`), errors.New("exit status 1")
			}
			return []byte(`{"id":"ref_image"}`), nil
		case "node":
			return []byte(`{"id":"node_retry","name":"generated"}`), nil
		default:
			t.Fatalf("unexpected args = %#v", args)
			return nil, nil
		}
	})
	provider, err := NewProvider(Config{
		BinPath:           binPath,
		ProjectID:         "project-123",
		Runner:            runner,
		Now:               func() time.Time { return time.Unix(8, 901) },
		UploadRetryDelays: []time.Duration{0, 0},
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	response, err := provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindVideo,
		RouteID:       generation.RouteLibTVSeedance20Mini,
		Prompt:        "make a video with a retryable upload",
		ReferenceURLs: []string{imagePath},
		Params: map[string]any{
			"aspectRatio":   "16:9",
			"resolution":    "720p",
			"duration":      "5",
			"generateAudio": false,
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if uploadAttempts != 3 {
		t.Fatalf("upload attempts = %d, want 3", uploadAttempts)
	}
	if len(calls) != 4 {
		t.Fatalf("calls = %#v, want 3 upload attempts and node create", calls)
	}
	if response.ID != generation.RouteLibTVSeedance20Mini+":project-123:node_retry" ||
		response.Status != "submitted" {
		t.Fatalf("response = %#v, want submitted LibTV task after upload retry", response)
	}
}

func TestGenerateVideoReportsReferenceUploadContext(t *testing.T) {
	binPath := fakeExecutable(t, "libtv")
	dir := t.TempDir()
	imagePath := filepath.Join(dir, "style.png")
	if err := os.WriteFile(imagePath, []byte("image-bytes"), 0o600); err != nil {
		t.Fatalf("writing image reference: %v", err)
	}

	runner := CommandRunnerFunc(func(_ context.Context, _ string, args ...string) ([]byte, error) {
		switch args[0] {
		case "upload":
			return []byte(`fetch failed`), errors.New("exit status 1")
		default:
			t.Fatalf("unexpected args = %#v", args)
			return nil, nil
		}
	})
	provider, err := NewProvider(Config{
		BinPath:           binPath,
		ProjectID:         "project-123",
		Runner:            runner,
		UploadRetryDelays: []time.Duration{0},
	})
	if err != nil {
		t.Fatalf("NewProvider() error = %v", err)
	}

	_, err = provider.Generate(context.Background(), generation.Request{
		Kind:          generation.KindVideo,
		RouteID:       generation.RouteLibTVSeedance20Mini,
		Prompt:        "make a video with a failing upload",
		ReferenceURLs: []string{imagePath},
		Params: map[string]any{
			"aspectRatio":   "16:9",
			"resolution":    "720p",
			"duration":      "5",
			"generateAudio": false,
		},
	})
	if err == nil {
		t.Fatal("Generate() error = nil, want upload failure")
	}
	for _, want := range []string{
		"libtv reference upload failed",
		"index=1",
		"kind=image",
		"size=11 bytes",
		"attempts=2",
		"fetch failed",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error = %q, missing %q", err.Error(), want)
		}
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

func withWorkingDir(t *testing.T, dir string) {
	t.Helper()
	previous, err := os.Getwd()
	if err != nil {
		t.Fatalf("getting working dir: %v", err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatalf("changing working dir: %v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(previous); err != nil {
			t.Fatalf("restoring working dir: %v", err)
		}
	})
}

type memoryProjectStore struct {
	bindings map[string]ProjectBinding
}

func (store *memoryProjectStore) GetLibTVProjectBinding(_ context.Context, internalProjectID string) (ProjectBinding, bool, error) {
	binding, ok := store.bindings[strings.TrimSpace(internalProjectID)]
	return binding, ok, nil
}

func (store *memoryProjectStore) SaveLibTVProjectBinding(_ context.Context, binding ProjectBinding) error {
	if store.bindings == nil {
		store.bindings = map[string]ProjectBinding{}
	}
	store.bindings[strings.TrimSpace(binding.InternalProjectID)] = binding
	return nil
}
