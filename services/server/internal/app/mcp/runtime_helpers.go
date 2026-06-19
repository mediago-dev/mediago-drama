package mcp

import (
	"strings"

	mcpdocs "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/documents"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	servicedocument "github.com/mediago-dev/mediago-drama/services/server/internal/service/document"
)

func (server DocumentServer) selectionFromConfig() *mediamcp.DocumentRangeSelection {
	quote := strings.TrimSpace(server.config.SelectionText)
	documentID := strings.TrimSpace(server.config.ActiveDocumentID)
	if quote == "" || documentID == "" || server.store == nil {
		return nil
	}
	document, ok, err := server.store.GetWorkspaceDocument(server.projectID, documentID)
	if err != nil || !ok {
		return nil
	}
	selection, err := mcpdocs.SelectionFromDocumentContent(document.Content, quote)
	if err != nil {
		return nil
	}
	return selection
}

func (server DocumentServer) publishSelectionSet(documentID string, selection mediamcp.DocumentRangeSelection) {
	if server.config.Events == nil {
		return
	}
	server.config.Events.PublishEvent(agentEvent{
		ProjectID: server.projectID,
		Type:      serviceagent.AgentDocumentSelectionSetEventType,
		Message:   "已设置文档选区。",
		DocumentSelection: &mediamcp.AgentDocumentSelectionEvent{
			DocumentID: documentID,
			Selection:  selection,
			RunID:      server.config.RunID,
			AgentTag:   firstNonEmpty(server.config.AgentTag, serviceagent.DefaultAgentName),
		},
	})
}

func (server DocumentServer) publishDocumentEditLifecycleForBlock(before agentDocumentEditSnapshot, after mediamcp.WorkspaceDocument, mode string, delta string, summary string, blockID string, op string) {
	if server.config.Events == nil {
		server.recordDocumentEditOperation(before, servicedocument.SnapshotDocument(after), summary)
		return
	}
	server.publishDocumentEditStarted(after, "开始写入《"+after.Title+"》。")
	server.publishDocumentEditDelta(after, agentDocumentEditDelta{
		Mode:    firstNonEmpty(mode, "replace"),
		Delta:   delta,
		Content: delta,
		Summary: summary,
		Status:  "streaming",
		BlockID: blockID,
		Op:      op,
	})
	server.recordDocumentEditOperation(before, servicedocument.SnapshotDocument(after), summary)
	server.publishDocumentEditCheckpoint(after, summary)
	server.publishDocumentEditCompleted(after, "流式编辑已完成。")
}

func (server DocumentServer) commentAuthorID() string {
	return firstNonEmpty(strings.TrimSpace(server.config.AgentTag), "agent")
}
