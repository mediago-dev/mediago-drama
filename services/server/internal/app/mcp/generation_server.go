package mcp

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	mcpserver "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/server"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	servicegeneration "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// GenerationService supplies generation operations to the MCP adapter.
type GenerationService interface {
	ListGenerationModels() servicegeneration.GenerationModelsResponse
	CreateGenerationMessage(ctx context.Context, payload servicegeneration.GenerationMessageRequest) (servicegeneration.GenerationMessageResponse, int, error)
	RetryGenerationTask(ctx context.Context, id string) (servicegeneration.GenerationMessageResponse, int, error)
	ListGenerationTasks(query servicegeneration.GenerationTaskListQuery) (servicegeneration.GenerationTasksResponse, error)
	GetGenerationTask(id string) (servicegeneration.GenerationTaskRecord, bool, error)
	PollGenerationTask(ctx context.Context, task servicegeneration.GenerationTaskRecord)
	UpdateGenerationTaskAsset(id string, assetIndex int, patch servicegeneration.UpdateGenerationTaskAssetRequest) (servicegeneration.GenerationTaskRecord, bool, error)
	CreatePromptOptimizedGenerationMessage(ctx context.Context, payload servicegeneration.GenerationMessageRequest) (servicegeneration.GenerationOptimizeAndGenerateResponse, int, error)
	GenerationPreferenceForProject(projectID string) (servicegeneration.GenerationPreferenceRecord, bool)
}

// NewGenerationServer creates a generation-scoped MCP server.
func NewGenerationServer(workspaceDir string, projectID string, service GenerationService, transport string) (*mcp.Server, *GenerationServer, error) {
	toolServer := &GenerationServer{
		service:   service,
		projectID: domain.CleanProjectID(projectID),
	}
	slog.Debug(
		"generation mcp server starting",
		"project_id", toolServer.projectID,
		"transport", transport,
		"has_service", service != nil,
	)

	server, err := mcpserver.NewGenerationServer(mcpserver.Config{
		WorkspaceDir: workspaceDir,
		ProjectID:    toolServer.projectID,
		Transport:    transport,
	}, toolServer)
	if err != nil {
		return nil, nil, err
	}
	slog.Debug(
		"generation mcp tools registered",
		"project_id", toolServer.projectID,
		"transport", transport,
	)
	return server, toolServer, nil
}

// GenerationServer owns generation MCP runtime state.
type GenerationServer struct {
	service   GenerationService
	projectID string
}

func (server *GenerationServer) requireService() (GenerationService, error) {
	if server == nil || server.service == nil {
		return nil, fmt.Errorf("generation service is not configured")
	}
	return server.service, nil
}

func (server *GenerationServer) logToolInvocation(toolName string, attrs ...any) {
	base := []any{
		"tool", toolName,
		"project_id", server.projectID,
	}
	slog.Debug("generation mcp tool invoked", append(base, attrs...)...)
}

func generationStatusError(action string, status int, err error) error {
	if err == nil {
		return nil
	}
	action = strings.TrimSpace(action)
	if action == "" {
		action = "generation"
	}
	if status <= 0 {
		return fmt.Errorf("%s failed: %w", action, err)
	}
	return fmt.Errorf("%s failed with HTTP %d: %w", action, status, err)
}
