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

func TestPackContentsRevisionIsStableAndChangesWithEditableContent(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	pack, err := store.CreatePack(ctx, Pack{ID: "company.revision-pack", Name: "Revision Pack"})
	if err != nil {
		t.Fatalf("CreatePack() error = %v", err)
	}
	if _, err := store.CreatePackCategory(ctx, pack.ID, Category{ID: "style", Label: "风格", Order: 0}); err != nil {
		t.Fatalf("CreatePackCategory() error = %v", err)
	}
	entry, err := store.CreatePackEntryDraft(ctx, pack.ID, instructionpack.KindPrompt, "cinematic", "style")
	if err != nil {
		t.Fatalf("CreatePackEntryDraft() error = %v", err)
	}
	entry, err = store.SavePackEntry(ctx, pack.ID, entry.ID, EntryUpdate{
		Name: "电影感", Body: "cinematic", Metadata: map[string]any{"category": "style", "nested": map[string]any{"b": 2, "a": 1}},
	})
	if err != nil {
		t.Fatalf("SavePackEntry() error = %v", err)
	}

	first, err := store.GetPackContents(ctx, pack.ID)
	if err != nil {
		t.Fatalf("GetPackContents() error = %v", err)
	}
	second, err := store.GetPackContents(ctx, pack.ID)
	if err != nil {
		t.Fatalf("GetPackContents() second error = %v", err)
	}
	if first.Revision == "" || second.Revision != first.Revision {
		t.Fatalf("revisions first=%q second=%q, want stable non-empty revision", first.Revision, second.Revision)
	}

	if _, err := store.SavePackEntry(ctx, pack.ID, entry.ID, EntryUpdate{
		Name: "电影感", Body: "updated cinematic", Metadata: map[string]any{"nested": map[string]any{"a": 1, "b": 2}, "category": "style"},
	}); err != nil {
		t.Fatalf("SavePackEntry(updated) error = %v", err)
	}
	updated, err := store.GetPackContents(ctx, pack.ID)
	if err != nil {
		t.Fatalf("GetPackContents(updated) error = %v", err)
	}
	if updated.Revision == first.Revision {
		t.Fatalf("updated revision = %q, want different from %q", updated.Revision, first.Revision)
	}
}

func TestPackContentsRevisionIgnoresSliceAndMetadataMapOrder(t *testing.T) {
	entries := []Entry{
		{ID: "entry-b", PackID: "company.revision-order", Kind: instructionpack.KindPrompt, Slug: "b", Name: "B", Body: "B", Metadata: map[string]any{"z": 2, "a": 1}},
		{ID: "entry-a", PackID: "company.revision-order", Kind: instructionpack.KindSkill, Slug: "a", Name: "A", Body: "A"},
	}
	categories := []Category{
		{ID: "second", PackID: "company.revision-order", Label: "Second", Order: 1, Source: entrySourceUser},
		{ID: "first", PackID: "company.revision-order", Label: "First", Order: 0, Source: entrySourceUser},
	}
	first, err := revisionForPackContents(entries, categories)
	if err != nil {
		t.Fatalf("revisionForPackContents() error = %v", err)
	}
	entries[0].Metadata = map[string]any{"a": 1, "z": 2}
	second, err := revisionForPackContents([]Entry{entries[1], entries[0]}, []Category{categories[1], categories[0]})
	if err != nil {
		t.Fatalf("revisionForPackContents(reordered) error = %v", err)
	}
	if first != second {
		t.Fatalf("revisions first=%q second=%q, want order-independent digest", first, second)
	}
}

func TestSavePackDraftAppliesMixedChangesAtomically(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	pack, err := store.CreatePack(ctx, Pack{ID: "company.atomic-draft", Name: "Atomic Draft"})
	if err != nil {
		t.Fatalf("CreatePack() error = %v", err)
	}
	if _, err := store.CreatePackCategory(ctx, pack.ID, Category{ID: "old", Label: "旧分组", Order: 0}); err != nil {
		t.Fatalf("CreatePackCategory() error = %v", err)
	}
	old, err := store.CreatePackEntryDraft(ctx, pack.ID, instructionpack.KindPrompt, "old-prompt", "old")
	if err != nil {
		t.Fatalf("CreatePackEntryDraft(old) error = %v", err)
	}
	before, err := store.GetPackContents(ctx, pack.ID)
	if err != nil {
		t.Fatalf("GetPackContents() error = %v", err)
	}
	newEntry := Entry{
		ID:   instructionpack.EntryID(pack.ID, instructionpack.KindSkill, "new-skill"),
		Kind: instructionpack.KindSkill, Slug: "new-skill", Title: "新 Skill", Description: "草稿内容", Body: "body",
	}
	after, err := store.SavePackDraft(ctx, pack.ID, SavePackDraftInput{
		BaseRevision: before.Revision,
		Entries:      []Entry{newEntry},
		Categories:   []Category{{ID: "new", Label: "新分组", Order: 0}},
	})
	if err != nil {
		t.Fatalf("SavePackDraft() error = %v", err)
	}
	if after.Revision == before.Revision {
		t.Fatalf("revision = %q, want change after atomic save", after.Revision)
	}
	if len(after.Entries) != 1 || after.Entries[0].Slug != "new-skill" || strings.TrimSpace(after.Entries[0].Body) != "body" {
		t.Fatalf("entries = %#v, want only new-skill", after.Entries)
	}
	if len(after.Categories) != 1 || after.Categories[0].ID != "new" {
		t.Fatalf("categories = %#v, want only new", after.Categories)
	}
	if _, err := store.getPackEntry(pack.ID, old.ID); !errors.Is(err, ErrEntryNotFound) {
		t.Fatalf("getPackEntry(deleted) error = %v, want ErrEntryNotFound", err)
	}
}

func TestSavePackDraftRejectsStaleRevisionWithoutPartialWrites(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	pack, err := store.CreatePack(ctx, Pack{ID: "company.conflict-draft", Name: "Conflict Draft"})
	if err != nil {
		t.Fatalf("CreatePack() error = %v", err)
	}
	before, err := store.GetPackContents(ctx, pack.ID)
	if err != nil {
		t.Fatalf("GetPackContents() error = %v", err)
	}
	if _, err := store.CreatePackCategory(ctx, pack.ID, Category{ID: "newer", Label: "服务器新内容", Order: 0}); err != nil {
		t.Fatalf("CreatePackCategory() error = %v", err)
	}
	_, err = store.SavePackDraft(ctx, pack.ID, SavePackDraftInput{
		BaseRevision: before.Revision,
		Categories:   []Category{{ID: "stale", Label: "过期草稿", Order: 0}},
	})
	if !errors.Is(err, ErrPackConflict) {
		t.Fatalf("SavePackDraft() error = %v, want ErrPackConflict", err)
	}
	after, err := store.GetPackContents(ctx, pack.ID)
	if err != nil {
		t.Fatalf("GetPackContents(after conflict) error = %v", err)
	}
	if len(after.Categories) != 1 || after.Categories[0].ID != "newer" {
		t.Fatalf("categories = %#v, want newer server state unchanged", after.Categories)
	}
}

func TestSavePackDraftRejectsReadonlyPacks(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	contents, err := store.GetPackContents(ctx, DefaultPackID)
	if err != nil {
		t.Fatalf("GetPackContents(default) error = %v", err)
	}
	_, err = store.SavePackDraft(ctx, DefaultPackID, SavePackDraftInput{
		BaseRevision: contents.Revision,
		Entries:      contents.Entries,
		Categories:   contents.Categories,
	})
	if !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("SavePackDraft(default) error = %v, want ErrPackReadonly", err)
	}
}

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
	if err := store.Uninstall(ctx, DefaultPackID); !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("Uninstall(default) error = %v, want ErrPackReadonly", err)
	}
	if _, err := store.GetPack(ctx, DefaultPackID); err != nil {
		t.Fatalf("GetPack(default) after rejected uninstall error = %v", err)
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

func TestServiceUpdatesOnlyLocalPackMetadata(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	local, err := store.CreatePack(ctx, Pack{
		ID:          "company.metadata-pack",
		Name:        "Before",
		Description: "Old description",
	})
	if err != nil {
		t.Fatalf("CreatePack() error = %v", err)
	}
	updated, err := store.UpdatePackMetadata(ctx, local.ID, UpdatePackMetadataInput{
		Name:        " Updated name ",
		Description: " Updated description ",
	})
	if err != nil {
		t.Fatalf("UpdatePackMetadata(local) error = %v", err)
	}
	if updated.Name != "Updated name" || updated.Description != "Updated description" {
		t.Fatalf("updated = %#v, want trimmed metadata", updated)
	}
	if _, err := store.UpdatePackMetadata(ctx, DefaultPackID, UpdatePackMetadataInput{
		Name: "Changed default",
	}); !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("UpdatePackMetadata(default) error = %v, want ErrPackReadonly", err)
	}
	model, err := store.repo.GetPack(local.ID)
	if err != nil {
		t.Fatalf("GetPack(local) error = %v", err)
	}
	model.Source = packSourceImported
	if err := store.repo.UpsertPack(model); err != nil {
		t.Fatalf("UpsertPack(imported) error = %v", err)
	}
	if _, err := store.UpdatePackMetadata(ctx, local.ID, UpdatePackMetadataInput{
		Name: "Changed imported",
	}); !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("UpdatePackMetadata(imported) error = %v, want ErrPackReadonly", err)
	}
}

func TestServiceFormalReimportPreservesExistingLocalAuthoringPack(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	local, err := store.CreatePack(ctx, Pack{
		ID: "com.example.test", Name: "My Test Pack", Version: "0.9.0", Description: "Local draft",
	})
	if err != nil {
		t.Fatalf("CreatePack() error = %v", err)
	}
	draft, err := store.CreatePackEntryDraft(ctx, local.ID, instructionpack.KindSkill, "test-skill", "")
	if err != nil {
		t.Fatalf("CreatePackEntryDraft() error = %v", err)
	}
	if _, err := store.SavePackEntry(ctx, local.ID, draft.ID, EntryUpdate{
		Name: "Local Skill", Description: "Locally authored", Body: "local working copy",
	}); err != nil {
		t.Fatalf("SavePackEntry() error = %v", err)
	}
	raw, err := os.ReadFile(writeTestMGPack(t))
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}

	reimported, err := store.InstallDataWithProvenance(ctx, "reviewed.mgpack", raw, InstallProvenance{
		PackageID: local.ID, ReleaseID: "release-reviewed", Version: "1.0.0",
	})
	if err != nil {
		t.Fatalf("InstallDataWithProvenance() error = %v", err)
	}
	if reimported.Source != packSourceLocal || reimported.Name != local.Name || reimported.Description != local.Description {
		t.Fatalf("reimported = %#v, want existing local ownership and metadata", reimported)
	}
	if reimported.ReleaseID != "release-reviewed" || reimported.Version != "1.0.0" || reimported.Origin != "" {
		t.Fatalf("reimported = %#v, want reviewed release linked without imported origin", reimported)
	}
	contents, err := store.GetPackContents(ctx, local.ID)
	if err != nil {
		t.Fatalf("GetPackContents() error = %v", err)
	}
	preserved, ok := findEntry(contents.Entries, "test-skill")
	if !ok || preserved.Source != entrySourceUser || strings.TrimSpace(preserved.Body) != "local working copy" {
		t.Fatalf("preserved entry = %#v, want untouched local working copy", preserved)
	}
	if _, err := store.ExportPack(ctx, local.ID); err != nil {
		t.Fatalf("ExportPack(reimported local) error = %v", err)
	}
}

func TestServiceReturnsAndManagesPackScopedCategories(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	pack, err := store.CreatePack(ctx, Pack{
		ID:      "company.category-pack",
		Name:    "Category Pack",
		Version: "1.0.0",
	})
	if err != nil {
		t.Fatalf("CreatePack() error = %v", err)
	}
	if _, err := store.CreatePackCategory(ctx, pack.ID, Category{
		ID:    "shots",
		Label: "镜头",
		Order: 2,
	}); err != nil {
		t.Fatalf("CreatePackCategory(shots) error = %v", err)
	}
	if _, err := store.CreatePackCategory(ctx, pack.ID, Category{
		ID:    "looks",
		Label: "造型",
		Order: 1,
	}); err != nil {
		t.Fatalf("CreatePackCategory(looks) error = %v", err)
	}

	contents, err := store.GetPackContents(ctx, pack.ID)
	if err != nil {
		t.Fatalf("GetPackContents() error = %v", err)
	}
	if len(contents.Categories) != 2 || contents.Categories[0].ID != "looks" || contents.Categories[1].ID != "shots" {
		t.Fatalf("categories = %#v, want pack-scoped categories in stored order", contents.Categories)
	}
	for _, category := range contents.Categories {
		if category.PackID != pack.ID || category.Source != entrySourceUser {
			t.Fatalf("category = %#v, want user category owned by %q", category, pack.ID)
		}
	}

	updated, err := store.UpdatePackCategory(ctx, pack.ID, "shots", Category{
		Label: "镜头语言",
		Order: 0,
	})
	if err != nil {
		t.Fatalf("UpdatePackCategory() error = %v", err)
	}
	if updated.ID != "shots" || updated.Label != "镜头语言" || updated.Order != 0 {
		t.Fatalf("updated category = %#v", updated)
	}

	prompt, err := store.CreatePackEntryDraft(ctx, pack.ID, instructionpack.KindPrompt, "camera-prompt", "")
	if err != nil {
		t.Fatalf("CreatePackEntryDraft() error = %v", err)
	}
	prompt, err = store.SavePackEntry(ctx, pack.ID, prompt.ID, EntryUpdate{
		Name:     "Camera Prompt",
		Body:     "Use a long lens.",
		Metadata: map[string]any{"category": "shots", "legacyFlag": "keep"},
	})
	if err != nil {
		t.Fatalf("SavePackEntry() error = %v", err)
	}
	if err := store.DeletePackCategory(ctx, pack.ID, "shots", "looks"); err != nil {
		t.Fatalf("DeletePackCategory() error = %v", err)
	}
	contents, err = store.GetPackContents(ctx, pack.ID)
	if err != nil {
		t.Fatalf("GetPackContents(after delete) error = %v", err)
	}
	if len(contents.Categories) != 1 || contents.Categories[0].ID != "looks" {
		t.Fatalf("categories after delete = %#v, want only looks", contents.Categories)
	}
	prompt, ok := findEntry(contents.Entries, prompt.Slug)
	if !ok || prompt.Metadata["category"] != "looks" || prompt.Metadata["legacyFlag"] != "keep" {
		t.Fatalf("prompt after category delete = %#v, want reassigned metadata", prompt)
	}

	defaultContents, err := store.GetPackContents(ctx, DefaultPackID)
	if err != nil {
		t.Fatalf("GetPackContents(default) error = %v", err)
	}
	if len(defaultContents.Categories) == 0 || hasCategory(contents.Categories, "style", "风格") {
		t.Fatalf("pack categories leaked across packs: local=%#v default=%#v", contents.Categories, defaultContents.Categories)
	}
	packageCategory := defaultContents.Categories[0]
	_, err = store.UpdatePackCategory(ctx, DefaultPackID, packageCategory.ID, Category{
		Label: packageCategory.Label + " changed",
		Order: packageCategory.Order,
	})
	if !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("UpdatePackCategory(default) error = %v, want ErrPackReadonly", err)
	}
	replacementCategory := defaultContents.Categories[1]
	if err := store.DeletePackCategory(ctx, DefaultPackID, packageCategory.ID, replacementCategory.ID); !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("DeletePackCategory(default) error = %v, want ErrPackReadonly", err)
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
	if _, err := store.CreatePackCategory(ctx, pack.ID, Category{
		ID:    "storyboard",
		Label: "分镜",
		Order: 0,
	}); err != nil {
		t.Fatalf("CreatePackCategory() error = %v", err)
	}

	prompt, err := store.CreatePackEntryDraft(
		ctx,
		pack.ID,
		instructionpack.KindPrompt,
		"prompt-draft",
		"storyboard",
	)
	if err != nil {
		t.Fatalf("CreatePackEntryDraft(prompt) error = %v", err)
	}
	if prompt.Name != "未命名提示词" || prompt.Body != "" || prompt.Source != entrySourceUser {
		t.Fatalf("prompt draft = %#v, want an empty user draft", prompt)
	}
	if prompt.Metadata["category"] != "storyboard" {
		t.Fatalf("prompt category = %#v, want storyboard", prompt.Metadata)
	}
	if _, err := store.CreatePackEntryDraft(
		ctx,
		pack.ID,
		instructionpack.KindPrompt,
		"unknown-category",
		"missing",
	); !errors.Is(err, ErrCategoryNotFound) {
		t.Fatalf("CreatePackEntryDraft(unknown category) error = %v, want ErrCategoryNotFound", err)
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

	skill, err := store.CreatePackEntryDraft(ctx, pack.ID, instructionpack.KindSkill, "skill-draft", "")
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

	_, err = store.CreatePackEntryDraft(
		ctx,
		DefaultPackID,
		instructionpack.KindPrompt,
		"builtin-user-draft",
		"",
	)
	if !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("CreatePackEntryDraft(default) error = %v, want ErrPackReadonly", err)
	}
}

func TestServiceRemovesExactFormalPackEntryAsHiddenOverlay(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	contents, err := store.GetPackContents(ctx, DefaultPackID)
	if err != nil {
		t.Fatalf("GetPackContents(default) error = %v", err)
	}
	var target Entry
	for _, entry := range contents.Entries {
		if entry.Kind == instructionpack.KindSkill && entry.Slug == "character-writer" {
			target = entry
			break
		}
	}
	if target.ID == "" {
		t.Fatal("default character-writer entry not found")
	}

	if err := store.RemoveEntry(ctx, DefaultPackID, target.ID); !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("RemoveEntry(default) error = %v, want ErrPackReadonly", err)
	}

	if _, err := store.ResetPack(ctx, DefaultPackID); !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("ResetPack(default) error = %v, want ErrPackReadonly", err)
	}
	restoredContents, err := store.GetPackContents(ctx, DefaultPackID)
	if err != nil {
		t.Fatalf("GetPackContents(restored default) error = %v", err)
	}
	restored := false
	for _, entry := range restoredContents.Entries {
		if entry.ID == target.ID {
			restored = true
			break
		}
	}
	if !restored {
		t.Fatalf("reset did not restore %q", target.ID)
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
	if _, err := store.ExportPack(ctx, installed.ID); !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("ExportPack() error = %v, want ErrPackReadonly", err)
	}
	exported, err := store.ExportPackSnapshot(ctx, installed.ID)
	if err != nil {
		t.Fatalf("ExportPackSnapshot() error = %v", err)
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

func TestServiceImportedPackManagementAccess(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	installed, err := store.InstallPath(ctx, writeTestMGPack(t))
	if err != nil {
		t.Fatalf("InstallPath() error = %v", err)
	}
	entries, err := store.ListEntries(ctx, instructionpack.KindSkill)
	if err != nil {
		t.Fatalf("ListEntries() error = %v", err)
	}
	entry, ok := findEntry(entries, "test-skill")
	if !ok {
		t.Fatalf("entries = %#v, want imported test-skill available to runtime", entries)
	}
	local, err := store.CreatePack(ctx, Pack{ID: "local.import-copy-target", Name: "Copy Target"})
	if err != nil {
		t.Fatalf("CreatePack(copy target) error = %v", err)
	}

	tests := []struct {
		name string
		run  func() error
	}{
		{name: "contents", run: func() error { _, err := store.GetPackContents(ctx, installed.ID); return err }},
		{name: "export", run: func() error { _, err := store.ExportPack(ctx, installed.ID); return err }},
		{name: "fork", run: func() error {
			_, err := store.ForkPack(ctx, installed.ID, ForkPackInput{Name: "Copy", Version: "1.0.0"})
			return err
		}},
		{name: "reset pack", run: func() error { _, err := store.ResetPack(ctx, installed.ID); return err }},
		{name: "create entry", run: func() error {
			_, err := store.CreatePackEntryDraft(ctx, installed.ID, instructionpack.KindSkill, "new-skill", "")
			return err
		}},
		{name: "save entry", run: func() error {
			_, err := store.SavePackEntry(ctx, installed.ID, entry.ID, EntryUpdate{Name: "Changed", Body: "Changed"})
			return err
		}},
		{name: "reset entry", run: func() error { _, err := store.ResetPackEntry(ctx, installed.ID, entry.ID); return err }},
		{name: "remove entry", run: func() error { return store.RemoveEntry(ctx, installed.ID, entry.ID) }},
		{name: "copy entry as source", run: func() error {
			_, err := store.CopyEntries(ctx, local.ID, []EntryReference{{
				PackID: installed.ID, Kind: instructionpack.KindSkill, Slug: entry.Slug,
			}})
			return err
		}},
		{name: "legacy save entry", run: func() error {
			_, err := store.SaveEntry(ctx, instructionpack.KindSkill, entry.Slug, Entry{
				Name: "test-skill", Description: "Changed", Body: "Changed",
			})
			return err
		}},
		{name: "legacy reset entry", run: func() error {
			_, err := store.ResetEntry(ctx, instructionpack.KindSkill, entry.Slug)
			return err
		}},
		{name: "legacy hide entry", run: func() error { return store.HideEntry(ctx, instructionpack.KindSkill, entry.Slug) }},
		{name: "create category", run: func() error {
			_, err := store.CreatePackCategory(ctx, installed.ID, Category{ID: "new", Label: "New"})
			return err
		}},
		{name: "update category", run: func() error {
			_, err := store.UpdatePackCategory(ctx, installed.ID, "missing", Category{Label: "Changed"})
			return err
		}},
		{name: "delete category", run: func() error {
			return store.DeletePackCategory(ctx, installed.ID, "missing", "replacement")
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := test.run(); !errors.Is(err, ErrPackReadonly) {
				t.Fatalf("operation error = %v, want ErrPackReadonly", err)
			}
		})
	}

	disabled, err := store.SetEnabled(ctx, installed.ID, false)
	if err != nil {
		t.Fatalf("SetEnabled(false) error = %v", err)
	}
	if disabled.Enabled {
		t.Fatalf("SetEnabled(false) = %#v, want disabled imported pack", disabled)
	}
	if err := store.Uninstall(ctx, installed.ID); err != nil {
		t.Fatalf("Uninstall() error = %v", err)
	}
}

func TestServiceRejectsHidingDefaultEntryAcrossBuiltinSeed(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	if _, err := store.GetEntry(ctx, instructionpack.KindPrompt, "image-character-concept"); err != nil {
		t.Fatalf("GetEntry() before hide error = %v", err)
	}
	if err := store.HideEntry(ctx, instructionpack.KindPrompt, "image-character-concept"); !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("HideEntry() error = %v, want ErrPackReadonly", err)
	}

	store.seeded = false
	entries, err := store.ListEntries(ctx, instructionpack.KindPrompt)
	if err != nil {
		t.Fatalf("ListEntries() after reseed error = %v", err)
	}
	if _, ok := findEntry(entries, "image-character-concept"); !ok {
		t.Fatalf("entries = %#v, want readonly default entry to survive reseed", entries)
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
	data, err := os.ReadFile(writeTestMGPack(t))
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	installed, err := source.InstallDataWithProvenance(ctx, "test.mgpack", data, InstallProvenance{
		PackageID: "com.example.test",
		ReleaseID: "release-export-test",
		Version:   "1.0.0",
	})
	if err != nil {
		t.Fatalf("InstallDataWithProvenance() error = %v", err)
	}
	if _, err := source.PromoteImportedPackToLocal(ctx, installed.ID); err != nil {
		t.Fatalf("PromoteImportedPackToLocal() error = %v", err)
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
	repeated, err := target.InstallData(ctx, exported.FileName, exported.Data)
	if err != nil {
		t.Fatalf("InstallData(repeated identical file) error = %v", err)
	}
	if repeated.ID != imported.ID {
		t.Fatalf("repeated import = %#v, want existing pack %q", repeated, imported.ID)
	}
	bundle.Manifest.Description = "Conflicting package contents"
	conflicting, err := encodeBundle(bundle)
	if err != nil {
		t.Fatalf("encodeBundle(conflicting) error = %v", err)
	}
	if _, err := target.InstallData(ctx, exported.FileName, conflicting); !errors.Is(err, ErrPackExists) {
		t.Fatalf("InstallData(conflicting same id) error = %v, want ErrPackExists", err)
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
	if _, err := store.SavePackEntry(ctx, pack.ID, entry.ID, EntryUpdate{
		Description: entry.Description,
		Body:        "local edit",
	}); !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("SavePackEntry(imported) error = %v, want ErrPackReadonly", err)
	}
	if _, err := store.ExportPack(ctx, pack.ID); !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("ExportPack(imported formal pack) error = %v, want ErrPackReadonly", err)
	}
	recovered, err := store.PromoteImportedPackToLocal(ctx, pack.ID)
	if err != nil {
		t.Fatalf("PromoteImportedPackToLocal() error = %v", err)
	}
	if recovered.Source != packSourceLocal || recovered.ReleaseID != "release-1" || recovered.Origin != "" {
		t.Fatalf("recovered = %#v, want local draft with formal release history", recovered)
	}
	updated, err := store.SavePackEntry(ctx, pack.ID, entry.ID, EntryUpdate{
		Description: entry.Description,
		Body:        "local edit",
	})
	if err != nil {
		t.Fatalf("SavePackEntry(recovered) error = %v", err)
	}
	if updated.ReleaseID != "" || updated.SourcePackageID != pack.ID || updated.SourceReleaseID != "release-1" {
		t.Fatalf("updated provenance = %#v, want original formal source", updated)
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

func TestServiceForksDefaultPackAsImportableMGPack(t *testing.T) {
	ctx := context.Background()
	source := newTestService(t)
	if _, err := source.SaveEntry(ctx, instructionpack.KindSkill, "character-writer", Entry{
		Slug:        "character-writer",
		Name:        "character-writer",
		Description: "Changed default skill",
		Body:        "Changed default pack body",
	}); !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("SaveEntry(default skill) error = %v, want ErrPackReadonly", err)
	}
	if _, err := source.ExportPack(ctx, DefaultPackID); !errors.Is(err, ErrPackReadonly) {
		t.Fatalf("ExportPack(default) error = %v, want ErrPackReadonly", err)
	}
	forked, err := source.ForkPack(ctx, DefaultPackID, ForkPackInput{
		Name:        "My Default Pack",
		Version:     "1.0.0",
		Description: "Standalone default pack copy",
	})
	if err != nil {
		t.Fatalf("ForkPack(default) error = %v", err)
	}
	if !strings.HasPrefix(forked.ID, "local.") || forked.ID == DefaultPackID || forked.Source != packSourceLocal {
		t.Fatalf("forked = %#v, want standalone local pack", forked)
	}
	secondFork, err := source.ForkPack(ctx, DefaultPackID, ForkPackInput{Name: "Another Copy"})
	if err != nil {
		t.Fatalf("ForkPack(default second) error = %v", err)
	}
	if secondFork.ID == forked.ID {
		t.Fatalf("fork ids = %q, want unique ids", forked.ID)
	}

	exported, err := source.ExportPack(ctx, forked.ID)
	if err != nil {
		t.Fatalf("ExportPack(fork) error = %v", err)
	}
	repeatedExport, err := source.ExportPack(ctx, forked.ID)
	if err != nil {
		t.Fatalf("ExportPack(fork repeated) error = %v", err)
	}
	if repeatedExport.Pack.ID != forked.ID {
		t.Fatalf("repeated export pack id = %q, want %q", repeatedExport.Pack.ID, forked.ID)
	}
	archive, err := codec.Decode(exported.Data)
	if err != nil {
		t.Fatalf("Decode(default export) error = %v", err)
	}
	bundle, err := instructionpack.ParseZip(ctx, archive)
	if err != nil {
		t.Fatalf("ParseZip(default export) error = %v", err)
	}
	if bundle.Manifest.ID != forked.ID {
		t.Fatalf("bundle manifest id = %q, want %q", bundle.Manifest.ID, forked.ID)
	}
	if entry, ok := findPackEntry(bundle.Entries, "character-writer"); !ok || strings.Contains(entry.Body, "Changed default pack body") {
		t.Fatalf("exported fork entries = %#v, want original default content", bundle.Entries)
	}

	target := newTestService(t)
	imported, err := target.InstallData(ctx, exported.FileName, exported.Data)
	if err != nil {
		t.Fatalf("InstallData(default export) error = %v", err)
	}
	if imported.ID != forked.ID || imported.Source != packSourceImported {
		t.Fatalf("imported = %#v, want importable default export pack", imported)
	}
	entry, err := target.GetEntry(ctx, instructionpack.KindSkill, "character-writer")
	if err != nil {
		t.Fatalf("GetEntry(imported default skill) error = %v", err)
	}
	if entry.PackID != forked.ID || strings.Contains(entry.Body, "Changed default pack body") || entry.SourcePackageID != "" || entry.SourceReleaseID != "" {
		t.Fatalf("entry = %#v, want imported fork with original default content to override builtin", entry)
	}
	if _, err := target.SetEnabled(ctx, forked.ID, false); err != nil {
		t.Fatalf("SetEnabled(default export false) error = %v", err)
	}
	reset, err := target.GetEntry(ctx, instructionpack.KindSkill, "character-writer")
	if err != nil {
		t.Fatalf("GetEntry(disabled default export skill) error = %v", err)
	}
	if reset.PackID == forked.ID || strings.Contains(reset.Body, "Changed default pack body") {
		t.Fatalf("entry = %#v, want disabling imported export to reveal builtin", reset)
	}
}

func TestServiceDefaultPackIsReadonlyExceptForFork(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	contents, err := store.GetPackContents(ctx, DefaultPackID)
	if err != nil {
		t.Fatalf("GetPackContents(default) error = %v", err)
	}
	var entry Entry
	for _, candidate := range contents.Entries {
		if candidate.Kind == instructionpack.KindSkill {
			entry = candidate
			break
		}
	}
	if entry.ID == "" {
		t.Fatal("default pack has no Skill entry")
	}

	operations := []struct {
		name string
		run  func() error
	}{
		{name: "save entry", run: func() error {
			_, err := store.SavePackEntry(ctx, DefaultPackID, entry.ID, EntryUpdate{Name: entry.Title, Body: entry.Body})
			return err
		}},
		{name: "reset entry", run: func() error {
			_, err := store.ResetPackEntry(ctx, DefaultPackID, entry.ID)
			return err
		}},
		{name: "remove entry", run: func() error { return store.RemoveEntry(ctx, DefaultPackID, entry.ID) }},
		{name: "create entry", run: func() error {
			_, err := store.CreatePackEntryDraft(ctx, DefaultPackID, instructionpack.KindSkill, "readonly-test", "")
			return err
		}},
		{name: "reset pack", run: func() error {
			_, err := store.ResetPack(ctx, DefaultPackID)
			return err
		}},
		{name: "export pack", run: func() error {
			_, err := store.ExportPack(ctx, DefaultPackID)
			return err
		}},
	}
	for _, operation := range operations {
		t.Run(operation.name, func(t *testing.T) {
			if err := operation.run(); !errors.Is(err, ErrPackReadonly) {
				t.Fatalf("operation error = %v, want ErrPackReadonly", err)
			}
		})
	}

	if _, err := store.ForkPack(ctx, DefaultPackID, ForkPackInput{Name: "Editable Copy"}); err != nil {
		t.Fatalf("ForkPack(default) error = %v, want editable local copy", err)
	}
}

func TestServiceForksLocalPackAsIndependentLocalCopy(t *testing.T) {
	ctx := context.Background()
	store := newTestService(t)
	source, err := store.CreatePack(ctx, Pack{
		ID:          "local.copy-source",
		Name:        "Copy Source",
		Version:     "2.0.0",
		Author:      "MediaGo",
		Description: "Original description",
	})
	if err != nil {
		t.Fatalf("CreatePack() error = %v", err)
	}

	copied, err := store.ForkPack(ctx, source.ID, ForkPackInput{
		Name:        "Copy Source Copy",
		Version:     "2.1.0",
		Description: "Independent copy",
	})
	if err != nil {
		t.Fatalf("ForkPack(local) error = %v", err)
	}
	if !strings.HasPrefix(copied.ID, "local.") || copied.ID == source.ID || copied.Source != packSourceLocal {
		t.Fatalf("copied = %#v, want independent local pack", copied)
	}
	if copied.Name != "Copy Source Copy" || copied.Version != "2.1.0" || copied.Description != "Independent copy" || copied.Author != source.Author {
		t.Fatalf("copied metadata = %#v, want requested metadata and source author", copied)
	}
}

func TestServiceExportsForkedDefaultPackWithUserUnicodeCategory(t *testing.T) {
	ctx := context.Background()
	source := newTestService(t)
	forked, err := source.ForkPack(ctx, DefaultPackID, ForkPackInput{Name: "Unicode Categories"})
	if err != nil {
		t.Fatalf("ForkPack(default) error = %v", err)
	}
	if _, err := source.CreatePackCategory(ctx, forked.ID, Category{ID: "角色", Label: "角色"}); err != nil {
		t.Fatalf("CreatePackCategory() error = %v", err)
	}
	if _, err := source.CreateEntry(ctx, instructionpack.KindPrompt, Entry{
		PackID: forked.ID,
		Slug:   "character-reference",
		Name:   "角色参考",
		Body:   "保持角色一致。",
		Metadata: map[string]any{
			"category": "角色",
			"type":     "image",
		},
	}); err != nil {
		t.Fatalf("CreateEntry(prompt) error = %v", err)
	}

	exported, err := source.ExportPack(ctx, forked.ID)
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
	if imported.ID != forked.ID || imported.Source != packSourceImported {
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
	if prompt.PackID != forked.ID || metadataString(prompt.Metadata, "category") != "角色" {
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
