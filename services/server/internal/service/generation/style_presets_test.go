package generation

import (
	"strings"
	"testing"
	"testing/fstest"

	configassets "github.com/mediago-dev/mediago-drama/services/server/configs"
)

func TestStylePresetStoreLoadsEmbeddedCatalog(t *testing.T) {
	store := NewStylePresetStore(configassets.StylePresets)
	presets, err := store.List()
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(presets) == 0 {
		t.Fatal("embedded style preset catalog is empty")
	}
	for _, preset := range presets {
		if preset.ID == "" || preset.Title == "" || preset.PromptSuffix == "" {
			t.Fatalf("preset = %#v, want id/title/promptSuffix", preset)
		}
		if len(preset.Kinds) == 0 {
			t.Fatalf("preset %q has no kinds", preset.ID)
		}
		if preset.PreviewURL == "" {
			t.Fatalf("preset %q has no preview url", preset.ID)
		}
		if !strings.HasPrefix(preset.PreviewURL, "/api/v1/generation/style-previews/") {
			t.Fatalf("preset %q preview url = %q, want style-previews route", preset.ID, preset.PreviewURL)
		}

		asset, data, found, err := store.PreviewContent(preset.ID)
		if err != nil {
			t.Fatalf("PreviewContent(%q) error = %v", preset.ID, err)
		}
		if !found || len(data) == 0 {
			t.Fatalf("PreviewContent(%q) found=%v len=%d, want embedded image", preset.ID, found, len(data))
		}
		if asset.MIMEType != "image/svg+xml" {
			t.Fatalf("preset %q mime = %q, want image/svg+xml", preset.ID, asset.MIMEType)
		}
	}
}

func TestStylePresetStorePreviewContentMissing(t *testing.T) {
	store := NewStylePresetStore(configassets.StylePresets)
	_, _, found, err := store.PreviewContent("preset-missing")
	if err != nil {
		t.Fatalf("PreviewContent() error = %v", err)
	}
	if found {
		t.Fatal("PreviewContent() found = true for unknown preset")
	}
}

func TestStylePresetStoreRejectsInvalidManifest(t *testing.T) {
	tests := []struct {
		name     string
		manifest string
	}{
		{"missing id", `{"schemaVersion":1,"presets":[{"title":"x","promptSuffix":"y"}]}`},
		{"missing promptSuffix", `{"schemaVersion":1,"presets":[{"id":"a","title":"x"}]}`},
		{"unknown route", `{"schemaVersion":1,"presets":[{"id":"a","title":"x","promptSuffix":"y","routeId":"route-does-not-exist"}]}`},
		{"duplicate id", `{"schemaVersion":1,"presets":[{"id":"a","title":"x","promptSuffix":"y"},{"id":"a","title":"x2","promptSuffix":"y2"}]}`},
		{"bad schema version", `{"schemaVersion":2,"presets":[]}`},
		{"escaping preview path", `{"schemaVersion":1,"presets":[{"id":"a","title":"x","promptSuffix":"y","previewPath":"../secret.svg"}]}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			files := fstest.MapFS{
				"style-presets/manifest.json": {Data: []byte(tt.manifest)},
			}
			store := NewStylePresetStore(files)
			if _, err := store.List(); err == nil {
				t.Fatalf("List() error = nil, want manifest rejection for %s", tt.name)
			}
		})
	}
}

func TestStylePresetStoreMissingManifestIsEmpty(t *testing.T) {
	store := NewStylePresetStore(fstest.MapFS{})
	presets, err := store.List()
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(presets) != 0 {
		t.Fatalf("presets = %#v, want empty catalog", presets)
	}
}
