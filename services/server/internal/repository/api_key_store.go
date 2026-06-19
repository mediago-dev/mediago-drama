package repository

import (
	"strings"
	"sync"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// APIKeyStore persists provider API keys in the settings database.
type APIKeyStore struct {
	mu      sync.RWMutex
	db      *gorm.DB
	initErr error
}

// NewAPIKeyStore creates a settings-backed API key store.
func NewAPIKeyStore(dbPath string) *APIKeyStore {
	store := &APIKeyStore{}
	db, err := OpenSettingsDB(dbPath)
	if err != nil {
		store.initErr = err
		return store
	}

	store.db = db
	return store
}

// NewAPIKeyStoreFromDB creates an API key store from an existing settings DB.
func NewAPIKeyStoreFromDB(db *gorm.DB, initErr error) *APIKeyStore {
	return &APIKeyStore{db: db, initErr: initErr}
}

// Get returns the API key value and source for a provider key name.
func (store *APIKeyStore) Get(keyName string) (string, string, error) {
	if store.initErr != nil {
		return "", "none", store.initErr
	}

	var record domain.APIKeyModel
	err := store.db.First(&record, "key_name = ?", keyName).Error
	if IsRecordNotFound(err) {
		return "", "none", nil
	}
	if err != nil {
		return "", "none", err
	}

	value := strings.TrimSpace(record.APIKey)
	if value != "" {
		return value, "settings", nil
	}

	return "", "none", nil
}

// Set stores an API key value for a provider key name.
func (store *APIKeyStore) Set(keyName string, value string) error {
	if store.initErr != nil {
		return store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	record := domain.APIKeyModel{
		KeyName:   keyName,
		APIKey:    strings.TrimSpace(value),
		UpdatedAt: timestamp.NowRFC3339Nano(),
	}
	return store.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key_name"}},
		DoUpdates: clause.AssignmentColumns([]string{"api_key", "updated_at"}),
	}).Create(&record).Error
}

// Clear removes a stored API key for a provider key name.
func (store *APIKeyStore) Clear(keyName string) error {
	if store.initErr != nil {
		return store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	return store.db.Delete(&domain.APIKeyModel{}, "key_name = ?", keyName).Error
}
