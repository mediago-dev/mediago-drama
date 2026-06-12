package repository

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
)

func TestGenerationPreferenceRepositoryLifecycle(t *testing.T) {
	repo, err := NewGenerationPreferenceRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationPreferenceRepository() error = %v", err)
	}

	if _, err := repo.GetGenerationPreference("project-alpha"); !errors.Is(err, ErrRecordNotFound) {
		t.Fatalf("GetGenerationPreference() error = %v, want ErrRecordNotFound", err)
	}

	preference := domain.GenerationPreferenceModel{
		ScopeID:         "project-alpha",
		FamilyIDsJSON:   `{"image":"seedream"}`,
		RouteIDsJSON:    `{"seedream-5-lite":"official.seedream-5-lite"}`,
		VersionIDsJSON:  `{"seedream":"seedream-5-lite"}`,
		RouteParamsJSON: `{"official.seedream-5-lite":{"size":"2K"}}`,
		StylePresetID:   "preset-cinematic",
		CreatedAt:       "2026-05-22T00:00:00Z",
		UpdatedAt:       "2026-05-22T00:00:00Z",
	}
	if err := repo.UpsertGenerationPreference(preference); err != nil {
		t.Fatalf("UpsertGenerationPreference() error = %v", err)
	}

	got, err := repo.GetGenerationPreference(preference.ScopeID)
	if err != nil {
		t.Fatalf("GetGenerationPreference() error = %v", err)
	}
	if got.StylePresetID != preference.StylePresetID || got.RouteParamsJSON != preference.RouteParamsJSON {
		t.Fatalf("GetGenerationPreference() = %+v, want inserted preference", got)
	}

	preference.StylePresetID = "preset-documentary"
	preference.UpdatedAt = "2026-05-22T00:01:00Z"
	if err := repo.UpsertGenerationPreference(preference); err != nil {
		t.Fatalf("UpsertGenerationPreference() update error = %v", err)
	}

	got, err = repo.GetGenerationPreference(preference.ScopeID)
	if err != nil {
		t.Fatalf("GetGenerationPreference() after update error = %v", err)
	}
	if got.StylePresetID != "preset-documentary" || got.CreatedAt != "2026-05-22T00:00:00Z" {
		t.Fatalf("updated preference = %+v, want updated style and preserved created_at", got)
	}
}
