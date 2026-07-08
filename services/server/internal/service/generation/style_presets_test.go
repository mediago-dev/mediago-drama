package generation

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"testing/fstest"

	configassets "github.com/mediago-dev/mediago-drama/services/server/configs"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptlibrary"
)

func TestStylePreviewStoreScansEmbeddedAssets(t *testing.T) {
	store := NewStylePreviewStore(configassets.StylePresets)
	for _, presetID := range []string{"anime-2d", "anime-3dcg", "chibi", "realistic"} {
		previewURL, mimeType, ok := store.Lookup(presetID)
		if !ok {
			t.Fatalf("Lookup(%q) missing bundled preview", presetID)
		}
		if !strings.HasPrefix(previewURL, "/api/v1/generation/style-previews/") {
			t.Fatalf("preview url = %q, want style-previews route", previewURL)
		}
		// The endpoint serves immutable cache headers, so the URL must carry a
		// content-hash version to bust stale client caches on image changes.
		if !strings.Contains(previewURL, "?v=") {
			t.Fatalf("preview url = %q, want content-hash version", previewURL)
		}
		if !strings.HasPrefix(mimeType, "image/") {
			t.Fatalf("mime = %q, want image/*", mimeType)
		}

		preset, data, found, err := store.PreviewContent(presetID)
		if err != nil || !found || len(data) == 0 {
			t.Fatalf("PreviewContent(%q) = err %v found %v len %d", presetID, err, found, len(data))
		}
		if preset.PreviewURL != previewURL {
			t.Fatalf("PreviewContent url = %q, want %q", preset.PreviewURL, previewURL)
		}
	}
}

func TestStylePreviewStoreMissingAssets(t *testing.T) {
	empty := NewStylePreviewStore(fstest.MapFS{})
	if _, _, ok := empty.Lookup("anime-2d"); ok {
		t.Fatal("Lookup() ok = true on empty catalog")
	}
	_, _, found, err := empty.PreviewContent("anime-2d")
	if err != nil || found {
		t.Fatalf("PreviewContent() = err %v found %v, want miss", err, found)
	}

	store := NewStylePreviewStore(configassets.StylePresets)
	if _, _, ok := store.Lookup("preset-missing"); ok {
		t.Fatal("Lookup(preset-missing) ok = true")
	}
}

type stylePromptSourceStub struct {
	entries []promptlibrary.PromptEntry
	err     error
}

func (stub stylePromptSourceStub) List(_ context.Context, filter promptlibrary.Filter) ([]promptlibrary.PromptEntry, error) {
	if stub.err != nil {
		return nil, stub.err
	}
	items := []promptlibrary.PromptEntry{}
	for _, entry := range stub.entries {
		if filter.Category == "" || entry.Category == filter.Category {
			items = append(items, entry)
		}
	}
	return items, nil
}

func TestStylePresetsFromLibrary(t *testing.T) {
	previews := NewStylePreviewStore(fstest.MapFS{
		"style-presets/previews/anime-2d.jpg": {Data: []byte("jpeg-bytes")},
	})
	source := stylePromptSourceStub{entries: []promptlibrary.PromptEntry{
		{ID: "custom-noir", Name: "暗黑电影", Category: "style", Prompt: "noir style"},
		{ID: "anime-2d", Name: "2D动漫", Category: "style", Prompt: "cel shading"},
		{ID: "extra-1", Name: "非风格", Category: "extra", Prompt: "ignored"},
		{ID: "empty-prompt", Name: "空提示", Category: "style", Prompt: "   "},
	}}

	presets := stylePresetsFromLibrary(context.Background(), source, previews)
	if len(presets) != 2 {
		t.Fatalf("presets = %#v, want the two style entries with prompts", presets)
	}
	// Bundled-preview entries sort first for better selection cards.
	if presets[0].ID != "anime-2d" || presets[0].PreviewURL == "" || presets[0].MIMEType != "image/jpeg" {
		t.Fatalf("presets[0] = %#v, want anime-2d with preview", presets[0])
	}
	if presets[0].PromptSuffix != "cel shading" || presets[0].Title != "2D动漫" {
		t.Fatalf("presets[0] = %#v, want prompt suffix and title from library", presets[0])
	}
	if presets[1].ID != "custom-noir" || presets[1].PreviewURL != "" {
		t.Fatalf("presets[1] = %#v, want text-only custom style", presets[1])
	}
}

func TestStylePresetsFromLibraryDegradesGracefully(t *testing.T) {
	previews := NewStylePreviewStore(fstest.MapFS{})
	if presets := stylePresetsFromLibrary(context.Background(), nil, previews); presets != nil {
		t.Fatalf("presets = %#v, want nil without a source", presets)
	}
	failing := stylePromptSourceStub{err: fmt.Errorf("library unavailable")}
	if presets := stylePresetsFromLibrary(context.Background(), failing, previews); presets != nil {
		t.Fatalf("presets = %#v, want nil on source error", presets)
	}
}
