package generation

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

func TestGenerationPreferenceServiceRequiresExplicitDBPath(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(homeDir, ".config"))
	t.Setenv("APPDATA", filepath.Join(homeDir, "AppData", "Roaming"))

	service := NewGenerationPreferenceService("")
	if _, err := service.GetPreference("agent"); err == nil || !strings.Contains(err.Error(), "path is required") {
		t.Fatalf("GetPreference() error = %v, want required path error", err)
	}

	configDir, err := os.UserConfigDir()
	if err != nil {
		t.Fatalf("UserConfigDir() error = %v", err)
	}
	legacySettingsDBPath := filepath.Join(configDir, "mediago-drama", "settings.db")
	if _, err := os.Stat(legacySettingsDBPath); !os.IsNotExist(err) {
		t.Fatalf("legacy settings db exists after empty path initialization: %v", err)
	}
}

func TestGenerationPreferenceServicePersistToSQLite(t *testing.T) {
	dbPath := generationTestDBPath(t)
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
		FamilyIDs:     map[string]string{"image": coregeneration.FamilyWhereslowImage, "": "ignored"},
		RouteIDs:      map[string]string{"image": coregeneration.RouteWhereslowNanoBanana2},
		VersionIDs:    map[string]string{"image": coregeneration.VersionWhereslowNanoBanana2},
		RouteParams:   map[string]map[string]any{coregeneration.RouteWhereslowNanoBanana2: {"aspectRatio": "9:16", "resolution": "2K"}},
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
	if got.FamilyIDs["image"] != coregeneration.FamilyWhereslowImage ||
		got.RouteIDs["image"] != coregeneration.RouteWhereslowNanoBanana2 ||
		got.VersionIDs["image"] != coregeneration.VersionWhereslowNanoBanana2 ||
		got.RouteParams[coregeneration.RouteWhereslowNanoBanana2]["aspectRatio"] != "9:16" ||
		got.RouteParams[coregeneration.RouteWhereslowNanoBanana2]["resolution"] != "2K" ||
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
	repos, err := repository.OpenSettingsRepositories(generationTestDBPath(t))
	if err != nil {
		t.Fatalf("opening settings repositories: %v", err)
	}
	preferences := NewGenerationPreferenceServiceFromRepository(repos.GenerationPreferences, nil)
	workflow := &GenerationService{generationPreferences: preferences}

	studioScope := NormalizeGenerationConversationScopeID("")
	if _, err := preferences.UpsertPreference(UpdateGenerationPreferenceRequest{
		ScopeID:     studioScope,
		RouteIDs:    map[string]string{"image": coregeneration.RouteWhereslowNanoBanana2, "video": "jimeng.seedance-2.0"},
		RouteParams: map[string]map[string]any{coregeneration.RouteWhereslowNanoBanana2: {"aspectRatio": "1:1"}},
	}); err != nil {
		t.Fatalf("upserting studio preference: %v", err)
	}
	if _, err := preferences.UpsertPreference(UpdateGenerationPreferenceRequest{
		ScopeID:     "project-merge-test",
		RouteIDs:    map[string]string{"image": coregeneration.RouteWhereslowNanoBanana2},
		RouteParams: map[string]map[string]any{coregeneration.RouteWhereslowNanoBanana2: {"aspectRatio": "3:4"}},
	}); err != nil {
		t.Fatalf("upserting project preference: %v", err)
	}

	if _, err := preferences.UpsertPreference(UpdateGenerationPreferenceRequest{
		ScopeID:     "agent",
		RouteParams: map[string]map[string]any{coregeneration.RouteWhereslowNanoBanana2: {"resolution": "4K"}},
	}); err != nil {
		t.Fatalf("upserting agent preference: %v", err)
	}

	merged, ok := workflow.GenerationPreferenceForProject("project-merge-test")
	if !ok {
		t.Fatal("GenerationPreferenceForProject ok = false")
	}
	if merged.RouteIDs["image"] != coregeneration.RouteWhereslowNanoBanana2 {
		t.Fatalf("image route = %q, want project override", merged.RouteIDs["image"])
	}
	if merged.RouteIDs["video"] != "jimeng.seedance-2.0" {
		t.Fatalf("video route = %q, want studio fallback", merged.RouteIDs["video"])
	}
	if merged.RouteParams[coregeneration.RouteWhereslowNanoBanana2]["aspectRatio"] != "3:4" {
		t.Fatalf("route params = %#v, want project params", merged.RouteParams)
	}
	if _, ok := merged.RouteParams[coregeneration.RouteWhereslowNanoBanana2]["resolution"]; ok {
		t.Fatalf("route params = %#v, want project scope to replace agent params", merged.RouteParams)
	}

	if _, ok := (&GenerationService{}).GenerationPreferenceForProject("project-merge-test"); ok {
		t.Fatal("ok = true without preference service")
	}
}
