package repository

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
)

func TestProjectAssetRepositoryLifecycle(t *testing.T) {
	repo, err := NewProjectAssetRepository(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("NewProjectAssetRepository() error = %v", err)
	}

	asset := domain.ProjectAssetModel{
		ProjectID: "project-a",
		ID:        "asset-1",
		Kind:      "binary",
		Filename:  "brief.pdf",
		MIMEType:  "application/pdf",
		SizeBytes: 32,
		Path:      "/tmp/brief.pdf",
		ParentID:  "",
		SortOrder: 1,
		CreatedAt: "2026-05-22T00:00:00Z",
		UpdatedAt: "2026-05-22T00:00:00Z",
	}
	if err := repo.CreateProjectAsset(asset); err != nil {
		t.Fatalf("CreateProjectAsset() error = %v", err)
	}

	otherProjectAsset := asset
	otherProjectAsset.ProjectID = "project-b"
	otherProjectAsset.ID = "asset-other"
	if err := repo.CreateProjectAsset(otherProjectAsset); err != nil {
		t.Fatalf("CreateProjectAsset(other) error = %v", err)
	}

	got, err := repo.GetProjectAsset(asset.ProjectID, asset.ID)
	if err != nil {
		t.Fatalf("GetProjectAsset() error = %v", err)
	}
	if got.Filename != asset.Filename {
		t.Fatalf("GetProjectAsset().Filename = %q, want %q", got.Filename, asset.Filename)
	}

	assets, err := repo.ListProjectAssets(asset.ProjectID)
	if err != nil {
		t.Fatalf("ListProjectAssets() error = %v", err)
	}
	if len(assets) != 1 || assets[0].ID != asset.ID {
		t.Fatalf("ListProjectAssets() = %+v, want only project-a asset", assets)
	}

	updated, err := repo.UpdateProjectAsset(asset.ProjectID, asset.ID, map[string]any{
		"filename":   "renamed.pdf",
		"parent_id":  "folder-1",
		"sort_order": 4,
		"updated_at": "2026-05-22T00:01:00Z",
	})
	if err != nil {
		t.Fatalf("UpdateProjectAsset() error = %v", err)
	}
	if !updated {
		t.Fatal("UpdateProjectAsset() updated = false, want true")
	}
	got, err = repo.GetProjectAsset(asset.ProjectID, asset.ID)
	if err != nil {
		t.Fatalf("GetProjectAsset() after update error = %v", err)
	}
	if got.Filename != "renamed.pdf" || got.ParentID != "folder-1" || got.SortOrder != 4 {
		t.Fatalf("updated asset = %+v, want renamed and moved", got)
	}

	deleted, err := repo.DeleteProjectAssets(asset.ProjectID, []string{asset.ID})
	if err != nil {
		t.Fatalf("DeleteProjectAssets() error = %v", err)
	}
	if deleted != 1 {
		t.Fatalf("DeleteProjectAssets() deleted = %d, want 1", deleted)
	}
	if _, err := repo.GetProjectAsset(asset.ProjectID, asset.ID); !errors.Is(err, ErrRecordNotFound) {
		t.Fatalf("GetProjectAsset() after delete error = %v, want ErrRecordNotFound", err)
	}

	if _, err := repo.GetProjectAsset("project-b", otherProjectAsset.ID); err != nil {
		t.Fatalf("other project asset was deleted: %v", err)
	}
}
