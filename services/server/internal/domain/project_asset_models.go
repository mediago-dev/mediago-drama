package domain

// ProjectAssetModel is the GORM model for project-scoped reference assets.
type ProjectAssetModel struct {
	ProjectID string `gorm:"column:project_id;primaryKey;index:project_assets_project_idx,priority:1"`
	ID        string `gorm:"column:id;primaryKey"`
	Kind      string `gorm:"column:kind;not null"`
	Filename  string `gorm:"column:filename;not null"`
	MIMEType  string `gorm:"column:mime_type;not null"`
	SizeBytes int64  `gorm:"column:size_bytes;not null"`
	Path      string `gorm:"column:path;not null"`
	ParentID  string `gorm:"column:parent_id;not null;default:''"`
	FolderID  string `gorm:"column:folder_id;not null;default:''"`
	SortOrder int    `gorm:"column:sort_order;not null;default:0"`
	CreatedAt string `gorm:"column:created_at;not null"`
	UpdatedAt string `gorm:"column:updated_at;not null;index:project_assets_project_idx,priority:2,sort:desc"`
}

// TableName returns the backing table name.
func (ProjectAssetModel) TableName() string {
	return "project_assets"
}
