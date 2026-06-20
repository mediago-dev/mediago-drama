package media

import (
	"path/filepath"
	"testing"
)

func TestMetadataFromFFprobePayload(t *testing.T) {
	metadata := metadataFromFFprobePayload(ffprobePayload{
		Format: ffprobeFormat{Duration: "4.200000"},
		Streams: []ffprobeStream{
			{CodecType: "audio", Duration: "5.000000"},
			{CodecType: "video", Width: 1280, Height: 720, Duration: "4.100000"},
		},
	})

	if metadata.DurationSeconds != 4.2 || metadata.Width != 1280 || metadata.Height != 720 {
		t.Fatalf("metadata = %#v, want video metadata with format duration", metadata)
	}
}

func TestPosterPathForVideo(t *testing.T) {
	cacheDir := filepath.Join("tmp", "posters")
	want := filepath.Join(cacheDir, "asset-video-1.poster.jpg")
	if got := posterPathForVideo(cacheDir, "asset video/1"); got != want {
		t.Fatalf("posterPathForVideo() = %q, want %q", got, want)
	}
}

func TestPosterSeekTime(t *testing.T) {
	if got := posterSeekTime(0.8); got != 0.4 {
		t.Fatalf("posterSeekTime(0.8) = %v, want 0.4", got)
	}
	if got := posterSeekTime(15); got != 0.5 {
		t.Fatalf("posterSeekTime(15) = %v, want 0.5", got)
	}
}
