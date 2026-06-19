package domain

// MediaAssetModel is the GORM model for local media assets.
type MediaAssetModel struct {
	ID                string  `gorm:"column:id;primaryKey"`
	Kind              string  `gorm:"column:kind;not null"`
	Filename          string  `gorm:"column:filename;not null"`
	MIMEType          string  `gorm:"column:mime_type;not null"`
	SizeBytes         int64   `gorm:"column:size_bytes;not null"`
	Path              string  `gorm:"column:path;not null"`
	URL               string  `gorm:"column:url;not null"`
	SourceURL         string  `gorm:"column:source_url;not null;default:'';index:media_assets_source_url_idx"`
	ProjectID         string  `gorm:"column:project_id;not null;default:'';index:media_assets_project_id_idx"`
	DurationSeconds   float64 `gorm:"column:duration_seconds;not null;default:0"`
	Width             int     `gorm:"column:width;not null;default:0"`
	Height            int     `gorm:"column:height;not null;default:0"`
	PosterPath        string  `gorm:"column:poster_path;not null;default:''"`
	PosterURL         string  `gorm:"column:poster_url;not null;default:''"`
	MetadataStatus    string  `gorm:"column:metadata_status;not null;default:''"`
	MetadataError     string  `gorm:"column:metadata_error;not null;default:''"`
	MetadataUpdatedAt string  `gorm:"column:metadata_updated_at;not null;default:''"`
	CreatedAt         string  `gorm:"column:created_at;not null"`
	UpdatedAt         string  `gorm:"column:updated_at;not null"`
}

// TableName returns the backing table name.
func (MediaAssetModel) TableName() string {
	return "media_assets"
}
