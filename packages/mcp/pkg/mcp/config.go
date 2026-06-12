package mcp

import "strings"

const (
	envAgentSessionID   = "MEDIAGO_DRAMA_AGENT_SESSION_ID"
	envAgentRunID       = "MEDIAGO_DRAMA_AGENT_RUN_ID"
	envAgentBridgeURL   = "MEDIAGO_DRAMA_AGENT_BRIDGE_URL"
	envAgentBridgeToken = "MEDIAGO_DRAMA_AGENT_BRIDGE_TOKEN"
	envRolePersona      = "MEDIAGO_DRAMA_ROLE_PERSONA"
	envAgentTag         = "MEDIAGO_DRAMA_AGENT_TAG"
	envActiveDocumentID = "MEDIAGO_DRAMA_ACTIVE_DOCUMENT_ID"
	envSelectionText    = "MEDIAGO_DRAMA_SELECTION_TEXT"

	legacyEnvAgentSessionID   = "MEDIA_CLI_AGENT_SESSION_ID"
	legacyEnvAgentRunID       = "MEDIA_CLI_AGENT_RUN_ID"
	legacyEnvAgentBridgeURL   = "MEDIA_CLI_AGENT_BRIDGE_URL"
	legacyEnvAgentBridgeToken = "MEDIA_CLI_AGENT_BRIDGE_TOKEN"
	legacyEnvRolePersona      = "MEDIA_CLI_ROLE_PERSONA"
	legacyEnvAgentTag         = "MEDIA_CLI_AGENT_TAG"
	legacyEnvActiveDocumentID = "MEDIA_CLI_ACTIVE_DOCUMENT_ID"
	legacyEnvSelectionText    = "MEDIA_CLI_SELECTION_TEXT"
)

// DocumentConfig is the transport-level MCP document server configuration.
type DocumentConfig struct {
	SessionID        string
	RunID            string
	BridgeURL        string
	BridgeToken      string
	RolePersona      string
	AgentTag         string
	ActiveDocumentID string
	SelectionText    string
}

// DocumentConfigFromEnvVars parses stdio document MCP configuration from a
// caller-provided environment variable lookup function.
func DocumentConfigFromEnvVars(lookup func(string) string) DocumentConfig {
	if lookup == nil {
		lookup = func(string) string { return "" }
	}
	return DocumentConfig{
		SessionID:        trimEnvValue(lookup, envAgentSessionID, legacyEnvAgentSessionID),
		RunID:            trimEnvValue(lookup, envAgentRunID, legacyEnvAgentRunID),
		BridgeURL:        trimEnvValue(lookup, envAgentBridgeURL, legacyEnvAgentBridgeURL),
		BridgeToken:      trimEnvValue(lookup, envAgentBridgeToken, legacyEnvAgentBridgeToken),
		RolePersona:      trimEnvValue(lookup, envRolePersona, legacyEnvRolePersona),
		AgentTag:         trimEnvValue(lookup, envAgentTag, legacyEnvAgentTag),
		ActiveDocumentID: trimEnvValue(lookup, envActiveDocumentID, legacyEnvActiveDocumentID),
		SelectionText:    trimEnvValue(lookup, envSelectionText, legacyEnvSelectionText),
	}
}

// EnvVar is a transport-neutral environment variable pair.
type EnvVar struct {
	Name  string
	Value string
}

// DocumentLaunchConfig describes how an ACP client should launch the document MCP server.
type DocumentLaunchConfig struct {
	SessionID        string
	RunID            string
	RolePersona      string
	AgentTag         string
	BridgeURL        string
	BridgeToken      string
	ActiveDocumentID string
	SelectionText    string
}

// DocumentStdioEnv returns the environment passed to a stdio document MCP child process.
func DocumentStdioEnv(config DocumentLaunchConfig) []EnvVar {
	return []EnvVar{
		{Name: envAgentSessionID, Value: config.SessionID},
		{Name: envAgentRunID, Value: config.RunID},
		{Name: envRolePersona, Value: config.RolePersona},
		{Name: envAgentTag, Value: config.AgentTag},
		{Name: envAgentBridgeURL, Value: config.BridgeURL},
		{Name: envAgentBridgeToken, Value: config.BridgeToken},
		{Name: envActiveDocumentID, Value: config.ActiveDocumentID},
		{Name: envSelectionText, Value: config.SelectionText},
	}
}

func trimEnvValue(lookup func(string) string, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(lookup(name)); value != "" {
			return value
		}
	}
	return ""
}
