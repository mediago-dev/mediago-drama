package server

import (
	"context"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
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

// GenerationStore supplies generation MCP operations.
type GenerationStore interface {
	CreateGenerationMessage(ctx context.Context, projectID string, input mediamcp.GenerationMessageInput) (mediamcp.GenerationMessageOutput, error)
	CreateGenerationBatch(ctx context.Context, projectID string, input mediamcp.GenerationBatchInput) (mediamcp.GenerationBatchOutput, error)
}

// SelectionStore supplies run-scoped user-selection prompts.
type SelectionStore interface {
	AskUserSelection(ctx context.Context, projectID string, input mediamcp.AskUserSelectionInput) (mediamcp.AskUserSelectionOutput, error)
	AskUserForm(ctx context.Context, projectID string, input mediamcp.AskUserFormInput) (mediamcp.AskUserSelectionOutput, error)
	AwaitUserSelection(ctx context.Context, projectID string, input mediamcp.AwaitUserSelectionInput) (mediamcp.AskUserSelectionOutput, error)
}

// DocumentServices is the target dependency set for run-scoped document tools.
type DocumentServices interface {
	SkillStore
	ProjectStore
	CommentStore
	SelectionStore
}

// ExternalServices is the target dependency set for cross-project external tools.
type ExternalServices interface {
	SkillStore
	ProjectStore
	CommentStore
}

// GenerationServices is the target dependency set for generation tools.
type GenerationServices interface {
	GenerationStore
}

// DocumentDeps is the dependency set for run-scoped document tools.
type DocumentDeps interface{ DocumentServices }

// ExternalDeps is the dependency set for cross-project external tools.
type ExternalDeps interface{ ExternalServices }

// GenerationDeps is the dependency set for generation tools.
type GenerationDeps interface{ GenerationServices }
