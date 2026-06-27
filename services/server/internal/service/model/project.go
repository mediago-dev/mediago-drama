package model

// CreateWorkspaceProjectRequest is the payload for creating a workspace project.
type CreateWorkspaceProjectRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	ProjectDir  string `json:"projectDir"`
}

// UpdateWorkspaceProjectRequest is the payload for updating workspace project metadata.
type UpdateWorkspaceProjectRequest struct {
	Name string `json:"name"`
}
