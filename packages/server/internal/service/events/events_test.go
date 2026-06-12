package events

import (
	"encoding/json"
	"net/http"
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	serviceagent "github.com/mediago-dev/mediago-drama/packages/server/internal/service/agent"
)

func TestDecodeInternalAgentEventAllowsDocumentBridgeEvents(t *testing.T) {
	for _, event := range []AgentEvent{
		{
			ProjectID: "project-1",
			Type:      AgentDocumentSelectionSetEventType,
			Message:   "selection",
			DocumentSelection: &mediamcp.AgentDocumentSelectionEvent{
				DocumentID: "doc-1",
			},
		},
	} {
		raw, err := json.Marshal(event)
		if err != nil {
			t.Fatalf("marshaling event: %v", err)
		}
		decoded, status, err := DecodeInternalAgentEvent(raw, func(projectID string) (string, error) {
			return "clean-" + projectID, nil
		})
		if err != nil {
			t.Fatalf("DecodeInternalAgentEvent(%s) returned error: %v", event.Type, err)
		}
		if status != http.StatusNoContent || decoded.ProjectID != "clean-project-1" || decoded.Type != event.Type {
			t.Fatalf("decoded = %#v status=%d, want cleaned no-content event", decoded, status)
		}
	}
}

func TestIsGuaranteedAgentEventPayloadOnlyGuaranteesACPPermissionRequests(t *testing.T) {
	if !IsGuaranteedAgentEventPayload(AgentEvent{
		Type: "agent.acp",
		ACP:  &serviceagent.AgentACPEvent{Kind: "permissionRequest"},
	}) {
		t.Fatal("ACP permission request should be guaranteed")
	}

	if IsGuaranteedAgentEventPayload(AgentEvent{
		Type: "agent.acp",
		ACP:  &serviceagent.AgentACPEvent{Kind: "toolCall"},
	}) {
		t.Fatal("ACP tool calls should remain best-effort")
	}
}
