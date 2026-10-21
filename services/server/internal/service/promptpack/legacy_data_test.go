package promptpack

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"gorm.io/gorm"
)

func TestLegacyInstalledPackSurvivesReopening(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "settings.db")
	repos, err := repository.OpenSettingsRepositories(path)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := repos.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	pack := domain.PackModel{
		ID: "legacy.purchased-pack", Name: "Existing Pack", Version: "1.2.3",
		ReleaseID: "legacy-release", Source: packSourceImported, Origin: "missing-old-runtime.mgpack", Enabled: true,
	}
	entry := domain.PackEntryModel{
		ID: "legacy.purchased-pack/skill/legacy-skill", PackID: pack.ID,
		Kind: string(instructionpack.KindSkill), Slug: "legacy-skill", Name: "legacy-skill",
		Description: "Existing skill", Body: "Keep this exact historical content.", Source: entrySourcePack,
		ReleaseID: pack.ReleaseID, SourcePackageID: pack.ID, SourceReleaseID: pack.ReleaseID,
	}
	if err := repos.Packs.UpsertPack(pack); err != nil {
		t.Fatal(err)
	}
	if err := repos.Packs.UpsertEntry(entry); err != nil {
		t.Fatal(err)
	}
	beforePack, err := repos.Packs.GetPack(pack.ID)
	if err != nil {
		t.Fatal(err)
	}
	beforeEntry, err := repos.Packs.GetEntry(entry.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatal(err)
	}

	reopenedDB, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	secondDB, err := reopenedDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := secondDB.Close(); err != nil {
			t.Error(err)
		}
	})
	if err := repository.EnsureSettingsRepositorySchemas(reopenedDB); err != nil {
		t.Fatal(err)
	}
	reopened := repository.SettingsRepositories{
		Packs:         repository.NewPackRepositoryFromDB(reopenedDB),
		PromptLibrary: repository.NewPromptLibraryRepositoryFromDB(reopenedDB),
	}
	store := NewServiceFromRepository(reopened.Packs, reopened.PromptLibrary, nil)
	resolved, err := store.GetEntry(ctx, instructionpack.KindSkill, entry.Slug)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Body != entry.Body || resolved.SourceReleaseID != pack.ReleaseID {
		t.Fatalf("legacy content changed: %#v", resolved)
	}
	afterPack, err := reopened.Packs.GetPack(pack.ID)
	if err != nil {
		t.Fatal(err)
	}
	afterEntry, err := reopened.Packs.GetEntry(entry.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(beforePack, afterPack) || !reflect.DeepEqual(beforeEntry, afterEntry) {
		t.Fatal("opening the OSS service rewrote the historical installed snapshot")
	}
}

func TestLocalPackImportCopyEditExportRoundTrip(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	data, err := os.ReadFile(writeTestMGPack(t))
	if err != nil {
		t.Fatal(err)
	}
	installed, err := store.InstallData(ctx, "local.mgpack", data)
	if err != nil {
		t.Fatal(err)
	}
	contents, err := store.GetPackContents(ctx, installed.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(contents.Entries) == 0 {
		t.Fatal("ordinary imported entries are not visible")
	}
	copy, err := store.ForkPack(ctx, installed.ID, ForkPackInput{Name: "Local copy"})
	if err != nil {
		t.Fatal(err)
	}
	copied, err := store.GetPackContents(ctx, copy.ID)
	if err != nil {
		t.Fatal(err)
	}
	entry := copied.Entries[0]
	if _, err := store.SavePackEntry(ctx, copy.ID, entry.ID, EntryUpdate{
		Name: entry.Name, Description: entry.Description, Body: "Locally edited body.",
	}); err != nil {
		t.Fatal(err)
	}
	exported, err := store.ExportPack(ctx, copy.ID)
	if err != nil {
		t.Fatal(err)
	}
	target := newTestService(t)
	imported, err := target.InstallData(ctx, exported.FileName, exported.Data)
	if err != nil {
		t.Fatal(err)
	}
	result, err := target.GetPackContents(ctx, imported.ID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, resultEntry := range result.Entries {
		if strings.TrimSpace(resultEntry.Body) == "Locally edited body." {
			found = true
		}
	}
	if !found {
		t.Fatal("local edits were lost during export/import")
	}
	if _, err := store.InstallData(ctx, "encrypted.mgpack", []byte{'M', 'G', 'P', 'K', 2}); err == nil {
		t.Fatal("unsupported encrypted container was accepted")
	}
}
