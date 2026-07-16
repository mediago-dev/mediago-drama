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
	CreateGenerationMessage(ctx context.Context, payload servicegeneration.GenerationMessageRequest) (servicegeneration.GenerationMessageResponse, int, error)
	CreateGenerationBatch(ctx context.Context, payload servicegeneration.GenerationBatchRequest) (servicegeneration.GenerationBatchResponse, int, error)
	CreatePromptOptimizedGenerationMessage(ctx context.Context, payload servicegeneration.GenerationMessageRequest) (servicegeneration.GenerationOptimizeAndGenerateResponse, int, error)
}

// GenerationCallerMode identifies the trust boundary of a generation MCP
// server. It must be selected explicitly when the server is constructed.
type GenerationCallerMode string

const (
	// GenerationCallerAgent requires a run-scoped user confirmation before an
	// image or video create or batch can reach the generation service.
	GenerationCallerAgent GenerationCallerMode = "agent"
	// GenerationCallerTrustedManual is reserved for integrations where a
	// direct user action is already the authorization boundary.
	GenerationCallerTrustedManual GenerationCallerMode = "trusted_manual"
)

// NewAgentGenerationServer creates a generation MCP server scoped to an agent
// run and its user-confirmation store.
func NewAgentGenerationServer(
	workspaceDir string,
	projectID string,
	service GenerationService,
	run GenerationRunContext,
	transport string,
) (*mcp.Server, *GenerationServer, error) {
	return newGenerationServer(
		workspaceDir,
		projectID,
		service,
		GenerationCallerAgent,
		run,
		transport,
	)
}

// NewTrustedManualGenerationServer creates a generation MCP server for an
// integration whose direct user action is already the authorization boundary.
// Agent HTTP and stdio factories must not use this constructor.
func NewTrustedManualGenerationServer(
	workspaceDir string,
	projectID string,
	service GenerationService,
	transport string,
) (*mcp.Server, *GenerationServer, error) {
	return newGenerationServer(
		workspaceDir,
		projectID,
		service,
		GenerationCallerTrustedManual,
		GenerationRunContext{},
		transport,
	)
}

func newGenerationServer(
	workspaceDir string,
	projectID string,
	service GenerationService,
	callerMode GenerationCallerMode,
	run GenerationRunContext,
	transport string,
) (*mcp.Server, *GenerationServer, error) {
	if callerMode != GenerationCallerAgent && callerMode != GenerationCallerTrustedManual {
		return nil, nil, fmt.Errorf("generation caller mode %q is invalid", callerMode)
	}
	toolServer := &GenerationServer{
		service:    service,
		projectID:  domain.CleanProjectID(projectID),
		callerMode: callerMode,
		sessionID:  strings.TrimSpace(run.SessionID),
		runID:      strings.TrimSpace(run.RunID),
		selections: run.Selections,
	}
	slog.Debug(
		"generation mcp server starting",
		"project_id", toolServer.projectID,
		"caller_mode", toolServer.callerMode,
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
		"caller_mode", toolServer.callerMode,
		"transport", transport,
	)
	return server, toolServer, nil
}

// GenerationServer owns generation MCP runtime state.
type GenerationServer struct {
	service    GenerationService
	projectID  string
	callerMode GenerationCallerMode
	sessionID  string
	runID      string
	selections GenerationSelectionStore
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
