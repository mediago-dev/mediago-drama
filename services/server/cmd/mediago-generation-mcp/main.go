package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	server "github.com/mediago-dev/mediago-drama/services/server/internal/app"
	serverconfig "github.com/mediago-dev/mediago-drama/services/server/internal/config"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	flags := flag.NewFlagSet("mediago-generation-mcp", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	configFlag := flags.String("config", "", "Path to YAML server config")
	projectID := flags.String("project", "", "MediaGo Drama project ID")
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
	return server.RunGenerationMCP(
		context.Background(),
		appConfigFromServerConfig(config),
		*projectID,
		os.Stdin,
		os.Stdout,
	)
}

func appConfigFromServerConfig(config serverconfig.ServerConfig) server.Config {
	workspaceDir := server.ResolveWorkspaceDir(config.WorkspaceDir)
	return server.Config{
		Host:                  config.Host,
		Port:                  config.Port,
		WorkspaceDir:          workspaceDir,
		ModelPlatforms:        config.ModelPlatforms,
		GenerationCLIs:        config.GenerationCLIs,
		MediagoBaseURL:        config.MediagoBaseURL,
		FFmpegPath:            config.FFmpeg.Path,
		FFmpegBinDir:          config.FFmpeg.BinDir,
		JimengBinPath:         config.Jimeng.Path,
		JimengBinDir:          config.Jimeng.BinDir,
		LibTVBinPath:          config.LibTV.Path,
		LibTVBinDir:           config.LibTV.BinDir,
		LibTVProjectID:        config.LibTV.ProjectID,
		PippitBinPath:         config.Pippit.Path,
		PippitBinDir:          config.Pippit.BinDir,
		AgentBridgeToken:      "generation-mcp-stdio",
		PromptMaxSectionChars: config.Prompt.MaxSectionChars,
		PromptDelivery:        config.Prompt.InstructionDelivery,
	}
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
