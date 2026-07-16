package promptpack

import (
	"context"
	"errors"
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
	if len(first) != 9 || len(second) != len(first) {
		t.Fatalf("skill counts first=%d second=%d, want 9 visible skills and idempotent", len(first), len(second))
	}
	if _, ok := findEntry(first, "auto-mention-resolver"); !ok {
		t.Fatalf("entries = %#v, want auto-mention-resolver", first)
	}
	for _, generationSlug := range []string{"image-generation", "video-generation"} {
		if _, ok := findEntry(first, generationSlug); !ok {
			t.Fatalf("entries = %#v, want visible %s skill", first, generationSlug)
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

func TestServiceCanDisableDefaultPack(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	before, err := store.ListEntries(ctx, instructionpack.KindSkill)
	if err != nil {
		t.Fatalf("seeding: %v", err)
	}
	if len(before) == 0 {
		t.Fatalf("expected built-in skills before disable")
	}
	pack, err := store.SetEnabled(ctx, DefaultPackID, false)
	if err != nil {
		t.Fatalf("SetEnabled(default,false) error = %v", err)
	}
	if pack.Enabled {
		t.Fatalf("default pack = %#v, want disabled", pack)
	}
	after, err := store.ListEntries(ctx, instructionpack.KindSkill)
	if err != nil {
		t.Fatalf("ListEntries() error = %v", err)
	}
	if len(after) != 0 {
		t.Fatalf("entries after disabling default = %d, want none", len(after))
	}
}

func TestServiceCreatesLocalAuthoringPackAndExportsV1(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	created, err := store.CreatePack(ctx, Pack{
		ID:      "company.story-prompts",
		Name:    "Story Prompts",
		Version: "1.0.0",
		Author:  "Creator",
	})
	if err != nil {
		t.Fatalf("CreatePack() error = %v", err)
	}
	if created.Source != packSourceLocal || !created.Enabled {
		t.Fatalf("created = %#v, want enabled local pack", created)
	}
	entry, err := store.CreateEntry(ctx, instructionpack.KindPrompt, Entry{
		PackID: "company.story-prompts",
		Slug:   "red-dress",
		Name:   "Red Dress",
		Body:   "A red silk dress",
	})
	if err != nil {
		t.Fatalf("CreateEntry() error = %v", err)
	}
	if entry.PackID != created.ID {
		t.Fatalf("entry.PackID = %q, want %q", entry.PackID, created.ID)
	}
	exported, err := store.ExportPack(ctx, created.ID)
	if err != nil {
		t.Fatalf("ExportPack() error = %v", err)
	}
	if len(exported.Data) == 0 || exported.Pack.ID != created.ID {
		t.Fatalf("exported = %#v, want encoded local pack", exported)
	}
	recorded, err := store.RecordSubmittedRelease(ctx, created.ID, "release-1", "1.0.0")
	if err != nil {
		t.Fatalf("RecordSubmittedRelease() error = %v", err)
	}
	if recorded.ReleaseID != "release-1" || recorded.Version != "1.0.0" {
		t.Fatalf("recorded = %#v, want latest release provenance", recorded)
	}
}

func TestServiceCreatesPackDraftEntriesBeforeContentIsWritten(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	pack, err := store.CreatePack(ctx, Pack{
		ID:      "company.draft-pack",
		Name:    "Draft Pack",
		Version: "1.0.0",
	})
	if err != nil {
		t.Fatalf("CreatePack() error = %v", err)
	}

	prompt, err := store.CreatePackEntryDraft(ctx, pack.ID, instructionpack.KindPrompt, "prompt-draft")
	if err != nil {
		t.Fatalf("CreatePackEntryDraft(prompt) error = %v", err)
	}
	if prompt.Name != "未命名提示词" || prompt.Body != "" || prompt.Source != entrySourceUser {
		t.Fatalf("prompt draft = %#v, want an empty user draft", prompt)
	}
	if _, err := store.ExportPack(ctx, pack.ID); !errors.Is(err, ErrInvalidPack) {
		t.Fatalf("ExportPack(incomplete) error = %v, want ErrInvalidPack", err)
	}

	prompt, err = store.SavePackEntry(ctx, pack.ID, prompt.ID, EntryUpdate{
		Name: "Finished Prompt",
		Body: "Finished prompt body",
	})
	if err != nil {
		t.Fatalf("SavePackEntry(prompt) error = %v", err)
	}
	if prompt.Name != "Finished Prompt" {
		t.Fatalf("saved prompt = %#v, want renamed prompt", prompt)
	}
	if _, err := store.ExportPack(ctx, pack.ID); err != nil {
		t.Fatalf("ExportPack(complete prompt) error = %v", err)
	}

	skill, err := store.CreatePackEntryDraft(ctx, pack.ID, instructionpack.KindSkill, "skill-draft")
	if err != nil {
		t.Fatalf("CreatePackEntryDraft(skill) error = %v", err)
	}
	if skill.Title != "未命名 Skill" || skill.Body != "" {
		t.Fatalf("skill draft = %#v, want an empty titled draft", skill)
	}
	skill, err = store.SavePackEntry(ctx, pack.ID, skill.ID, EntryUpdate{
		Name:        "Finished Skill",
		Description: "A complete Skill",
		Body:        "Finished Skill body",
	})
	if err != nil {
		t.Fatalf("SavePackEntry(skill) error = %v", err)
	}
	if skill.Title != "Finished Skill" {
		t.Fatalf("saved skill = %#v, want editable title", skill)
	}
	if _, err := store.ExportPack(ctx, pack.ID); err != nil {
		t.Fatalf("ExportPack(complete entries) error = %v", err)
	}

	if _, err := store.CreatePackEntryDraft(ctx, DefaultPackID, instructionpack.KindPrompt, "blocked-draft"); !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("CreatePackEntryDraft(default) error = %v, want ErrPackReadonly", err)
	}
}

func TestServiceLinksEntriesIntoLocalAuthoringPackAndTracksSources(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	for _, pack := range []Pack{
		{ID: "company.source-pack", Name: "Source Pack", Version: "1.0.0"},
		{ID: "company.target-pack", Name: "Target Pack", Version: "1.0.0"},
	} {
		if _, err := store.CreatePack(ctx, pack); err != nil {
			t.Fatalf("CreatePack(%s) error = %v", pack.ID, err)
		}
	}
	if err := store.repo.UpsertCategory(domain.PackCategoryModel{
		PackID: "company.source-pack",
		ID:     "story",
		Label:  "Story",
		Order:  7,
		Source: entrySourceUser,
	}); err != nil {
		t.Fatalf("UpsertCategory() error = %v", err)
	}
	if _, err := store.CreateEntry(ctx, instructionpack.KindSkill, Entry{
		PackID:      "company.source-pack",
		Slug:        "story-helper",
		Name:        "story-helper",
		Title:       "Story Helper",
		Description: "Helps with stories",
		Body:        "Write a story.",
	}); err != nil {
		t.Fatalf("CreateEntry(skill) error = %v", err)
	}
	if _, err := store.CreateEntry(ctx, instructionpack.KindPrompt, Entry{
		PackID: "company.source-pack",
		Slug:   "red-dress",
		Name:   "Red Dress",
		Body:   "A red silk dress.",
		Metadata: map[string]any{
			"category": "story",
			"type":     "image",
		},
	}); err != nil {
		t.Fatalf("CreateEntry(prompt) error = %v", err)
	}

	references := []EntryReference{
		{PackID: "company.source-pack", Kind: instructionpack.KindSkill, Slug: "story-helper"},
		{PackID: "company.source-pack", Kind: instructionpack.KindPrompt, Slug: "red-dress"},
	}
	linked, err := store.CopyEntries(ctx, "company.target-pack", references)
	if err != nil {
		t.Fatalf("CopyEntries() error = %v", err)
	}
	if len(linked) != 2 {
		t.Fatalf("len(linked) = %d, want 2", len(linked))
	}
	if _, ok := findEntry(linked, "story-helper-copy"); !ok {
		t.Fatalf("linked = %#v, want materialized story-helper reference", linked)
	}
	promptLink, ok := findEntry(linked, "red-dress-copy")
	if !ok {
		t.Fatalf("linked = %#v, want materialized red-dress reference", linked)
	}
	if !promptLink.Linked || promptLink.ReferenceSlug != "red-dress" || !promptLink.ReferenceEditable {
		t.Fatalf("prompt link = %#v, want editable source reference", promptLink)
	}
	if promptLink.Metadata[entryMetadataCopiedFromPack] != "company.source-pack" {
		t.Fatalf("link metadata = %#v, want source pack provenance", promptLink.Metadata)
	}
	if _, err := store.GetEntry(ctx, instructionpack.KindPrompt, "red-dress"); err != nil {
		t.Fatalf("source prompt moved or removed: %v", err)
	}
	category, err := store.repo.GetCategory("company.target-pack", "story")
	if err != nil {
		t.Fatalf("target category missing: %v", err)
	}
	if category.Label != "Story" || category.Order != 7 || category.Source != entrySourceUser {
		t.Fatalf("target category = %#v, want copied user category", category)
	}

	if _, err := store.CopyEntries(ctx, "company.target-pack", references[:1]); !errors.Is(err, ErrEntryExists) {
		t.Fatalf("CopyEntries() duplicate error = %v, want ErrEntryExists", err)
	}
	contents, err := store.GetPackContents(ctx, "company.target-pack")
	if err != nil {
		t.Fatalf("GetPackContents() error = %v", err)
	}
	if len(contents.Entries) != 2 {
		t.Fatalf("target entries = %#v, want 2 linked entries", contents.Entries)
	}

	if _, err := store.SaveEntry(ctx, instructionpack.KindPrompt, "red-dress", Entry{
		Slug: "red-dress",
		Name: "Red Dress Updated",
		Body: "A crimson silk dress.",
		Metadata: map[string]any{
			"category": "story",
			"type":     "image",
		},
	}); err != nil {
		t.Fatalf("SaveEntry(source) error = %v", err)
	}
	contents, err = store.GetPackContents(ctx, "company.target-pack")
	if err != nil {
		t.Fatalf("GetPackContents() after source update error = %v", err)
	}
	promptLink, ok = findEntry(contents.Entries, "red-dress-copy")
	if !ok || promptLink.Name != "Red Dress Updated" || !strings.Contains(promptLink.Body, "crimson") {
		t.Fatalf("linked prompt = %#v, want current source content", promptLink)
	}

	exported, err := store.ExportPack(ctx, "company.target-pack")
	if err != nil {
		t.Fatalf("ExportPack() error = %v", err)
	}
	archive, err := codec.Decode(exported.Data)
	if err != nil {
		t.Fatalf("Decode(exported) error = %v", err)
	}
	bundle, err := instructionpack.ParseZip(ctx, archive)
	if err != nil {
		t.Fatalf("ParseZip(exported) error = %v", err)
	}
	exportedPrompt, ok := findPackEntry(bundle.Entries, "red-dress-copy")
	if !ok || !strings.Contains(exportedPrompt.Body, "crimson") {
		t.Fatalf("exported prompt = %#v, want resolved source snapshot", exportedPrompt)
	}
	if _, exists := exportedPrompt.Metadata[entryMetadataCopiedFrom]; exists {
		t.Fatalf("exported prompt metadata = %#v, want no draft reference fields", exportedPrompt.Metadata)
	}
	if _, exists := exportedPrompt.Metadata[entryMetadataLinked]; exists {
		t.Fatalf("exported prompt metadata = %#v, want no linked marker", exportedPrompt.Metadata)
	}

	detached, err := store.DetachEntry(ctx, "company.target-pack", promptLink.ID)
	if err != nil {
		t.Fatalf("DetachEntry() error = %v", err)
	}
	if detached.Linked || detached.ReferenceEntryID != "" {
		t.Fatalf("detached = %#v, want package-owned entry", detached)
	}
	if _, err := store.SaveEntry(ctx, instructionpack.KindPrompt, "red-dress", Entry{
		Slug:     "red-dress",
		Name:     "Red Dress Newer",
		Body:     "A blue dress.",
		Metadata: map[string]any{"category": "story"},
	}); err != nil {
		t.Fatalf("SaveEntry(source after detach) error = %v", err)
	}
	contents, err = store.GetPackContents(ctx, "company.target-pack")
	if err != nil {
		t.Fatalf("GetPackContents() after detach error = %v", err)
	}
	detached, ok = findEntry(contents.Entries, "red-dress-copy")
	if !ok || !strings.Contains(detached.Body, "crimson") || strings.Contains(detached.Body, "blue") {
		t.Fatalf("detached prompt = %#v, want frozen package-specific content", detached)
	}
}

func TestServiceMigratesOnlyUntouchedLegacyCopiesToLinks(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	if _, err := store.CreatePack(ctx, Pack{ID: "company.source-pack", Name: "Source"}); err != nil {
		t.Fatalf("CreatePack(source) error = %v", err)
	}
	if _, err := store.CreatePack(ctx, Pack{ID: "company.target-pack", Name: "Target"}); err != nil {
		t.Fatalf("CreatePack(target) error = %v", err)
	}
	source, err := store.CreateEntry(ctx, instructionpack.KindPrompt, Entry{
		PackID: "company.source-pack",
		Slug:   "source-prompt",
		Name:   "Source Prompt",
		Body:   "Original body",
		Metadata: map[string]any{
			"category": "extra",
		},
	})
	if err != nil {
		t.Fatalf("CreateEntry(source) error = %v", err)
	}
	legacyMetadata := cloneMetadata(source.Metadata)
	legacyMetadata[entryMetadataCopiedFrom] = source.ID
	legacyMetadata[entryMetadataCopiedFromPack] = source.PackID
	for _, legacy := range []Entry{
		{
			ID:       instructionpack.EntryID("company.target-pack", instructionpack.KindPrompt, "untouched-copy"),
			PackID:   "company.target-pack",
			Kind:     instructionpack.KindPrompt,
			Slug:     "untouched-copy",
			Name:     source.Name,
			Body:     source.Body,
			Metadata: cloneMetadata(legacyMetadata),
			Source:   entrySourceUser,
		},
		{
			ID:       instructionpack.EntryID("company.target-pack", instructionpack.KindPrompt, "edited-copy"),
			PackID:   "company.target-pack",
			Kind:     instructionpack.KindPrompt,
			Slug:     "edited-copy",
			Name:     "Edited Prompt",
			Body:     "Locally edited body",
			Metadata: cloneMetadata(legacyMetadata),
			Source:   entrySourceUser,
		},
	} {
		if err := store.repo.UpsertEntry(entryModelFromEntry(legacy)); err != nil {
			t.Fatalf("UpsertEntry(%s) error = %v", legacy.Slug, err)
		}
	}

	if err := store.migrateCopiedEntriesToLinks(); err != nil {
		t.Fatalf("migrateCopiedEntriesToLinks() error = %v", err)
	}
	untouchedModel, err := store.repo.GetEntry(instructionpack.EntryID(
		"company.target-pack",
		instructionpack.KindPrompt,
		"untouched-copy",
	))
	if err != nil {
		t.Fatalf("GetEntry(untouched) error = %v", err)
	}
	untouched := entryFromModel(untouchedModel)
	if !untouched.Linked || untouched.ReferenceEntryID != source.ID {
		t.Fatalf("untouched = %#v, want upgraded linked reference", untouched)
	}
	editedModel, err := store.repo.GetEntry(instructionpack.EntryID(
		"company.target-pack",
		instructionpack.KindPrompt,
		"edited-copy",
	))
	if err != nil {
		t.Fatalf("GetEntry(edited) error = %v", err)
	}
	edited := entryFromModel(editedModel)
	if edited.Linked || edited.ReferenceEntryID != "" || !strings.Contains(edited.Body, "Locally edited") {
		t.Fatalf("edited = %#v, want preserved independent content", edited)
	}
}

func TestServiceRejectsCopyIntoNonLocalPack(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	if _, err := store.ListEntries(ctx, instructionpack.KindSkill); err != nil {
		t.Fatalf("ListEntries() error = %v", err)
	}
	_, err := store.CopyEntries(ctx, DefaultPackID, []EntryReference{
		{PackID: DefaultPackID, Kind: instructionpack.KindSkill, Slug: "character-writer"},
	})
	if !errors.Is(err, ErrInvalidPack) {
		t.Fatalf("CopyEntries(default) error = %v, want ErrInvalidPack for same target", err)
	}

	if _, err := store.CreatePack(ctx, Pack{ID: "company.source-pack", Name: "Source"}); err != nil {
		t.Fatalf("CreatePack() error = %v", err)
	}
	if _, err := store.CreateEntry(ctx, instructionpack.KindSkill, Entry{
		PackID: "company.source-pack",
		Slug:   "source-skill",
		Name:   "source-skill",
		Body:   "Source body",
	}); err != nil {
		t.Fatalf("CreateEntry() error = %v", err)
	}
	_, err = store.CopyEntries(ctx, DefaultPackID, []EntryReference{
		{PackID: "company.source-pack", Kind: instructionpack.KindSkill, Slug: "source-skill"},
	})
	if !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("CopyEntries(default) error = %v, want ErrPackReadonly", err)
	}
}

func TestServiceFormalPackExportsUnprotectedV1Snapshot(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	raw, err := os.ReadFile(writeTestMGPack(t))
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	installed, err := store.InstallDataWithProvenance(ctx, "test.mgpack", raw, InstallProvenance{
		PackageID: "com.example.test",
		ReleaseID: "release-1",
		Version:   "1.0.0",
	})
	if err != nil {
		t.Fatalf("InstallDataWithProvenance() error = %v", err)
	}
	exported, err := store.ExportPack(ctx, installed.ID)
	if err != nil {
		t.Fatalf("ExportPack() error = %v", err)
	}
	archive, err := codec.Decode(exported.Data)
	if err != nil {
		t.Fatalf("Decode(exported formal pack) error = %v", err)
	}
	exportedBundle, err := instructionpack.ParseZip(ctx, archive)
	if err != nil {
		t.Fatalf("ParseZip(exported formal pack) error = %v", err)
	}
	if exportedBundle.Manifest.ID != installed.ID {
		t.Fatalf("exported package id = %q, want %q", exportedBundle.Manifest.ID, installed.ID)
	}
	if _, err := store.ExportPackSnapshot(ctx, installed.ID); err != nil {
		t.Fatalf("ExportPackSnapshot() error = %v", err)
	}
	versioned, err := store.ExportPackSnapshotAtVersion(ctx, installed.ID, "1.0.7")
	if err != nil {
		t.Fatalf("ExportPackSnapshotAtVersion() error = %v", err)
	}
	archive, err = codec.Decode(versioned.Data)
	if err != nil {
		t.Fatalf("Decode(versioned snapshot) error = %v", err)
	}
	bundle, err := instructionpack.ParseZip(ctx, archive)
	if err != nil {
		t.Fatalf("ParseZip(versioned snapshot) error = %v", err)
	}
	if bundle.Manifest.Version != "1.0.7" || versioned.Pack.Version != "1.0.7" {
		t.Fatalf("versioned snapshot = %#v / %#v, want version 1.0.7", bundle.Manifest, versioned.Pack)
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
	entry, ok := findEntry(entries, "test-skill")
	if !ok || entry.Source != entrySourcePack {
		t.Fatalf("entries = %#v, want imported test-skill", entries)
	}
	if _, err := store.SavePackEntry(ctx, installed.ID, entry.ID, EntryUpdate{
		Description: "Changed",
		Body:        "Changed body",
	}); err != nil {
		t.Fatalf("SavePackEntry(imported skill) error = %v", err)
	}
	reset, err := store.ResetPackEntry(ctx, installed.ID, entry.ID)
	if err != nil {
		t.Fatalf("ResetPackEntry(imported skill) error = %v", err)
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

func TestServiceSavePackEntryTargetsExactDuplicateSlug(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	for _, packID := range []string{"company.duplicate-a", "company.duplicate-b"} {
		if _, err := store.CreatePack(ctx, Pack{ID: packID, Name: packID, Version: "1.0.0"}); err != nil {
			t.Fatalf("CreatePack(%s) error = %v", packID, err)
		}
		if err := store.repo.UpsertEntry(domain.PackEntryModel{
			ID:     instructionpack.EntryID(packID, instructionpack.KindPrompt, "shared-name"),
			PackID: packID,
			Kind:   string(instructionpack.KindPrompt),
			Slug:   "shared-name",
			Name:   "Shared prompt",
			Body:   "original " + packID,
			Source: entrySourceUser,
		}); err != nil {
			t.Fatalf("UpsertEntry(%s) error = %v", packID, err)
		}
	}

	targetID := instructionpack.EntryID("company.duplicate-b", instructionpack.KindPrompt, "shared-name")
	updated, err := store.SavePackEntry(ctx, "company.duplicate-b", targetID, EntryUpdate{
		Name: "Only B changed",
		Body: "updated B",
		Metadata: map[string]any{
			"category":                  "style",
			entryMetadataLinked:         true,
			entryMetadataCopiedFrom:     "malicious-reference",
			entryMetadataCopiedFromPack: "malicious-pack",
		},
	})
	if err != nil {
		t.Fatalf("SavePackEntry() error = %v", err)
	}
	if updated.PackID != "company.duplicate-b" || updated.Name != "Only B changed" || strings.TrimSpace(updated.Body) != "updated B" {
		t.Fatalf("updated = %#v, want exact entry in duplicate-b", updated)
	}
	if updated.Linked || updated.Metadata[entryMetadataCopiedFrom] != nil || updated.Metadata[entryMetadataCopiedFromPack] != nil {
		t.Fatalf("updated metadata = %#v, want reserved link metadata ignored", updated.Metadata)
	}

	otherModel, err := store.repo.GetEntry(
		instructionpack.EntryID("company.duplicate-a", instructionpack.KindPrompt, "shared-name"),
	)
	if err != nil {
		t.Fatalf("GetEntry(duplicate-a) error = %v", err)
	}
	other := entryFromModel(otherModel)
	if other.Name != "Shared prompt" || strings.TrimSpace(other.Body) != "original company.duplicate-a" {
		t.Fatalf("other = %#v, want duplicate-a unchanged", other)
	}
	if _, err := store.SavePackEntry(ctx, "company.duplicate-a", targetID, EntryUpdate{
		Name: "Wrong pack",
		Body: "wrong",
	}); !errors.Is(err, ErrEntryNotFound) {
		t.Fatalf("SavePackEntry(wrong pack) error = %v, want ErrEntryNotFound", err)
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
	if exported.FileName != "Test Pack-v1.0.0.mgpack" {
		t.Fatalf("exported filename = %q, want readable pack name and version", exported.FileName)
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

func TestReadablePackFileNamePreservesNameAndSanitizesPathCharacters(t *testing.T) {
	tests := []struct {
		name     string
		packName string
		packID   string
		version  string
		want     string
	}{
		{name: "Chinese name", packName: "测试风格", packID: "local.uuid", version: "1.0.0", want: "测试风格-v1.0.0.mgpack"},
		{name: "path characters", packName: "角色/场景:套装", packID: "local.uuid", version: "v2.1.0", want: "角色-场景-套装-v2.1.0.mgpack"},
		{name: "fallback to id", packID: "local.readable", version: "1.0.0", want: "local.readable-v1.0.0.mgpack"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := readablePackFileName(test.packName, test.packID, test.version); got != test.want {
				t.Fatalf("readablePackFileName() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestServiceInstallsFormalReleaseWithProvenance(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	path := writeTestMGPack(t)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	pack, err := store.InstallDataWithProvenance(ctx, filepath.Base(path), data, InstallProvenance{
		PackageID: "com.example.test",
		ReleaseID: "release-1",
		Version:   "1.0.1",
	})
	if err != nil {
		t.Fatalf("InstallDataWithProvenance() error = %v", err)
	}
	if pack.ReleaseID != "release-1" || pack.Version != "1.0.1" {
		t.Fatalf("pack release = %q v%s, want release-1 v1.0.1", pack.ReleaseID, pack.Version)
	}
	entry, err := store.GetEntry(ctx, instructionpack.KindSkill, "test-skill")
	if err != nil {
		t.Fatalf("GetEntry() error = %v", err)
	}
	if entry.PackID != pack.ID || entry.ReleaseID != "release-1" {
		t.Fatalf("entry provenance = %s/%s, want %s/release-1", entry.PackID, entry.ReleaseID, pack.ID)
	}
	if entry.SourcePackageID != pack.ID || entry.SourceReleaseID != "release-1" {
		t.Fatalf("content provenance = %s/%s, want %s/release-1", entry.SourcePackageID, entry.SourceReleaseID, pack.ID)
	}
	updated, err := store.SavePackEntry(ctx, pack.ID, entry.ID, EntryUpdate{
		Description: entry.Description,
		Body:        "local edit",
	})
	if err != nil {
		t.Fatalf("SavePackEntry() error = %v", err)
	}
	if updated.ReleaseID != "release-1" || updated.SourcePackageID != pack.ID || updated.SourceReleaseID != "release-1" {
		t.Fatalf("updated provenance = %#v, want original formal source", updated)
	}
	if _, err := store.ExportPack(ctx, pack.ID); err != nil {
		t.Fatalf("ExportPack(imported formal pack) error = %v", err)
	}
	recovered, err := store.PromoteImportedPackToLocal(ctx, pack.ID)
	if err != nil {
		t.Fatalf("PromoteImportedPackToLocal() error = %v", err)
	}
	if recovered.Source != packSourceLocal || recovered.ReleaseID != "release-1" || recovered.Origin != "" {
		t.Fatalf("recovered = %#v, want local draft with formal release history", recovered)
	}
	recoveredEntry, err := store.GetEntry(ctx, instructionpack.KindSkill, "test-skill")
	if err != nil {
		t.Fatalf("GetEntry(recovered) error = %v", err)
	}
	if recoveredEntry.Source != entrySourceUser || recoveredEntry.OverriddenFrom != "" || recoveredEntry.ReleaseID != "" || recoveredEntry.SourcePackageID != pack.ID || recoveredEntry.SourceReleaseID != "release-1" || strings.TrimSpace(recoveredEntry.Body) != "local edit" {
		t.Fatalf("recovered entry = %#v, want standalone local edit", recoveredEntry)
	}
	if _, err := store.CreatePack(ctx, Pack{ID: "com.example.derivative", Name: "Derivative"}); err != nil {
		t.Fatalf("CreatePack(derivative) error = %v", err)
	}
	copied, err := store.CopyEntries(ctx, "com.example.derivative", []EntryReference{{
		PackID: pack.ID,
		Kind:   instructionpack.KindSkill,
		Slug:   recoveredEntry.Slug,
	}})
	if err != nil {
		t.Fatalf("CopyEntries(formal source) error = %v", err)
	}
	if len(copied) != 1 || copied[0].SourcePackageID != pack.ID || copied[0].SourceReleaseID != "release-1" {
		t.Fatalf("copied provenance = %#v, want original formal source", copied)
	}
	if err := store.RemoveEntry(ctx, recovered.ID, recoveredEntry.ID); err != nil {
		t.Fatalf("RemoveEntry(recovered) error = %v", err)
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
	store := NewServiceFromRepository(
		repository.NewPackRepositoryFromDB(db),
		repository.NewPromptLibraryRepositoryFromDB(db),
		nil,
	).withTestPackFilesDir(t.TempDir())
	store.SetUnprotectedImportAllowed(true)
	return store
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
