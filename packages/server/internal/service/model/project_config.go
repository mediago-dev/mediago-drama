package model

import mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"

// ProjectConfigMutationResult describes a project.media.json update.
type ProjectConfigMutationResult struct {
	Config  mediamcp.ProjectConfig `json:"config"`
	Changed bool                   `json:"changed"`
}
