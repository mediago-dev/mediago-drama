package mcp

// AgentDocumentSelectionEvent asks the host editor to select a document range.
type AgentDocumentSelectionEvent struct {
	DocumentID string                 `json:"documentId"`
	Selection  DocumentRangeSelection `json:"selection"`
	RunID      string                 `json:"runId,omitempty"`
	AgentTag   string                 `json:"agentTag,omitempty"`
}

// AgentDocumentEvent is the closed set of document events that MCP servers may
// ask the host application to publish.
type AgentDocumentEvent interface {
	agentDocumentEvent()
}

func (AgentDocumentSelectionEvent) agentDocumentEvent() {}
