package document

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

func newWorkspaceStateService(t *testing.T, workspaceDir string) *Service {
	t.Helper()
	db, err := repository.OpenWorkspaceDB(filepath.Join(workspaceDir, "workspace.db"))
	if err != nil {
		return NewService(workspaceDir, nil, nil, err)
	}
	t.Cleanup(func() {
		if err := repository.CloseDatabase(db); err != nil {
			t.Errorf("closing workspace database: %v", err)
		}
	})
	store := NewService(workspaceDir, repository.NewWorkspaceRepository(db), nil, nil, repository.NewDocumentSectionRepositoryFromDB(db))
	store.SetProjectAssetRepository(repository.NewProjectAssetRepositoryFromDB(db))
	store.SetEditStreamService(NewEditStreamService(repository.NewDocumentEditStreamRepository(db), nil))
	return store
}

func requireDocumentStore(t *testing.T) *Service {
	t.Helper()
	store := newWorkspaceStateService(t, t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing document store: %v", store.initErr)
	}
	return store
}

func requireTestProject(t *testing.T, store *Service, projectID string) string {
	t.Helper()
	projectDir := filepath.Join(t.TempDir(), projectID)
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatalf("creating project dir: %v", err)
	}
	if _, err := store.CreateProject(projectID, CreateWorkspaceProjectRequest{
		Name:       projectID,
		ProjectDir: projectDir,
	}); err != nil {
		t.Fatalf("creating project %s: %v", projectID, err)
	}
	return projectDir
}
