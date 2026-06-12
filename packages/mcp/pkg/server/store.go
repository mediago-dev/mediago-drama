package server

import (
	"context"

	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

// Project is the project summary type used by external MCP services.
type Project = mediamcp.Project

// ProjectList is the project listing type used by external MCP services.
type ProjectList = mediamcp.ProjectList

// ProjectConfig is the project.media.json config type used by MCP services.
type ProjectConfig = mediamcp.ProjectConfig

// SkillStore supplies run-scoped skill loading.
type SkillStore interface {
	LoadSkill(ctx context.Context, projectID string, input mediamcp.LoadSkillInput) (mediamcp.LoadSkillOutput, error)
}

// ProjectStore supplies project-level MCP operations.
type ProjectStore interface {
	ListProjects(ctx context.Context) (ProjectList, error)
	GetProjectConfig(ctx context.Context, projectID string) (mediamcp.ProjectConfigToolOutput, error)
	UpdateProjectConfig(ctx context.Context, projectID string, input mediamcp.ProjectConfigPatchInput) (mediamcp.ProjectConfigToolOutput, error)
}

// CommentStore supplies comment thread operations.
type CommentStore interface {
	ListComments(ctx context.Context, projectID string, input mediamcp.ListCommentsInput) (mediamcp.CommentsToolOutput, error)
	GetComment(ctx context.Context, projectID string, input mediamcp.GetCommentInput) (mediamcp.CommentToolOutput, error)
	MutateComment(ctx context.Context, projectID string, input mediamcp.MutateCommentInput) (mediamcp.CommentMutationOutput, error)
}

// DocumentServices is the target dependency set for run-scoped document tools.
type DocumentServices interface {
	SkillStore
	ProjectStore
	CommentStore
}

// ExternalServices is the target dependency set for cross-project external tools.
type ExternalServices interface {
	SkillStore
	ProjectStore
	CommentStore
}

// DocumentDeps is the dependency set for run-scoped document tools.
type DocumentDeps interface{ DocumentServices }

// ExternalDeps is the dependency set for cross-project external tools.
type ExternalDeps interface{ ExternalServices }
