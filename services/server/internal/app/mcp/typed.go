package mcp

import (
	"fmt"
	"strings"
)

func (adapter *Adapter) documentServerForProject(projectID string) (DocumentServer, error) {
	if adapter == nil {
		return DocumentServer{}, fmt.Errorf("mcp adapter is not configured")
	}
	projectID = strings.TrimSpace(projectID)
	if adapter.external != nil && projectID != "" {
		return adapter.external.documentServer(projectID)
	}
	if adapter.document != nil {
		return *adapter.document, nil
	}
	return DocumentServer{}, fmt.Errorf("document mcp adapter is not configured")
}

func (adapter *Adapter) normalizeProjectID(projectID string) (string, error) {
	if adapter != nil && adapter.external != nil {
		return CleanExternalProjectID(projectID)
	}
	return strings.TrimSpace(projectID), nil
}
