package generation

import (
	"path/filepath"
	"testing"
)

func TestGenerationPreferenceServicePersistToSQLite(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	service := NewGenerationPreferenceService(dbPath)

	empty, err := service.GetPreference("project-alpha")
	if err != nil {
		t.Fatalf("getting empty preference: %v", err)
	}
	if empty.ScopeID != "project-alpha" || len(empty.FamilyIDs) != 0 || len(empty.RouteParams) != 0 {
		t.Fatalf("empty preference = %+v, want scoped empty record", empty)
	}

	saved, err := service.UpsertPreference(UpdateGenerationPreferenceRequest{
		ScopeID:       "project-alpha",
		FamilyIDs:     map[string]string{"image": "seedream", "": "ignored"},
		RouteIDs:      map[string]string{"seedream-5-lite": "official.seedream-5-lite"},
		VersionIDs:    map[string]string{"seedream": "seedream-5-lite"},
		RouteParams:   map[string]map[string]any{"official.seedream-5-lite": {"size": "2K"}},
		StylePresetID: "preset-cinematic",
	})
	if err != nil {
		t.Fatalf("upserting preference: %v", err)
	}
	if saved.CreatedAt == "" || saved.UpdatedAt == "" {
		t.Fatalf("saved timestamps = created %q updated %q, want values", saved.CreatedAt, saved.UpdatedAt)
	}

	restarted := NewGenerationPreferenceService(dbPath)
	got, err := restarted.GetPreference("project-alpha")
	if err != nil {
		t.Fatalf("getting persisted preference: %v", err)
	}
	if got.FamilyIDs["image"] != "seedream" ||
		got.RouteIDs["seedream-5-lite"] != "official.seedream-5-lite" ||
		got.VersionIDs["seedream"] != "seedream-5-lite" ||
		got.RouteParams["official.seedream-5-lite"]["size"] != "2K" ||
		got.StylePresetID != "preset-cinematic" {
		t.Fatalf("preference = %+v, want persisted fields", got)
	}

	updated, err := restarted.UpsertPreference(UpdateGenerationPreferenceRequest{
		ScopeID:       "project-alpha",
		FamilyIDs:     map[string]string{"video": "seedance"},
		RouteIDs:      map[string]string{},
		VersionIDs:    map[string]string{"seedance": "seedance-2.0-fast"},
		RouteParams:   map[string]map[string]any{},
		StylePresetID: "",
	})
	if err != nil {
		t.Fatalf("updating preference: %v", err)
	}
	if updated.CreatedAt != got.CreatedAt {
		t.Fatalf("updated createdAt = %q, want %q", updated.CreatedAt, got.CreatedAt)
	}
	if _, ok := updated.FamilyIDs["image"]; ok {
		t.Fatalf("updated family IDs = %+v, want replacement not merge", updated.FamilyIDs)
	}
}
