package media

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

func TestRunAssetMigrationDryRunAndApply(t *testing.T) {
	workspaceDir := t.TempDir()
	paths := shared.WorkspacePathsFor(workspaceDir)
	if err := os.MkdirAll(paths.DatabaseDir(), 0o755); err != nil {
		t.Fatalf("creating db dir: %v", err)
	}
	settingsRepos, err := repository.OpenSettingsRepositories(paths.DatabasePath())
	if err != nil {
		t.Fatalf("OpenSettingsRepositories() error = %v", err)
	}
	workspaceRepos, err := repository.OpenWorkspaceRepositories(paths.DatabasePath())
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	projectDir := filepath.Join(t.TempDir(), "project-a")
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatalf("creating project dir: %v", err)
	}
	if err := workspaceRepos.Workspace.UpsertProject(domain.WorkspaceProjectModel{
		ID:          "project-a",
		Name:        "Project A",
		ProjectDir:  projectDir,
		RelativeDir: projectDir,
		CreatedAt:   "2026-06-20T00:00:00Z",
		UpdatedAt:   "2026-06-20T00:00:00Z",
	}); err != nil {
		t.Fatalf("UpsertProject() error = %v", err)
	}

	legacySourceDir := filepath.Join(paths.LibraryAssetsDir(), "legacy-source")
	if err := os.MkdirAll(legacySourceDir, 0o755); err != nil {
		t.Fatalf("creating legacy source dir: %v", err)
	}
	oldSectionPath := filepath.Join(legacySourceDir, "asset-section.png")
	if err := os.WriteFile(oldSectionPath, []byte("section-image"), 0o600); err != nil {
		t.Fatalf("writing section asset: %v", err)
	}
	oldGlobalPath := filepath.Join(legacySourceDir, "asset-global.png")
	if err := os.WriteFile(oldGlobalPath, []byte("global-image"), 0o600); err != nil {
		t.Fatalf("writing global asset: %v", err)
	}

	for _, asset := range []domain.MediaAssetModel{
		{
			ID:        "asset-section",
			Kind:      MediaKindImage,
			Filename:  "section.png",
			MIMEType:  "image/png",
			SizeBytes: 13,
			Path:      oldSectionPath,
			URL:       "/api/v1/media-assets/asset-section/content",
			ProjectID: "project-a",
			CreatedAt: "2026-06-20T00:00:00Z",
			UpdatedAt: "2026-06-20T00:00:00Z",
		},
		{
			ID:        "asset-global",
			Kind:      MediaKindImage,
			Filename:  "global.png",
			MIMEType:  "image/png",
			SizeBytes: 12,
			Path:      oldGlobalPath,
			URL:       "/api/v1/media-assets/asset-global/content",
			CreatedAt: "2026-06-20T00:00:00Z",
			UpdatedAt: "2026-06-20T00:00:00Z",
		},
		{
			ID:        "asset-missing",
			Kind:      MediaKindAudio,
			Filename:  "missing.mp3",
			MIMEType:  "audio/mpeg",
			SizeBytes: 0,
			Path:      filepath.Join(legacySourceDir, "missing.mp3"),
			URL:       "/api/v1/media-assets/asset-missing/content",
			CreatedAt: "2026-06-20T00:00:00Z",
			UpdatedAt: "2026-06-20T00:00:00Z",
		},
	} {
		if err := settingsRepos.MediaAssets.CreateMediaAsset(asset); err != nil {
			t.Fatalf("CreateMediaAsset(%s) error = %v", asset.ID, err)
		}
	}
	if err := settingsRepos.GenerationTasks.UpsertGenerationTask(domain.GenerationTaskModel{
		ID:                    "task-section",
		ConversationID:        "conversation-1",
		ProjectID:             "project-a",
		SectionID:             "document%201:block%2F2",
		Kind:                  MediaKindImage,
		RouteID:               "image-test",
		FamilyID:              "test",
		VersionID:             "v1",
		Provider:              "test",
		ModelID:               "test",
		Model:                 "test",
		Prompt:                "draw",
		ReferenceURLsJSON:     "[]",
		ReferenceAssetIDsJSON: "[]",
		ParamsJSON:            "{}",
		Status:                "succeeded",
		Message:               "ok",
		AssetsJSON:            `[{"url":"/api/v1/media-assets/asset-section/content","kind":"image"}]`,
		DeletedAssetSlotsJSON: "[]",
		UsageJSON:             "{}",
		CreatedAt:             "2026-06-20T00:00:00Z",
		UpdatedAt:             "2026-06-20T00:01:00Z",
	}); err != nil {
		t.Fatalf("UpsertGenerationTask() error = %v", err)
	}

	manifestPath := filepath.Join(workspaceDir, "migration.json")
	dryRun, err := RunAssetMigration(context.Background(), AssetMigrationOptions{
		WorkspaceDir: workspaceDir,
		ManifestPath: manifestPath,
	})
	if err != nil {
		t.Fatalf("RunAssetMigration(dry-run) error = %v", err)
	}
	sectionEntry := assetMigrationEntryByID(dryRun.Entries, "asset-section")
	wantSectionPath := filepath.Join(projectDir, "library", "assets", "images", "document-1", "block-2", "asset-section.png")
	if sectionEntry.NewPath != wantSectionPath || sectionEntry.RelativePath != "library/assets/images/document-1/block-2/asset-section.png" {
		t.Fatalf("section entry = %#v, want %s", sectionEntry, wantSectionPath)
	}
	if _, err := os.Stat(oldSectionPath); err != nil {
		t.Fatalf("dry-run moved section asset: %v", err)
	}
	if assetMigrationEntryByID(dryRun.Entries, "asset-missing").Status != "missing" {
		t.Fatalf("missing entry = %#v", assetMigrationEntryByID(dryRun.Entries, "asset-missing"))
	}

	applied, err := RunAssetMigration(context.Background(), AssetMigrationOptions{
		Apply:        true,
		WorkspaceDir: workspaceDir,
		ManifestPath: manifestPath,
	})
	if err != nil {
		t.Fatalf("RunAssetMigration(apply) error = %v", err)
	}
	if applied.BackupPath == "" {
		t.Fatal("BackupPath is empty")
	}
	if _, err := os.Stat(applied.BackupPath); err != nil {
		t.Fatalf("backup should exist: %v", err)
	}
	if _, err := os.Stat(wantSectionPath); err != nil {
		t.Fatalf("migrated section asset should exist: %v", err)
	}
	if _, err := os.Stat(oldSectionPath); !os.IsNotExist(err) {
		t.Fatalf("old section asset should be moved, err=%v", err)
	}
	globalEntry := assetMigrationEntryByID(applied.Entries, "asset-global")
	if globalEntry.NewPath != filepath.Join(workspaceDir, "library", "assets", "images", "uploads", "asset-global.png") {
		t.Fatalf("global entry = %#v", globalEntry)
	}

	got, err := settingsRepos.MediaAssets.GetMediaAsset("asset-section")
	if err != nil {
		t.Fatalf("GetMediaAsset(section) error = %v", err)
	}
	if got.Path != wantSectionPath ||
		got.Source != MediaSourceGeneration ||
		got.ConversationID != "conversation-1" ||
		got.SectionID != "document%201:block%2F2" ||
		got.RelativePath != "library/assets/images/document-1/block-2/asset-section.png" {
		t.Fatalf("migrated model = %#v", got)
	}
}

func assetMigrationEntryByID(entries []AssetMigrationEntry, id string) AssetMigrationEntry {
	for _, entry := range entries {
		if entry.AssetID == id {
			return entry
		}
	}
	return AssetMigrationEntry{}
}
