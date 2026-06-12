package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	corepricing "github.com/mediago-dev/mediago-drama/packages/core/pkg/pricing"
	server "github.com/mediago-dev/mediago-drama/packages/server/internal/app"
	appagent "github.com/mediago-dev/mediago-drama/packages/server/internal/app/agent"
	serverconfig "github.com/mediago-dev/mediago-drama/packages/server/internal/config"
	platformlogger "github.com/mediago-dev/mediago-drama/packages/server/internal/platform/logger"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/workspace"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	flags := flag.NewFlagSet("mediago-server", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	configFlag := flags.String("config", "", "Path to YAML server config")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}

	configPath, err := cleanConfigPath(*configFlag)
	if err != nil {
		return err
	}
	config, err := serverconfig.Load(configPath)
	if err != nil {
		return err
	}
	if err := applyEnvOverrides(&config); err != nil {
		return err
	}

	staticFS, err := workspace.StaticFS()
	if err != nil {
		return fmt.Errorf("loading embedded workspace assets: %w", err)
	}
	workspaceDir := server.ResolveWorkspaceDir(config.WorkspaceDir)
	logPath := config.LogPath
	if strings.TrimSpace(logPath) == "" {
		logPath = filepath.Join(workspaceDir, ".mediago-drama", "logs", "server.log")
	}
	acpLogPath := filepath.Join(filepath.Dir(logPath), "acp.log")
	logPath, closeLog, err := platformlogger.ConfigureDefaultLogger(logPath, config.LogLevel)
	if err != nil {
		return fmt.Errorf("configuring logger: %w", err)
	}
	defer func() {
		if err := closeLog(); err != nil {
			slog.Error("closing log file", "error", err)
		}
	}()
	acpLogger, acpLogPath, closeACPLog, err := platformlogger.NewComponentLogger("acp", acpLogPath)
	if err != nil {
		return fmt.Errorf("configuring ACP logger: %w", err)
	}
	defer func() {
		if err := closeACPLog(); err != nil {
			slog.Error("closing ACP log file", "error", err)
		}
	}()
	appagent.SetACPLogger(acpLogger)

	addr := net.JoinHostPort(config.Host, strconv.Itoa(config.Port))
	bridgeAddr := net.JoinHostPort(agentBridgeHost(config.Host), strconv.Itoa(config.Port))
	bridgeToken, err := generateServeInternalToken()
	if err != nil {
		return fmt.Errorf("generating internal API token: %w", err)
	}
	internalAPIURL := "http://" + bridgeAddr
	if err := os.Setenv("ONE_INTERNAL_API_URL", internalAPIURL); err != nil {
		return fmt.Errorf("exporting ONE_INTERNAL_API_URL: %w", err)
	}
	if err := os.Setenv("ONE_INTERNAL_API_TOKEN", bridgeToken); err != nil {
		return fmt.Errorf("exporting ONE_INTERNAL_API_TOKEN: %w", err)
	}
	billingPrices, err := loadBillingPrices(config.Billing.PriceOverlayPath, configPath)
	if err != nil {
		return err
	}
	handler := server.NewHandlerWithConfig(staticFS, server.Config{
		Host:                  config.Host,
		Port:                  config.Port,
		WorkspaceDir:          workspaceDir,
		ACPCommand:            config.ACPCommand,
		AgentID:               config.Agent.ID,
		AgentBinDir:           config.Agent.BinDir,
		FFmpegPath:            config.FFmpeg.Path,
		FFmpegBinDir:          config.FFmpeg.BinDir,
		JimengBinPath:         config.Jimeng.Path,
		JimengBinDir:          config.Jimeng.BinDir,
		DocumentMCPConfigPath: configPath,
		AgentBridgeURL:        internalAPIURL + "/api/v1/internal/agent/spawn",
		AgentBridgeToken:      bridgeToken,
		PromptMaxSectionChars: config.Prompt.MaxSectionChars,
		BillingPrices:         billingPrices,
	})
	defer closeServerHandler(handler)
	httpServer := &http.Server{
		Addr:    addr,
		Handler: handler,
	}
	if exitOnStdinCloseEnabled() {
		shutdownOnStdinClose(httpServer)
	}

	fmt.Printf("Serving workspace at http://%s\n", addr)
	fmt.Printf("MCP endpoint: http://%s/mcp\n", addr)
	fmt.Printf("Workspace: %s\n", workspaceDir)
	fmt.Printf("Logs: %s\n", logPath)
	fmt.Printf("ACP logs: %s\n", acpLogPath)
	fmt.Printf("Agent runtime: acp\n")
	fmt.Printf("Agent backend: %s (%s)\n", displayAgentID(config.Agent.ID), displayAgentMode(config.Agent.BinDir))
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serving workspace: %w", err)
	}
	return nil
}

func closeServerHandler(handler http.Handler) {
	closer, ok := handler.(interface{ Close() error })
	if !ok {
		return
	}
	if err := closer.Close(); err != nil {
		slog.Error("closing server handler", "error", err)
	}
}

func loadBillingPrices(overlayPath string, configPath string) (corepricing.Table, error) {
	overlayPath = strings.TrimSpace(overlayPath)
	if overlayPath == "" {
		return corepricing.Default(), nil
	}
	resolvedPath := resolveConfigRelativePath(overlayPath, configPath)
	file, err := os.Open(resolvedPath)
	if err != nil {
		return nil, fmt.Errorf("opening billing price overlay %s: %w", resolvedPath, err)
	}
	defer file.Close()
	table, err := corepricing.OverlayJSON(corepricing.Default(), file)
	if err != nil {
		return nil, fmt.Errorf("loading billing price overlay %s: %w", resolvedPath, err)
	}
	return table, nil
}

func resolveConfigRelativePath(path string, configPath string) string {
	if filepath.IsAbs(path) || strings.TrimSpace(configPath) == "" {
		return path
	}
	return filepath.Join(filepath.Dir(configPath), path)
}

func shutdownOnStdinClose(httpServer *http.Server) {
	go func() {
		_, _ = io.Copy(io.Discard, os.Stdin)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(ctx); err != nil {
			_ = httpServer.Close()
		}
	}()
}

func applyEnvOverrides(config *serverconfig.ServerConfig) error {
	if config == nil {
		return nil
	}
	if value := strings.TrimSpace(os.Getenv("MEDIAGO_AGENT_ID")); value != "" {
		config.Agent.ID = value
	}
	if value := strings.TrimSpace(os.Getenv("MEDIAGO_AGENT_BIN_DIR")); value != "" {
		config.Agent.BinDir = value
	}
	if value := strings.TrimSpace(os.Getenv("MEDIAGO_FFMPEG_PATH")); value != "" {
		config.FFmpeg.Path = value
	}
	if value := strings.TrimSpace(os.Getenv("MEDIAGO_FFMPEG_BIN_DIR")); value != "" {
		config.FFmpeg.BinDir = value
	}
	if value := strings.TrimSpace(os.Getenv("MEDIAGO_JIMENG_PATH")); value != "" {
		config.Jimeng.Path = value
	}
	if value := strings.TrimSpace(os.Getenv("MEDIAGO_JIMENG_BIN_DIR")); value != "" {
		config.Jimeng.BinDir = value
	}
	if value := strings.TrimSpace(os.Getenv("MEDIAGO_SERVER_PORT")); value != "" {
		port, err := parseServerPort(value)
		if err != nil {
			return fmt.Errorf("invalid MEDIAGO_SERVER_PORT: %w", err)
		}
		config.Port = port
	}
	if value := strings.TrimSpace(os.Getenv("MEDIAGO_LOG_LEVEL")); value != "" {
		config.LogLevel = value
	}
	return nil
}

func exitOnStdinCloseEnabled() bool {
	return truthyEnvValue(os.Getenv("MEDIAGO_EXIT_ON_STDIN_CLOSE"))
}

func truthyEnvValue(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func parseServerPort(value string) (int, error) {
	port, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 0, err
	}
	if port <= 0 || port > 65535 {
		return 0, fmt.Errorf("port must be between 1 and 65535")
	}
	return port, nil
}

func displayAgentID(id string) string {
	id = strings.TrimSpace(id)
	if id == "" {
		return "codex"
	}
	return id
}

func displayAgentMode(binDir string) string {
	binDir = strings.TrimSpace(binDir)
	if binDir == "" {
		return "PATH"
	}
	return "vendored: " + binDir
}

func cleanConfigPath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", nil
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolving config path %s: %w", path, err)
	}
	return absPath, nil
}

func agentBridgeHost(host string) string {
	host = strings.TrimSpace(host)
	if host == "" || host == "0.0.0.0" || host == "::" || host == "[::]" {
		return "127.0.0.1"
	}
	return host
}

func generateServeInternalToken() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw[:]), nil
}
