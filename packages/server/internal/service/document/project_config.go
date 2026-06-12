package document

import (
	"fmt"
	"path/filepath"
	"reflect"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/service/shared"
)

// LoadProjectConfig loads the canonical project.media.json config.
func (store *Service) LoadProjectConfig(projectID string) (mediamcp.ProjectConfig, error) {
	if store.initErr != nil {
		return mediamcp.ProjectConfig{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	return store.loadProjectConfigUnlocked(projectID)
}

// SaveProjectConfigPatchInput applies a sparse project.media.json patch.
func (store *Service) SaveProjectConfigPatchInput(projectID string, input mediamcp.ProjectConfigPatchInput) (ProjectConfigMutationResult, error) {
	if store.initErr != nil {
		return ProjectConfigMutationResult{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return ProjectConfigMutationResult{}, fmt.Errorf("projectId is required")
	}

	config, err := store.loadProjectConfigUnlocked(projectID)
	if err != nil {
		return ProjectConfigMutationResult{}, err
	}

	next := config
	if input.Overview != nil {
		if input.Overview.Style != nil {
			next.Overview.Style = strings.TrimSpace(*input.Overview.Style)
		}
		if input.Overview.LayerDefaults != nil {
			next.Overview.LayerDefaults = normalizeLayerDefaults(input.Overview.LayerDefaults)
		}
	}
	if reflect.DeepEqual(next, config) {
		return ProjectConfigMutationResult{Config: config, Changed: false}, nil
	}

	projectDir := store.projectDir(projectID)
	if projectDir == "" {
		return ProjectConfigMutationResult{}, fmt.Errorf("project %s is not registered with projectDir", projectID)
	}
	if err := shared.WriteJSONFile(filepath.Join(projectDir, "project.media.json"), projectManifestFromMCPConfig(next)); err != nil {
		return ProjectConfigMutationResult{}, err
	}
	return ProjectConfigMutationResult{Config: next, Changed: true}, nil
}

func (store *Service) loadProjectConfigUnlocked(projectID string) (mediamcp.ProjectConfig, error) {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return mediamcp.ProjectConfig{}, fmt.Errorf("projectId is required")
	}

	model, err := store.workspace.GetProject(projectID)
	if err != nil {
		if repository.IsRecordNotFound(err) {
			return mediamcp.ProjectConfig{}, fmt.Errorf("project %s is not registered", projectID)
		}
		return mediamcp.ProjectConfig{}, fmt.Errorf("reading project %s: %w", projectID, err)
	}
	projects := WorkspaceProjectRecordsFromModels([]workspaceProjectModel{model})
	if len(projects) == 0 {
		return mediamcp.ProjectConfig{}, fmt.Errorf("project %s is not registered", projectID)
	}
	project := projects[0]
	if err := store.ensureProjectLayout(project); err != nil {
		return mediamcp.ProjectConfig{}, err
	}

	manifest, err := shared.ReadProjectManifestFile(filepath.Join(project.ProjectDir, "project.media.json"))
	if err != nil {
		return mediamcp.ProjectConfig{}, err
	}
	return mcpProjectConfigFromManifest(manifest), nil
}

func mcpProjectConfigFromManifest(manifest shared.ProjectManifestFile) mediamcp.ProjectConfig {
	return mediamcp.ProjectConfig{
		SchemaVersion: manifest.SchemaVersion,
		ProjectID:     manifest.ProjectID,
		Name:          manifest.Name,
		Description:   manifest.Description,
		Overview: mediamcp.ProjectOverviewConfig{
			Style:         manifest.Overview.Style,
			LayerDefaults: normalizeLayerDefaults(manifest.Overview.LayerDefaults),
		},
		CreatedAt: manifest.CreatedAt,
	}
}

// normalizeLayerDefaults trims and drops empty entries; returns nil when empty.
func normalizeLayerDefaults(defaults map[string]string) map[string]string {
	if len(defaults) == 0 {
		return nil
	}
	normalized := map[string]string{}
	for layer, presetID := range defaults {
		layer = strings.TrimSpace(layer)
		presetID = strings.TrimSpace(presetID)
		if layer == "" || presetID == "" {
			continue
		}
		normalized[layer] = presetID
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func projectManifestFromMCPConfig(config mediamcp.ProjectConfig) shared.ProjectManifestFile {
	return shared.ProjectManifestFile{
		SchemaVersion: 1,
		ProjectID:     domain.CleanProjectID(config.ProjectID),
		Name:          strings.TrimSpace(config.Name),
		Description:   strings.TrimSpace(config.Description),
		Overview: shared.ProjectManifestOverviewFile{
			Style:         strings.TrimSpace(config.Overview.Style),
			LayerDefaults: normalizeLayerDefaults(config.Overview.LayerDefaults),
		},
		CreatedAt: strings.TrimSpace(config.CreatedAt),
	}
}
