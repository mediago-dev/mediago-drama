package config

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// ServerConfig contains local HTTP server configuration loaded from YAML.
type ServerConfig struct {
	Host           string            `yaml:"host"`
	Port           int               `yaml:"port"`
	LogPath        string            `yaml:"log_path"`
	LogLevel       string            `yaml:"log_level"`
	WorkspaceDir   string            `yaml:"workspace_dir"`
	ACPCommand     string            `yaml:"acp_command"`
	ModelPlatforms []string          `yaml:"model_platforms"`
	MediagoBaseURL string            `yaml:"mediago_base_url"`
	Agent          AgentConfig       `yaml:"agent"`
	FFmpeg         FFmpegConfig      `yaml:"ffmpeg"`
	Jimeng         JimengConfig      `yaml:"jimeng"`
	Billing        BillingConfig     `yaml:"billing"`
	Prompt         PromptConfig      `yaml:"prompt"`
	InternalAPI    InternalAPIConfig `yaml:"internal_api"`
	DocumentMCP    DocumentMCPConfig `yaml:"document_mcp"`
}

// AgentConfig contains ACP agent binary selection and vendored bin settings.
type AgentConfig struct {
	ID     string `yaml:"id"`
	BinDir string `yaml:"bin_dir"`
}

// FFmpegConfig contains ffmpeg binary selection and vendored bin settings.
type FFmpegConfig struct {
	Path   string `yaml:"path"`
	BinDir string `yaml:"bin_dir"`
}

// JimengConfig contains Dreamina/Jimeng CLI binary selection and vendored bin settings.
type JimengConfig struct {
	Path   string `yaml:"path"`
	BinDir string `yaml:"bin_dir"`
}

// PromptConfig contains system prompt rendering configuration.
type PromptConfig struct {
	MaxSectionChars int `yaml:"max_section_chars"`
}

// BillingConfig contains billing and pricing configuration.
type BillingConfig struct {
	PriceOverlayPath string `yaml:"price_overlay_path"`
}

// DocumentMCPConfig contains stdio document MCP runtime configuration loaded
// from YAML before environment overrides are applied.
type DocumentMCPConfig struct {
	SessionID        string `yaml:"session_id"`
	RunID            string `yaml:"run_id"`
	BridgeURL        string `yaml:"bridge_url"`
	BridgeToken      string `yaml:"bridge_token"`
	RolePersona      string `yaml:"role_persona"`
	AgentTag         string `yaml:"agent_tag"`
	ActiveDocumentID string `yaml:"active_document_id"`
	SelectionText    string `yaml:"selection_text"`
}

// Load reads a YAML server configuration file over the built-in defaults.
func Load(path string) (ServerConfig, error) {
	config := defaults()
	path = strings.TrimSpace(path)
	if path == "" {
		return config, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return config, fmt.Errorf("reading config %s: %w", path, err)
	}
	if err := yaml.Unmarshal(raw, &config); err != nil {
		return config, fmt.Errorf("parsing config %s: %w", path, err)
	}
	return normalize(config), nil
}

func defaults() ServerConfig {
	return ServerConfig{Host: "127.0.0.1", Port: 8080, Prompt: PromptConfig{MaxSectionChars: 12000}}
}

func normalize(config ServerConfig) ServerConfig {
	defaults := defaults()
	config.Host = strings.TrimSpace(config.Host)
	if config.Host == "" {
		config.Host = defaults.Host
	}
	config.LogPath = strings.TrimSpace(config.LogPath)
	config.LogLevel = strings.TrimSpace(config.LogLevel)
	config.WorkspaceDir = strings.TrimSpace(config.WorkspaceDir)
	config.ACPCommand = strings.TrimSpace(config.ACPCommand)
	config.ModelPlatforms = normalizeStringList(config.ModelPlatforms)
	config.MediagoBaseURL = strings.TrimRight(strings.TrimSpace(config.MediagoBaseURL), "/")
	config.Agent = normalizeAgentConfig(config.Agent)
	config.FFmpeg = normalizeFFmpegConfig(config.FFmpeg)
	config.Jimeng = normalizeJimengConfig(config.Jimeng)
	config.Billing = normalizeBillingConfig(config.Billing)
	config.InternalAPI = normalizeInternalAPIConfig(config.InternalAPI)
	config.DocumentMCP = normalizeDocumentMCPConfig(config.DocumentMCP)
	if config.Prompt.MaxSectionChars <= 0 {
		config.Prompt.MaxSectionChars = defaults.Prompt.MaxSectionChars
	}
	return config
}

func normalizeAgentConfig(config AgentConfig) AgentConfig {
	config.ID = strings.TrimSpace(config.ID)
	config.BinDir = strings.TrimSpace(config.BinDir)
	return config
}

func normalizeFFmpegConfig(config FFmpegConfig) FFmpegConfig {
	config.Path = strings.TrimSpace(config.Path)
	config.BinDir = strings.TrimSpace(config.BinDir)
	return config
}

func normalizeJimengConfig(config JimengConfig) JimengConfig {
	config.Path = strings.TrimSpace(config.Path)
	config.BinDir = strings.TrimSpace(config.BinDir)
	return config
}

func normalizeBillingConfig(config BillingConfig) BillingConfig {
	config.PriceOverlayPath = strings.TrimSpace(config.PriceOverlayPath)
	return config
}

func normalizeInternalAPIConfig(config InternalAPIConfig) InternalAPIConfig {
	config.URL = strings.TrimSpace(config.URL)
	config.Token = strings.TrimSpace(config.Token)
	return config
}

func normalizeDocumentMCPConfig(config DocumentMCPConfig) DocumentMCPConfig {
	config.SessionID = strings.TrimSpace(config.SessionID)
	config.RunID = strings.TrimSpace(config.RunID)
	config.BridgeURL = strings.TrimSpace(config.BridgeURL)
	config.BridgeToken = strings.TrimSpace(config.BridgeToken)
	config.RolePersona = strings.TrimSpace(config.RolePersona)
	config.AgentTag = strings.TrimSpace(config.AgentTag)
	config.ActiveDocumentID = strings.TrimSpace(config.ActiveDocumentID)
	config.SelectionText = strings.TrimSpace(config.SelectionText)
	return config
}

func normalizeStringList(values []string) []string {
	if values == nil {
		return nil
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			result = append(result, value)
		}
	}
	return result
}
