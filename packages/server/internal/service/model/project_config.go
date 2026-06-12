package model

import mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"

// ProjectConfigMutationResult describes a project.media.json update.
type ProjectConfigMutationResult struct {
	Config  mediamcp.ProjectConfig `json:"config"`
	Changed bool                   `json:"changed"`
}
