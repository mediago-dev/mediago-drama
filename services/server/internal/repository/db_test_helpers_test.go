package repository

import (
	"testing"

	"gorm.io/gorm"
)

func openTestWorkspaceDB(t *testing.T, dbPath string) (*gorm.DB, error) {
	t.Helper()
	return openTestDatabase(t, dbPath, OpenWorkspaceDB)
}

func openTestGormSQLite(t *testing.T, dbPath string) (*gorm.DB, error) {
	t.Helper()
	return openTestDatabase(t, dbPath, OpenGormSQLite)
}

func cleanupTestDatabase(t *testing.T, db *gorm.DB) {
	t.Helper()
	t.Cleanup(func() {
		if err := CloseDatabase(db); err != nil {
			t.Errorf("closing test database: %v", err)
		}
	})
}

func openTestDatabase(
	t *testing.T,
	dbPath string,
	open func(string) (*gorm.DB, error),
) (*gorm.DB, error) {
	t.Helper()
	db, err := open(dbPath)
	if err != nil {
		return nil, err
	}
	cleanupTestDatabase(t, db)
	return db, nil
}
