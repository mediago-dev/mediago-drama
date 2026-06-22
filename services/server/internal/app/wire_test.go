package app

import (
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	serviceshared "github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

func TestNewHandlerDefaultsSettingsDBToWorkspaceDatabaseDir(t *testing.T) {
	workspaceDir := filepath.Join(t.TempDir(), "workspace")
	paths := serviceshared.WorkspacePathsFor(workspaceDir)
	legacyRepos, err := repository.OpenSettingsRepositories(paths.DatabasePath())
	if err != nil {
		t.Fatalf("opening legacy settings database: %v", err)
	}
	if err := legacyRepos.APIKeys.Set("openrouter", "sk-legacy-settings"); err != nil {
		t.Fatalf("writing legacy API key: %v", err)
	}

	handler := NewHandlerWithConfig(
		fstest.MapFS{
			"index.html": {
				Data: []byte("<html>workspace</html>"),
			},
		},
		Config{
			WorkspaceDir:            workspaceDir,
			DisableGenerationWorker: true,
			DisableWorkspaceWatcher: true,
			agentRunner:             fakeAgentRunner{},
			documentOperationRunner: fakeDocumentOperationRunner{},
		},
	)
	if closer, ok := handler.(interface{ Close() error }); ok {
		t.Cleanup(func() {
			if err := closer.Close(); err != nil {
				t.Fatalf("closing handler: %v", err)
			}
		})
	}

	if paths.SettingsDatabasePath() == paths.DatabasePath() {
		t.Fatalf("settings database path should be separate from workspace database path")
	}
	assertPathExists(t, paths.DatabasePath())
	assertPathExists(t, paths.SettingsDatabasePath())

	response := requestJSON(t, handler, http.MethodGet, "/api/v1/prompt-categories", "")
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status code = %d, want %d: %s", response.StatusCode, http.StatusOK, readBody(t, response.Body))
	}

	keys := requestJSON(t, handler, http.MethodGet, "/api/v1/settings/api-keys", "")
	defer keys.Body.Close()
	if keys.StatusCode != http.StatusOK {
		t.Fatalf("keys status code = %d, want %d: %s", keys.StatusCode, http.StatusOK, readBody(t, keys.Body))
	}
	body := readBody(t, keys.Body)
	if !strings.Contains(body, `"id":"openrouter"`) ||
		!strings.Contains(body, `"source":"settings"`) ||
		!strings.Contains(body, `"sk-l••••••••ings"`) {
		t.Fatalf("body = %s, want migrated masked openrouter key", body)
	}
}
