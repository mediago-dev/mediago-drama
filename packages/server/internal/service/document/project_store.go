package document

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/service/shared"
)

const persistedProjectCategory = "agent"

func (store *Service) listProjects() (workspaceProjectsResponse, error) {
	if store.initErr != nil {
		return workspaceProjectsResponse{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	projects, err := store.loadProjectsUnlocked()
	if err != nil {
		return workspaceProjectsResponse{}, err
	}

	return workspaceProjectsResponse{
		WorkspaceDir: store.dir,
		DatabasePath: store.databasePath(),
		Projects:     projects,
	}, nil
}

// ListProjects returns workspace project metadata for HTTP handlers.
func (store *Service) ListProjects() (workspaceProjectsResponse, error) {
	return store.listProjects()
}

func (store *Service) createProject(id string, request createWorkspaceProjectRequest) (workspaceProjectRecord, error) {
	if store.initErr != nil {
		return workspaceProjectRecord{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	id = domain.CleanProjectID(id)
	if id == "" {
		id = fmt.Sprintf("project-%d", time.Now().UnixNano())
	}
	name := strings.TrimSpace(request.Name)
	projectDir := strings.TrimSpace(request.ProjectDir)
	if projectDir == "" {
		projectDir = defaultProjectDir(store.dir, id)
	} else {
		var err error
		projectDir, err = cleanExistingProjectDir(projectDir)
		if err != nil {
			return workspaceProjectRecord{}, err
		}
	}
	if name == "" {
		name = fallbackProjectNameFromDir(projectDir)
	}
	relativeDir := shared.DisplayProjectDir(store.dir, projectDir)
	now := timestamp.NowRFC3339Nano()
	project := workspaceProjectRecord{
		ID:            id,
		Name:          name,
		Description:   strings.TrimSpace(request.Description),
		ProjectDir:    projectDir,
		RelativeDir:   relativeDir,
		DocumentCount: 0,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	if err := store.ensureProjectLayout(project); err != nil {
		return workspaceProjectRecord{}, err
	}
	if err := store.insertProjectUnlocked(project); err != nil {
		return workspaceProjectRecord{}, err
	}

	initialState := workspaceStateRequest{
		Documents:    []mediamcp.WorkspaceDocument{},
		OperationLog: []documentOperationLogRecord{},
	}
	if _, err := store.saveUnlocked(id, initialState); err != nil {
		return workspaceProjectRecord{}, err
	}

	return project, nil
}

// CreateProject creates a workspace project for HTTP handlers.
func (store *Service) CreateProject(id string, request createWorkspaceProjectRequest) (workspaceProjectRecord, error) {
	return store.createProject(id, request)
}

func (store *Service) deleteProject(projectID string) (workspaceProjectRecord, bool, error) {
	if store.initErr != nil {
		return workspaceProjectRecord{}, false, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return workspaceProjectRecord{}, false, fmt.Errorf("projectId is required")
	}

	model, err := store.workspace.GetProject(projectID)
	if err != nil {
		if repository.IsRecordNotFound(err) {
			return workspaceProjectRecord{}, false, nil
		}
		return workspaceProjectRecord{}, false, fmt.Errorf("reading project %s: %w", projectID, err)
	}
	projects := WorkspaceProjectRecordsFromModels([]workspaceProjectModel{model})
	if len(projects) == 0 {
		return workspaceProjectRecord{}, false, nil
	}

	deleted, err := store.workspace.DeleteProject(projectID)
	if err != nil {
		return workspaceProjectRecord{}, false, fmt.Errorf("deleting project %s: %w", projectID, err)
	}
	if !deleted {
		return workspaceProjectRecord{}, false, nil
	}

	return projects[0], true, nil
}

// DeleteProject deletes a workspace project for HTTP handlers.
func (store *Service) DeleteProject(projectID string) (workspaceProjectRecord, bool, error) {
	return store.deleteProject(projectID)
}

func (store *Service) LoadProjectBrief(projectID string) (ProjectBrief, error) {
	if store.initErr != nil {
		return ProjectBrief{}, store.initErr
	}

	store.mu.RLock()
	defer store.mu.RUnlock()

	return store.loadProjectBriefUnlocked(projectID)
}

func (store *Service) SaveProjectBrief(projectID string, brief ProjectBrief, mask ProjectBriefUpdateMask) (ProjectBrief, error) {
	if store.initErr != nil {
		return ProjectBrief{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return ProjectBrief{}, fmt.Errorf("projectId is required")
	}
	if err := store.ensureProjectRecordUnlocked(projectID); err != nil {
		return ProjectBrief{}, err
	}

	current, err := store.loadProjectBriefUnlocked(projectID)
	if err != nil {
		return ProjectBrief{}, err
	}
	if mask.Empty() {
		return current, nil
	}

	next := current.Apply(brief, mask)
	now := NowProjectBriefTimestamp()
	next.UpdatedAt = now
	briefJSON, err := EncodeProjectBriefJSON(next)
	if err != nil {
		return ProjectBrief{}, err
	}

	if err := store.workspace.UpdateProjectBrief(projectID, briefJSON, now); err != nil {
		return ProjectBrief{}, fmt.Errorf("saving project brief for %s: %w", projectID, err)
	}
	return next, nil
}

// SaveProjectBriefPatchInput applies an MCP project brief patch to the workspace store.
func (store *Service) SaveProjectBriefPatchInput(projectID string, input mediamcp.ProjectBriefPatchInput) (ProjectBriefMutationResult, error) {
	update, mask := ProjectBriefPatchToUpdate(ProjectBriefPatch{
		Medium:     input.Medium,
		Genre:      input.Genre,
		Pacing:     input.Pacing,
		Audience:   input.Audience,
		Tone:       input.Tone,
		Style:      input.Style,
		References: input.References,
		Notes:      input.Notes,
	})
	brief, err := store.SaveProjectBrief(projectID, update, mask)
	if err != nil {
		return ProjectBriefMutationResult{}, err
	}
	return ProjectBriefMutationResult{Brief: brief, Changed: !mask.Empty()}, nil
}

func (store *Service) loadProjectBriefUnlocked(projectID string) (ProjectBrief, error) {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return ProjectBrief{}, nil
	}

	model, err := store.workspace.GetProject(projectID)
	if err != nil {
		if repository.IsRecordNotFound(err) {
			return ProjectBrief{}, nil
		}
		return ProjectBrief{}, fmt.Errorf("reading project brief for %s: %w", projectID, err)
	}
	if !model.BriefJSON.Valid {
		return ProjectBrief{}, nil
	}
	return DecodeProjectBriefJSON(projectID, model.BriefJSON.String)
}

func (store *Service) loadProjectsUnlocked() ([]workspaceProjectRecord, error) {
	models, err := store.workspace.ListProjects()
	if err != nil {
		return nil, fmt.Errorf("reading projects: %w", err)
	}

	projects := WorkspaceProjectRecordsFromModels(models)
	if len(projects) == 0 {
		return []workspaceProjectRecord{}, nil
	}

	for index := range projects {
		if err := store.ensureProjectLayout(projects[index]); err != nil {
			return nil, err
		}
		count, err := store.countProjectDocumentsUnlocked(projects[index].ID)
		if err != nil {
			return nil, err
		}
		projects[index].DocumentCount = count
	}

	return NormalizeProjectRecords(projects), nil
}

func (store *Service) countProjectDocumentsUnlocked(projectID string) (int, error) {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return 0, nil
	}
	documents, _, err := store.loadLocalMarkdownWorkspaceUnlocked(projectID)
	if err != nil {
		return 0, fmt.Errorf("counting project documents: %w", err)
	}
	return CountRegularWorkspaceDocuments(documents), nil
}

func (store *Service) insertProjectUnlocked(project workspaceProjectRecord) error {
	projects := NormalizeProjectRecords([]workspaceProjectRecord{project})
	if len(projects) == 0 {
		return nil
	}
	project = projects[0]
	if err := store.ensureProjectLayout(project); err != nil {
		return err
	}
	model := workspaceProjectModel{
		ID:          project.ID,
		Name:        project.Name,
		Category:    persistedProjectCategory,
		Description: project.Description,
		ProjectDir:  project.ProjectDir,
		RelativeDir: project.RelativeDir,
		CreatedAt:   project.CreatedAt,
		UpdatedAt:   project.UpdatedAt,
	}
	if err := store.workspace.UpsertProject(model); err != nil {
		return fmt.Errorf("saving project %s: %w", project.ID, err)
	}

	return nil
}

func (store *Service) ensureProjectRecordUnlocked(projectID string) error {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return nil
	}

	exists, err := store.workspace.ProjectExists(projectID)
	if err != nil {
		return fmt.Errorf("checking project %s: %w", projectID, err)
	}
	if exists {
		return nil
	}
	return fmt.Errorf("project %s is not registered; create it with projectDir first", projectID)
}

func cleanExistingProjectDir(projectDir string) (string, error) {
	projectDir = shared.ResolveWorkspaceDir(projectDir)
	info, err := os.Stat(projectDir)
	if err != nil {
		return "", fmt.Errorf("projectDir must be an existing directory: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("projectDir must be a directory")
	}
	return projectDir, nil
}

func defaultProjectDir(workspaceDir string, projectID string) string {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		projectID = fmt.Sprintf("project-%d", time.Now().UnixNano())
	}
	return shared.WorkspacePathsFor(workspaceDir).AgentDir(projectID)
}

func fallbackProjectNameFromDir(projectDir string) string {
	if strings.TrimSpace(projectDir) == "" {
		return "未命名项目"
	}
	name := strings.TrimSpace(filepath.Base(projectDir))
	if name == "." || name == string(filepath.Separator) || name == "" {
		return "未命名项目"
	}
	return name
}
