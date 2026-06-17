package repository

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// WorkspaceRepository persists workspace projects and operation logs.
type WorkspaceRepository struct {
	db *gorm.DB
}

const (
	ProjectStatusActive   = "active"
	ProjectStatusArchived = "archived"
	ProjectStatusTrashed  = "trashed"
	ProjectStatusAll      = "all"
)

// NewWorkspaceRepository creates a workspace repository.
func NewWorkspaceRepository(db *gorm.DB) *WorkspaceRepository {
	return &WorkspaceRepository{db: db}
}

// GetProject returns a project by ID.
func (repo *WorkspaceRepository) GetProject(projectID string) (domain.WorkspaceProjectModel, error) {
	var model domain.WorkspaceProjectModel
	err := repo.db.First(&model, "id = ?", strings.TrimSpace(projectID)).Error
	if IsRecordNotFound(err) {
		return domain.WorkspaceProjectModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.WorkspaceProjectModel{}, fmt.Errorf("getting project: %w", err)
	}
	return normalizeProjectModel(model), nil
}

// ProjectExists reports whether a project exists.
func (repo *WorkspaceRepository) ProjectExists(projectID string) (bool, error) {
	var model domain.WorkspaceProjectModel
	err := repo.db.Select("id").First(&model, "id = ?", strings.TrimSpace(projectID)).Error
	if IsRecordNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("checking project: %w", err)
	}
	return true, nil
}

// ListProjects returns active projects ordered by last update.
func (repo *WorkspaceRepository) ListProjects() ([]domain.WorkspaceProjectModel, error) {
	return repo.ListProjectsByStatus(ProjectStatusActive)
}

// ListProjectsByStatus returns projects filtered by lifecycle status.
func (repo *WorkspaceRepository) ListProjectsByStatus(status string) ([]domain.WorkspaceProjectModel, error) {
	models := []domain.WorkspaceProjectModel{}
	query := repo.db.Order("updated_at DESC, created_at DESC")
	switch NormalizeProjectStatus(status) {
	case ProjectStatusArchived:
		query = query.Where("status = ?", ProjectStatusArchived)
	case ProjectStatusTrashed:
		query = query.Where("status = ?", ProjectStatusTrashed)
	case ProjectStatusAll:
	default:
		query = query.Where("status = '' OR status = ?", ProjectStatusActive)
	}
	if err := query.Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing projects: %w", err)
	}
	for index := range models {
		models[index] = normalizeProjectModel(models[index])
	}
	return models, nil
}

// UpsertProject inserts or updates a project.
func (repo *WorkspaceRepository) UpsertProject(model domain.WorkspaceProjectModel) error {
	if err := repo.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"name",
			"category",
			"status",
			"description",
			"project_dir",
			"relative_dir",
			"original_project_dir",
			"trash_project_dir",
			"archived_at",
			"trashed_at",
			"updated_at",
		}),
	}).Create(&model).Error; err != nil {
		return fmt.Errorf("upserting project: %w", err)
	}
	return nil
}

// ArchiveProject marks a project archived without moving its files.
func (repo *WorkspaceRepository) ArchiveProject(projectID string, archivedAt string) (bool, error) {
	projectID = strings.TrimSpace(projectID)
	archivedAt = strings.TrimSpace(archivedAt)
	if projectID == "" {
		return false, fmt.Errorf("project id is required")
	}
	result := repo.db.Model(&domain.WorkspaceProjectModel{}).
		Where("id = ? AND status <> ?", projectID, ProjectStatusTrashed).
		Updates(map[string]any{
			"status":      ProjectStatusArchived,
			"archived_at": archivedAt,
			"trashed_at":  "",
			"updated_at":  archivedAt,
		})
	if result.Error != nil {
		return false, fmt.Errorf("archiving project %s: %w", projectID, result.Error)
	}
	return result.RowsAffected > 0, nil
}

// TrashProject marks a project as moved to the app trash.
func (repo *WorkspaceRepository) TrashProject(projectID string, originalProjectDir string, trashProjectDir string, relativeDir string, trashedAt string) (bool, error) {
	projectID = strings.TrimSpace(projectID)
	originalProjectDir = strings.TrimSpace(originalProjectDir)
	trashProjectDir = strings.TrimSpace(trashProjectDir)
	relativeDir = strings.TrimSpace(relativeDir)
	trashedAt = strings.TrimSpace(trashedAt)
	if projectID == "" {
		return false, fmt.Errorf("project id is required")
	}
	if originalProjectDir == "" || trashProjectDir == "" || relativeDir == "" {
		return false, fmt.Errorf("project trash paths are required")
	}
	result := repo.db.Model(&domain.WorkspaceProjectModel{}).
		Where("id = ? AND status <> ?", projectID, ProjectStatusTrashed).
		Updates(map[string]any{
			"status":               ProjectStatusTrashed,
			"project_dir":          trashProjectDir,
			"relative_dir":         relativeDir,
			"original_project_dir": originalProjectDir,
			"trash_project_dir":    trashProjectDir,
			"archived_at":          "",
			"trashed_at":           trashedAt,
			"updated_at":           trashedAt,
		})
	if result.Error != nil {
		return false, fmt.Errorf("trashing project %s: %w", projectID, result.Error)
	}
	return result.RowsAffected > 0, nil
}

// RestoreProject marks a project active and points it at a restored project directory.
func (repo *WorkspaceRepository) RestoreProject(projectID string, projectDir string, relativeDir string, updatedAt string) (bool, error) {
	projectID = strings.TrimSpace(projectID)
	projectDir = strings.TrimSpace(projectDir)
	relativeDir = strings.TrimSpace(relativeDir)
	updatedAt = strings.TrimSpace(updatedAt)
	if projectID == "" {
		return false, fmt.Errorf("project id is required")
	}
	if projectDir == "" || relativeDir == "" {
		return false, fmt.Errorf("project storage location is required")
	}

	updated := false
	err := repo.db.Transaction(func(tx *gorm.DB) error {
		var project domain.WorkspaceProjectModel
		if err := tx.First(&project, "id = ?", projectID).Error; err != nil {
			if IsRecordNotFound(err) {
				return ErrRecordNotFound
			}
			return fmt.Errorf("reading project: %w", err)
		}
		project = normalizeProjectModel(project)
		result := tx.Model(&domain.WorkspaceProjectModel{}).
			Where("id = ?", projectID).
			Updates(map[string]any{
				"status":               ProjectStatusActive,
				"project_dir":          projectDir,
				"relative_dir":         relativeDir,
				"original_project_dir": "",
				"trash_project_dir":    "",
				"archived_at":          "",
				"trashed_at":           "",
				"updated_at":           updatedAt,
			})
		if result.Error != nil {
			return fmt.Errorf("restoring project: %w", result.Error)
		}
		updated = result.RowsAffected > 0
		if !updated {
			return nil
		}
		oldDir := project.OriginalProjectDir
		if oldDir == "" {
			oldDir = project.ProjectDir
		}
		if oldDir == "" || oldDir == projectDir {
			return nil
		}
		if err := updateProjectPathPrefix(tx, &domain.ProjectAssetModel{}, "path", projectID, oldDir, projectDir); err != nil {
			return fmt.Errorf("updating project asset paths: %w", err)
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrRecordNotFound) {
			return false, nil
		}
		return false, fmt.Errorf("restoring project %s: %w", projectID, err)
	}
	return updated, nil
}

// UpdateProjectStorageLocation moves a project record to a new storage path and rewrites project-scoped file paths.
func (repo *WorkspaceRepository) UpdateProjectStorageLocation(
	projectID string,
	projectDir string,
	relativeDir string,
	oldDir string,
	newDir string,
	updatedAt string,
) (bool, error) {
	projectID = strings.TrimSpace(projectID)
	projectDir = strings.TrimSpace(projectDir)
	relativeDir = strings.TrimSpace(relativeDir)
	oldDir = strings.TrimSpace(oldDir)
	newDir = strings.TrimSpace(newDir)
	updatedAt = strings.TrimSpace(updatedAt)
	if projectID == "" {
		return false, fmt.Errorf("project id is required")
	}
	if projectDir == "" || relativeDir == "" {
		return false, fmt.Errorf("project storage location is required")
	}

	updated := false
	err := repo.db.Transaction(func(tx *gorm.DB) error {
		updates := map[string]any{
			"project_dir":  projectDir,
			"relative_dir": relativeDir,
		}
		if updatedAt != "" {
			updates["updated_at"] = updatedAt
		}
		result := tx.Model(&domain.WorkspaceProjectModel{}).
			Where("id = ?", projectID).
			Updates(updates)
		if result.Error != nil {
			return fmt.Errorf("updating project storage location: %w", result.Error)
		}
		updated = result.RowsAffected > 0
		if !updated || oldDir == "" || newDir == "" || oldDir == newDir {
			return nil
		}

		if err := updateProjectPathPrefix(tx, &domain.ProjectAssetModel{}, "path", projectID, oldDir, newDir); err != nil {
			return fmt.Errorf("updating project asset paths: %w", err)
		}
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("updating project %s storage location: %w", projectID, err)
	}
	return updated, nil
}

func updateProjectPathPrefix(
	tx *gorm.DB,
	model any,
	column string,
	projectID string,
	oldDir string,
	newDir string,
) error {
	oldChildPrefix := oldDir + string(filepath.Separator)
	err := tx.Model(model).
		Where("project_id = ? AND (? = "+column+" OR instr("+column+", ?) = 1)", projectID, oldDir, oldChildPrefix).
		Update(column, gorm.Expr("replace("+column+", ?, ?)", oldDir, newDir)).
		Error
	if err != nil {
		return err
	}
	return nil
}

// DeleteProject permanently deletes a project and project-scoped workspace records.
func (repo *WorkspaceRepository) DeleteProject(projectID string) (bool, error) {
	return repo.PermanentlyDeleteProject(projectID)
}

// PermanentlyDeleteProject deletes a project and project-scoped workspace records.
func (repo *WorkspaceRepository) PermanentlyDeleteProject(projectID string) (bool, error) {
	projectID = strings.TrimSpace(projectID)
	deleted := false

	err := repo.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Delete(&domain.WorkspaceProjectModel{}, "id = ?", projectID)
		if result.Error != nil {
			return fmt.Errorf("deleting project: %w", result.Error)
		}
		deleted = result.RowsAffected > 0
		if !deleted {
			return nil
		}

		if err := tx.Delete(&domain.EpisodeTimelineModel{}, "project_id = ?", projectID).Error; err != nil {
			return fmt.Errorf("deleting episode timelines: %w", err)
		}
		if err := tx.Delete(&domain.DocumentOperationLogModel{}, "project_id = ?", projectID).Error; err != nil {
			return fmt.Errorf("deleting document operation logs: %w", err)
		}
		if err := tx.Delete(&domain.DocumentToolApprovalModel{}, "project_id = ?", projectID).Error; err != nil {
			return fmt.Errorf("deleting document tool approvals: %w", err)
		}
		if err := tx.Delete(&domain.DocumentEditStreamModel{}, "project_id = ?", projectID).Error; err != nil {
			return fmt.Errorf("deleting document edit streams: %w", err)
		}
		if err := tx.Delete(&domain.ProjectAssetModel{}, "project_id = ?", projectID).Error; err != nil {
			return fmt.Errorf("deleting project assets: %w", err)
		}

		if err := tx.Delete(&domain.AgentSessionModel{}, "project_id = ?", projectID).Error; err != nil {
			return fmt.Errorf("deleting agent sessions: %w", err)
		}

		return nil
	})
	if err != nil {
		return false, fmt.Errorf("deleting project %s: %w", projectID, err)
	}
	return deleted, nil
}

// NormalizeProjectStatus normalizes external project status filters.
func NormalizeProjectStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "", ProjectStatusActive:
		return ProjectStatusActive
	case ProjectStatusArchived:
		return ProjectStatusArchived
	case ProjectStatusTrashed:
		return ProjectStatusTrashed
	case ProjectStatusAll:
		return ProjectStatusAll
	default:
		return ProjectStatusActive
	}
}

func normalizeProjectModel(model domain.WorkspaceProjectModel) domain.WorkspaceProjectModel {
	model.Status = NormalizeProjectStatus(model.Status)
	return model
}

const deprecatedStudioCapabilitySessionDescriptionPrefix = "__studio_capability_session__:"

// DeleteProjectsWithoutProjectDir removes deprecated internal projects and their derived records.
func (repo *WorkspaceRepository) DeleteProjectsWithoutProjectDir() (int, error) {
	projectIDs := []string{}
	if err := repo.db.Model(&domain.WorkspaceProjectModel{}).
		Where("project_dir IS NULL OR TRIM(project_dir) = ''").
		Pluck("id", &projectIDs).Error; err != nil {
		return 0, fmt.Errorf("listing internal projects: %w", err)
	}
	deleted := 0
	for _, projectID := range projectIDs {
		ok, err := repo.DeleteProject(projectID)
		if err != nil {
			return deleted, err
		}
		if ok {
			deleted++
		}
	}
	return deleted, nil
}

// DeleteDeprecatedStudioCapabilityProjects removes legacy studio project records.
func (repo *WorkspaceRepository) DeleteDeprecatedStudioCapabilityProjects() ([]domain.WorkspaceProjectModel, error) {
	models := []domain.WorkspaceProjectModel{}
	if err := repo.db.
		Where("category = ? AND description LIKE ?", "studio", deprecatedStudioCapabilitySessionDescriptionPrefix+"%").
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing deprecated studio projects: %w", err)
	}
	deleted := make([]domain.WorkspaceProjectModel, 0, len(models))
	for _, model := range models {
		ok, err := repo.DeleteProject(model.ID)
		if err != nil {
			return deleted, err
		}
		if ok {
			deleted = append(deleted, model)
		}
	}
	return deleted, nil
}

// GetEpisodeTimeline returns persisted episode timeline state by document ID.
func (repo *WorkspaceRepository) GetEpisodeTimeline(projectID string, documentID string) (domain.EpisodeTimelineModel, error) {
	var model domain.EpisodeTimelineModel
	err := repo.db.First(
		&model,
		"project_id = ? AND document_id = ?",
		strings.TrimSpace(projectID),
		strings.TrimSpace(documentID),
	).Error
	if IsRecordNotFound(err) {
		return domain.EpisodeTimelineModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.EpisodeTimelineModel{}, fmt.Errorf("getting episode timeline: %w", err)
	}
	return model, nil
}

// UpsertEpisodeTimeline inserts or updates persisted episode timeline state.
func (repo *WorkspaceRepository) UpsertEpisodeTimeline(model domain.EpisodeTimelineModel) error {
	if err := repo.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "project_id"}, {Name: "document_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"episode_json",
			"updated_at",
		}),
	}).Create(&model).Error; err != nil {
		return fmt.Errorf("upserting episode timeline: %w", err)
	}
	return nil
}

// UpdateProjectBrief updates a project's stored brief JSON.
func (repo *WorkspaceRepository) UpdateProjectBrief(projectID string, briefJSON string, updatedAt string) error {
	if err := repo.db.Model(&domain.WorkspaceProjectModel{}).
		Where("id = ?", strings.TrimSpace(projectID)).
		Updates(map[string]any{
			"brief_json": briefJSON,
			"updated_at": updatedAt,
		}).Error; err != nil {
		return fmt.Errorf("updating project brief: %w", err)
	}
	return nil
}

// ListDocumentOperationLogs returns operation logs for a project.
func (repo *WorkspaceRepository) ListDocumentOperationLogs(projectID string) ([]domain.DocumentOperationLogModel, error) {
	models := []domain.DocumentOperationLogModel{}
	if err := repo.db.Where("project_id = ?", strings.TrimSpace(projectID)).
		Order("created_at DESC, rowid DESC").
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing document operation logs: %w", err)
	}
	return models, nil
}

// ReplaceDocumentOperationLogs atomically replaces operation logs for a project.
func (repo *WorkspaceRepository) ReplaceDocumentOperationLogs(
	projectID string,
	operationModels []domain.DocumentOperationLogModel,
) error {
	return repo.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&domain.DocumentOperationLogModel{}, "project_id = ?", strings.TrimSpace(projectID)).Error; err != nil {
			return fmt.Errorf("clearing operation log: %w", err)
		}
		if len(operationModels) > 0 {
			if err := tx.Create(&operationModels).Error; err != nil {
				return fmt.Errorf("saving operation log: %w", err)
			}
		}
		return nil
	})
}
