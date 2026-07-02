package mcp

import appworkspace "github.com/mediago-dev/mediago-drama/services/server/internal/app/workspace"
import serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"

// Adapter bridges CLI-owned workspace services into packages/mcp server
// dependency interfaces.
type Adapter struct {
	store         *appworkspace.WorkspaceStateService
	events        EventPublisher
	skillRegistry *serviceskill.Registry
	document      *DocumentServer
	external      *ExternalServer
}

// NewAdapter creates a MediaGo Drama MCP adapter.
func NewAdapter(store *appworkspace.WorkspaceStateService, events EventPublisher) *Adapter {
	return NewAdapterWithSkillRegistry(store, events, nil)
}

// NewAdapterWithSkillRegistry creates a MediaGo Drama MCP adapter with an
// explicit skill registry.
func NewAdapterWithSkillRegistry(
	store *appworkspace.WorkspaceStateService,
	events EventPublisher,
	skillRegistry *serviceskill.Registry,
) *Adapter {
	if skillRegistry == nil {
		skillRegistry = newSkillRegistryForWorkspace(store)
	}
	return &Adapter{store: store, events: events, skillRegistry: skillRegistry}
}

// NormalizeProjectID validates and normalizes a project ID for document tools.
func (adapter *Adapter) NormalizeProjectID(projectID string) (string, error) {
	return adapter.normalizeProjectID(projectID)
}
