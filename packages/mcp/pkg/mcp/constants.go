package mcp

const (
	// ServerName is the canonical MCP server name exposed to ACP clients.
	ServerName = "mediago_drama"
	// BlockIDFreshnessNotice is appended to tools that operate on generated block IDs.
	BlockIDFreshnessNotice = "写入前必须先调用 get_document_outline 或 get_document 获取最新 blockId/hash；blockId 由当前 Markdown 结构即时计算，跨编辑可能漂移。写入工具成功返回 nextOutline 时，连续编辑同一文档优先复用其中最新 blockId/hash；缺失或文档已被其他操作更新时再重新读取。"
	// DocumentHTTPPath is the streamable HTTP route for run-scoped document tools.
	DocumentHTTPPath = "/api/v1/internal/agent/document-mcp"
	// LegacyDocumentHTTPPath is accepted by the server for in-flight agents started
	// before the versioned route was introduced.
	LegacyDocumentHTTPPath = "/api/internal/agent/document-mcp"
	// BridgeURLHeader forwards the bridge base URL to HTTP-hosted MCP tools.
	BridgeURLHeader = "X-MediaGo-Drama-Agent-Bridge-URL"
	// BridgeTokenHeader forwards the bridge bearer token to HTTP-hosted MCP tools.
	BridgeTokenHeader = "X-MediaGo-Drama-Agent-Bridge-Token"
)

// ToolPrefix returns the MCP-qualified tool prefix.
func ToolPrefix() string {
	return ServerName + "/"
}

// ToolName returns a fully-qualified MCP tool name.
func ToolName(toolName string) string {
	return ToolPrefix() + toolName
}
