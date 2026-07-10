package mcp

import (
	"path/filepath"

	appworkspace "github.com/mediago-dev/mediago-drama/services/server/internal/app/workspace"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	servicelicense "github.com/mediago-dev/mediago-drama/services/server/internal/service/license"
	servicepromptpack "github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
	serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"
)

func newSkillRegistryForWorkspace(store *appworkspace.WorkspaceStateService) *serviceskill.Registry {
	if store == nil {
		return serviceskill.NewRegistry()
	}
	settingsDBPath := store.SettingsDatabasePath()
	repos, err := repository.OpenSettingsRepositories(settingsDBPath)
	licenseService, _ := servicelicense.NewFromEnvironment(filepath.Join(filepath.Dir(settingsDBPath), "license"))
	promptPack := servicepromptpack.NewServiceFromRepositoryWithPackFilesDirAndLicense(
		repos.Packs,
		repos.PromptLibrary,
		err,
		filepath.Join(filepath.Dir(settingsDBPath), "packs"),
		licenseService,
	)
	return serviceskill.NewRegistryWithStore(promptPack)
}
