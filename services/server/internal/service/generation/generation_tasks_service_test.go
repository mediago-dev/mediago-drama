package generation

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/config"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	serviceshared "github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
	"gorm.io/gorm/clause"
)

func TestGenerationTaskServicePersistToSQLite(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	taskID := "official.seedance-2.0-fast:task-persisted"
	seedGenerationTaskAsset(t, dbPath, "asset-test", "image", "")
	seedGenerationTaskAsset(t, dbPath, "video-test", "video", "")

	service := NewGenerationTaskService(dbPath, nil)
	if err := service.Upsert(GenerationTaskRecord{
		ID:                taskID,
		ProviderTaskID:    "official.seedance-2.0-fast:provider-task",
		Kind:              "video",
		RouteID:           "official.seedance-2.0-fast",
		FamilyID:          "seedance",
		VersionID:         "seedance-2.0-fast",
		Provider:          "volcengine",
		ModelID:           "jimeng-seedance-2-fast",
		Model:             "doubao-seedance-2-0-fast-260128",
		Prompt:            "cinematic city shot",
		ReferenceURLs:     []string{"https://example.com/reference.png"},
		ReferenceAssetIDs: []string{"asset-test"},
		Params:            map[string]any{"mode": "pro"},
		Status:            "submitted",
		Message:           "Video generation task was submitted.",
		Usage: GenerationUsage{
			InputTokens:     120,
			OutputTokens:    34,
			TotalTokens:     154,
			ReasoningTokens: 9,
			CachedTokens:    12,
		},
		Error:     "raw provider error",
		ErrorCode: "policy_violation",
		ErrorType: "policy_violation",
		Retryable: false,
	}); err != nil {
		t.Fatalf("upserting task: %v", err)
	}

	restarted := NewGenerationTaskService(dbPath, nil)
	task, ok, err := restarted.Get(taskID)
	if err != nil {
		t.Fatalf("getting task: %v", err)
	}
	if !ok {
		t.Fatal("task was not persisted")
	}
	if task.Prompt != "cinematic city shot" || task.RouteID != "official.seedance-2.0-fast" {
		t.Fatalf("task = %+v, want persisted prompt and route", task)
	}
	if task.ProviderTaskID != "official.seedance-2.0-fast:provider-task" {
		t.Fatalf("provider task id = %q, want persisted provider task id", task.ProviderTaskID)
	}
	if task.Error != "raw provider error" ||
		task.ErrorCode != "policy_violation" ||
		task.ErrorType != "policy_violation" ||
		task.Retryable {
		t.Fatalf("failure fields = %+v, want persisted policy failure", task)
	}
	if len(task.ReferenceURLs) != 1 || task.ReferenceURLs[0] != "https://example.com/reference.png" {
		t.Fatalf("reference urls = %#v, want persisted urls", task.ReferenceURLs)
	}
	if len(task.ReferenceAssetIDs) != 1 || task.ReferenceAssetIDs[0] != "asset-test" {
		t.Fatalf("reference asset ids = %#v, want persisted asset ids", task.ReferenceAssetIDs)
	}
	if task.Usage.InputTokens != 120 ||
		task.Usage.OutputTokens != 34 ||
		task.Usage.TotalTokens != 154 ||
		task.Usage.ReasoningTokens != 9 ||
		task.Usage.CachedTokens != 12 {
		t.Fatalf("usage = %+v, want persisted token columns", task.Usage)
	}
	if err := restarted.RecordAttempt(taskID, "create", "submitted", "created", nil); err != nil {
		t.Fatalf("recording attempt: %v", err)
	}
	if err := restarted.RecordAttempt(taskID, "retry", "submitted", "retried", nil); err != nil {
		t.Fatalf("recording retry attempt: %v", err)
	}

	pending, err := restarted.ListPending(10)
	if err != nil {
		t.Fatalf("listing pending tasks: %v", err)
	}
	if len(pending) != 1 || pending[0].ID != taskID {
		t.Fatalf("pending = %+v, want seeded task", pending)
	}

	task.Status = "completed"
	task.Assets = []GenerationAsset{{Kind: "video", URL: "/api/v1/media-assets/video-test/content"}}
	if err := restarted.Upsert(task); err != nil {
		t.Fatalf("updating task: %v", err)
	}

	tasks, err := restarted.List()
	if err != nil {
		t.Fatalf("listing tasks: %v", err)
	}
	if len(tasks) != 1 || tasks[0].Status != "completed" || len(tasks[0].Assets) != 1 || tasks[0].RetryCount != 1 || len(tasks[0].Attempts) != 2 {
		t.Fatalf("tasks = %+v, want completed task with asset and attempts", tasks)
	}

	deleted, err := restarted.Delete(taskID)
	if err != nil {
		t.Fatalf("deleting task: %v", err)
	}
	if !deleted {
		t.Fatal("delete returned false, want true")
	}
	_, ok, err = restarted.Get(taskID)
	if err != nil {
		t.Fatalf("getting deleted task: %v", err)
	}
	if ok {
		t.Fatal("deleted task is still present")
	}
}

func TestGenerationTaskForClientOmitsInternalParams(t *testing.T) {
	task := GenerationTaskForClient(GenerationTaskRecord{
		ID: "task-internal-params",
		Params: map[string]any{
			"duration":                        "5",
			generationAssetTitleRequestOption: "第 01 组",
		},
	})

	if _, ok := task.Params[generationAssetTitleRequestOption]; ok {
		t.Fatalf("client params = %#v, want internal asset title omitted", task.Params)
	}
	if task.Params["duration"] != "5" {
		t.Fatalf("client params = %#v, want public params preserved", task.Params)
	}
}

func TestGenerationTaskServiceDefaultDBPathUsesWorkspaceAppDB(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(homeDir, ".config"))
	t.Setenv("APPDATA", filepath.Join(homeDir, "AppData", "Roaming"))

	service := NewGenerationTaskService("", nil)
	if err := service.Upsert(GenerationTaskRecord{
		ID:     "task-default-workspace-db",
		Kind:   "text",
		Status: "completed",
		Prompt: "hello",
		Text:   "world",
	}); err != nil {
		t.Fatalf("Upsert() error = %v", err)
	}

	if _, err := os.Stat(serviceshared.WorkspacePathsFor("").DatabasePath()); err != nil {
		t.Fatalf("workspace app.db was not created: %v", err)
	}
	if _, err := os.Stat(config.DefaultSettingsDBPath()); !os.IsNotExist(err) {
		t.Fatalf("settings db exists after generation default path open: %v", err)
	}
}

func TestGenerationTaskServiceHydratesVideoPosterURL(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	taskID := "task-video-poster"
	assetID := "video-with-poster"
	posterURL := "/api/v1/media-assets/video-with-poster/poster"
	seedGenerationTaskAsset(t, dbPath, assetID, "video", "")

	db, err := repository.OpenWorkspaceDB(dbPath)
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	if err := db.Model(&domain.AssetModel{}).
		Where("id = ?", assetID).
		Updates(map[string]any{
			"poster_rel_path": "library/2026-06-01/video-with-poster.poster.jpg",
			"poster_url":      posterURL,
		}).Error; err != nil {
		t.Fatalf("updating asset poster fixture: %v", err)
	}

	service := NewGenerationTaskService(dbPath, nil)
	if err := service.Upsert(GenerationTaskRecord{
		ID:     taskID,
		Kind:   "video",
		Status: "completed",
		Prompt: "cinematic city shot",
		Assets: []GenerationAsset{
			{Kind: "video", URL: "/api/v1/media-assets/video-with-poster/content"},
		},
	}); err != nil {
		t.Fatalf("upserting task: %v", err)
	}

	task, ok, err := service.Get(taskID)
	if err != nil {
		t.Fatalf("getting task: %v", err)
	}
	if !ok {
		t.Fatal("task was not persisted")
	}
	if len(task.Assets) != 1 || task.Assets[0].PosterURL != posterURL {
		t.Fatalf("task assets = %#v, want hydrated poster URL %q", task.Assets, posterURL)
	}
}

func TestGenerationTaskServiceDeleteAssetIncludesAttemptsWithoutDeadlock(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	taskID := "task-delete-asset"
	seedGenerationTaskAsset(t, dbPath, "image-a", "image", "")
	seedGenerationTaskAsset(t, dbPath, "image-b", "image", "")

	service := NewGenerationTaskService(dbPath, nil)
	if err := service.Upsert(GenerationTaskRecord{
		ID:     taskID,
		Kind:   "image",
		Status: "completed",
		Prompt: "portrait",
		Assets: []GenerationAsset{
			{Kind: "image", URL: "/api/v1/media-assets/image-a/content"},
			{Kind: "image", URL: "/api/v1/media-assets/image-b/content"},
		},
	}); err != nil {
		t.Fatalf("upserting task: %v", err)
	}
	if err := service.RecordAttempt(taskID, "create", "completed", "created", nil); err != nil {
		t.Fatalf("recording attempt: %v", err)
	}

	type deleteResult struct {
		deleted bool
		err     error
		task    GenerationTaskRecord
	}
	done := make(chan deleteResult, 1)
	go func() {
		task, deleted, err := service.DeleteAsset(taskID, 0)
		done <- deleteResult{deleted: deleted, err: err, task: task}
	}()

	select {
	case result := <-done:
		if result.err != nil {
			t.Fatalf("deleting asset: %v", result.err)
		}
		if !result.deleted {
			t.Fatal("delete returned false, want true")
		}
		if len(result.task.Assets) != 1 {
			t.Fatalf("assets = %#v, want deleted row removed", result.task.Assets)
		}
		if len(result.task.DeletedAssetSlots) != 1 || result.task.DeletedAssetSlots[0] != 0 {
			t.Fatalf("deleted slots = %#v, want first image slot deleted", result.task.DeletedAssetSlots)
		}
		visibleTask := GenerationTaskForClient(result.task)
		if len(visibleTask.Assets) != 1 ||
			visibleTask.Assets[0].URL != "/api/v1/media-assets/image-b/content" ||
			visibleTask.Assets[0].SlotIndex != 1 {
			t.Fatalf("visible assets = %#v, want only second image with original slot", visibleTask.Assets)
		}
		if len(result.task.Attempts) != 1 {
			t.Fatalf("attempts = %#v, want delete response with attempts", result.task.Attempts)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("DeleteAsset timed out, likely waiting on its own attempts summary lock")
	}
}

func TestGenerationTaskServiceUpdateAssetSelectionPersists(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	taskID := "task-update-selected-asset"
	seedGenerationTaskAsset(t, dbPath, "image-a", "image", "")
	seedGenerationTaskAsset(t, dbPath, "image-b", "image", "")

	service := NewGenerationTaskService(dbPath, nil)
	if err := service.Upsert(GenerationTaskRecord{
		ID:     taskID,
		Kind:   "image",
		Status: "completed",
		Prompt: "portrait set",
		Assets: []GenerationAsset{
			{Kind: "image", URL: "/api/v1/media-assets/image-a/content"},
			{Kind: "image", URL: "/api/v1/media-assets/image-b/content"},
		},
	}); err != nil {
		t.Fatalf("upserting task: %v", err)
	}

	selected := true
	title := "主角设定图"
	task, updated, err := service.UpdateAsset(taskID, 1, UpdateGenerationTaskAssetRequest{
		Selected:     &selected,
		Title:        &title,
		ResourceType: "character",
	})
	if err != nil {
		t.Fatalf("updating asset: %v", err)
	}
	if !updated {
		t.Fatal("update returned false, want true")
	}
	if !task.Assets[1].Selected || task.Assets[1].Title != title || task.CapabilityID != "character" {
		t.Fatalf("task = %+v, want selected character asset with title", task)
	}

	restarted := NewGenerationTaskService(dbPath, nil)
	reloaded, ok, err := restarted.Get(taskID)
	if err != nil {
		t.Fatalf("getting task: %v", err)
	}
	if !ok {
		t.Fatal("task was not persisted")
	}
	if !reloaded.Assets[1].Selected || reloaded.CapabilityID != "character" {
		t.Fatalf("persisted task = %+v, want selected character asset with title", reloaded)
	}

	visibleTask := GenerationTaskForClient(reloaded)
	if visibleTask.Assets[1].TaskID != taskID || visibleTask.Assets[1].SlotIndex != 1 {
		t.Fatalf("visible asset = %+v, want task id and original slot", visibleTask.Assets[1])
	}
}

func TestGenerationTaskServiceAutoSelectsFirstCompletedProjectResourceImage(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	projectID := "project-auto-select-first"
	taskID := "task-auto-select-first"
	seedGenerationTaskProject(t, dbPath, projectID)
	seedGenerationTaskAsset(t, dbPath, "image-a", "image", projectID)
	seedGenerationTaskAsset(t, dbPath, "image-b", "image", projectID)

	service := NewGenerationTaskService(dbPath, nil)
	if err := service.Upsert(GenerationTaskRecord{
		ID:           taskID,
		ProjectID:    projectID,
		DocumentID:   "characters",
		SectionID:    "section-lintong",
		CapabilityID: "character",
		Kind:         "image",
		Status:       "completed",
		Prompt:       "portrait set",
		Assets: []GenerationAsset{
			{Kind: "image", URL: "/api/v1/media-assets/image-a/content", Title: "林书彤生成图 1"},
			{Kind: "image", URL: "/api/v1/media-assets/image-b/content", Title: "林书彤生成图 2"},
		},
	}); err != nil {
		t.Fatalf("upserting task: %v", err)
	}

	reloaded, ok, err := service.Get(taskID)
	if err != nil || !ok {
		t.Fatalf("getting task ok=%v error=%v", ok, err)
	}
	if len(reloaded.Assets) != 2 || !reloaded.Assets[0].Selected || reloaded.Assets[1].Selected {
		t.Fatalf("task assets = %+v, want first generated image selected only", reloaded.Assets)
	}

	selected, err := service.ListProjectSelectedAssets(projectID)
	if err != nil {
		t.Fatalf("listing selected assets: %v", err)
	}
	if len(selected) != 1 ||
		selected[0].TaskID != taskID ||
		selected[0].AssetIndex != 0 ||
		selected[0].MediaAssetID != "image-a" ||
		selected[0].ResourceType != "character" ||
		selected[0].ResourceID != "section-lintong" ||
		selected[0].SourceDocumentID != "characters" {
		t.Fatalf("selected assets = %+v, want first task image selected for resource", selected)
	}
}

func TestGenerationTaskServiceDoesNotAutoSelectWhenResourceAlreadyHasSelection(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	projectID := "project-auto-select-existing"
	taskID := "task-auto-select-existing"
	seedGenerationTaskProject(t, dbPath, projectID)
	seedGenerationTaskAsset(t, dbPath, "existing-selected", "image", projectID)
	seedGenerationTaskAsset(t, dbPath, "image-a", "image", projectID)
	seedGenerationTaskAsset(t, dbPath, "image-b", "image", projectID)

	service := NewGenerationTaskService(dbPath, nil)
	if _, ok, err := service.UpsertSelectedAsset(projectID, UpdateSelectedGenerationAssetRequest{
		ResourceType:     "character",
		ResourceID:       "section-lintong",
		ResourceTitle:    "林书彤",
		MediaAssetID:     "existing-selected",
		SourceDocumentID: "characters",
		SourceType:       "uploaded",
	}); err != nil || !ok {
		t.Fatalf("upserting existing selected asset ok=%v error=%v", ok, err)
	}

	if err := service.Upsert(GenerationTaskRecord{
		ID:           taskID,
		ProjectID:    projectID,
		DocumentID:   "characters",
		SectionID:    "section-lintong",
		CapabilityID: "character",
		Kind:         "image",
		Status:       "completed",
		Prompt:       "portrait set",
		Assets: []GenerationAsset{
			{Kind: "image", URL: "/api/v1/media-assets/image-a/content", Title: "林书彤生成图 1"},
			{Kind: "image", URL: "/api/v1/media-assets/image-b/content", Title: "林书彤生成图 2"},
		},
	}); err != nil {
		t.Fatalf("upserting task: %v", err)
	}

	reloaded, ok, err := service.Get(taskID)
	if err != nil || !ok {
		t.Fatalf("getting task ok=%v error=%v", ok, err)
	}
	if len(reloaded.Assets) != 2 || reloaded.Assets[0].Selected || reloaded.Assets[1].Selected {
		t.Fatalf("task assets = %+v, want no generated image auto-selected", reloaded.Assets)
	}

	selected, err := service.ListProjectSelectedAssets(projectID)
	if err != nil {
		t.Fatalf("listing selected assets: %v", err)
	}
	if len(selected) != 1 ||
		selected[0].MediaAssetID != "existing-selected" ||
		selected[0].TaskID != "" {
		t.Fatalf("selected assets = %+v, want existing resource selection preserved", selected)
	}
}

func TestGenerationServiceListSelectedGenerationAssets(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	projectID := "project-selected-assets"
	seedGenerationTaskProject(t, dbPath, projectID)
	seedGenerationTaskAsset(t, dbPath, "character", "image", projectID)
	seedGenerationTaskAsset(t, dbPath, "scene", "image", projectID)
	seedGenerationTaskAsset(t, dbPath, "video", "video", projectID)
	seedGenerationTaskAsset(t, dbPath, "generic", "image", projectID)
	service := NewGenerationTaskService(dbPath, nil)
	workflow := &GenerationService{generationTasks: service}

	if err := service.Upsert(GenerationTaskRecord{
		ID:           "task-character",
		ProjectID:    projectID,
		CapabilityID: "character",
		Kind:         "image",
		Status:       "completed",
		Prompt:       "character",
		Assets: []GenerationAsset{
			{
				Kind:     "image",
				URL:      "/api/v1/media-assets/character/content",
				Title:    "角色图",
				Selected: true,
			},
		},
	}); err != nil {
		t.Fatalf("upserting character task: %v", err)
	}
	if err := service.Upsert(GenerationTaskRecord{
		ID:           "task-scene-unselected",
		ProjectID:    projectID,
		CapabilityID: "scene",
		Kind:         "image",
		Status:       "completed",
		Prompt:       "scene",
		Assets: []GenerationAsset{
			{Kind: "image", URL: "/api/v1/media-assets/scene/content"},
		},
	}); err != nil {
		t.Fatalf("upserting scene task: %v", err)
	}
	if err := service.Upsert(GenerationTaskRecord{
		ID:           "task-video-selected",
		ProjectID:    projectID,
		CapabilityID: "storyboard",
		Kind:         "video",
		Status:       "completed",
		Prompt:       "video",
		Assets: []GenerationAsset{
			{Kind: "video", URL: "/api/v1/media-assets/video/content", Selected: true},
		},
	}); err != nil {
		t.Fatalf("upserting video task: %v", err)
	}
	if err := service.Upsert(GenerationTaskRecord{
		ID:           "task-generic-selected",
		ProjectID:    projectID,
		CapabilityID: "image.generate",
		Kind:         "image",
		Status:       "completed",
		Prompt:       "generic",
		Assets: []GenerationAsset{
			{Kind: "image", URL: "/api/v1/media-assets/generic/content", Selected: true},
		},
	}); err != nil {
		t.Fatalf("upserting generic task: %v", err)
	}

	response, err := workflow.ListSelectedGenerationAssets(projectID, SelectedGenerationAssetQuery{})
	if err != nil {
		t.Fatalf("listing selected assets: %v", err)
	}
	if len(response.Assets) != 1 {
		t.Fatalf("assets = %+v, want only one selected creative image", response.Assets)
	}
	asset := response.Assets[0]
	if asset.TaskID != "task-character" ||
		asset.AssetIndex != 0 ||
		asset.ResourceType != "character" ||
		asset.MediaAssetID != "character" ||
		asset.SourceType != "generated" ||
		asset.Title != "角色图" ||
		asset.URL != "/api/v1/media-assets/character/content" {
		t.Fatalf("asset = %+v, want selected character image summary", asset)
	}

	filtered, err := workflow.ListSelectedGenerationAssets(projectID, SelectedGenerationAssetQuery{
		Kind:             "image",
		ResourceType:     "character",
		SourceDocumentID: asset.SourceDocumentID,
		ResourceID:       asset.ResourceID,
	})
	if err != nil {
		t.Fatalf("listing filtered selected assets: %v", err)
	}
	if len(filtered.Assets) != 1 || filtered.Assets[0].ID != asset.ID {
		t.Fatalf("filtered assets = %+v, want selected character asset", filtered.Assets)
	}
}

func TestGenerationServiceUpdateSelectedGenerationAssetFromTask(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	projectID := "project-selected-from-task"
	taskID := "task-select-source"
	seedGenerationTaskProject(t, dbPath, projectID)
	seedGenerationTaskAsset(t, dbPath, "image-a", "image", projectID)
	service := NewGenerationTaskService(dbPath, nil)
	workflow := &GenerationService{generationTasks: service}
	if err := service.Upsert(GenerationTaskRecord{
		ID:         taskID,
		ProjectID:  projectID,
		DocumentID: "character-doc",
		SectionID:  "section-chenyuan",
		Kind:       "image",
		Status:     "completed",
		Prompt:     "character",
		Assets: []GenerationAsset{
			{Kind: "image", URL: "/api/v1/media-assets/image-a/content", MIMEType: "image/png"},
		},
	}); err != nil {
		t.Fatalf("upserting task: %v", err)
	}

	selected := true
	assetIndex := 0
	response, status, err := workflow.UpdateSelectedGenerationAsset(projectID, UpdateSelectedGenerationAssetRequest{
		Selected:     &selected,
		ResourceType: "character",
		TaskID:       taskID,
		AssetIndex:   &assetIndex,
		Title:        "陈远",
	})
	if err != nil || status != 200 {
		t.Fatalf("selecting generated asset status=%d error=%v", status, err)
	}
	if response.Asset == nil ||
		response.Asset.TaskID != taskID ||
		response.Asset.AssetIndex != 0 ||
		response.Asset.ResourceID != "section-chenyuan" ||
		response.Asset.ResourceType != "character" ||
		response.Asset.MediaAssetID != "image-a" ||
		response.Asset.SourceDocumentID != "character-doc" ||
		response.Asset.Title != "陈远" {
		t.Fatalf("response = %+v, want selected task asset", response)
	}

	reloaded, ok, err := service.Get(taskID)
	if err != nil || !ok {
		t.Fatalf("getting task ok=%v error=%v", ok, err)
	}
	if !reloaded.Assets[0].Selected || reloaded.CapabilityID != "character" {
		t.Fatalf("task = %+v, want mirrored selected asset state", reloaded)
	}

	listed, err := workflow.ListSelectedGenerationAssets(projectID, SelectedGenerationAssetQuery{})
	if err != nil {
		t.Fatalf("listing selected assets: %v", err)
	}
	if len(listed.Assets) != 1 || listed.Assets[0].ID != response.Asset.ID {
		t.Fatalf("listed assets = %+v, want selected asset", listed.Assets)
	}

	selected = false
	deleteResponse, status, err := workflow.UpdateSelectedGenerationAsset(projectID, UpdateSelectedGenerationAssetRequest{
		Selected:     &selected,
		ResourceType: "character",
		TaskID:       taskID,
		AssetIndex:   &assetIndex,
	})
	if err != nil || status != 200 || !deleteResponse.Deleted {
		t.Fatalf("unselecting generated asset status=%d response=%+v error=%v", status, deleteResponse, err)
	}
	listed, err = workflow.ListSelectedGenerationAssets(projectID, SelectedGenerationAssetQuery{})
	if err != nil {
		t.Fatalf("listing after unselect: %v", err)
	}
	if len(listed.Assets) != 0 {
		t.Fatalf("listed assets after unselect = %+v, want none", listed.Assets)
	}
	reloaded, ok, err = service.Get(taskID)
	if err != nil || !ok {
		t.Fatalf("getting task after unselect ok=%v error=%v", ok, err)
	}
	if reloaded.Assets[0].Selected {
		t.Fatalf("task = %+v, want mirrored unselected asset state", reloaded)
	}
}

func TestGenerationServiceUpdateSelectedGenerationAssetWithMissingTaskSource(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	projectID := "project-selected-missing-task"
	taskID := "task-select-missing"
	seedGenerationTaskProject(t, dbPath, projectID)
	seedGenerationTaskAsset(t, dbPath, "scene-direct", "image", projectID)
	service := NewGenerationTaskService(dbPath, nil)
	workflow := &GenerationService{generationTasks: service}

	selected := true
	assetIndex := 0
	response, status, err := workflow.UpdateSelectedGenerationAsset(projectID, UpdateSelectedGenerationAssetRequest{
		Selected:     &selected,
		ResourceType: "scene",
		TaskID:       taskID,
		AssetIndex:   &assetIndex,
		Title:        "湖南校门口晨光",
		URL:          "/api/v1/media-assets/scene-direct/content",
		MIMEType:     "image/png",
	})
	if err != nil || status != 200 {
		t.Fatalf("selecting asset with missing task status=%d error=%v", status, err)
	}
	if response.Asset == nil ||
		response.Asset.TaskID != "" ||
		response.Asset.AssetIndex != -1 ||
		response.Asset.ResourceType != "scene" ||
		response.Asset.MediaAssetID != "scene-direct" ||
		response.Asset.Kind != "image" ||
		response.Asset.SourceType != "uploaded" ||
		response.Asset.Title != "湖南校门口晨光" {
		t.Fatalf("response = %+v, want selected direct asset with task source metadata", response)
	}

	listed, err := workflow.ListSelectedGenerationAssets(projectID, SelectedGenerationAssetQuery{})
	if err != nil {
		t.Fatalf("listing selected assets: %v", err)
	}
	if len(listed.Assets) != 1 || listed.Assets[0].ID != response.Asset.ID {
		t.Fatalf("listed assets = %+v, want saved selected asset", listed.Assets)
	}
}

func TestGenerationTaskServiceUpsertSelectedAssetWithoutTask(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	projectID := "project-selected-direct"
	seedGenerationTaskProject(t, dbPath, projectID)
	seedGenerationTaskAsset(t, dbPath, "media-direct", "image", projectID)
	service := NewGenerationTaskService(dbPath, nil)

	asset, ok, err := service.UpsertSelectedAsset(projectID, UpdateSelectedGenerationAssetRequest{
		ResourceType:  "character",
		ResourceTitle: "陈远",
		MediaAssetID:  "media-direct",
		Kind:          "image",
		Title:         "陈远设定图",
		URL:           "/api/v1/media-assets/media-direct/content",
		MIMEType:      "image/png",
		SourceType:    "uploaded",
	})
	if err != nil || !ok {
		t.Fatalf("upserting selected asset ok=%v error=%v", ok, err)
	}
	if asset.TaskID != "" ||
		asset.AssetIndex != -1 ||
		asset.MediaAssetID != "media-direct" ||
		asset.ResourceTitle != "陈远" ||
		asset.SourceType != "uploaded" {
		t.Fatalf("asset = %+v, want direct selected media asset", asset)
	}

	assets, err := service.ListProjectSelectedAssets(projectID)
	if err != nil {
		t.Fatalf("listing selected assets: %v", err)
	}
	if len(assets) != 1 || assets[0].ID != asset.ID {
		t.Fatalf("assets = %+v, want direct selected asset", assets)
	}
	deleted, err := service.DeleteSelectedAsset(projectID, asset.ID)
	if err != nil || !deleted {
		t.Fatalf("deleting selected asset deleted=%v error=%v", deleted, err)
	}
	assets, err = service.ListProjectSelectedAssets(projectID)
	if err != nil {
		t.Fatalf("listing after delete: %v", err)
	}
	if len(assets) != 0 {
		t.Fatalf("assets after delete = %+v, want none", assets)
	}
}

func TestGenerationTaskServiceDeleteAssetSlotPersistsAsMissingRow(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	taskID := "task-delete-slot-row"
	for _, id := range []string{"image-a", "image-b", "image-c", "image-d"} {
		seedGenerationTaskAsset(t, dbPath, id, "image", "")
	}

	service := NewGenerationTaskService(dbPath, nil)
	if err := service.Upsert(GenerationTaskRecord{
		ID:     taskID,
		Kind:   "image",
		Status: "completed",
		Prompt: "portrait set",
		Assets: []GenerationAsset{
			{Kind: "image", URL: "/api/v1/media-assets/image-a/content"},
			{Kind: "image", URL: "/api/v1/media-assets/image-b/content"},
			{Kind: "image", URL: "/api/v1/media-assets/image-c/content"},
			{Kind: "image", URL: "/api/v1/media-assets/image-d/content"},
		},
	}); err != nil {
		t.Fatalf("upserting task: %v", err)
	}

	task, deleted, err := service.DeleteAsset(taskID, 2)
	if err != nil {
		t.Fatalf("deleting slot: %v", err)
	}
	if !deleted {
		t.Fatal("delete returned false, want true")
	}
	if len(task.DeletedAssetSlots) != 1 || task.DeletedAssetSlots[0] != 2 {
		t.Fatalf("deleted slots = %#v, want slot 2", task.DeletedAssetSlots)
	}

	reloaded, ok, err := service.Get(taskID)
	if err != nil {
		t.Fatalf("getting task: %v", err)
	}
	if !ok {
		t.Fatal("task was not persisted")
	}
	if len(reloaded.DeletedAssetSlots) != 1 || reloaded.DeletedAssetSlots[0] != 2 {
		t.Fatalf("deleted slots after upsert = %#v, want slot 2 preserved", reloaded.DeletedAssetSlots)
	}
	visibleTask := GenerationTaskForClient(reloaded)
	if len(visibleTask.Assets) != 3 {
		t.Fatalf("visible assets = %#v, want one deleted slot hidden", visibleTask.Assets)
	}
	if visibleTask.Assets[0].SlotIndex != 0 ||
		visibleTask.Assets[1].SlotIndex != 1 ||
		visibleTask.Assets[2].SlotIndex != 3 {
		t.Fatalf("visible asset slots = %#v, want original slots 0, 1, 3", visibleTask.Assets)
	}
}

func TestGenerationTaskServiceDeleteAssetSlotRemovesSelectedAssetBySourceSlot(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	projectID := "project-delete-selected-slot"
	taskID := "task-delete-selected-slot"
	seedGenerationTaskProject(t, dbPath, projectID)
	seedGenerationTaskAsset(t, dbPath, "image-a", "image", projectID)

	service := NewGenerationTaskService(dbPath, nil)
	if err := service.Upsert(GenerationTaskRecord{
		ID:           taskID,
		ProjectID:    projectID,
		CapabilityID: "character",
		Kind:         "image",
		Status:       "completed",
		Prompt:       "portrait set",
		Assets: []GenerationAsset{
			{Kind: "image", URL: "/api/v1/media-assets/image-a/content", Title: "生成图 1"},
		},
	}); err != nil {
		t.Fatalf("upserting task: %v", err)
	}

	selectedFlag := true
	assetIndex := 0
	if _, ok, err := service.UpsertSelectedAsset(projectID, UpdateSelectedGenerationAssetRequest{
		Selected:         &selectedFlag,
		ResourceType:     "character",
		ResourceID:       "section-chenyuan",
		ResourceTitle:    "陈远",
		SourceDocumentID: "character-doc",
		TaskID:           taskID,
		AssetIndex:       &assetIndex,
	}); err != nil || !ok {
		t.Fatalf("selecting generated asset ok=%v error=%v", ok, err)
	}

	selected, err := service.ListProjectSelectedAssets(projectID)
	if err != nil {
		t.Fatalf("listing selected assets: %v", err)
	}
	if len(selected) != 1 {
		t.Fatalf("selected assets = %+v, want one asset before delete", selected)
	}

	if _, deleted, err := service.DeleteAsset(taskID, 0); err != nil || !deleted {
		t.Fatalf("deleting slot deleted=%v error=%v", deleted, err)
	}

	selected, err = service.ListProjectSelectedAssets(projectID)
	if err != nil {
		t.Fatalf("listing selected assets after delete: %v", err)
	}
	if len(selected) != 0 {
		t.Fatalf("selected assets after delete = %+v, want none", selected)
	}
}

func TestGenerationTaskServiceRejectsGeneratedAssetWithoutAssetID(t *testing.T) {
	service := NewGenerationTaskService(filepath.Join(t.TempDir(), "settings.db"), nil)

	err := service.Upsert(GenerationTaskRecord{
		ID:     "task-missing-asset-id",
		Kind:   "image",
		Status: "completed",
		Prompt: "portrait",
		Assets: []GenerationAsset{
			{Kind: "image", URL: "https://example.test/generated.png"},
		},
	})
	if err == nil {
		t.Fatal("Upsert() error = nil, want missing asset_id error")
	}
	if !strings.Contains(err.Error(), "missing asset_id") {
		t.Fatalf("Upsert() error = %v, want missing asset_id", err)
	}
}

func seedGenerationTaskProject(t *testing.T, dbPath string, projectID string) {
	t.Helper()
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return
	}
	db, err := repository.OpenWorkspaceDB(dbPath)
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	now := domain.TimeFromString("2026-06-01T00:00:00Z")
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&domain.WorkspaceProjectModel{
		ID:          projectID,
		Name:        projectID,
		Category:    "drama",
		Status:      "active",
		RelativeDir: projectID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("creating project fixture %q: %v", projectID, err)
	}
}

func seedGenerationTaskAsset(t *testing.T, dbPath string, id string, kind string, projectID string) {
	t.Helper()
	if id == "" {
		return
	}
	seedGenerationTaskProject(t, dbPath, projectID)
	db, err := repository.OpenWorkspaceDB(dbPath)
	if err != nil {
		t.Fatalf("OpenWorkspaceDB() error = %v", err)
	}
	if kind == "" {
		kind = "image"
	}
	now := domain.TimeFromString("2026-06-01T00:00:00Z")
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&domain.AssetModel{
		ID:            id,
		ProjectID:     domain.StringPtr(projectID),
		Kind:          kind,
		Filename:      id + "." + generationTaskAssetExtension(kind),
		MIMEType:      generationTaskAssetMIMEType(kind),
		RelPath:       "library/2026-06-01/" + id + "." + generationTaskAssetExtension(kind),
		URL:           "/api/v1/media-assets/" + id + "/content",
		Source:        "generated",
		StorageStatus: "ready",
		CreatedAt:     now,
		UpdatedAt:     now,
	}).Error; err != nil {
		t.Fatalf("creating asset fixture %q: %v", id, err)
	}
}

func generationTaskAssetExtension(kind string) string {
	switch kind {
	case "video":
		return "mp4"
	case "audio":
		return "mp3"
	case "text":
		return "txt"
	default:
		return "png"
	}
}

func generationTaskAssetMIMEType(kind string) string {
	switch kind {
	case "video":
		return "video/mp4"
	case "audio":
		return "audio/mpeg"
	case "text":
		return "text/plain"
	default:
		return "image/png"
	}
}
