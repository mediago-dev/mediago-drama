package model

// ProjectAssetRecord is the API projection for one project-scoped asset.
type ProjectAssetRecord struct {
	ID           string `json:"id"`
	ProjectID    string `json:"projectId"`
	Kind         string `json:"kind"`
	Filename     string `json:"filename"`
	MIMEType     string `json:"mimeType"`
	SizeBytes    int64  `json:"sizeBytes"`
	URL          string `json:"url"`
	ParentID     string `json:"parentId,omitempty"`
	FolderID     string `json:"folderId,omitempty"`
	SortOrder    int    `json:"sortOrder"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
	DownloadPath string `json:"downloadPath,omitempty"`
	FilePath     string `json:"-"`
}
