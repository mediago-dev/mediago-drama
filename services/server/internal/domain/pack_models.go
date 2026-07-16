package domain

import "time"

// PackModel is the GORM model for an installed prompt pack.
type PackModel struct {
	ID          string    `gorm:"column:id;primaryKey"`
	Name        string    `gorm:"column:name;not null"`
	Version     string    `gorm:"column:version;not null"`
	ReleaseID   string    `gorm:"column:release_id;not null;default:'';index:packs_release_idx"`
	Author      string    `gorm:"column:author;not null;default:''"`
	Description string    `gorm:"column:description;not null;default:''"`
	Source      string    `gorm:"column:source;not null;default:'imported';index:packs_source_idx"`
	Origin      string    `gorm:"column:origin;not null;default:''"`
	Enabled     bool      `gorm:"column:enabled;not null;default:true;index:packs_enabled_idx"`
	CreatedAt   time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt   time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano"`
}

// TableName returns the backing table name.
func (PackModel) TableName() string {
	return "packs"
}

// PackEntryModel is the GORM model for skills and prompt presets.
type PackEntryModel struct {
	ID              string    `gorm:"column:id;primaryKey"`
	PackID          string    `gorm:"column:pack_id;not null;index:pack_entries_pack_idx;uniqueIndex:pack_entries_pack_kind_slug_idx"`
	ReleaseID       string    `gorm:"column:release_id;not null;default:'';index:pack_entries_release_idx"`
	SourcePackageID string    `gorm:"column:source_package_id;not null;default:'';index:pack_entries_source_package_idx"`
	SourceReleaseID string    `gorm:"column:source_release_id;not null;default:'';index:pack_entries_source_release_idx"`
	Kind            string    `gorm:"column:kind;not null;index:pack_entries_kind_idx;uniqueIndex:pack_entries_pack_kind_slug_idx"`
	Slug            string    `gorm:"column:slug;not null;index:pack_entries_slug_idx;uniqueIndex:pack_entries_pack_kind_slug_idx"`
	Name            string    `gorm:"column:name;not null;default:''"`
	Title           string    `gorm:"column:title;not null;default:''"`
	Description     string    `gorm:"column:description;not null;default:''"`
	Body            string    `gorm:"column:body;not null;type:text"`
	Metadata        string    `gorm:"column:metadata;not null;type:text;default:'{}'"`
	Source          string    `gorm:"column:source;not null;default:'pack';index:pack_entries_source_idx"`
	OverriddenFrom  string    `gorm:"column:overridden_from;not null;default:'';index:pack_entries_overridden_from_idx"`
	CreatedAt       time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt       time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano"`
	Pack            PackModel `gorm:"foreignKey:PackID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (PackEntryModel) TableName() string {
	return "pack_entries"
}

// PackCategoryModel is the GORM model for prompt categories owned by a pack.
type PackCategoryModel struct {
	PackID    string    `gorm:"column:pack_id;primaryKey"`
	ID        string    `gorm:"column:id;primaryKey"`
	Label     string    `gorm:"column:label;not null"`
	Order     int       `gorm:"column:entry_order;not null;default:0"`
	Source    string    `gorm:"column:source;not null;default:'pack';index:pack_categories_source_idx"`
	Builtin   bool      `gorm:"column:builtin;not null;default:false;index:pack_categories_builtin_idx"`
	CreatedAt time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano"`
	Pack      PackModel `gorm:"foreignKey:PackID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (PackCategoryModel) TableName() string {
	return "pack_categories"
}
