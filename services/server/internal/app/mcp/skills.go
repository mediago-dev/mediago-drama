package mcp

import (
	"path/filepath"

	appworkspace "github.com/mediago-dev/mediago-drama/services/server/internal/app/workspace"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	servicepromptpack "github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
	serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"
)

func newSkillRegistryForWorkspace(store *appworkspace.WorkspaceStateService) *serviceskill.Registry {
	if store == nil {
		return serviceskill.NewRegistry()
	}
	settingsDBPath := store.SettingsDatabasePath()
	repos, err := repository.OpenSettingsRepositories(settingsDBPath)
	promptPack := servicepromptpack.NewServiceFromRepositoryWithPackFilesDir(
		repos.Packs,
		repos.PromptLibrary,
		err,
		filepath.Join(filepath.Dir(settingsDBPath), "packs"),
	)
	return serviceskill.NewRegistryWithStore(promptPack)
}
