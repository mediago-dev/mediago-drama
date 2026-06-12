package mcp

import appworkspace "github.com/torchstellar-team/mediago-drama/packages/server/internal/app/workspace"

// Adapter bridges CLI-owned workspace services into packages/mcp server
// dependency interfaces.
type Adapter struct {
	store    *appworkspace.WorkspaceStateService
	events   EventPublisher
	document *DocumentServer
	external *ExternalServer
}

// NewAdapter creates a MediaGo Drama MCP adapter.
func NewAdapter(store *appworkspace.WorkspaceStateService, events EventPublisher) *Adapter {
	return &Adapter{store: store, events: events}
}

// NormalizeProjectID validates and normalizes a project ID for document tools.
func (adapter *Adapter) NormalizeProjectID(projectID string) (string, error) {
	return adapter.normalizeProjectID(projectID)
}
