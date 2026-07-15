package generation

import (
	"testing"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

func TestGenerationProjectIDFromScopeID(t *testing.T) {
	tests := []struct {
		name    string
		scopeID string
		want    string
	}{
		{name: "project scope", scopeID: "project-alpha", want: "alpha"},
		{name: "trims whitespace", scopeID: " project-alpha ", want: "alpha"},
		{name: "studio scope", scopeID: "studio", want: ""},
		{name: "empty scope", scopeID: "", want: ""},
		{name: "sanitizes project id", scopeID: "project-alpha/beta", want: "alpha-beta"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := GenerationProjectIDFromScopeID(test.scopeID); got != test.want {
				t.Fatalf("GenerationProjectIDFromScopeID(%q) = %q, want %q", test.scopeID, got, test.want)
			}
		})
	}
}

func TestGenerationProjectIDForRequestPrefersExplicitProjectID(t *testing.T) {
	if got := GenerationProjectIDForRequest("alpha", "episode-video:episode-1:clip-1"); got != "alpha" {
		t.Fatalf("GenerationProjectIDForRequest() = %q, want alpha", got)
	}
	if got := GenerationProjectIDForRequest("", "project-beta"); got != "beta" {
		t.Fatalf("GenerationProjectIDForRequest() fallback = %q, want beta", got)
	}
}

func TestGenerationBackgroundRouting(t *testing.T) {
	tests := []struct {
		name       string
		route      coregeneration.ModelRoute
		wantRun    bool
		wantSubmit bool
	}{
		{
			name:    "synchronous image runs in server background",
			route:   coregeneration.ModelRoute{Kind: coregeneration.KindImage},
			wantRun: true,
		},
		{
			name:    "synchronous video runs in server background",
			route:   coregeneration.ModelRoute{Kind: coregeneration.KindVideo},
			wantRun: true,
		},
		{
			name:       "asynchronous video submits in server background",
			route:      coregeneration.ModelRoute{Kind: coregeneration.KindVideo, Async: true},
			wantSubmit: true,
		},
		{
			name:  "audio keeps foreground behavior",
			route: coregeneration.ModelRoute{Kind: coregeneration.KindAudio},
		},
		{
			name:  "text keeps foreground behavior",
			route: coregeneration.ModelRoute{Kind: coregeneration.KindText},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := ShouldRunGenerationInBackground(test.route); got != test.wantRun {
				t.Fatalf("ShouldRunGenerationInBackground() = %v, want %v", got, test.wantRun)
			}
			if got := ShouldSubmitGenerationInBackground(test.route); got != test.wantSubmit {
				t.Fatalf("ShouldSubmitGenerationInBackground() = %v, want %v", got, test.wantSubmit)
			}
		})
	}
}

func TestGenerationResponseFromCoreIncludesVideoPosterURL(t *testing.T) {
	response := GenerationResponseFromCore(coregeneration.Response{
		ID:     "generation-video-poster",
		Status: "completed",
		Assets: []coregeneration.Asset{
			{
				Kind: coregeneration.KindVideo,
				URL:  "/api/v1/media-assets/video-with-poster/content",
				Metadata: map[string]any{
					"poster_url": "/api/v1/media-assets/video-with-poster/poster",
				},
			},
		},
	}, string(coregeneration.KindVideo))

	if len(response.Assets) != 1 || response.Assets[0].PosterURL != "/api/v1/media-assets/video-with-poster/poster" {
		t.Fatalf("assets = %#v, want poster URL from metadata", response.Assets)
	}
}

func TestGenerationResponseFromCoreFailsCompletedImageWithoutAssets(t *testing.T) {
	response := GenerationResponseFromCore(coregeneration.Response{
		ID:     "generation-empty-image",
		Status: "completed",
		Model:  "gemini-3.1-flash-image",
	}, string(coregeneration.KindImage))

	if response.Status != "failed" {
		t.Fatalf("status = %q, want failed", response.Status)
	}
	if response.Message != "图像生成失败。" {
		t.Fatalf("message = %q, want image failure", response.Message)
	}
	if response.Error != "生成请求已完成，但未返回图片素材。" {
		t.Fatalf("error = %q, want empty image asset reason", response.Error)
	}
}
