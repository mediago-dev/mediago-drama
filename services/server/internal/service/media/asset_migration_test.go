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
	oldVideoPath := filepath.Join(legacySourceDir, "asset-video.mp4")
	if err := os.WriteFile(oldVideoPath, []byte("video-bytes"), 0o600); err != nil {
		t.Fatalf("writing video asset: %v", err)
	}
	oldVideoPosterPath := filepath.Join(legacySourceDir, "asset-video.poster.jpg")
	if err := os.WriteFile(oldVideoPosterPath, []byte("poster-bytes"), 0o600); err != nil {
		t.Fatalf("writing video poster: %v", err)
	}
	oldTextToolboxDir := filepath.Join(workspaceDir, "library", "assets", "text", "toolbox", "session-text-old")
	if err := os.MkdirAll(oldTextToolboxDir, 0o755); err != nil {
		t.Fatalf("creating text toolbox dir: %v", err)
	}
	oldTextToolboxPath := filepath.Join(oldTextToolboxDir, "generation-old.txt")
	if err := os.WriteFile(oldTextToolboxPath, []byte("old text result"), 0o600); err != nil {
		t.Fatalf("writing text toolbox asset: %v", err)
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
		{
			ID:         "asset-video",
			Kind:       MediaKindVideo,
			Filename:   "video.mp4",
			MIMEType:   "video/mp4",
			SizeBytes:  11,
			Path:       oldVideoPath,
			PosterPath: oldVideoPosterPath,
			URL:        "/api/v1/media-assets/asset-video/content",
			CreatedAt:  "2026-06-20T00:00:00Z",
			UpdatedAt:  "2026-06-20T00:00:00Z",
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
	wantDateDir := mediaAssetDateDirFromTimestamp("2026-06-20T00:00:00Z")
	wantSectionRelativePath := filepath.ToSlash(filepath.Join("library", wantDateDir, "asset-section.png"))
	wantSectionPath := filepath.Join(projectDir, "library", wantDateDir, "asset-section.png")
	if sectionEntry.NewPath != wantSectionPath || sectionEntry.RelativePath != wantSectionRelativePath {
		t.Fatalf("section entry = %#v, want %s", sectionEntry, wantSectionPath)
	}
	if _, err := os.Stat(oldSectionPath); err != nil {
		t.Fatalf("dry-run moved section asset: %v", err)
	}
	if assetMigrationEntryByID(dryRun.Entries, "asset-missing").Status != "missing" {
		t.Fatalf("missing entry = %#v", assetMigrationEntryByID(dryRun.Entries, "asset-missing"))
	}
	wantVideoPosterPath := filepath.Join(paths.MediaPosterCacheDir(), "asset-video.poster.jpg")
	videoEntry := assetMigrationEntryByID(dryRun.Entries, "asset-video")
	if videoEntry.NewPosterPath != wantVideoPosterPath || videoEntry.PosterStatus != "planned" {
		t.Fatalf("video poster entry = %#v, want hidden poster path %s", videoEntry, wantVideoPosterPath)
	}
	textEntry := assetMigrationEntryByRelativePath(
		dryRun.Entries,
		"library/assets/text/toolbox/session-text-old/generation-old.txt",
	)
	if textEntry.Status != "register" || textEntry.Kind != MediaKindText || textEntry.ConversationID != "session-text-old" {
		t.Fatalf("text registration entry = %#v, want text register entry", textEntry)
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
	if applied.Registered != 1 {
		t.Fatalf("Registered = %d, want 1", applied.Registered)
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
	if _, err := os.Stat(wantVideoPosterPath); err != nil {
		t.Fatalf("migrated video poster should exist: %v", err)
	}
	if _, err := os.Stat(oldVideoPosterPath); !os.IsNotExist(err) {
		t.Fatalf("old video poster should be moved, err=%v", err)
	}
	globalEntry := assetMigrationEntryByID(applied.Entries, "asset-global")
	if globalEntry.NewPath != filepath.Join(workspaceDir, "library", wantDateDir, "asset-global.png") {
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
		got.RelativePath != wantSectionRelativePath {
		t.Fatalf("migrated model = %#v", got)
	}
	missing, err := settingsRepos.MediaAssets.GetMediaAsset("asset-missing")
	if err != nil {
		t.Fatalf("GetMediaAsset(missing) error = %v", err)
	}
	if missing.StorageStatus != StorageStatusMissing || missing.StorageError == "" {
		t.Fatalf("missing model storage = %q/%q, want missing status and error", missing.StorageStatus, missing.StorageError)
	}
	videoAsset, err := settingsRepos.MediaAssets.GetMediaAsset("asset-video")
	if err != nil {
		t.Fatalf("GetMediaAsset(video) error = %v", err)
	}
	if videoAsset.PosterPath != wantVideoPosterPath {
		t.Fatalf("video poster path = %q, want %q", videoAsset.PosterPath, wantVideoPosterPath)
	}
	appliedTextEntry := assetMigrationEntryByRelativePath(
		applied.Entries,
		"library/assets/text/toolbox/session-text-old/generation-old.txt",
	)
	textAsset, err := settingsRepos.MediaAssets.GetMediaAsset(appliedTextEntry.AssetID)
	if err != nil {
		t.Fatalf("GetMediaAsset(text) error = %v", err)
	}
	if textAsset.Kind != MediaKindText ||
		textAsset.Source != MediaSourceToolbox ||
		textAsset.ConversationID != "session-text-old" ||
		textAsset.RelativePath != "library/assets/text/toolbox/session-text-old/generation-old.txt" ||
		textAsset.StorageStatus != StorageStatusReady {
		t.Fatalf("registered text asset = %#v", textAsset)
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

func assetMigrationEntryByRelativePath(entries []AssetMigrationEntry, relativePath string) AssetMigrationEntry {
	for _, entry := range entries {
		if entry.RelativePath == relativePath {
			return entry
		}
	}
	return AssetMigrationEntry{}
}
