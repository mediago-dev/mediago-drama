package handlers

import (
	"encoding/json"
	"testing"
)

func TestPlayableEpisodeVideoURLsUsesAllReadyVideos(t *testing.T) {
	raw := json.RawMessage(`{
		"tracks": [
			{"type":"caption","clips":[]},
			{"type":"video","clips":[
				{"start": 10, "end": 20, "status":"ready", "videoUrl":"/api/v1/media-assets/asset-2/content"},
				{"start": 0, "end": 10, "status":"ready", "videoUrl":"/api/v1/media-assets/asset-1/content"},
				{"start": 20, "end": 30, "status":"draft", "videoUrl":"/api/v1/media-assets/asset-3/content"},
				{"start": 30, "end": 40, "status":"ready", "videoUrl":"/api/v1/media-assets/asset-4/content"}
			]}
		]
	}`)

	urls, err := playableEpisodeVideoURLs(raw)
	if err != nil {
		t.Fatalf("playableEpisodeVideoURLs() error = %v", err)
	}
	if len(urls) != 3 ||
		urls[0] != "/api/v1/media-assets/asset-1/content" ||
		urls[1] != "/api/v1/media-assets/asset-2/content" ||
		urls[2] != "/api/v1/media-assets/asset-4/content" {
		t.Fatalf("urls = %#v, want all ready video urls in timeline order", urls)
	}
}

func TestPlayableEpisodeVideoURLsSkipsTimelineGaps(t *testing.T) {
	raw := json.RawMessage(`{
		"tracks": [{"type":"video","clips":[
			{"start": 0, "end": 10, "status":"ready", "videoUrl":"/api/v1/media-assets/asset-1/content"},
			{"start": 14, "end": 20, "status":"ready", "videoUrl":"/api/v1/media-assets/asset-2/content"}
		]}]
	}`)

	urls, err := playableEpisodeVideoURLs(raw)
	if err != nil {
		t.Fatalf("playableEpisodeVideoURLs() error = %v", err)
	}
	if len(urls) != 2 ||
		urls[0] != "/api/v1/media-assets/asset-1/content" ||
		urls[1] != "/api/v1/media-assets/asset-2/content" {
		t.Fatalf("urls = %#v, want ready videos across timeline gap", urls)
	}
}

func TestMediaAssetIDFromURL(t *testing.T) {
	tests := []struct {
		value string
		want  string
		ok    bool
	}{
		{value: "/api/v1/media-assets/asset-1/content", want: "asset-1", ok: true},
		{value: "/api/v1/projects/proj/media-assets/asset%202/content", want: "asset 2", ok: true},
		{value: "/api/media/assets/asset-legacy/content", want: "asset-legacy", ok: true},
		{value: "/api/v1/projects/proj/media/assets/asset%205/content", want: "asset 5", ok: true},
		{value: "https://example.test/api/v1/media-assets/asset-3/content", want: "asset-3", ok: true},
		{value: "/api/v1/media-assets/asset-4", ok: false},
	}

	for _, test := range tests {
		t.Run(test.value, func(t *testing.T) {
			got, ok := mediaAssetIDFromURL(test.value)
			if got != test.want || ok != test.ok {
				t.Fatalf("mediaAssetIDFromURL(%q) = %q, %v; want %q, %v", test.value, got, ok, test.want, test.ok)
			}
		})
	}
}
