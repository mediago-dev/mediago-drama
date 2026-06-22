package repository

import (
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

func TestDocumentSectionRepositoryUpsertAndMarkMissing(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	seedRepositoryProject(t, db, "project-sections")
	repo := NewDocumentSectionRepositoryFromDB(db)

	now := domain.TimeFromString("2026-06-22T00:00:00Z")
	if err := repo.UpsertObservedSections([]domain.DocumentSectionModel{
		{
			ProjectID:     "project-sections",
			SectionID:     "section_role",
			DocumentID:    "doc-character",
			Type:          "character",
			Title:         "林书彤",
			MetadataJSON:  `{"locked":true}`,
			Status:        "active",
			ObservedTitle: "林书彤",
			HeadingLevel:  2,
			HeadingPath:   "角色册 / 林书彤",
			LineStart:     3,
			LineEnd:       8,
			ContentHash:   "hash-a",
			CreatedAt:     now,
			UpdatedAt:     now,
			LastSeenAt:    &now,
		},
	}); err != nil {
		t.Fatalf("UpsertObservedSections() error = %v", err)
	}

	later := domain.TimeFromString("2026-06-22T00:01:00Z")
	if err := repo.UpsertObservedSections([]domain.DocumentSectionModel{
		{
			ProjectID:     "project-sections",
			SectionID:     "section_role",
			DocumentID:    "doc-character",
			Type:          "scene",
			Title:         "被扫描覆盖的标题",
			MetadataJSON:  `{}`,
			Status:        "active",
			ObservedTitle: "林书彤（改名）",
			HeadingLevel:  2,
			HeadingPath:   "角色册 / 林书彤（改名）",
			LineStart:     10,
			LineEnd:       15,
			ContentHash:   "hash-b",
			CreatedAt:     later,
			UpdatedAt:     later,
			LastSeenAt:    &later,
		},
	}); err != nil {
		t.Fatalf("UpsertObservedSections(second) error = %v", err)
	}

	sections, err := repo.ListProjectSections("project-sections")
	if err != nil {
		t.Fatalf("ListProjectSections() error = %v", err)
	}
	if len(sections) != 1 {
		t.Fatalf("sections len = %d, want 1", len(sections))
	}
	got := sections[0]
	if got.Type != "character" || got.Title != "林书彤" || got.MetadataJSON != `{"locked":true}` {
		t.Fatalf("metadata fields = type %q title %q metadata %q, want preserved", got.Type, got.Title, got.MetadataJSON)
	}
	if got.ObservedTitle != "林书彤（改名）" || got.LineStart != 10 || got.ContentHash != "hash-b" {
		t.Fatalf("observation fields = %#v, want updated observation", got)
	}

	affected, err := repo.MarkProjectSectionsMissing("project-sections", nil, "2026-06-22T00:02:00Z")
	if err != nil {
		t.Fatalf("MarkProjectSectionsMissing() error = %v", err)
	}
	if affected != 1 {
		t.Fatalf("affected = %d, want 1", affected)
	}
	sections, err = repo.ListProjectSections("project-sections")
	if err != nil {
		t.Fatalf("ListProjectSections(after missing) error = %v", err)
	}
	if sections[0].Status != "missing" {
		t.Fatalf("status = %q, want missing", sections[0].Status)
	}
}

func TestDocumentSectionRepositoryUpsertPreservesDeletedStatus(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	seedRepositoryProject(t, db, "project-deleted-section")
	repo := NewDocumentSectionRepositoryFromDB(db)

	now := domain.TimeFromString("2026-06-22T00:00:00Z")
	if err := repo.UpsertObservedSections([]domain.DocumentSectionModel{
		{
			ProjectID:     "project-deleted-section",
			SectionID:     "section_deleted",
			DocumentID:    "doc-reference",
			Type:          "reference",
			Title:         "已删除资源",
			MetadataJSON:  `{}`,
			Status:        "active",
			ObservedTitle: "已删除资源",
			HeadingLevel:  2,
			LineStart:     1,
			LineEnd:       3,
			ContentHash:   "hash-a",
			CreatedAt:     now,
			UpdatedAt:     now,
			LastSeenAt:    &now,
		},
	}); err != nil {
		t.Fatalf("UpsertObservedSections() error = %v", err)
	}
	if ok, err := repo.UpdateSectionMetadata("project-deleted-section", "section_deleted", map[string]any{
		"status": "deleted",
	}); err != nil || !ok {
		t.Fatalf("UpdateSectionMetadata() ok=%v err=%v", ok, err)
	}

	later := domain.TimeFromString("2026-06-22T00:01:00Z")
	if err := repo.UpsertObservedSections([]domain.DocumentSectionModel{
		{
			ProjectID:     "project-deleted-section",
			SectionID:     "section_deleted",
			DocumentID:    "doc-reference",
			Type:          "reference",
			Title:         "已删除资源",
			MetadataJSON:  `{}`,
			Status:        "active",
			ObservedTitle: "仍在文档中",
			HeadingLevel:  2,
			LineStart:     5,
			LineEnd:       9,
			ContentHash:   "hash-b",
			CreatedAt:     later,
			UpdatedAt:     later,
			LastSeenAt:    &later,
		},
	}); err != nil {
		t.Fatalf("UpsertObservedSections(second) error = %v", err)
	}

	sections, err := repo.ListProjectSections("project-deleted-section")
	if err != nil {
		t.Fatalf("ListProjectSections() error = %v", err)
	}
	if len(sections) != 1 {
		t.Fatalf("sections len = %d, want 1", len(sections))
	}
	if sections[0].Status != "deleted" {
		t.Fatalf("status = %q, want deleted preserved", sections[0].Status)
	}
	if sections[0].ObservedTitle != "仍在文档中" || sections[0].ContentHash != "hash-b" {
		t.Fatalf("observation = %#v, want observation fields updated while deleted", sections[0])
	}
}
