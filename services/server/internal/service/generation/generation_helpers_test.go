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
