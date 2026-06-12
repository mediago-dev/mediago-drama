package server

import (
	"log/slog"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	externaltools "github.com/mediago-dev/mediago-drama/packages/mcp/internal/tools/external"
	v2tools "github.com/mediago-dev/mediago-drama/packages/mcp/internal/tools/v2"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

// NewDocumentServer creates the run-scoped document MCP server.
func NewDocumentServer(cfg Config, deps DocumentDeps) (*mcpsdk.Server, error) {
	rt := newRuntime(cfg, slog.Default())
	server := mcpsdk.NewServer(&mcpsdk.Implementation{
		Name:    rt.implementationName(),
		Version: rt.cfg.Version,
	}, &mcpsdk.ServerOptions{Instructions: mediamcp.AgentMCPInstructions})
	if deps != nil {
		v2tools.Register(server, deps, v2tools.Options{
			ProjectID: rt.cfg.ProjectID,
		}, false, rt.logToolRegistered)
	}
	rt.logger.Debug(
		"document mcp server assembled",
		"project_id", rt.cfg.ProjectID,
		"transport", rt.cfg.Transport,
		"tool_count", rt.toolLogs,
	)
	return server, nil
}

// NewExternalServer creates the cross-project external MCP server.
func NewExternalServer(cfg Config, deps ExternalDeps) (*mcpsdk.Server, error) {
	rt := newRuntime(cfg, slog.Default())
	server := mcpsdk.NewServer(&mcpsdk.Implementation{
		Name:    rt.implementationName(),
		Version: rt.cfg.Version,
	}, &mcpsdk.ServerOptions{Instructions: mediamcp.ExternalMCPInstructions})
	if deps != nil {
		externaltools.Register(server, deps, false, rt.logToolRegistered)
	}
	rt.logger.Debug(
		"external mcp server assembled",
		"transport", rt.cfg.Transport,
		"tool_count", rt.toolLogs,
	)
	return server, nil
}
