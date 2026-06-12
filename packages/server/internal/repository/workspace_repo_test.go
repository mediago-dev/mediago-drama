package repository

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
)

func TestWorkspaceRepositoryProjectAndOperationLogLifecycle(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	repo := NewWorkspaceRepository(db)

	project := domain.WorkspaceProjectModel{
		ID:          "project-1",
		Name:        "Project One",
		RelativeDir: "projects/project-1",
		CreatedAt:   "2026-05-22T00:00:00Z",
		UpdatedAt:   "2026-05-22T00:00:00Z",
	}
	if err := repo.UpsertProject(project); err != nil {
		t.Fatalf("UpsertProject() error = %v", err)
	}
	exists, err := repo.ProjectExists(project.ID)
	if err != nil {
		t.Fatalf("ProjectExists() error = %v", err)
	}
	if !exists {
		t.Fatal("ProjectExists() = false, want true")
	}

	if err := repo.UpdateProjectBrief(project.ID, `{"logline":"hello"}`, "2026-05-22T00:02:00Z"); err != nil {
		t.Fatalf("UpdateProjectBrief() error = %v", err)
	}

	gotProject, err := repo.GetProject(project.ID)
	if err != nil {
		t.Fatalf("GetProject() error = %v", err)
	}
	if !gotProject.BriefJSON.Valid {
		t.Fatal("BriefJSON.Valid = false, want true")
	}

	operations := []domain.DocumentOperationLogModel{
		{
			ProjectID:  project.ID,
			ID:         "op-1",
			DocumentID: "doc-1",
			RecordJSON: `{"id":"op-1"}`,
			CreatedAt:  "2026-05-22T00:04:00Z",
		},
	}
	if err := repo.ReplaceDocumentOperationLogs(project.ID, operations); err != nil {
		t.Fatalf("ReplaceDocumentOperationLogs() error = %v", err)
	}
	gotOperations, err := repo.ListDocumentOperationLogs(project.ID)
	if err != nil {
		t.Fatalf("ListDocumentOperationLogs() error = %v", err)
	}
	if len(gotOperations) != 1 {
		t.Fatalf("ListDocumentOperationLogs() len = %d, want 1", len(gotOperations))
	}

	projects, err := repo.ListProjects()
	if err != nil {
		t.Fatalf("ListProjects() error = %v", err)
	}
	if len(projects) != 1 {
		t.Fatalf("ListProjects() len = %d, want 1", len(projects))
	}

	deleted, err := repo.DeleteProject(project.ID)
	if err != nil {
		t.Fatalf("DeleteProject() error = %v", err)
	}
	if !deleted {
		t.Fatal("DeleteProject() deleted = false, want true")
	}
}

func TestWorkspaceRepositoryDeletesDeprecatedStudioCapabilityProjects(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	repo := NewWorkspaceRepository(db)
	now := "2026-06-06T00:00:00Z"
	legacyProjectID := "project-legacy-studio"
	retainedProjectID := "project-retained-studio"

	if err := repo.UpsertProject(domain.WorkspaceProjectModel{
		ID:          legacyProjectID,
		Name:        "Legacy Studio",
		Category:    "studio",
		Description: deprecatedStudioCapabilitySessionDescriptionPrefix + "video.chunk",
		ProjectDir:  "/tmp/project-legacy-studio",
		RelativeDir: "studio/project-legacy-studio",
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("UpsertProject(legacy) error = %v", err)
	}
	if err := repo.UpsertProject(domain.WorkspaceProjectModel{
		ID:          retainedProjectID,
		Name:        "Retained Studio",
		Category:    "studio",
		Description: "manual studio project",
		ProjectDir:  "/tmp/project-retained-studio",
		RelativeDir: "studio/project-retained-studio",
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("UpsertProject(retained) error = %v", err)
	}
	if err := db.Create(&domain.ProjectAssetModel{
		ProjectID: legacyProjectID,
		ID:        "asset-1",
		Kind:      "text",
		Filename:  "story.txt",
		MIMEType:  "text/plain",
		SizeBytes: 12,
		Path:      "/tmp/story.txt",
		CreatedAt: now,
		UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("Create(ProjectAssetModel) error = %v", err)
	}

	deleted, err := repo.DeleteDeprecatedStudioCapabilityProjects()
	if err != nil {
		t.Fatalf("DeleteDeprecatedStudioCapabilityProjects() error = %v", err)
	}
	if len(deleted) != 1 || deleted[0].ID != legacyProjectID {
		t.Fatalf("deleted = %+v, want only legacy studio project", deleted)
	}
	if _, err := repo.GetProject(legacyProjectID); !IsRecordNotFound(err) {
		t.Fatalf("GetProject(legacy) error = %v, want not found", err)
	}
	if _, err := repo.GetProject(retainedProjectID); err != nil {
		t.Fatalf("GetProject(retained) error = %v", err)
	}

	for _, table := range []struct {
		name  string
		model any
	}{
		{name: "project assets", model: &domain.ProjectAssetModel{}},
	} {
		var count int64
		if err := db.Model(table.model).Where("project_id = ?", legacyProjectID).Count(&count).Error; err != nil {
			t.Fatalf("counting %s: %v", table.name, err)
		}
		if count != 0 {
			t.Fatalf("%s count = %d, want 0", table.name, count)
		}
	}
}

func TestWorkspaceRepositoryUpdatesProjectStorageLocation(t *testing.T) {
	db, err := OpenWorkspaceDB(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	repo := NewWorkspaceRepository(db)
	projectID := "project-local"
	otherProjectID := "project-other"
	oldDir := filepath.Join(t.TempDir(), "workspace", "local-projects", projectID)
	newDir := filepath.Join(t.TempDir(), "workspace", "agent", projectID)
	now := "2026-06-06T00:00:00Z"

	for _, project := range []domain.WorkspaceProjectModel{
		{
			ID:          projectID,
			Name:        "Legacy Local",
			Category:    "agent",
			ProjectDir:  oldDir,
			RelativeDir: "local-projects/" + projectID,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			ID:          otherProjectID,
			Name:        "Other",
			Category:    "agent",
			ProjectDir:  filepath.Join(t.TempDir(), "other"),
			RelativeDir: "other",
			CreatedAt:   now,
			UpdatedAt:   now,
		},
	} {
		if err := repo.UpsertProject(project); err != nil {
			t.Fatalf("UpsertProject(%s) error = %v", project.ID, err)
		}
	}
	assetRepo := NewProjectAssetRepositoryFromDB(db)
	for _, asset := range []domain.ProjectAssetModel{
		{
			ProjectID: projectID,
			ID:        "asset-1",
			Kind:      "text",
			Filename:  "story.txt",
			MIMEType:  "text/plain",
			Path:      filepath.Join(oldDir, "assets", "asset-1.txt"),
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ProjectID: projectID,
			ID:        "asset-outside",
			Kind:      "text",
			Filename:  "outside.txt",
			MIMEType:  "text/plain",
			Path:      filepath.Join(t.TempDir(), "outside.txt"),
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ProjectID: otherProjectID,
			ID:        "asset-other",
			Kind:      "text",
			Filename:  "other.txt",
			MIMEType:  "text/plain",
			Path:      filepath.Join(oldDir, "assets", "other.txt"),
			CreatedAt: now,
			UpdatedAt: now,
		},
	} {
		if err := assetRepo.CreateProjectAsset(asset); err != nil {
			t.Fatalf("CreateProjectAsset(%s) error = %v", asset.ID, err)
		}
	}
	updatedAt := "2026-06-06T00:01:00Z"
	updated, err := repo.UpdateProjectStorageLocation(
		projectID,
		newDir,
		"agent/"+projectID,
		oldDir,
		newDir,
		updatedAt,
	)
	if err != nil {
		t.Fatalf("UpdateProjectStorageLocation() error = %v", err)
	}
	if !updated {
		t.Fatal("UpdateProjectStorageLocation() updated = false, want true")
	}

	project, err := repo.GetProject(projectID)
	if err != nil {
		t.Fatalf("GetProject() error = %v", err)
	}
	if project.ProjectDir != newDir || project.RelativeDir != "agent/"+projectID || project.UpdatedAt != updatedAt {
		t.Fatalf("project storage = (%q, %q, %q), want new location", project.ProjectDir, project.RelativeDir, project.UpdatedAt)
	}
	asset, err := assetRepo.GetProjectAsset(projectID, "asset-1")
	if err != nil {
		t.Fatalf("GetProjectAsset(asset-1) error = %v", err)
	}
	if asset.Path != filepath.Join(newDir, "assets", "asset-1.txt") {
		t.Fatalf("asset path = %q, want rewritten path", asset.Path)
	}
	outsideAsset, err := assetRepo.GetProjectAsset(projectID, "asset-outside")
	if err != nil {
		t.Fatalf("GetProjectAsset(asset-outside) error = %v", err)
	}
	if strings.Contains(outsideAsset.Path, newDir) {
		t.Fatalf("outside asset path = %q, should not be rewritten", outsideAsset.Path)
	}
	otherAsset, err := assetRepo.GetProjectAsset(otherProjectID, "asset-other")
	if err != nil {
		t.Fatalf("GetProjectAsset(asset-other) error = %v", err)
	}
	if otherAsset.Path != filepath.Join(oldDir, "assets", "other.txt") {
		t.Fatalf("other project asset path = %q, should not be rewritten", otherAsset.Path)
	}
}
