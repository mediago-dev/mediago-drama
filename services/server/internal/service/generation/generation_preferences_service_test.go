package generation

import (
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
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
		RouteParams:   map[string]map[string]any{"official.seedream-5-lite": {"size": "1600x2848"}},
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
		got.RouteParams["official.seedream-5-lite"]["aspectRatio"] != "9:16" ||
		got.RouteParams["official.seedream-5-lite"]["resolution"] != "2K" ||
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

func TestGenerationPreferenceForProjectMergesScopes(t *testing.T) {
	repos, err := repository.OpenSettingsRepositories(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("opening settings repositories: %v", err)
	}
	preferences := NewGenerationPreferenceServiceFromRepository(repos.GenerationPreferences, nil)
	workflow := &GenerationService{generationPreferences: preferences}

	studioScope := NormalizeGenerationConversationScopeID("")
	if _, err := preferences.UpsertPreference(UpdateGenerationPreferenceRequest{
		ScopeID:     studioScope,
		RouteIDs:    map[string]string{"image": "jimeng.seedream-5.0", "video": "jimeng.seedance-2.0"},
		RouteParams: map[string]map[string]any{"jimeng.seedream-5.0": {"aspectRatio": "1:1"}},
	}); err != nil {
		t.Fatalf("upserting studio preference: %v", err)
	}
	if _, err := preferences.UpsertPreference(UpdateGenerationPreferenceRequest{
		ScopeID:     "project-merge-test",
		RouteIDs:    map[string]string{"image": "openrouter.seedream-4.5"},
		RouteParams: map[string]map[string]any{"openrouter.seedream-4.5": {"aspectRatio": "3:4"}},
	}); err != nil {
		t.Fatalf("upserting project preference: %v", err)
	}

	if _, err := preferences.UpsertPreference(UpdateGenerationPreferenceRequest{
		ScopeID:     "agent",
		RouteParams: map[string]map[string]any{"jimeng.seedream-5.0": {"resolution": "4K"}},
	}); err != nil {
		t.Fatalf("upserting agent preference: %v", err)
	}

	merged, ok := workflow.GenerationPreferenceForProject("project-merge-test")
	if !ok {
		t.Fatal("GenerationPreferenceForProject ok = false")
	}
	if merged.RouteParams["jimeng.seedream-5.0"]["resolution"] != "4K" {
		t.Fatalf("agent scope params = %#v, want seedream 4K habit", merged.RouteParams)
	}
	if merged.RouteIDs["image"] != "openrouter.seedream-4.5" {
		t.Fatalf("image route = %q, want project override", merged.RouteIDs["image"])
	}
	if merged.RouteIDs["video"] != "jimeng.seedance-2.0" {
		t.Fatalf("video route = %q, want studio fallback", merged.RouteIDs["video"])
	}
	if merged.RouteParams["openrouter.seedream-4.5"]["aspectRatio"] != "3:4" {
		t.Fatalf("route params = %#v, want project params", merged.RouteParams)
	}

	if _, ok := (&GenerationService{}).GenerationPreferenceForProject("project-merge-test"); ok {
		t.Fatal("ok = true without preference service")
	}
}
