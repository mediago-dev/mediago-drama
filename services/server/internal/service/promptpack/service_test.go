package promptpack

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack/codec"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"gorm.io/gorm"
)

func TestServiceSeedsBuiltinPackIdempotently(t *testing.T) {
	store := newTestService(t)
	first, err := store.ListEntries(context.Background(), instructionpack.KindSkill)
	if err != nil {
		t.Fatalf("ListEntries() error = %v", err)
	}
	second, err := store.ListEntries(context.Background(), instructionpack.KindSkill)
	if err != nil {
		t.Fatalf("ListEntries() second error = %v", err)
	}
	if len(first) != 7 || len(second) != len(first) {
		t.Fatalf("skill counts first=%d second=%d, want 7 and idempotent", len(first), len(second))
	}
	if _, ok := findEntry(first, "auto-mention-resolver"); !ok {
		t.Fatalf("entries = %#v, want auto-mention-resolver", first)
	}
	packs, err := store.ListPacks(context.Background())
	if err != nil {
		t.Fatalf("ListPacks() error = %v", err)
	}
	if len(packs) != 1 || packs[0].ID != DefaultPackID || packs[0].Source != packSourceDefault {
		t.Fatalf("packs = %#v, want default pack", packs)
	}
}

func TestServiceHidesDisabledPackEntries(t *testing.T) {
	store := newTestService(t)
	if _, err := store.ListEntries(context.Background(), instructionpack.KindSkill); err != nil {
		t.Fatalf("seeding: %v", err)
	}
	if _, err := store.SetEnabled(context.Background(), DefaultPackID, false); err != nil {
		t.Fatalf("SetEnabled() error = %v", err)
	}
	entries, err := store.ListEntries(context.Background(), instructionpack.KindSkill)
	if err != nil {
		t.Fatalf("ListEntries() error = %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("entries = %#v, want hidden", entries)
	}
}

func TestServiceInstallsEncodedPackAndUninstalls(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	packFile := writeTestMGPack(t)
	installed, err := store.InstallPath(ctx, packFile)
	if err != nil {
		t.Fatalf("InstallPath() error = %v", err)
	}
	if installed.ID != "com.example.test" || installed.Source != packSourceImported || !installed.Enabled {
		t.Fatalf("installed = %#v, want imported enabled test pack", installed)
	}
	entries, err := store.ListEntries(ctx, instructionpack.KindSkill)
	if err != nil {
		t.Fatalf("ListEntries() error = %v", err)
	}
	if entry, ok := findEntry(entries, "test-skill"); !ok || entry.Source != entrySourcePack {
		t.Fatalf("entries = %#v, want imported test-skill", entries)
	}
	if _, err := store.SaveEntry(ctx, instructionpack.KindSkill, "test-skill", Entry{
		Slug:        "test-skill",
		Name:        "test-skill",
		Description: "Changed",
		Body:        "Changed body",
	}); err != nil {
		t.Fatalf("SaveEntry(imported skill) error = %v", err)
	}
	reset, err := store.ResetEntry(ctx, instructionpack.KindSkill, "test-skill")
	if err != nil {
		t.Fatalf("ResetEntry(imported skill) error = %v", err)
	}
	if reset.Source != entrySourcePack || reset.Description != "Test skill" || !strings.Contains(reset.Body, "Use this for tests.") {
		t.Fatalf("reset = %#v, want imported pack default", reset)
	}
	if _, err := store.SetEnabled(ctx, installed.ID, false); err != nil {
		t.Fatalf("SetEnabled(false) error = %v", err)
	}
	entries, err = store.ListEntries(ctx, instructionpack.KindSkill)
	if err != nil {
		t.Fatalf("ListEntries() after disable error = %v", err)
	}
	if _, ok := findEntry(entries, "test-skill"); ok {
		t.Fatalf("entries = %#v, want disabled imported skill hidden", entries)
	}
	if err := store.Uninstall(ctx, installed.ID); err != nil {
		t.Fatalf("Uninstall() error = %v", err)
	}
	packs, err := store.ListPacks(ctx)
	if err != nil {
		t.Fatalf("ListPacks() error = %v", err)
	}
	for _, pack := range packs {
		if pack.ID == installed.ID {
			t.Fatalf("packs = %#v, want test pack removed", packs)
		}
	}
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	dbName := strings.NewReplacer("/", "_", " ", "_").Replace(t.Name())
	db, err := gorm.Open(sqlite.Open("file:"+dbName+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("opening sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&domain.PackModel{},
		&domain.PackEntryModel{},
		&domain.PackCategoryModel{},
		&domain.PromptCategoryModel{},
		&domain.PromptLibraryEntryModel{},
	); err != nil {
		t.Fatalf("migrating: %v", err)
	}
	return NewServiceFromRepository(
		repository.NewPackRepositoryFromDB(db),
		repository.NewPromptLibraryRepositoryFromDB(db),
		nil,
	)
}

func writeTestMGPack(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "pack.json"), []byte(`{
		"id": "com.example.test",
		"name": "Test Pack",
		"version": "1.0.0"
	}`), 0o644); err != nil {
		t.Fatalf("writing pack.json: %v", err)
	}
	skillsDir := filepath.Join(root, "skills")
	if err := os.MkdirAll(skillsDir, 0o755); err != nil {
		t.Fatalf("creating skills dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillsDir, "test-skill.skill.md"), []byte(`---
name: test-skill
description: Test skill
---
Use this for tests.
`), 0o644); err != nil {
		t.Fatalf("writing skill: %v", err)
	}
	archive, err := instructionpack.ArchiveDir(context.Background(), root)
	if err != nil {
		t.Fatalf("archiving pack: %v", err)
	}
	output := filepath.Join(t.TempDir(), "test.mgpack")
	if err := os.WriteFile(output, codec.Encode(archive), 0o644); err != nil {
		t.Fatalf("writing mgpack: %v", err)
	}
	return output
}

func findEntry(entries []Entry, slug string) (Entry, bool) {
	for _, entry := range entries {
		if entry.Slug == slug {
			return entry, true
		}
	}
	return Entry{}, false
}
