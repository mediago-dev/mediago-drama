package repository

import (
	"fmt"
	"strings"

	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// DocumentEditStreamRepository persists streamed document edits.
type DocumentEditStreamRepository struct {
	db *gorm.DB
}

// NewDocumentEditStreamRepository creates a document edit stream repository.
func NewDocumentEditStreamRepository(db *gorm.DB) *DocumentEditStreamRepository {
	return &DocumentEditStreamRepository{db: db}
}

// GetDocumentEditStream returns a persisted edit stream by project and stream ID.
func (repo *DocumentEditStreamRepository) GetDocumentEditStream(projectID string, streamID string) (domain.DocumentEditStreamModel, error) {
	var model domain.DocumentEditStreamModel
	err := repo.db.First(&model, "project_id = ? AND stream_id = ?", strings.TrimSpace(projectID), strings.TrimSpace(streamID)).Error
	if IsRecordNotFound(err) {
		return domain.DocumentEditStreamModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.DocumentEditStreamModel{}, fmt.Errorf("getting document edit stream: %w", err)
	}
	return model, nil
}

// UpsertDocumentEditStream inserts or updates an edit stream.
func (repo *DocumentEditStreamRepository) UpsertDocumentEditStream(model domain.DocumentEditStreamModel) error {
	if err := repo.db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&model).Error; err != nil {
		return fmt.Errorf("upserting document edit stream: %w", err)
	}
	return nil
}
