package document

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
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
		len(config.Overview.CategoryDefaults) != 0 ||
		config.CreatedAt == "" {
		t.Fatalf("config = %#v, want minimal project config", config)
	}

	categoryDefaults := map[string]string{"extra": "video-cinematic-shot", "style": "realistic"}
	result, err := store.SaveProjectConfigPatchInput(projectID, mediamcp.ProjectConfigPatchInput{
		Overview: &mediamcp.ProjectOverviewConfigPatch{CategoryDefaults: categoryDefaults},
	})
	if err != nil {
		t.Fatalf("SaveProjectConfigPatchInput returned error: %v", err)
	}
	if !result.Changed ||
		result.Config.Overview.CategoryDefaults["extra"] != "video-cinematic-shot" ||
		result.Config.Overview.CategoryDefaults["style"] != "" {
		t.Fatalf("result = %#v, want changed category defaults", result)
	}

	production := &mediamcp.ProjectProductionState{
		Template: mediamcp.ProjectTemplateSnapshot{
			ID: "comic-drama", Name: "漫剧", Description: "连续叙事生产流程", Category: "serialized-story", Version: 2,
			Stages: []mediamcp.ProjectProductionStage{{ID: "stage-1", Order: 1, Title: "世界观设定", Gate: "世界规则已确认"}},
		},
		StageStates: map[string]mediamcp.ProjectProductionStageState{
			"stage-1": {Status: "IN_PROGRESS", DocumentID: "production-comic-drama-stage-01"},
		},
		CurrentStageID: "stage-1", OverallProgress: 10, Version: "V01", UpdatedAt: "2026-08-20T17:00:00Z", NextAction: "完成世界观设定",
		WorkbenchStates: map[string]mediamcp.ProjectWorkbenchExecutionState{
			"stage-1": {
				Phase:        "confirm",
				Confirmation: &mediamcp.ProjectWorkbenchConfirmation{Confirmed: true, ConfirmedAt: "2026-08-20T17:01:00Z"},
				Note:         "保持角色 Look02",
			},
		},
		ReferenceTransfer: &mediamcp.ProjectReferenceTransferState{
			Draft:                   json.RawMessage(`{"style":"电影感","targetCharacter":"Look02"}`),
			References:              []mediamcp.ProjectReferenceImage{{ID: "ref-1", Name: "灯光参考", Purposes: []string{"灯光"}}},
			StyleTransferDocumentID: "style-transfer-config-project-V01",
			UpdatedAt:               "2026-08-20T17:02:00Z",
		},
		QCResults: map[string]mediamcp.ProjectQCResult{
			"qc-1": {ID: "qc-1", EntityType: "asset", EntityID: "horse-1", Status: "PASS", ReviewedAt: "2026-08-20T17:03:00Z"},
		},
		Versions:      []mediamcp.ProjectVersionRecord{{ID: "version-1", EntityType: "asset", EntityID: "horse-1", Version: "V01", Status: "PASS", Model: "nano-banana-pro", CreatedAt: "2026-08-20T17:03:00Z"}},
		Retrospective: &mediamcp.ProjectRetrospective{Status: "READY", Conclusion: "先锁视觉 DNA 再生成", ReusableRules: []string{"产品结构优先"}, UpdatedAt: "2026-08-20T17:04:00Z"},
		SharedContext: &mediamcp.ProjectSharedContext{
			Script: "女主走入月光", StoryboardBrief: "6 格竖屏分镜", ShotBreakdown: "P01-P06",
			AssetPlan: "角色 / 场景 / 礼盒", MotionPlan: "月光推进", FinalReviewNotes: "字幕与调色待审",
			VisualDNA: map[string]interface{}{"lighting": "冷月光"}, ApprovedAssets: []string{"horse-1"}, UpdatedAt: "2026-08-20T17:04:00Z",
		},
	}
	coverAssetID := "cover-image-1"
	sortOrder := 3
	productionResult, err := store.SaveProjectConfigPatchInput(projectID, mediamcp.ProjectConfigPatchInput{
		Overview: &mediamcp.ProjectOverviewConfigPatch{Production: production, CoverAssetID: &coverAssetID, SortOrder: &sortOrder},
	})
	if err != nil {
		t.Fatalf("saving production state returned error: %v", err)
	}
	if !productionResult.Changed || productionResult.Config.Overview.Production == nil || productionResult.Config.Overview.Production.Template.ID != "comic-drama" {
		t.Fatalf("production result = %#v, want template snapshot", productionResult)
	}
	reloaded, err := store.LoadProjectConfig(projectID)
	if err != nil {
		t.Fatalf("reloading production state returned error: %v", err)
	}
	if reloaded.Overview.Production == nil || reloaded.Overview.Production.StageStates["stage-1"].Status != "IN_PROGRESS" {
		t.Fatalf("reloaded production = %#v, want persisted stage status", reloaded.Overview.Production)
	}
	if reloaded.Overview.Production.WorkbenchStates["stage-1"].Confirmation == nil ||
		!reloaded.Overview.Production.WorkbenchStates["stage-1"].Confirmation.Confirmed ||
		reloaded.Overview.Production.ReferenceTransfer == nil ||
		len(reloaded.Overview.Production.ReferenceTransfer.References) != 1 ||
		reloaded.Overview.Production.ReferenceTransfer.StyleTransferDocumentID != "style-transfer-config-project-V01" {
		t.Fatalf("reloaded production execution context = %#v, want durable workbench and reference transfer", reloaded.Overview.Production)
	}
	if len(reloaded.Overview.Production.QCResults) != 1 || len(reloaded.Overview.Production.Versions) != 1 ||
		reloaded.Overview.Production.Retrospective == nil || reloaded.Overview.Production.Retrospective.Status != "READY" ||
		reloaded.Overview.Production.SharedContext == nil || reloaded.Overview.Production.SharedContext.Script == "" ||
		reloaded.Overview.Production.SharedContext.StoryboardBrief == "" ||
		reloaded.Overview.Production.SharedContext.ShotBreakdown == "" ||
		reloaded.Overview.Production.SharedContext.AssetPlan == "" ||
		reloaded.Overview.Production.SharedContext.MotionPlan == "" ||
		reloaded.Overview.Production.SharedContext.FinalReviewNotes == "" {
		t.Fatalf("reloaded production memory = %#v, want qc, version, retrospective and shared context", reloaded.Overview.Production)
	}
	if reloaded.Overview.CoverAssetID != coverAssetID || reloaded.Overview.SortOrder == nil || *reloaded.Overview.SortOrder != sortOrder {
		t.Fatalf("reloaded overview = %#v, want cover and sort order", reloaded.Overview)
	}
	projects, err := store.ListProjects()
	if err != nil || len(projects.Projects) != 1 {
		t.Fatalf("ListProjects() = %#v, %v", projects, err)
	}
	if projects.Projects[0].Production == nil || projects.Projects[0].CoverAssetID != coverAssetID || projects.Projects[0].SortOrder == nil || *projects.Projects[0].SortOrder != sortOrder {
		t.Fatalf("project summary = %#v, want embedded production summary", projects.Projects[0])
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
	defaults, ok := overview["categoryDefaults"].(map[string]any)
	if !ok || defaults["extra"] != "video-cinematic-shot" || defaults["style"] != nil {
		t.Fatalf("overview = %#v, want category defaults persisted", rawManifest["overview"])
	}

	empty, err := store.SaveProjectConfigPatchInput(projectID, mediamcp.ProjectConfigPatchInput{})
	if err != nil {
		t.Fatalf("empty SaveProjectConfigPatchInput returned error: %v", err)
	}
	if empty.Changed || empty.Config.Overview.CategoryDefaults["extra"] != "video-cinematic-shot" {
		t.Fatalf("empty result = %#v, want unchanged category defaults", empty)
	}
}
