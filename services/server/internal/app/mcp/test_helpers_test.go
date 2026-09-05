package mcp

import (
	"os"
	"path/filepath"
	"testing"

	appworkspace "github.com/mediago-dev/mediago-drama/services/server/internal/app/workspace"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	cliservice "github.com/mediago-dev/mediago-drama/services/server/internal/service/document"
)

type workspaceStateService = appworkspace.WorkspaceStateService
type createWorkspaceDocumentRequest = cliservice.CreateWorkspaceDocumentRequest

func newWorkspaceStateService(t *testing.T, workspaceDir string) *workspaceStateService {
	t.Helper()
	store := appworkspace.NewStateService(workspaceDir)
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("closing MCP workspace store: %v", err)
		}
		if err := repository.CloseDatabasePath(store.SettingsDatabasePath()); err != nil {
			t.Errorf("closing MCP settings database: %v", err)
		}
	})
	return store
}

func requireMCPTestProject(t *testing.T, store *workspaceStateService, projectID string) string {
	t.Helper()
	projectDir := filepath.Join(t.TempDir(), projectID)
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatalf("creating project dir: %v", err)
	}
	if _, err := store.StateService().Documents.CreateProject(projectID, cliservice.CreateWorkspaceProjectRequest{
		Name:       projectID,
		ProjectDir: projectDir,
	}); err != nil {
		t.Fatalf("creating project %s: %v", projectID, err)
	}
	return projectDir
}

func mcpTestProjectDir(t *testing.T, store *workspaceStateService, projectID string) string {
	t.Helper()
	projectDir, err := store.StateService().Documents.ProjectDir(projectID)
	if err != nil {
		t.Fatalf("reading project dir: %v", err)
	}
	return projectDir
}
