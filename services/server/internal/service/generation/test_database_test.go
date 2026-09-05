package generation

import (
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
)

func generationTestDBPath(t *testing.T) string {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	t.Cleanup(func() {
		if err := repository.CloseDatabasePath(dbPath); err != nil {
			t.Errorf("closing generation test database: %v", err)
		}
	})
	return dbPath
}

type generationTestAppSettingStore struct{ values map[string]string }

func (store *generationTestAppSettingStore) GetAppSetting(key string) (string, bool, error) {
	value, ok := store.values[key]
	return value, ok, nil
}
func (store *generationTestAppSettingStore) SetAppSetting(key, value string) error {
	store.values[key] = value
	return nil
}
func (store *generationTestAppSettingStore) ClearAppSetting(key string) error {
	delete(store.values, key)
	return nil
}

func newGenerationTestSettings(apiKeys *generationTestAPIKeyStore) *settings.Settings {
	return settings.NewSettingsWithStores(apiKeys, nil, &generationTestAppSettingStore{values: map[string]string{}})
}

func generationTestWorkspaceDBPath(t *testing.T) string {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "workspace.db")
	t.Cleanup(func() {
		if err := repository.CloseDatabasePath(dbPath); err != nil {
			t.Errorf("closing generation test database: %v", err)
		}
	})
	return dbPath
}
