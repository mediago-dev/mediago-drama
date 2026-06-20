package service

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/approval"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/chat"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/document"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

// WorkspaceStateService is the stable aggregate entry point for workspace state.
type WorkspaceStateService struct {
	Documents   *document.Service
	Approvals   *approval.Service
	Chat        *chat.Service
	EditStreams *document.EditStreamService

	dir           string
	agentSessions *repository.AgentSessionRepository
	initErr       error
}

// WorkspaceStateRepositories groups repositories used by WorkspaceStateService.
type WorkspaceStateRepositories = repository.WorkspaceRepositories

// NewWorkspaceStateService returns a workspace state service for a local workspace.
func NewWorkspaceStateService(workspaceDir string) *WorkspaceStateService {
	store := &WorkspaceStateService{
		dir: shared.ResolveWorkspaceDir(workspaceDir),
	}
	if err := store.initialize(); err != nil {
		store.initErr = err
	}
	return store
}

// NewWorkspaceStateServiceFromRepositories returns a workspace state service backed
// by already constructed repositories.
func NewWorkspaceStateServiceFromRepositories(workspaceDir string, repos WorkspaceStateRepositories, initErr error) *WorkspaceStateService {
	store := &WorkspaceStateService{
		dir:           shared.ResolveWorkspaceDir(workspaceDir),
		agentSessions: repos.AgentSessions,
		initErr:       initErr,
	}
	if store.initErr == nil {
		store.initErr = validateWorkspaceStateRepositories(repos)
	}
	if store.initErr == nil {
		store.initErr = cleanupDeprecatedWorkspaceProjects(store.dir, repos)
	}
	store.compose(repos)
	return store
}

// Dir returns the resolved workspace root.
func (store *WorkspaceStateService) Dir() string {
	if store == nil {
		return ""
	}
	return store.dir
}

// InitErr returns initialization failure, if any.
func (store *WorkspaceStateService) InitErr() error {
	if store == nil {
		return fmt.Errorf("workspace state service is nil")
	}
	return store.initErr
}

// AgentSessionRepository returns the repository used by the session service.
func (store *WorkspaceStateService) AgentSessionRepository() *repository.AgentSessionRepository {
	if store == nil {
		return nil
	}
	return store.agentSessions
}

// Close releases buffered workspace resources.
func (store *WorkspaceStateService) Close() error {
	if store == nil || store.Chat == nil {
		return nil
	}
	return store.Chat.Close()
}

func validateWorkspaceStateRepositories(repos WorkspaceStateRepositories) error {
	switch {
	case repos.Workspace == nil:
		return fmt.Errorf("workspace repository is nil")
	case repos.EditStreams == nil:
		return fmt.Errorf("document edit stream repository is nil")
	case repos.AgentSessions == nil:
		return fmt.Errorf("agent session repository is nil")
	case repos.Approvals == nil:
		return fmt.Errorf("document tool approval repository is nil")
	default:
		return nil
	}
}

func (store *WorkspaceStateService) initialize() error {
	if err := store.ensureWorkspaceLayout(); err != nil {
		return err
	}

	repos, err := repository.OpenWorkspaceRepositories(store.databasePath())
	if err != nil {
		return err
	}
	if err := cleanupDeprecatedWorkspaceProjects(store.dir, repos); err != nil {
		return err
	}
	store.agentSessions = repos.AgentSessions
	store.compose(repos)
	return nil
}

func (store *WorkspaceStateService) compose(repos WorkspaceStateRepositories) {
	store.Approvals = approval.NewService(repos.Approvals, store.initErr)
	store.Documents = document.NewService(store.dir, repos.Workspace, store.Approvals, store.initErr)
	store.EditStreams = document.NewEditStreamService(repos.EditStreams, store.initErr)
	store.Documents.SetEditStreamService(store.EditStreams)
	store.Chat = chat.NewService(store.dir, repos.AgentSessions, store.Documents, store.initErr)
}

func (store *WorkspaceStateService) ensureWorkspaceLayout() error {
	return shared.EnsureWorkspaceLayout(store.dir)
}

func (store *WorkspaceStateService) databasePath() string {
	return shared.WorkspacePathsFor(store.dir).DatabasePath()
}

func cleanupDeprecatedWorkspaceProjects(workspaceDir string, repos WorkspaceStateRepositories) error {
	if repos.Workspace == nil {
		return nil
	}
	deleted, err := repos.Workspace.DeleteProjectsWithoutProjectDir()
	if err != nil {
		return fmt.Errorf("cleaning deprecated internal projects: %w", err)
	}
	if deleted > 0 {
		slog.Info("deprecated internal workspace projects removed", "count", deleted)
	}
	studioProjects, err := repos.Workspace.DeleteDeprecatedStudioCapabilityProjects()
	if err != nil {
		return fmt.Errorf("cleaning deprecated studio projects: %w", err)
	}
	for _, project := range studioProjects {
		if err := removeDeprecatedStudioProjectDir(workspaceDir, project); err != nil {
			return err
		}
	}
	if len(studioProjects) > 0 {
		slog.Info("deprecated studio workspace projects removed", "count", len(studioProjects))
	}
	migrated, err := migrateDeprecatedLocalProjectDirs(workspaceDir, repos)
	if err != nil {
		return fmt.Errorf("migrating deprecated local projects: %w", err)
	}
	if migrated > 0 {
		slog.Info("deprecated local workspace projects migrated", "count", migrated)
	}
	return nil
}

func removeDeprecatedStudioProjectDir(workspaceDir string, project domain.WorkspaceProjectModel) error {
	projectDir := shared.ResolveWorkspaceDir(project.ProjectDir)
	if !isDeprecatedStudioProjectDir(workspaceDir, projectDir) {
		return nil
	}
	if err := os.RemoveAll(projectDir); err != nil {
		return fmt.Errorf("removing deprecated studio project dir %s: %w", projectDir, err)
	}
	return nil
}

func isDeprecatedStudioProjectDir(workspaceDir string, projectDir string) bool {
	projectDir = shared.ResolveWorkspaceDir(projectDir)
	for _, studioDir := range deprecatedStudioProjectRoots(workspaceDir) {
		relative, err := filepath.Rel(studioDir, projectDir)
		if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
			continue
		}
		return strings.HasPrefix(filepath.Base(projectDir), "project-")
	}
	return false
}

func deprecatedStudioProjectRoots(workspaceDir string) []string {
	paths := shared.WorkspacePathsFor(workspaceDir)
	return []string{
		paths.StudioSessionDir(""),
		filepath.Join(paths.Root, "toolbox"),
		filepath.Join(paths.Root, "studio"),
	}
}

func migrateDeprecatedLocalProjectDirs(workspaceDir string, repos WorkspaceStateRepositories) (int, error) {
	if repos.Workspace == nil {
		return 0, nil
	}
	projects, err := repos.Workspace.ListProjects()
	if err != nil {
		return 0, fmt.Errorf("listing workspace projects: %w", err)
	}

	migrated := 0
	for _, project := range projects {
		projectDir := shared.ResolveWorkspaceDir(project.ProjectDir)
		if !isDeprecatedLocalProjectDir(workspaceDir, project.ID, projectDir) &&
			!isLegacyAgentProjectDir(workspaceDir, project.ID, projectDir) {
			continue
		}
		nextDir := canonicalProjectDir(workspaceDir, project)
		if nextDir == "" || nextDir == projectDir {
			continue
		}
		if err := moveDeprecatedLocalProjectDir(projectDir, nextDir); err != nil {
			return migrated, err
		}
		relativeDir := shared.DisplayProjectDir(workspaceDir, nextDir)
		updated, err := repos.Workspace.UpdateProjectStorageLocation(
			project.ID,
			nextDir,
			relativeDir,
			projectDir,
			nextDir,
			timestamp.NowRFC3339Nano(),
		)
		if err != nil {
			return migrated, err
		}
		if updated {
			migrated++
		}
	}
	removeDeprecatedLocalProjectsRootIfEmpty(workspaceDir)
	removeLegacyAgentProjectsRootIfEmpty(workspaceDir)
	return migrated, nil
}

func canonicalProjectDir(workspaceDir string, project domain.WorkspaceProjectModel) string {
	projectID := domain.CleanProjectID(project.ID)
	if projectID == "" {
		return ""
	}
	return shared.WorkspacePathsFor(workspaceDir).AgentDir(projectID)
}

func isDeprecatedLocalProjectDir(workspaceDir string, projectID string, projectDir string) bool {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return false
	}
	projectDir = shared.ResolveWorkspaceDir(projectDir)
	localProjectsDir := filepath.Join(shared.WorkspacePathsFor(workspaceDir).Root, "local-projects")
	relative, err := filepath.Rel(localProjectsDir, projectDir)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return false
	}
	return relative == projectID && strings.HasPrefix(projectID, "project-")
}

func isLegacyAgentProjectDir(workspaceDir string, projectID string, projectDir string) bool {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return false
	}
	projectDir = shared.ResolveWorkspaceDir(projectDir)
	legacyAgentDir := filepath.Join(shared.WorkspacePathsFor(workspaceDir).Root, "agent")
	relative, err := filepath.Rel(legacyAgentDir, projectDir)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return false
	}
	return relative == projectID && strings.HasPrefix(projectID, "project-")
}

func moveDeprecatedLocalProjectDir(oldDir string, newDir string) error {
	oldDir = shared.ResolveWorkspaceDir(oldDir)
	newDir = shared.ResolveWorkspaceDir(newDir)
	if oldDir == newDir {
		return nil
	}
	info, err := os.Stat(oldDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("reading deprecated local project dir %s: %w", oldDir, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("deprecated local project path is not a directory: %s", oldDir)
	}
	if _, err := os.Stat(newDir); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("reading canonical project dir %s: %w", newDir, err)
	}
	if err := os.MkdirAll(filepath.Dir(newDir), 0o755); err != nil {
		return fmt.Errorf("creating canonical project parent %s: %w", filepath.Dir(newDir), err)
	}
	if err := os.Rename(oldDir, newDir); err != nil {
		return fmt.Errorf("moving deprecated local project dir %s to %s: %w", oldDir, newDir, err)
	}
	return nil
}

func removeDeprecatedLocalProjectsRootIfEmpty(workspaceDir string) {
	localProjectsDir := filepath.Join(shared.WorkspacePathsFor(workspaceDir).Root, "local-projects")
	_ = os.Remove(localProjectsDir)
}

func removeLegacyAgentProjectsRootIfEmpty(workspaceDir string) {
	legacyAgentDir := filepath.Join(shared.WorkspacePathsFor(workspaceDir).Root, "agent")
	_ = os.Remove(legacyAgentDir)
}
