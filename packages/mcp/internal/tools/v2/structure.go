package v2

import (
	"context"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

func registerLoadSkillTool(server *mcpsdk.Server, dispatcher Dispatcher, projectID string, closedWorld bool, logToolRegistered func(string)) {
	handler := func(ctx context.Context, request *mcpsdk.CallToolRequest, input mediamcp.LoadSkillInput) (*mcpsdk.CallToolResult, any, error) {
		_ = request
		output, err := dispatcher.LoadSkill(ctx, projectID, input)
		if err != nil {
			return &mcpsdk.CallToolResult{IsError: true}, output, nil
		}
		return nil, output, nil
	}
	mediamcp.AddTool(server, closedWorld, logToolRegistered, mediamcp.AgentDocumentTools.LoadSkill, handler)
}
