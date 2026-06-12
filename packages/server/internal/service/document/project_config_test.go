package document

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

func TestWorkspaceStateServiceProjectConfig(t *testing.T) {
	store := newWorkspaceStateService(t.TempDir())
	if store.initErr != nil {
		t.Fatalf("initializing workspace store: %v", store.initErr)
	}
	projectID := "config-project"
	projectDir := requireTestProject(t, store, projectID)

	config, err := store.LoadProjectConfig(projectID)
	if err != nil {
		t.Fatalf("LoadProjectConfig returned error: %v", err)
	}
	if config.SchemaVersion != 1 ||
		config.ProjectID != projectID ||
		config.Name != projectID ||
		config.Description != "" ||
		config.Overview.Style != "" ||
		config.CreatedAt == "" {
		t.Fatalf("config = %#v, want minimal project config", config)
	}

	style := "低饱和冷调写实，浅景深。"
	result, err := store.SaveProjectConfigPatchInput(projectID, mediamcp.ProjectConfigPatchInput{
		Overview: &mediamcp.ProjectOverviewConfigPatch{Style: &style},
	})
	if err != nil {
		t.Fatalf("SaveProjectConfigPatchInput returned error: %v", err)
	}
	if !result.Changed || result.Config.Overview.Style != style {
		t.Fatalf("result = %#v, want changed style", result)
	}

	data, err := os.ReadFile(filepath.Join(projectDir, "project.media.json"))
	if err != nil {
		t.Fatalf("reading project manifest: %v", err)
	}
	rawManifest := map[string]any{}
	if err := json.Unmarshal(data, &rawManifest); err != nil {
		t.Fatalf("decoding raw manifest: %v", err)
	}
	if _, ok := rawManifest["directories"]; ok {
		t.Fatalf("manifest should not include directories: %s", string(data))
	}
	if _, ok := rawManifest["updatedAt"]; ok {
		t.Fatalf("manifest should not include updatedAt: %s", string(data))
	}
	overview, ok := rawManifest["overview"].(map[string]any)
	if !ok || overview["style"] != style {
		t.Fatalf("overview = %#v, want style persisted", rawManifest["overview"])
	}

	empty, err := store.SaveProjectConfigPatchInput(projectID, mediamcp.ProjectConfigPatchInput{})
	if err != nil {
		t.Fatalf("empty SaveProjectConfigPatchInput returned error: %v", err)
	}
	if empty.Changed || empty.Config.Overview.Style != style {
		t.Fatalf("empty result = %#v, want unchanged style", empty)
	}
}
