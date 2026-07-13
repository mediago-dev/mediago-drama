package promptpack

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack/codec"
	instructionpro "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack/pro"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/license"
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
		t.Fatalf("skill counts first=%d second=%d, want 7 visible skills and idempotent", len(first), len(second))
	}
	if _, ok := findEntry(first, "auto-mention-resolver"); !ok {
		t.Fatalf("entries = %#v, want auto-mention-resolver", first)
	}
	for _, hiddenSlug := range []string{"image-generation", "video-generation"} {
		if _, ok := findEntry(first, hiddenSlug); ok {
			t.Fatalf("entries = %#v, want %s hidden while under test", first, hiddenSlug)
		}
	}
	packs, err := store.ListPacks(context.Background())
	if err != nil {
		t.Fatalf("ListPacks() error = %v", err)
	}
	if len(packs) != 1 || packs[0].ID != DefaultPackID || packs[0].Source != packSourceDefault {
		t.Fatalf("packs = %#v, want default pack", packs)
	}
}

func TestServiceKeepsDefaultPackAlwaysEnabled(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	before, err := store.ListEntries(ctx, instructionpack.KindSkill)
	if err != nil {
		t.Fatalf("seeding: %v", err)
	}
	if len(before) == 0 {
		t.Fatalf("expected built-in skills before disable")
	}
	// The default pack is a permanent base layer: disabling it is a no-op so
	// its content stays usable while installed packs stack on top.
	pack, err := store.SetEnabled(ctx, DefaultPackID, false)
	if err != nil {
		t.Fatalf("SetEnabled(default,false) error = %v", err)
	}
	if !pack.Enabled {
		t.Fatalf("default pack = %#v, want still enabled", pack)
	}
	after, err := store.ListEntries(ctx, instructionpack.KindSkill)
	if err != nil {
		t.Fatalf("ListEntries() error = %v", err)
	}
	if len(after) != len(before) {
		t.Fatalf("entries after disabling default = %d, want unchanged %d", len(after), len(before))
	}
}

func TestServiceStacksInstalledPackOnDefault(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	before, err := store.ListEntries(ctx, instructionpack.KindSkill)
	if err != nil {
		t.Fatalf("seeding: %v", err)
	}
	if _, err := store.InstallPath(ctx, writeTestMGPack(t)); err != nil {
		t.Fatalf("InstallPath() error = %v", err)
	}
	after, err := store.ListEntries(ctx, instructionpack.KindSkill)
	if err != nil {
		t.Fatalf("ListEntries() error = %v", err)
	}
	// The imported pack stacks on top of the default: both are visible together.
	if _, ok := findEntry(after, "test-skill"); !ok {
		t.Fatalf("entries = %#v, want imported test-skill", after)
	}
	if _, ok := findEntry(after, "character-writer"); !ok {
		t.Fatalf("entries = %#v, want default character-writer still present", after)
	}
	if len(after) != len(before)+1 {
		t.Fatalf("entries = %d, want default %d + 1 imported", len(after), len(before))
	}
}

func TestServiceHideEntryPersistsAcrossBuiltinSeed(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	if _, err := store.GetEntry(ctx, instructionpack.KindPrompt, "image-character-concept"); err != nil {
		t.Fatalf("GetEntry() before hide error = %v", err)
	}
	if err := store.HideEntry(ctx, instructionpack.KindPrompt, "image-character-concept"); err != nil {
		t.Fatalf("HideEntry() error = %v", err)
	}
	if _, err := store.GetEntry(ctx, instructionpack.KindPrompt, "image-character-concept"); !errors.Is(err, ErrEntryNotFound) {
		t.Fatalf("GetEntry() after hide error = %v, want ErrEntryNotFound", err)
	}

	store.seeded = false
	entries, err := store.ListEntries(ctx, instructionpack.KindPrompt)
	if err != nil {
		t.Fatalf("ListEntries() after reseed error = %v", err)
	}
	if _, ok := findEntry(entries, "image-character-concept"); ok {
		t.Fatalf("entries = %#v, want hidden entry to survive reseed", entries)
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

func TestServiceRejectsProPackWithoutLicense(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("rand.Read() error = %v", err)
	}
	signer, _ := newTestProSigner(t)
	data, err := writeTestMGPackPro(t, key, signer, "1.0.0")
	if err != nil {
		t.Fatalf("writeTestMGPackPro() error = %v", err)
	}
	_, err = store.InstallData(ctx, "test.mgpackpro", data)
	if !errors.Is(err, ErrPackLicenseRequired) {
		t.Fatalf("InstallData() error = %v, want ErrPackLicenseRequired", err)
	}
}

func TestServiceInstallsProPackWithLicense(t *testing.T) {
	ctx := context.Background()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("rand.Read() error = %v", err)
	}
	signer, publisherKey := newTestProSigner(t)
	data, err := writeTestMGPackPro(t, key, signer, "1.0.0")
	if err != nil {
		t.Fatalf("writeTestMGPackPro() error = %v", err)
	}
	store := newTestServiceWithLicense(
		t,
		newTestLicenseProvider(
			map[string]struct{}{license.DefaultProEntitlement(): {}},
			map[string][]byte{
				"default": key,
			},
			map[string][]byte{
				signer.KeyID: publisherKey,
			},
		),
	)
	installed, err := store.InstallData(ctx, "test.mgpackpro", data)
	if err != nil {
		t.Fatalf("InstallData() error = %v", err)
	}
	if installed.Source != packSourcePro {
		t.Fatalf("installed source = %q, want %q", installed.Source, packSourcePro)
	}
	packs, err := store.ListPacks(ctx)
	if err != nil {
		t.Fatalf("ListPacks() error = %v", err)
	}
	found := false
	for _, pack := range packs {
		if pack.ID == installed.ID {
			found = true
			if pack.Source != packSourcePro {
				t.Fatalf("stored pack source = %q, want %q", pack.Source, packSourcePro)
			}
			break
		}
	}
	if !found {
		t.Fatalf("pack %q not found after import", installed.ID)
	}
	_, err = store.GetEntry(ctx, instructionpack.KindSkill, "pro-skill")
	if err != nil {
		t.Fatalf("GetEntry(pro-skill) error = %v", err)
	}
}

func TestServiceInstallsProPackPathWithProSource(t *testing.T) {
	ctx := context.Background()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("rand.Read() error = %v", err)
	}
	signer, publisherKey := newTestProSigner(t)
	path := writeTestMGPackProFile(t, key, signer, "1.0.0")
	store := newTestServiceWithLicense(
		t,
		newTestLicenseProvider(
			map[string]struct{}{license.DefaultProEntitlement(): {}},
			map[string][]byte{
				"default": key,
			},
			map[string][]byte{
				signer.KeyID: publisherKey,
			},
		),
	)
	installed, err := store.InstallPath(ctx, path)
	if err != nil {
		t.Fatalf("InstallPath() error = %v", err)
	}
	if installed.Source != packSourcePro {
		t.Fatalf("installed source = %q, want %q", installed.Source, packSourcePro)
	}
}

func TestServiceRejectsProPackExport(t *testing.T) {
	ctx := context.Background()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("rand.Read() error = %v", err)
	}
	signer, publisherKey := newTestProSigner(t)
	data, err := writeTestMGPackPro(t, key, signer, "1.0.0")
	if err != nil {
		t.Fatalf("writeTestMGPackPro() error = %v", err)
	}
	store := newTestServiceWithLicense(
		t,
		newTestLicenseProvider(
			map[string]struct{}{license.DefaultProEntitlement(): {}},
			map[string][]byte{
				"default": key,
			},
			map[string][]byte{
				signer.KeyID: publisherKey,
			},
		),
	)
	installed, err := store.InstallData(ctx, "test.mgpackpro", data)
	if err != nil {
		t.Fatalf("InstallData() error = %v", err)
	}
	_, err = store.ExportPack(ctx, installed.ID)
	if !errors.Is(err, ErrPackExportRestricted) {
		t.Fatalf("ExportPack() error = %v, want ErrPackExportRestricted", err)
	}
}

func TestServiceRejectsInvalidProPackAsInvalidPack(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	_, err := store.InstallData(ctx, "broken.mgpackpro", []byte("not a pro pack"))
	if !errors.Is(err, ErrInvalidPack) {
		t.Fatalf("InstallData() error = %v, want ErrInvalidPack", err)
	}
}

func TestServiceRejectsForgedProPackAsInvalidPack(t *testing.T) {
	ctx := context.Background()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("rand.Read() error = %v", err)
	}
	// The attacker signs with their own key under the official publisher key id.
	officialSigner, officialPublisherKey := newTestProSigner(t)
	attackerSigner, _ := newTestProSigner(t)
	attackerSigner.KeyID = officialSigner.KeyID
	data, err := writeTestMGPackPro(t, key, attackerSigner, "1.0.0")
	if err != nil {
		t.Fatalf("writeTestMGPackPro() error = %v", err)
	}
	store := newTestServiceWithLicense(
		t,
		newTestLicenseProvider(
			map[string]struct{}{license.DefaultProEntitlement(): {}},
			map[string][]byte{
				"default": key,
			},
			map[string][]byte{
				officialSigner.KeyID: officialPublisherKey,
			},
		),
	)
	_, err = store.InstallData(ctx, "forged.mgpackpro", data)
	if !errors.Is(err, ErrInvalidPack) {
		t.Fatalf("InstallData(forged) error = %v, want ErrInvalidPack", err)
	}
}

func TestServiceRejectsProPackWithUnknownPublisherAsLicenseRequired(t *testing.T) {
	ctx := context.Background()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("rand.Read() error = %v", err)
	}
	signer, _ := newTestProSigner(t)
	data, err := writeTestMGPackPro(t, key, signer, "1.0.0")
	if err != nil {
		t.Fatalf("writeTestMGPackPro() error = %v", err)
	}
	// License is provisioned but has no trusted key for this publisher.
	store := newTestServiceWithLicense(
		t,
		newTestLicenseProvider(
			map[string]struct{}{license.DefaultProEntitlement(): {}},
			map[string][]byte{
				"default": key,
			},
			nil,
		),
	)
	_, err = store.InstallData(ctx, "test.mgpackpro", data)
	if !errors.Is(err, ErrPackLicenseRequired) {
		t.Fatalf("InstallData() error = %v, want ErrPackLicenseRequired", err)
	}
}

func TestServiceExportsAndImportsFullMGPack(t *testing.T) {
	ctx := context.Background()
	source := newTestService(t)
	installed, err := source.InstallPath(ctx, writeTestMGPack(t))
	if err != nil {
		t.Fatalf("InstallPath() error = %v", err)
	}
	if _, err := source.SaveEntry(ctx, instructionpack.KindSkill, "test-skill", Entry{
		Slug:        "test-skill",
		Name:        "test-skill",
		Description: "Changed test skill",
		Body:        "Changed full pack body",
	}); err != nil {
		t.Fatalf("SaveEntry() error = %v", err)
	}

	exported, err := source.ExportPack(ctx, installed.ID)
	if err != nil {
		t.Fatalf("ExportPack() error = %v", err)
	}
	if exported.FileName == "" || filepath.Ext(exported.FileName) != ".mgpack" {
		t.Fatalf("exported filename = %q, want .mgpack", exported.FileName)
	}
	archive, err := codec.Decode(exported.Data)
	if err != nil {
		t.Fatalf("Decode(exported) error = %v", err)
	}
	bundle, err := instructionpack.ParseZip(ctx, archive)
	if err != nil {
		t.Fatalf("ParseZip(exported) error = %v", err)
	}
	if bundle.Manifest.ID != installed.ID {
		t.Fatalf("bundle manifest = %#v, want installed pack id", bundle.Manifest)
	}
	if entry, ok := findPackEntry(bundle.Entries, "test-skill"); !ok || !strings.Contains(entry.Body, "Changed full pack body") {
		t.Fatalf("exported entries = %#v, want current full pack content", bundle.Entries)
	}

	target := newTestService(t)
	imported, err := target.InstallData(ctx, exported.FileName, exported.Data)
	if err != nil {
		t.Fatalf("InstallData(exported) error = %v", err)
	}
	if imported.ID != installed.ID || imported.Source != packSourceImported || !imported.Enabled {
		t.Fatalf("imported = %#v, want imported enabled full pack", imported)
	}
	importedSkill, err := target.GetEntry(ctx, instructionpack.KindSkill, "test-skill")
	if err != nil {
		t.Fatalf("GetEntry(skill) error = %v", err)
	}
	if importedSkill.Source != entrySourcePack || !strings.Contains(importedSkill.Body, "Changed full pack body") {
		t.Fatalf("imported skill = %#v, want pack-backed exported body", importedSkill)
	}
	if _, err := target.SetEnabled(ctx, imported.ID, false); err != nil {
		t.Fatalf("SetEnabled(false) error = %v", err)
	}
	entries, err := target.ListEntries(ctx, instructionpack.KindSkill)
	if err != nil {
		t.Fatalf("ListEntries() after disable error = %v", err)
	}
	if _, ok := findEntry(entries, "test-skill"); ok {
		t.Fatalf("entries = %#v, want imported pack disabled", entries)
	}
}

func TestServiceExportsDefaultPackAsImportableMGPack(t *testing.T) {
	ctx := context.Background()
	source := newTestService(t)
	if _, err := source.SaveEntry(ctx, instructionpack.KindSkill, "character-writer", Entry{
		Slug:        "character-writer",
		Name:        "character-writer",
		Description: "Changed default skill",
		Body:        "Changed default pack body",
	}); err != nil {
		t.Fatalf("SaveEntry(default skill) error = %v", err)
	}
	exported, err := source.ExportPack(ctx, DefaultPackID)
	if err != nil {
		t.Fatalf("ExportPack(default) error = %v", err)
	}
	archive, err := codec.Decode(exported.Data)
	if err != nil {
		t.Fatalf("Decode(default export) error = %v", err)
	}
	bundle, err := instructionpack.ParseZip(ctx, archive)
	if err != nil {
		t.Fatalf("ParseZip(default export) error = %v", err)
	}
	if bundle.Manifest.ID != defaultExportPackID {
		t.Fatalf("bundle manifest id = %q, want %q", bundle.Manifest.ID, defaultExportPackID)
	}
	if entry, ok := findPackEntry(bundle.Entries, "character-writer"); !ok || !strings.Contains(entry.Body, "Changed default pack body") {
		t.Fatalf("exported default entries = %#v, want edited default content", bundle.Entries)
	}

	target := newTestService(t)
	imported, err := target.InstallData(ctx, exported.FileName, exported.Data)
	if err != nil {
		t.Fatalf("InstallData(default export) error = %v", err)
	}
	if imported.ID != defaultExportPackID || imported.Source != packSourceImported {
		t.Fatalf("imported = %#v, want importable default export pack", imported)
	}
	entry, err := target.GetEntry(ctx, instructionpack.KindSkill, "character-writer")
	if err != nil {
		t.Fatalf("GetEntry(imported default skill) error = %v", err)
	}
	if entry.PackID != defaultExportPackID || !strings.Contains(entry.Body, "Changed default pack body") {
		t.Fatalf("entry = %#v, want imported default export to override builtin", entry)
	}
	if _, err := target.SetEnabled(ctx, defaultExportPackID, false); err != nil {
		t.Fatalf("SetEnabled(default export false) error = %v", err)
	}
	reset, err := target.GetEntry(ctx, instructionpack.KindSkill, "character-writer")
	if err != nil {
		t.Fatalf("GetEntry(disabled default export skill) error = %v", err)
	}
	if reset.PackID == defaultExportPackID || strings.Contains(reset.Body, "Changed default pack body") {
		t.Fatalf("entry = %#v, want disabling imported export to reveal builtin", reset)
	}
}

func TestServiceExportsDefaultPackWithUserUnicodeCategory(t *testing.T) {
	ctx := context.Background()
	source := newTestService(t)
	if _, err := source.CreateCategory(ctx, Category{ID: "角色", Label: "角色"}); err != nil {
		t.Fatalf("CreateCategory() error = %v", err)
	}
	if _, err := source.CreateEntry(ctx, instructionpack.KindPrompt, Entry{
		Slug: "character-reference",
		Name: "角色参考",
		Body: "保持角色一致。",
		Metadata: map[string]any{
			"category": "角色",
			"type":     "image",
		},
	}); err != nil {
		t.Fatalf("CreateEntry(prompt) error = %v", err)
	}

	exported, err := source.ExportPack(ctx, DefaultPackID)
	if err != nil {
		t.Fatalf("ExportPack(default) error = %v", err)
	}
	archive, err := codec.Decode(exported.Data)
	if err != nil {
		t.Fatalf("Decode(default export) error = %v", err)
	}
	bundle, err := instructionpack.ParseZip(ctx, archive)
	if err != nil {
		t.Fatalf("ParseZip(default export) error = %v", err)
	}
	if !hasPackCategory(bundle.Categories, "角色", "角色") {
		t.Fatalf("categories = %#v, want Unicode category", bundle.Categories)
	}
	if entry, ok := findPackEntry(bundle.Entries, "character-reference"); !ok || entry.Metadata["category"] != "角色" {
		t.Fatalf("entries = %#v, want exported Unicode prompt category", bundle.Entries)
	}

	target := newTestService(t)
	imported, err := target.InstallData(ctx, exported.FileName, exported.Data)
	if err != nil {
		t.Fatalf("InstallData(default export) error = %v", err)
	}
	if imported.ID != defaultExportPackID || imported.Source != packSourceImported {
		t.Fatalf("imported = %#v, want importable default export pack", imported)
	}
	categories, err := target.ListCategories(ctx)
	if err != nil {
		t.Fatalf("ListCategories() error = %v", err)
	}
	if !hasCategory(categories, "角色", "角色") {
		t.Fatalf("categories = %#v, want imported Unicode category", categories)
	}
	prompt, err := target.GetEntry(ctx, instructionpack.KindPrompt, "character-reference")
	if err != nil {
		t.Fatalf("GetEntry(imported prompt) error = %v", err)
	}
	if prompt.PackID != defaultExportPackID || metadataString(prompt.Metadata, "category") != "角色" {
		t.Fatalf("prompt = %#v, want imported Unicode category", prompt)
	}
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	dbName := strings.NewReplacer("/", "_", " ", "_").Replace(t.Name() + "_" + filepath.Base(t.TempDir()))
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
	).withTestPackFilesDir(t.TempDir())
}

func newTestServiceWithLicense(t *testing.T, provider license.Service) *Service {
	t.Helper()
	dbName := strings.NewReplacer("/", "_", " ", "_").Replace(t.Name() + "_" + filepath.Base(t.TempDir()))
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
	return NewServiceFromRepositoryWithPackFilesDirAndLicense(
		repository.NewPackRepositoryFromDB(db),
		repository.NewPromptLibraryRepositoryFromDB(db),
		nil,
		t.TempDir(),
		provider,
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

func newTestProSigner(t *testing.T) (instructionpro.Signer, ed25519.PublicKey) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}
	return instructionpro.Signer{KeyID: "test-publisher", Key: private}, public
}

func writeTestMGPackPro(t *testing.T, key []byte, signer instructionpro.Signer, version string) ([]byte, error) {
	t.Helper()
	root := t.TempDir()
	packID := "com.example.pro.test"
	if err := os.WriteFile(filepath.Join(root, "pack.json"), []byte(`{
		"id": "`+packID+`",
		"name": "Pro Test Pack",
		"version": "`+version+`"
	}`), 0o644); err != nil {
		return nil, err
	}
	skillsDir := filepath.Join(root, "skills")
	if err := os.MkdirAll(skillsDir, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(skillsDir, "pro-skill.skill.md"), []byte(`---
name: pro-skill
description: Pro skill
---
Use this for pro tests.
`), 0o644); err != nil {
		return nil, err
	}
	raw, err := instructionpack.ArchiveDir(context.Background(), root)
	if err != nil {
		return nil, err
	}
	return instructionpro.Build(
		context.Background(),
		raw,
		instructionpro.Manifest{
			ID:                  packID,
			Name:                "Pro Test Pack",
			Version:             version,
			RequiredEntitlement: license.DefaultProEntitlement(),
			KeyID:               "default",
		},
		key,
		signer,
	)
}

func writeTestMGPackProFile(t *testing.T, key []byte, signer instructionpro.Signer, version string) string {
	t.Helper()
	data, err := writeTestMGPackPro(t, key, signer, version)
	if err != nil {
		t.Fatalf("writeTestMGPackPro() error = %v", err)
	}
	path := filepath.Join(t.TempDir(), "test.mgpackpro")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write pro pack file: %v", err)
	}
	return path
}

func findEntry(entries []Entry, slug string) (Entry, bool) {
	for _, entry := range entries {
		if entry.Slug == slug {
			return entry, true
		}
	}
	return Entry{}, false
}

type testLicenseProvider struct {
	entitlements  map[string]struct{}
	keys          map[string][]byte
	publisherKeys map[string][]byte
}

func newTestLicenseProvider(
	entitlements map[string]struct{},
	keys map[string][]byte,
	publisherKeys map[string][]byte,
) *testLicenseProvider {
	return &testLicenseProvider{
		entitlements:  entitlements,
		keys:          keys,
		publisherKeys: publisherKeys,
	}
}

func (provider *testLicenseProvider) HasEntitlement(_ context.Context, entitlement string) (bool, error) {
	if provider == nil {
		return false, nil
	}
	_, ok := provider.entitlements[strings.TrimSpace(entitlement)]
	return ok, nil
}

func (provider *testLicenseProvider) ResolvePackKey(_ context.Context, keyID string, _ string) ([]byte, error) {
	if provider == nil {
		return nil, license.ErrPackKeyNotFound
	}
	keyID = strings.TrimSpace(keyID)
	key, ok := provider.keys[keyID]
	if !ok {
		return nil, license.ErrPackKeyNotFound
	}
	keyCopy := make([]byte, len(key))
	copy(keyCopy, key)
	return keyCopy, nil
}

func (provider *testLicenseProvider) ResolvePublisherKeys(_ context.Context) (map[string][]byte, error) {
	if provider == nil {
		return map[string][]byte{}, nil
	}
	keys := make(map[string][]byte, len(provider.publisherKeys))
	for keyID, key := range provider.publisherKeys {
		keyCopy := make([]byte, len(key))
		copy(keyCopy, key)
		keys[keyID] = keyCopy
	}
	return keys, nil
}

func findPackEntry(entries []instructionpack.Entry, slug string) (instructionpack.Entry, bool) {
	for _, entry := range entries {
		if entry.Slug == slug {
			return entry, true
		}
	}
	return instructionpack.Entry{}, false
}

func hasCategory(categories []Category, id string, label string) bool {
	for _, category := range categories {
		if category.ID == id && category.Label == label {
			return true
		}
	}
	return false
}

func hasPackCategory(categories []instructionpack.Category, id string, label string) bool {
	for _, category := range categories {
		if category.ID == id && category.Label == label {
			return true
		}
	}
	return false
}

func (store *Service) withTestPackFilesDir(dir string) *Service {
	store.packFilesDir = dir
	return store
}
