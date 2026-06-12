package mcp

import (
	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

// DocumentConfig controls document MCP runtime behavior.
type DocumentConfig struct {
	SessionID        string
	RunID            string
	BridgeURL        string
	BridgeToken      string
	RolePersona      string
	AgentTag         string
	ActiveDocumentID string
	SelectionText    string
	Events           EventPublisher
}

// DocumentConfigFromProtocol maps protocol-level document config to app runtime config.
func DocumentConfigFromProtocol(base mediamcp.DocumentConfig) DocumentConfig {
	return DocumentConfig{
		SessionID:        base.SessionID,
		RunID:            base.RunID,
		BridgeURL:        base.BridgeURL,
		BridgeToken:      base.BridgeToken,
		RolePersona:      base.RolePersona,
		AgentTag:         base.AgentTag,
		ActiveDocumentID: base.ActiveDocumentID,
		SelectionText:    base.SelectionText,
	}
}

func (config DocumentConfig) protocolConfig() mediamcp.DocumentConfig {
	return mediamcp.DocumentConfig{
		SessionID:        config.SessionID,
		RunID:            config.RunID,
		BridgeURL:        config.BridgeURL,
		BridgeToken:      config.BridgeToken,
		RolePersona:      config.RolePersona,
		AgentTag:         config.AgentTag,
		ActiveDocumentID: config.ActiveDocumentID,
		SelectionText:    config.SelectionText,
	}
}

func (server DocumentServer) ensureCanWriteDocument(documentID string) error {
	_ = documentID
	return nil
}

func (server DocumentServer) ensureCanUseStructuralWrite(toolName string) error {
	_ = toolName
	return nil
}

func (server DocumentServer) rememberDocumentVersion(document mediamcp.WorkspaceDocument) {
	_ = document
}
