package mcp

import (
	"context"
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

func TestMCPAdapterGetProjectConfigReadsCurrentProject(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.InitErr() != nil {
		t.Fatalf("workspace init error: %v", store.InitErr())
	}
	const projectID = "project-config"
	requireMCPTestProject(t, store, projectID)

	if _, err := store.SaveProjectConfigPatchInput(projectID, mediamcp.ProjectConfigPatchInput{
		Overview: &mediamcp.ProjectOverviewConfigPatch{
			CategoryDefaults: map[string]string{"extra": "video-cinematic-shot", "style": "realistic"},
		},
	}); err != nil {
		t.Fatalf("saving project config: %v", err)
	}

	adapter := NewAdapter(store, nil)
	adapter.document = &DocumentServer{store: store, projectID: projectID}

	output, err := adapter.GetProjectConfig(context.Background(), "")
	if err != nil {
		t.Fatalf("GetProjectConfig returned error: %v", err)
	}
	if output.Status != "ok" ||
		output.Config.ProjectID != projectID ||
		output.Config.Overview.CategoryDefaults["extra"] != "video-cinematic-shot" ||
		output.Config.Overview.CategoryDefaults["style"] != "" {
		t.Fatalf("project config output = %+v, want category defaults without style", output)
	}
}
