package config

import (
	"os"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

const (
	oneInternalAPIURLEnv   = "ONE_INTERNAL_API_URL"
	oneInternalAPITokenEnv = "ONE_INTERNAL_API_TOKEN"
)

// InternalAPIConfig contains the internal HTTP bridge configuration exported to child tools.
type InternalAPIConfig struct {
	URL   string `yaml:"url"`
	Token string `yaml:"token"`
}

// InternalAPIFromEnv loads internal bridge configuration from process environment variables.
func InternalAPIFromEnv() InternalAPIConfig {
	return InternalAPIFromLookup(os.Getenv)
}

// InternalAPIFromConfig resolves internal bridge configuration from YAML with
// non-empty environment variables applied as overrides.
func InternalAPIFromConfig(config InternalAPIConfig) InternalAPIConfig {
	return InternalAPIFromConfigLookup(config, os.Getenv)
}

// InternalAPIFromConfigLookup resolves internal bridge configuration from YAML
// with non-empty caller-provided environment values applied as overrides.
func InternalAPIFromConfigLookup(config InternalAPIConfig, lookup func(string) string) InternalAPIConfig {
	envConfig := InternalAPIFromLookup(lookup)
	return InternalAPIConfig{
		URL:   firstNonEmpty(envConfig.URL, config.URL),
		Token: firstNonEmpty(envConfig.Token, config.Token),
	}
}

// InternalAPIFromLookup loads internal bridge configuration from a caller-provided lookup.
func InternalAPIFromLookup(lookup func(string) string) InternalAPIConfig {
	if lookup == nil {
		lookup = func(string) string { return "" }
	}
	return InternalAPIConfig{
		URL:   strings.TrimSpace(lookup(oneInternalAPIURLEnv)),
		Token: strings.TrimSpace(lookup(oneInternalAPITokenEnv)),
	}
}

// DocumentMCPFromEnv loads stdio document MCP configuration from process environment variables.
func DocumentMCPFromEnv() mediamcp.DocumentConfig {
	return DocumentMCPFromLookup(os.Getenv)
}

// DocumentMCPFromConfig resolves stdio document MCP configuration from YAML
// with non-empty environment variables applied as overrides.
func DocumentMCPFromConfig(config DocumentMCPConfig) mediamcp.DocumentConfig {
	return DocumentMCPFromConfigLookup(config, os.Getenv)
}

// DocumentMCPFromConfigLookup resolves stdio document MCP configuration from
// YAML with non-empty caller-provided environment values applied as overrides.
func DocumentMCPFromConfigLookup(config DocumentMCPConfig, lookup func(string) string) mediamcp.DocumentConfig {
	base := mediamcp.DocumentConfig{
		SessionID:        config.SessionID,
		RunID:            config.RunID,
		BridgeURL:        config.BridgeURL,
		BridgeToken:      config.BridgeToken,
		RolePersona:      config.RolePersona,
		AgentTag:         config.AgentTag,
		ActiveDocumentID: config.ActiveDocumentID,
		SelectionText:    config.SelectionText,
	}
	envConfig := DocumentMCPFromLookup(lookup)
	return mediamcp.DocumentConfig{
		SessionID:        firstNonEmpty(envConfig.SessionID, base.SessionID),
		RunID:            firstNonEmpty(envConfig.RunID, base.RunID),
		BridgeURL:        firstNonEmpty(envConfig.BridgeURL, base.BridgeURL),
		BridgeToken:      firstNonEmpty(envConfig.BridgeToken, base.BridgeToken),
		RolePersona:      firstNonEmpty(envConfig.RolePersona, base.RolePersona),
		AgentTag:         firstNonEmpty(envConfig.AgentTag, base.AgentTag),
		ActiveDocumentID: firstNonEmpty(envConfig.ActiveDocumentID, base.ActiveDocumentID),
		SelectionText:    firstNonEmpty(envConfig.SelectionText, base.SelectionText),
	}
}

// DocumentMCPFromLookup loads stdio document MCP configuration from a caller-provided lookup.
func DocumentMCPFromLookup(lookup func(string) string) mediamcp.DocumentConfig {
	return mediamcp.DocumentConfigFromEnvVars(lookup)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}
