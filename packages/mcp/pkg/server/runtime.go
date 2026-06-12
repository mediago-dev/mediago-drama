package server

import (
	"log/slog"
	"strings"

	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

type runtime struct {
	cfg      Config
	toolLogs int
	logger   *slog.Logger
}

func newRuntime(cfg Config, logger *slog.Logger) runtime {
	if logger == nil {
		logger = slog.Default()
	}
	cfg.Transport = strings.TrimSpace(cfg.Transport)
	if cfg.Transport == "" {
		cfg.Transport = "stdio"
	}
	cfg.Version = strings.TrimSpace(cfg.Version)
	if cfg.Version == "" {
		cfg.Version = "0.0.0"
	}
	return runtime{cfg: cfg, logger: logger}
}

func (rt *runtime) logToolRegistered(name string) {
	rt.toolLogs++
	rt.logger.Debug(
		"mcp tool registered",
		"tool", name,
		"project_id", rt.cfg.ProjectID,
		"transport", rt.cfg.Transport,
	)
}

func (rt runtime) implementationName() string {
	return mediamcp.ServerName
}
