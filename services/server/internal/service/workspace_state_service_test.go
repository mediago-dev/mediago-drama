package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

func TestWorkspaceStateServiceCleansDeprecatedStudioProjectDirs(t *testing.T) {
	workspaceDir := t.TempDir()
	legacyProjectID := "project-legacy-studio"
	legacyDir := filepath.Join(workspaceDir, "studio", legacyProjectID)
	activeRunFile := filepath.Join(workspaceDir, "studio", "video-chunk", "2026-06", "run-1", "source.mp4")
	if err := os.MkdirAll(filepath.Join(legacyDir, "assets"), 0o755); err != nil {
		t.Fatalf("creating legacy dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyDir, "project.media.json"), []byte("{}"), 0o644); err != nil {
		t.Fatalf("writing legacy manifest: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(activeRunFile), 0o755); err != nil {
		t.Fatalf("creating active studio run dir: %v", err)
	}
	if err := os.WriteFile(activeRunFile, []byte("video"), 0o644); err != nil {
		t.Fatalf("writing active studio run file: %v", err)
	}

	repos, err := repository.OpenWorkspaceRepositories(shared.WorkspacePathsFor(workspaceDir).DatabasePath())
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	now := "2026-06-06T00:00:00Z"
	if err := repos.Workspace.UpsertProject(domain.WorkspaceProjectModel{
		ID:          legacyProjectID,
		Name:        "Legacy Studio",
		Category:    "studio",
		Description: "__studio_capability_session__:video.chunk",
		ProjectDir:  legacyDir,
		RelativeDir: "studio/" + legacyProjectID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("UpsertProject() error = %v", err)
	}

	store := NewWorkspaceStateServiceFromRepositories(workspaceDir, repos, nil)
	if err := store.InitErr(); err != nil {
		t.Fatalf("InitErr() = %v", err)
	}
	if _, err := os.Stat(legacyDir); !os.IsNotExist(err) {
		t.Fatalf("legacy dir stat error = %v, want not exist", err)
	}
	if _, err := os.Stat(activeRunFile); err != nil {
		t.Fatalf("active studio run file should remain: %v", err)
	}
	if _, err := repos.Workspace.GetProject(legacyProjectID); !repository.IsRecordNotFound(err) {
		t.Fatalf("GetProject(legacy) error = %v, want not found", err)
	}
}

func TestWorkspaceStateServiceMigratesDeprecatedLocalProjectDirs(t *testing.T) {
	workspaceDir := t.TempDir()
	legacyProjectID := "project-legacy-local"
	legacyAgentProjectID := "project-legacy-agent"
	retainedProjectID := "project-retained-local"
	legacyDir := filepath.Join(workspaceDir, "local-projects", legacyProjectID)
	legacyAgentDir := filepath.Join(workspaceDir, "agent", legacyAgentProjectID)
	retainedDir := filepath.Join(workspaceDir, "local-projects", "manually-picked")
	canonicalDir := filepath.Join(workspaceDir, "projects", legacyProjectID)
	canonicalAgentDir := filepath.Join(workspaceDir, "projects", legacyAgentProjectID)
	assetPath := filepath.Join(legacyDir, "assets", "asset-1.txt")
	if err := os.MkdirAll(filepath.Dir(assetPath), 0o755); err != nil {
		t.Fatalf("creating legacy asset dir: %v", err)
	}
	if err := os.WriteFile(assetPath, []byte("story"), 0o644); err != nil {
		t.Fatalf("writing legacy asset: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(legacyAgentDir, "work"), 0o755); err != nil {
		t.Fatalf("creating legacy agent project dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyAgentDir, "project.media.json"), []byte("{}"), 0o644); err != nil {
		t.Fatalf("writing legacy agent manifest: %v", err)
	}
	if err := os.MkdirAll(retainedDir, 0o755); err != nil {
		t.Fatalf("creating retained dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(retainedDir, "notes.txt"), []byte("manual"), 0o644); err != nil {
		t.Fatalf("writing retained file: %v", err)
	}

	repos, err := repository.OpenWorkspaceRepositories(shared.WorkspacePathsFor(workspaceDir).DatabasePath())
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	now := "2026-06-06T00:00:00Z"
	for _, project := range []domain.WorkspaceProjectModel{
		{
			ID:          legacyProjectID,
			Name:        "Legacy Local",
			Category:    "agent",
			ProjectDir:  legacyDir,
			RelativeDir: "local-projects/" + legacyProjectID,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			ID:          legacyAgentProjectID,
			Name:        "Legacy Agent",
			Category:    "agent",
			ProjectDir:  legacyAgentDir,
			RelativeDir: "agent/" + legacyAgentProjectID,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			ID:          retainedProjectID,
			Name:        "Retained Local",
			Category:    "agent",
			ProjectDir:  retainedDir,
			RelativeDir: "local-projects/manually-picked",
			CreatedAt:   now,
			UpdatedAt:   now,
		},
	} {
		if err := repos.Workspace.UpsertProject(project); err != nil {
			t.Fatalf("UpsertProject(%s) error = %v", project.ID, err)
		}
	}
	if err := repos.ProjectAssets.CreateProjectAsset(domain.ProjectAssetModel{
		ProjectID: legacyProjectID,
		ID:        "asset-1",
		Kind:      "text",
		Filename:  "story.txt",
		MIMEType:  "text/plain",
		Path:      assetPath,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("CreateProjectAsset() error = %v", err)
	}

	store := NewWorkspaceStateServiceFromRepositories(workspaceDir, repos, nil)
	if err := store.InitErr(); err != nil {
		t.Fatalf("InitErr() = %v", err)
	}
	if _, err := os.Stat(legacyDir); !os.IsNotExist(err) {
		t.Fatalf("legacy dir stat error = %v, want not exist", err)
	}
	if _, err := os.Stat(legacyAgentDir); !os.IsNotExist(err) {
		t.Fatalf("legacy agent dir stat error = %v, want not exist", err)
	}
	if _, err := os.Stat(filepath.Join(canonicalDir, "assets", "asset-1.txt")); err != nil {
		t.Fatalf("canonical asset should exist: %v", err)
	}
	if _, err := os.Stat(filepath.Join(canonicalAgentDir, "project.media.json")); err != nil {
		t.Fatalf("canonical agent manifest should exist: %v", err)
	}
	if _, err := os.Stat(filepath.Join(retainedDir, "notes.txt")); err != nil {
		t.Fatalf("retained local project dir should remain: %v", err)
	}

	project, err := repos.Workspace.GetProject(legacyProjectID)
	if err != nil {
		t.Fatalf("GetProject(legacy) error = %v", err)
	}
	if project.ProjectDir != canonicalDir || project.RelativeDir != "projects/"+legacyProjectID {
		t.Fatalf("project location = (%q, %q), want canonical projects dir", project.ProjectDir, project.RelativeDir)
	}
	asset, err := repos.ProjectAssets.GetProjectAsset(legacyProjectID, "asset-1")
	if err != nil {
		t.Fatalf("GetProjectAsset() error = %v", err)
	}
	if asset.Path != filepath.Join(canonicalDir, "assets", "asset-1.txt") {
		t.Fatalf("asset path = %q, want canonical path", asset.Path)
	}
	agentProject, err := repos.Workspace.GetProject(legacyAgentProjectID)
	if err != nil {
		t.Fatalf("GetProject(legacy agent) error = %v", err)
	}
	if agentProject.ProjectDir != canonicalAgentDir || agentProject.RelativeDir != "projects/"+legacyAgentProjectID {
		t.Fatalf("agent project location = (%q, %q), want canonical projects dir", agentProject.ProjectDir, agentProject.RelativeDir)
	}
	retainedProject, err := repos.Workspace.GetProject(retainedProjectID)
	if err != nil {
		t.Fatalf("GetProject(retained) error = %v", err)
	}
	if retainedProject.ProjectDir != retainedDir {
		t.Fatalf("retained project dir = %q, want %q", retainedProject.ProjectDir, retainedDir)
	}
}
