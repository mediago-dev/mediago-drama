package repository

import (
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
)

func seedRepositoryProject(t *testing.T, db *gorm.DB, id string) {
	t.Helper()
	now := domain.TimeFromString("2026-05-22T00:00:00Z")
	if err := db.Create(&domain.WorkspaceProjectModel{
		ID:          id,
		Name:        id,
		Category:    "drama",
		Status:      "active",
		RelativeDir: id,
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("creating project fixture %q: %v", id, err)
	}
}
