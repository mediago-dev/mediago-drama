package mcp

import (
	"net/http"

	mcpserver "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/server"
	appevents "github.com/mediago-dev/mediago-drama/services/server/internal/app/events"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
)

const (
	documentMCPHTTPPath          = mcpserver.DocumentHTTPPath
	documentMCPBridgeURLHeader   = mcpserver.BridgeURLHeader
	documentMCPBridgeTokenHeader = mcpserver.BridgeTokenHeader
)

// RuntimeConfigSource supplies the app runtime values needed by document MCP HTTP.
type RuntimeConfigSource interface {
	AgentBridgeURL() string
	AgentBridgeToken() string
	WorkspaceDir() string
	NewAgentEventBus(appevents.Context) appevents.EventPublisher
}

// DocumentMCPConfigFromHTTPRequest builds document MCP runtime config from an HTTP request.
func DocumentMCPConfigFromHTTPRequest(request *http.Request, source RuntimeConfigSource) DocumentConfig {
	query := request.URL.Query()
	base := mcpserver.DocumentConfigFromHTTPRequest(request, mcpserver.DocumentHTTPConfigOptions{
		DefaultBridgeURL:   source.AgentBridgeURL(),
		DefaultBridgeToken: source.AgentBridgeToken(),
	})
	config := DocumentConfigFromProtocol(base)
	config.RolePersona = serviceagent.DefaultAgentPersona
	config.AgentTag = firstNonEmpty(base.AgentTag, serviceagent.DefaultAgentName)
	config.Events = source.NewAgentEventBus(appevents.Context{
		SessionID: config.SessionID,
		ProjectID: domain.CleanProjectID(query.Get("projectId")),
		RunID:     config.RunID,
		AgentTag:  config.AgentTag,
	})
	return config
}
