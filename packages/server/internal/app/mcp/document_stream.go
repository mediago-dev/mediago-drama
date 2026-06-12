package mcp

import (
	"log/slog"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	cliservice "github.com/mediago-dev/mediago-drama/packages/server/internal/service/document"
)

func (server DocumentServer) publishDocumentEditStarted(document mediamcp.WorkspaceDocument, summary string) {
	server.publishDocumentEdit("agent.document.edit.started", document, agentDocumentEditDelta{
		Summary: firstNonEmpty(summary, "开始流式编辑。"),
		Status:  "streaming",
	})
}

func (server DocumentServer) publishDocumentEditDelta(document mediamcp.WorkspaceDocument, delta agentDocumentEditDelta) {
	if delta.Status == "" {
		delta.Status = "streaming"
	}
	server.publishDocumentEdit("agent.document.edit.delta", document, delta)
}

func (server DocumentServer) publishDocumentEditCheckpoint(document mediamcp.WorkspaceDocument, summary string) {
	server.publishDocumentEdit("agent.document.edit.checkpoint", document, agentDocumentEditDelta{
		Content: document.Content,
		Summary: summary,
		Status:  "checkpoint",
	})
}

func (server DocumentServer) publishDocumentEditCompleted(document mediamcp.WorkspaceDocument, summary string) {
	server.publishDocumentEdit("agent.document.edit.completed", document, agentDocumentEditDelta{
		Content: document.Content,
		Summary: firstNonEmpty(summary, "流式编辑已完成。"),
		Status:  "completed",
	})
}

func (server DocumentServer) publishDocumentEditFailed(documentID string, title string, summary string) {
	if server.config.Events == nil {
		return
	}
	server.config.Events.PublishEvent(cliservice.BuildDocumentEditFailedEvent(server.projectID, documentID, title, summary))
}

func (server DocumentServer) publishDocumentEditLifecycle(
	before agentDocumentEditSnapshot,
	after mediamcp.WorkspaceDocument,
	mode string,
	delta string,
	summary string,
	anchorText string,
) {
	if summary == "" {
		summary = "已写入《" + after.Title + "》。"
	}
	if server.config.Events == nil {
		if before.ID != "" || after.ID != "" {
			server.recordDocumentEditOperation(before, cliservice.SnapshotDocument(after), summary)
		}
		return
	}
	server.publishDocumentEditStarted(after, "开始写入《"+after.Title+"》。")
	if delta != "" || mode == "replace" {
		server.publishDocumentEditDelta(after, agentDocumentEditDelta{
			Mode:       firstNonEmpty(mode, "replace"),
			Delta:      delta,
			Content:    after.Content,
			AnchorText: anchorText,
			Status:     "streaming",
		})
	}
	if before.ID != "" || after.ID != "" {
		server.recordDocumentEditOperation(before, cliservice.SnapshotDocument(after), summary)
	}
	server.publishDocumentEditCheckpoint(after, summary)
	server.publishDocumentEditCompleted(after, "流式编辑已完成。")
}

func (server DocumentServer) publishDocumentEdit(eventType string, document mediamcp.WorkspaceDocument, delta agentDocumentEditDelta) {
	if server.config.Events == nil {
		return
	}
	server.config.Events.PublishEvent(cliservice.BuildDocumentEditEvent(
		eventType,
		document,
		delta,
		cliservice.DocumentEditEventContext{
			ProjectID: server.projectID,
			RunID:     server.config.RunID,
			AgentTag:  server.config.AgentTag,
		},
	))
}

func (server DocumentServer) recordDocumentEditOperation(
	before agentDocumentEditSnapshot,
	after agentDocumentEditSnapshot,
	summary string,
) {
	record, ok := cliservice.NewDocumentEditOperationLogRecord(before, after, summary, server.config.AgentTag)
	if !ok {
		return
	}
	if err := server.store.AppendDocumentOperationLog(server.projectID, record); err != nil {
		slog.Warn(
			"recording document edit operation log failed",
			"project_id", server.projectID,
			"document_id", after.ID,
			"error", err,
		)
		server.publishDocumentEditFailed(after.ID, after.Title, "写入流式编辑操作日志失败："+err.Error())
	}
}
