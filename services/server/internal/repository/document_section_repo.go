package repository

import (
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// DocumentSectionRepository persists stable document section metadata.
type DocumentSectionRepository struct {
	db *gorm.DB
}

// NewDocumentSectionRepository opens the workspace database for document sections.
func NewDocumentSectionRepository(dbPath string) (*DocumentSectionRepository, error) {
	db, err := OpenWorkspaceDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("opening document section repository database: %w", err)
	}
	return NewDocumentSectionRepositoryFromDB(db), nil
}

// NewDocumentSectionRepositoryFromDB creates a repository from an existing workspace DB.
func NewDocumentSectionRepositoryFromDB(db *gorm.DB) *DocumentSectionRepository {
	return &DocumentSectionRepository{db: db}
}

// ListProjectSections returns every section record for one project.
func (repo *DocumentSectionRepository) ListProjectSections(projectID string) ([]domain.DocumentSectionModel, error) {
	models := []domain.DocumentSectionModel{}
	if err := repo.db.
		Where("project_id = ?", domain.CleanProjectID(projectID)).
		Order("document_id ASC, line_start ASC, section_id ASC").
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing document sections: %w", err)
	}
	return models, nil
}

// ListProjectSectionsByDocument returns section records for one document.
func (repo *DocumentSectionRepository) ListProjectSectionsByDocument(projectID string, documentID string) ([]domain.DocumentSectionModel, error) {
	models := []domain.DocumentSectionModel{}
	if err := repo.db.
		Where("project_id = ? AND document_id = ?", domain.CleanProjectID(projectID), strings.TrimSpace(documentID)).
		Order("line_start ASC, section_id ASC").
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing document sections by document: %w", err)
	}
	return models, nil
}

// UpsertObservedSections inserts new section records and updates observation fields for existing records.
func (repo *DocumentSectionRepository) UpsertObservedSections(rows []domain.DocumentSectionModel) error {
	filtered := make([]domain.DocumentSectionModel, 0, len(rows))
	for _, row := range rows {
		row.ProjectID = domain.CleanProjectID(row.ProjectID)
		row.SectionID = strings.TrimSpace(row.SectionID)
		row.DocumentID = strings.TrimSpace(row.DocumentID)
		row.Type = normalizeDocumentSectionType(row.Type)
		row.Status = normalizeDocumentSectionStatus(row.Status)
		row.Title = strings.TrimSpace(row.Title)
		row.ObservedTitle = strings.TrimSpace(row.ObservedTitle)
		row.MetadataJSON = normalizeDocumentSectionMetadataJSON(row.MetadataJSON)
		if row.ProjectID == "" || row.SectionID == "" {
			continue
		}
		filtered = append(filtered, row)
	}
	if len(filtered) == 0 {
		return nil
	}
	err := repo.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "project_id"}, {Name: "section_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"document_id":    gorm.Expr("excluded.document_id"),
			"title":          gorm.Expr("CASE WHEN title = '' THEN excluded.title ELSE title END"),
			"status":         gorm.Expr("CASE WHEN status = 'deleted' THEN status ELSE excluded.status END"),
			"observed_title": gorm.Expr("excluded.observed_title"),
			"heading_level":  gorm.Expr("excluded.heading_level"),
			"heading_path":   gorm.Expr("excluded.heading_path"),
			"line_start":     gorm.Expr("excluded.line_start"),
			"line_end":       gorm.Expr("excluded.line_end"),
			"content_hash":   gorm.Expr("excluded.content_hash"),
			"last_seen_at":   gorm.Expr("excluded.last_seen_at"),
			"updated_at":     gorm.Expr("excluded.updated_at"),
		}),
	}).Create(&filtered).Error
	if err != nil {
		return fmt.Errorf("upserting observed document sections: %w", err)
	}
	return nil
}

// MarkProjectSectionsMissing marks project sections missing when they were not seen during reconcile.
func (repo *DocumentSectionRepository) MarkProjectSectionsMissing(projectID string, seenSectionIDs []string, updatedAt string) (int64, error) {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return 0, nil
	}
	seen := compactStrings(seenSectionIDs)
	query := repo.db.Model(&domain.DocumentSectionModel{}).
		Where("project_id = ? AND status <> ?", projectID, "deleted")
	if len(seen) > 0 {
		query = query.Where("section_id NOT IN ?", seen)
	}
	result := query.Updates(map[string]any{
		"status":     "missing",
		"updated_at": domain.TimeFromString(updatedAt),
	})
	if result.Error != nil {
		return 0, fmt.Errorf("marking document sections missing: %w", result.Error)
	}
	return result.RowsAffected, nil
}

// UpdateSectionMetadata updates user-owned metadata fields for one section.
func (repo *DocumentSectionRepository) UpdateSectionMetadata(projectID string, sectionID string, updates map[string]any) (bool, error) {
	if len(updates) == 0 {
		return true, nil
	}
	projectID = domain.CleanProjectID(projectID)
	sectionID = strings.TrimSpace(sectionID)
	if projectID == "" || sectionID == "" {
		return false, nil
	}
	allowed := map[string]any{}
	for key, value := range updates {
		switch key {
		case "section_type", "subtype", "title", "metadata_json", "status", "updated_at":
			allowed[key] = value
		}
	}
	if len(allowed) == 0 {
		return true, nil
	}
	result := repo.db.Model(&domain.DocumentSectionModel{}).
		Where("project_id = ? AND section_id = ?", projectID, sectionID).
		Updates(allowed)
	if result.Error != nil {
		return false, fmt.Errorf("updating document section metadata: %w", result.Error)
	}
	return result.RowsAffected > 0, nil
}

func normalizeDocumentSectionType(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "screenplay", "character", "scene", "prop", "storyboard", "reference":
		return value
	default:
		return "unknown"
	}
}

func normalizeDocumentSectionStatus(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "active", "missing", "detached", "duplicated", "deleted":
		return value
	default:
		return "active"
	}
}

func normalizeDocumentSectionMetadataJSON(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "{}"
	}
	return value
}

func compactStrings(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}
