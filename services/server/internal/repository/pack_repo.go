package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// PackRepository persists installed prompt packs and their entries.
type PackRepository struct {
	db *gorm.DB
}

// NewPackRepositoryFromDB creates a pack repository from an existing settings DB.
func NewPackRepositoryFromDB(db *gorm.DB) *PackRepository {
	return &PackRepository{db: db}
}

// WithTransaction runs fn inside one database transaction.
func (repo *PackRepository) WithTransaction(ctx context.Context, fn func(*PackRepository) error) error {
	if repo == nil || repo.db == nil {
		return fmt.Errorf("pack repository is nil")
	}
	return repo.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return fn(NewPackRepositoryFromDB(tx))
	})
}

// ListPacks returns every installed prompt pack.
func (repo *PackRepository) ListPacks() ([]domain.PackModel, error) {
	models := []domain.PackModel{}
	if err := repo.db.Order("id asc").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing packs: %w", err)
	}
	return models, nil
}

// GetPack returns one installed prompt pack.
func (repo *PackRepository) GetPack(id string) (domain.PackModel, error) {
	var model domain.PackModel
	err := repo.db.First(&model, "id = ?", strings.TrimSpace(id)).Error
	if IsRecordNotFound(err) {
		return domain.PackModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.PackModel{}, fmt.Errorf("getting pack: %w", err)
	}
	return model, nil
}

// UpsertPack inserts or updates one installed prompt pack.
func (repo *PackRepository) UpsertPack(model domain.PackModel) error {
	err := repo.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"name",
			"version",
			"author",
			"description",
			"source",
			"origin",
			"enabled",
			"updated_at",
		}),
	}).Create(&model).Error
	if err != nil {
		return fmt.Errorf("upserting pack: %w", err)
	}
	return nil
}

// SetPackEnabled updates one pack enabled flag.
func (repo *PackRepository) SetPackEnabled(id string, enabled bool) error {
	err := repo.db.Model(&domain.PackModel{}).
		Where("id = ?", strings.TrimSpace(id)).
		Update("enabled", enabled).
		Error
	if err != nil {
		return fmt.Errorf("setting pack enabled: %w", err)
	}
	return nil
}

// DisableOtherPacks disables every pack except the specified one.
func (repo *PackRepository) DisableOtherPacks(id string) error {
	err := repo.db.Model(&domain.PackModel{}).
		Where("id <> ?", strings.TrimSpace(id)).
		Update("enabled", false).
		Error
	if err != nil {
		return fmt.Errorf("disabling other packs: %w", err)
	}
	return nil
}

// DeletePack removes an installed prompt pack and its entries.
func (repo *PackRepository) DeletePack(id string) error {
	err := repo.db.Delete(&domain.PackModel{}, "id = ?", strings.TrimSpace(id)).Error
	if err != nil {
		return fmt.Errorf("deleting pack: %w", err)
	}
	return nil
}

// NormalizeLegacySources rewrites the old builtin/imported entry source names to the current model.
func (repo *PackRepository) NormalizeLegacySources() error {
	if err := repo.db.Model(&domain.PackModel{}).
		Where("source = ?", "builtin").
		Update("source", "default").
		Error; err != nil {
		return fmt.Errorf("normalizing legacy pack sources: %w", err)
	}
	if err := repo.db.Model(&domain.PackEntryModel{}).
		Where("source IN ?", []string{"builtin", "imported"}).
		Update("source", "pack").
		Error; err != nil {
		return fmt.Errorf("normalizing legacy pack entry sources: %w", err)
	}
	if err := repo.db.Model(&domain.PackCategoryModel{}).
		Where("source IN ?", []string{"builtin", "imported"}).
		Update("source", "pack").
		Error; err != nil {
		return fmt.Errorf("normalizing legacy pack category sources: %w", err)
	}
	return nil
}

// ListEntries returns every prompt pack entry.
func (repo *PackRepository) ListEntries() ([]domain.PackEntryModel, error) {
	models := []domain.PackEntryModel{}
	if err := repo.db.Order("pack_id asc, kind asc, slug asc").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing pack entries: %w", err)
	}
	return models, nil
}

// ListEnabledEntries returns entries from enabled packs.
func (repo *PackRepository) ListEnabledEntries(kind string) ([]domain.PackEntryModel, error) {
	models := []domain.PackEntryModel{}
	query := repo.db.Model(&domain.PackEntryModel{}).
		Joins("JOIN packs ON packs.id = pack_entries.pack_id AND packs.enabled = ?", true)
	if strings.TrimSpace(kind) != "" {
		query = query.Where("pack_entries.kind = ?", strings.TrimSpace(kind))
	}
	if err := query.Order("pack_entries.pack_id asc, pack_entries.kind asc, pack_entries.slug asc").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing enabled pack entries: %w", err)
	}
	return models, nil
}

// GetEntry returns one prompt pack entry by canonical ID.
func (repo *PackRepository) GetEntry(id string) (domain.PackEntryModel, error) {
	var model domain.PackEntryModel
	err := repo.db.First(&model, "id = ?", strings.TrimSpace(id)).Error
	if IsRecordNotFound(err) {
		return domain.PackEntryModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.PackEntryModel{}, fmt.Errorf("getting pack entry: %w", err)
	}
	return model, nil
}

// GetEntryByPackKindSlug returns one pack entry by pack, kind, and slug.
func (repo *PackRepository) GetEntryByPackKindSlug(packID string, kind string, slug string) (domain.PackEntryModel, error) {
	var model domain.PackEntryModel
	err := repo.db.First(
		&model,
		"pack_id = ? AND kind = ? AND slug = ?",
		strings.TrimSpace(packID),
		strings.TrimSpace(kind),
		strings.TrimSpace(slug),
	).Error
	if IsRecordNotFound(err) {
		return domain.PackEntryModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.PackEntryModel{}, fmt.Errorf("getting pack entry: %w", err)
	}
	return model, nil
}

// UpsertEntry inserts or updates one prompt pack entry.
func (repo *PackRepository) UpsertEntry(model domain.PackEntryModel) error {
	err := repo.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"pack_id",
			"kind",
			"slug",
			"name",
			"title",
			"description",
			"body",
			"metadata",
			"source",
			"overridden_from",
			"updated_at",
		}),
	}).Create(&model).Error
	if err != nil {
		return fmt.Errorf("upserting pack entry: %w", err)
	}
	return nil
}

// DeleteEntry removes one prompt pack entry.
func (repo *PackRepository) DeleteEntry(id string) error {
	err := repo.db.Delete(&domain.PackEntryModel{}, "id = ?", strings.TrimSpace(id)).Error
	if err != nil {
		return fmt.Errorf("deleting pack entry: %w", err)
	}
	return nil
}

// DeleteEntriesByPack removes every entry owned by a pack.
func (repo *PackRepository) DeleteEntriesByPack(packID string) error {
	err := repo.db.Delete(&domain.PackEntryModel{}, "pack_id = ?", strings.TrimSpace(packID)).Error
	if err != nil {
		return fmt.Errorf("deleting pack entries: %w", err)
	}
	return nil
}

// DeleteResettableEntriesByPack removes package-owned entries and package overrides for a pack.
func (repo *PackRepository) DeleteResettableEntriesByPack(packID string) error {
	err := repo.db.Delete(
		&domain.PackEntryModel{},
		"pack_id = ? AND NOT (source = ? AND overridden_from = '')",
		strings.TrimSpace(packID),
		"user",
	).Error
	if err != nil {
		return fmt.Errorf("deleting resettable pack entries: %w", err)
	}
	return nil
}

// ListCategories returns every prompt pack category.
func (repo *PackRepository) ListCategories() ([]domain.PackCategoryModel, error) {
	models := []domain.PackCategoryModel{}
	if err := repo.db.Order("entry_order asc, id asc").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("listing pack categories: %w", err)
	}
	return models, nil
}

// ListEnabledCategories returns categories from enabled packs.
func (repo *PackRepository) ListEnabledCategories() ([]domain.PackCategoryModel, error) {
	models := []domain.PackCategoryModel{}
	err := repo.db.Model(&domain.PackCategoryModel{}).
		Joins("JOIN packs ON packs.id = pack_categories.pack_id AND packs.enabled = ?", true).
		Order("pack_categories.entry_order asc, pack_categories.id asc").
		Find(&models).
		Error
	if err != nil {
		return nil, fmt.Errorf("listing enabled pack categories: %w", err)
	}
	return models, nil
}

// GetCategory returns one category by pack and ID.
func (repo *PackRepository) GetCategory(packID string, id string) (domain.PackCategoryModel, error) {
	var model domain.PackCategoryModel
	err := repo.db.First(&model, "pack_id = ? AND id = ?", strings.TrimSpace(packID), strings.TrimSpace(id)).Error
	if IsRecordNotFound(err) {
		return domain.PackCategoryModel{}, ErrRecordNotFound
	}
	if err != nil {
		return domain.PackCategoryModel{}, fmt.Errorf("getting pack category: %w", err)
	}
	return model, nil
}

// UpsertCategory inserts or updates one pack category.
func (repo *PackRepository) UpsertCategory(model domain.PackCategoryModel) error {
	err := repo.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "pack_id"}, {Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"label",
			"entry_order",
			"source",
			"builtin",
			"updated_at",
		}),
	}).Create(&model).Error
	if err != nil {
		return fmt.Errorf("upserting pack category: %w", err)
	}
	return nil
}

// DeleteCategoriesByPack removes every category owned by a pack.
func (repo *PackRepository) DeleteCategoriesByPack(packID string) error {
	err := repo.db.Delete(&domain.PackCategoryModel{}, "pack_id = ?", strings.TrimSpace(packID)).Error
	if err != nil {
		return fmt.Errorf("deleting pack categories: %w", err)
	}
	return nil
}

// DeletePackOwnedCategoriesByPack removes package-owned categories while preserving user categories.
func (repo *PackRepository) DeletePackOwnedCategoriesByPack(packID string) error {
	err := repo.db.Delete(
		&domain.PackCategoryModel{},
		"pack_id = ? AND source <> ?",
		strings.TrimSpace(packID),
		"user",
	).Error
	if err != nil {
		return fmt.Errorf("deleting pack-owned categories: %w", err)
	}
	return nil
}
