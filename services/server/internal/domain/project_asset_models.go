package domain

import "time"

// ProjectReferenceAssetModel links project reference/folder entries to physical assets.
type ProjectReferenceAssetModel struct {
	ID        string    `gorm:"column:id;primaryKey"`
	ProjectID string    `gorm:"column:project_id;not null;index:project_reference_assets_project_idx,priority:1"`
	AssetID   string    `gorm:"column:asset_id;not null;index:project_reference_assets_asset_idx"`
	ParentID  *string   `gorm:"column:parent_id"`
	FolderID  *string   `gorm:"column:folder_id"`
	SortOrder int       `gorm:"column:sort_order;not null;default:0"`
	CreatedAt time.Time `gorm:"column:created_at;not null;autoCreateTime:nano"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null;autoUpdateTime:nano;index:project_reference_assets_project_idx,priority:2,sort:desc"`

	Project WorkspaceProjectModel `gorm:"foreignKey:ProjectID;references:ID;constraint:OnDelete:CASCADE"`
	Asset   AssetModel            `gorm:"foreignKey:AssetID;references:ID;constraint:OnDelete:CASCADE"`
}

// TableName returns the backing table name.
func (ProjectReferenceAssetModel) TableName() string {
	return "project_reference_assets"
}
