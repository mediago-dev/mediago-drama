package projectasset

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

func TestProjectAssetFolderPathByIDUsesFilesystemFolderIDs(t *testing.T) {
	projectID := "project-folders"
	paths := projectAssetFolderPathByID([]string{"参考", "参考/子目录"}, projectID)
	folderID := deterministicProjectWorkFileID("folder-file-", projectID, "参考")
	childID := deterministicProjectWorkFileID("folder-file-", projectID, "参考/子目录")
	if paths[folderID] != "参考" {
		t.Fatalf("folder path = %q, want 参考", paths[folderID])
	}
	if paths[childID] != filepath.ToSlash(filepath.Join("参考", "子目录")) {
		t.Fatalf("child folder path = %q, want child under folder", paths[childID])
	}
}

func TestProjectAssetsSaveListUpdateDelete(t *testing.T) {
	repos, err := repository.OpenWorkspaceRepositories(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	requireProjectAssetTestProject(t, repos.Workspace, "project-a")
	requireProjectAssetTestProject(t, repos.Workspace, "project-b")
	store := NewProjectAssetsFromRepository(
		repos.ProjectAssets,
		filepath.Join(t.TempDir(), "assets"),
		filepath.Join(t.TempDir(), "workspace"),
		repos.Workspace,
		nil,
	)

	asset, err := store.SaveReader(
		context.Background(),
		"project-a",
		strings.NewReader("hello"),
		"notes.txt",
		"text/plain; charset=utf-8",
		"",
		2,
	)
	if err != nil {
		t.Fatalf("SaveReader() error = %v", err)
	}
	if asset.Kind != "text" || asset.ProjectID != "project-a" || asset.URL == "" {
		t.Fatalf("asset = %+v, want text project asset", asset)
	}
	if asset.MIMEType != "text/plain" {
		t.Fatalf("MIMEType = %q, want normalized text/plain", asset.MIMEType)
	}
	if _, err := os.Stat(asset.FilePath); err != nil {
		t.Fatalf("asset file was not written: %v", err)
	}

	other, err := store.SaveReader(context.Background(), "project-b", strings.NewReader("%PDF-"), "brief.pdf", "application/pdf", "", 0)
	if err != nil {
		t.Fatalf("SaveReader(other) error = %v", err)
	}
	if other.Kind != "binary" {
		t.Fatalf("pdf kind = %q, want binary", other.Kind)
	}

	assets, err := store.List("project-a")
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(assets) != 1 || assets[0].ID != asset.ID {
		t.Fatalf("List() = %+v, want only project-a asset", assets)
	}

	rename := "renamed"
	parentID := "folder-1"
	sortOrder := 7
	updated, ok, err := store.Update("project-a", asset.ID, ProjectAssetUpdateRequest{
		Filename:  &rename,
		ParentID:  &parentID,
		SortOrder: &sortOrder,
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if !ok || updated.Filename != "renamed.txt" || updated.ParentID != parentID || updated.SortOrder != sortOrder {
		t.Fatalf("Update() = %+v ok=%v, want renamed/moved", updated, ok)
	}

	deleted, err := store.Delete("project-a", asset.ID)
	if err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if !deleted {
		t.Fatal("Delete() deleted = false, want true")
	}
	if _, err := os.Stat(asset.FilePath); !os.IsNotExist(err) {
		t.Fatalf("asset file after delete stat error = %v, want not exists", err)
	}

	otherAssets, err := store.List("project-b")
	if err != nil {
		t.Fatalf("List(other) error = %v", err)
	}
	if len(otherAssets) != 1 || otherAssets[0].ID != other.ID {
		t.Fatalf("other project assets = %+v, want preserved other asset", otherAssets)
	}
}

func requireProjectAssetTestProject(t *testing.T, repo *repository.WorkspaceRepository, projectID string) string {
	t.Helper()
	projectDir := filepath.Join(t.TempDir(), projectID)
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatalf("creating project dir: %v", err)
	}
	now := timestamp.NowRFC3339Nano()
	if err := repo.UpsertProject(domain.WorkspaceProjectModel{
		ID:          projectID,
		Name:        projectID,
		ProjectDir:  projectDir,
		RelativeDir: projectDir,
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("UpsertProject(%s) error = %v", projectID, err)
	}
	return projectDir
}

func TestProjectAssetsSaveReaderStoresOriginalBasename(t *testing.T) {
	repos, err := repository.OpenWorkspaceRepositories(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	requireProjectAssetTestProject(t, repos.Workspace, "project-original-name")
	store := NewProjectAssetsFromRepository(
		repos.ProjectAssets,
		filepath.Join(t.TempDir(), "global-assets"),
		filepath.Join(t.TempDir(), "workspace"),
		repos.Workspace,
		nil,
	)

	filename := "颠覆全球：开启扮演系统.txt"
	first, err := store.SaveReader(
		context.Background(),
		"project-original-name",
		strings.NewReader("chapter one"),
		filename,
		"text/plain",
		"",
		0,
	)
	if err != nil {
		t.Fatalf("SaveReader(first) error = %v", err)
	}
	if first.Filename != filename {
		t.Fatalf("Filename = %q, want original filename %q", first.Filename, filename)
	}
	if filepath.Base(first.FilePath) != filename {
		t.Fatalf("FilePath basename = %q, want original filename %q", filepath.Base(first.FilePath), filename)
	}

	second, err := store.SaveReader(
		context.Background(),
		"project-original-name",
		strings.NewReader("chapter two"),
		filename,
		"text/plain",
		"",
		1,
	)
	if err != nil {
		t.Fatalf("SaveReader(second) error = %v", err)
	}
	if second.Filename != filename {
		t.Fatalf("second Filename = %q, want original filename %q", second.Filename, filename)
	}
	if filepath.Base(second.FilePath) != "颠覆全球：开启扮演系统-2.txt" {
		t.Fatalf("second FilePath basename = %q, want suffixed original filename", filepath.Base(second.FilePath))
	}
}

func TestProjectAssetsSaveReaderUsesPersistedProjectDir(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "workspace.db")
	repos, err := repository.OpenWorkspaceRepositories(dbPath)
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	projectDir := filepath.Join(t.TempDir(), "custom-project")
	now := timestamp.NowRFC3339Nano()
	if err := repos.Workspace.UpsertProject(domain.WorkspaceProjectModel{
		ID:          "project-custom",
		Name:        "Custom",
		ProjectDir:  projectDir,
		RelativeDir: projectDir,
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("UpsertProject() error = %v", err)
	}

	store := NewProjectAssetsFromRepository(
		repos.ProjectAssets,
		filepath.Join(t.TempDir(), "global-assets"),
		filepath.Join(t.TempDir(), "workspace"),
		repos.Workspace,
		nil,
	)
	asset, err := store.SaveReader(
		context.Background(),
		"project-custom",
		strings.NewReader("uploaded notes"),
		"notes.txt",
		"text/plain",
		"",
		0,
	)
	if err != nil {
		t.Fatalf("SaveReader() error = %v", err)
	}

	wantDir := filepath.Join(projectDir, "work")
	if filepath.Dir(asset.FilePath) != wantDir {
		t.Fatalf("asset dir = %q, want %q", filepath.Dir(asset.FilePath), wantDir)
	}
	if _, err := os.Stat(asset.FilePath); err != nil {
		t.Fatalf("asset file was not written: %v", err)
	}
}

func TestProjectAssetsListImportsLocalWorkFiles(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "workspace.db")
	repos, err := repository.OpenWorkspaceRepositories(dbPath)
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	projectDir := requireProjectAssetTestProject(t, repos.Workspace, "project-local-work-assets")
	workDir := filepath.Join(projectDir, "work")
	if err := os.MkdirAll(filepath.Join(workDir, "参考"), 0o755); err != nil {
		t.Fatalf("creating work dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "参考", "原始素材.txt"), []byte("local notes"), 0o644); err != nil {
		t.Fatalf("writing local asset: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "参考", "文档.md"), []byte("# markdown"), 0o644); err != nil {
		t.Fatalf("writing local markdown: %v", err)
	}

	store := NewProjectAssetsFromRepository(
		repos.ProjectAssets,
		filepath.Join(t.TempDir(), "global-assets"),
		filepath.Join(t.TempDir(), "workspace"),
		repos.Workspace,
		nil,
	)
	assets, err := store.List("project-local-work-assets")
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(assets) != 1 {
		t.Fatalf("List() = %+v, want one non-markdown local asset", assets)
	}
	if assets[0].Filename != "原始素材.txt" ||
		assets[0].Kind != "text" ||
		assets[0].FilePath != filepath.Join(workDir, "参考", "原始素材.txt") {
		t.Fatalf("asset = %+v, want imported local text asset", assets[0])
	}
	if assets[0].FolderID == "" {
		t.Fatalf("asset folder id is empty")
	}
}

func TestProjectAssetsUpdateFolderMovesLocalWorkFile(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "workspace.db")
	repos, err := repository.OpenWorkspaceRepositories(dbPath)
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	projectDir := requireProjectAssetTestProject(t, repos.Workspace, "project-move-asset")
	if err := os.MkdirAll(filepath.Join(projectDir, "work", "参考"), 0o755); err != nil {
		t.Fatalf("creating work folder: %v", err)
	}
	store := NewProjectAssetsFromRepository(
		repos.ProjectAssets,
		filepath.Join(t.TempDir(), "global-assets"),
		filepath.Join(t.TempDir(), "workspace"),
		repos.Workspace,
		nil,
	)
	asset, err := store.SaveReader(
		context.Background(),
		"project-move-asset",
		strings.NewReader("local notes"),
		"notes.txt",
		"text/plain",
		"",
		0,
	)
	if err != nil {
		t.Fatalf("SaveReader() error = %v", err)
	}
	originalPath := asset.FilePath
	folderID := deterministicProjectWorkFileID("folder-file-", "project-move-asset", "参考")

	updated, ok, err := store.Update("project-move-asset", asset.ID, ProjectAssetUpdateRequest{
		FolderID: &folderID,
	})
	if err != nil {
		t.Fatalf("Update(FolderID) error = %v", err)
	}
	if !ok || updated.FolderID != folderID {
		t.Fatalf("Update() = %+v ok=%v, want folder-a", updated, ok)
	}
	if updated.FilePath != filepath.Join(projectDir, "work", "参考", "notes.txt") {
		t.Fatalf("FilePath = %q, want file moved under folder", updated.FilePath)
	}
	if _, err := os.Stat(originalPath); !os.IsNotExist(err) {
		t.Fatalf("original path stat error = %v, want not exists", err)
	}
	if _, err := os.Stat(updated.FilePath); err != nil {
		t.Fatalf("moved path should exist: %v", err)
	}
	assets, err := store.List("project-move-asset")
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(assets) != 1 || assets[0].FolderID != folderID {
		t.Fatalf("List() = %+v, want moved folder id to persist after sync", assets)
	}

	rootFolderID := ""
	updated, ok, err = store.Update("project-move-asset", asset.ID, ProjectAssetUpdateRequest{
		FolderID: &rootFolderID,
	})
	if err != nil {
		t.Fatalf("Update(root FolderID) error = %v", err)
	}
	if !ok || updated.FolderID != "" || updated.FilePath != filepath.Join(projectDir, "work", "notes.txt") {
		t.Fatalf("Update(root) = %+v ok=%v, want root file", updated, ok)
	}
	assets, err = store.List("project-move-asset")
	if err != nil {
		t.Fatalf("List(root) error = %v", err)
	}
	if len(assets) != 1 || assets[0].FolderID != "" {
		t.Fatalf("List(root) = %+v, want root folder id to persist after sync", assets)
	}
}

func TestProjectAssetsListPrunesMissingFiles(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "workspace.db")
	repos, err := repository.OpenWorkspaceRepositories(dbPath)
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	requireProjectAssetTestProject(t, repos.Workspace, "project-prune")
	store := NewProjectAssetsFromRepository(
		repos.ProjectAssets,
		filepath.Join(t.TempDir(), "global-assets"),
		filepath.Join(t.TempDir(), "workspace"),
		repos.Workspace,
		nil,
	)

	asset, err := store.SaveReader(
		context.Background(),
		"project-prune",
		strings.NewReader("deleted by agent"),
		"notes.txt",
		"text/plain",
		"",
		0,
	)
	if err != nil {
		t.Fatalf("SaveReader() error = %v", err)
	}
	if err := os.Remove(asset.FilePath); err != nil {
		t.Fatalf("removing asset file: %v", err)
	}

	assets, err := store.List("project-prune")
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(assets) != 0 {
		t.Fatalf("List() = %+v, want missing asset pruned", assets)
	}
	if _, err := repos.ProjectAssets.GetProjectAsset("project-prune", asset.ID); !errors.Is(err, repository.ErrRecordNotFound) {
		t.Fatalf("GetProjectAsset() after prune error = %v, want ErrRecordNotFound", err)
	}
}

func TestProjectAssetsSaveReaderInDirDoesNotRequireProjectRecord(t *testing.T) {
	repos, err := repository.OpenWorkspaceRepositories(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	targetDir := filepath.Join(t.TempDir(), "toolbox", "novel-chunk", "2026-06", "run-1")
	store := NewProjectAssetsFromRepository(
		repos.ProjectAssets,
		filepath.Join(t.TempDir(), "global-assets"),
		filepath.Join(t.TempDir(), "workspace"),
		repos.Workspace,
		nil,
	)

	asset, err := store.SaveReaderInDir(
		context.Background(),
		"studio-novel-chunk",
		strings.NewReader("studio notes"),
		"notes.txt",
		"text/plain",
		"",
		0,
		targetDir,
		"notes.txt",
	)
	if err != nil {
		t.Fatalf("SaveReaderInDir() error = %v", err)
	}
	if asset.ProjectID != "studio-novel-chunk" {
		t.Fatalf("ProjectID = %q, want studio scope", asset.ProjectID)
	}
	if asset.FilePath != filepath.Join(targetDir, "notes.txt") {
		t.Fatalf("FilePath = %q, want source in target dir", asset.FilePath)
	}
	if _, err := os.Stat(asset.FilePath); err != nil {
		t.Fatalf("asset file was not written: %v", err)
	}
}
