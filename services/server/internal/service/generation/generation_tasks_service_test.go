package generation

import (
	"path/filepath"
	"testing"
	"time"
)

func TestGenerationTaskServicePersistToSQLite(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	taskID := "official.seedance-2.0-fast:task-persisted"

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
		Error:             "raw provider error",
		ErrorCode:         "policy_violation",
		ErrorType:         "policy_violation",
		Retryable:         false,
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
	task.Assets = []GenerationAsset{{Kind: "video", URL: "https://example.com/video.mp4"}}
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

func TestGenerationTaskServiceDeleteAssetIncludesAttemptsWithoutDeadlock(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	taskID := "task-delete-asset"

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
		if len(result.task.Assets) != 2 {
			t.Fatalf("assets = %#v, want stored assets preserved", result.task.Assets)
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
	if !reloaded.Assets[1].Selected || reloaded.Assets[1].Title != title || reloaded.CapabilityID != "character" {
		t.Fatalf("persisted task = %+v, want selected character asset with title", reloaded)
	}

	visibleTask := GenerationTaskForClient(reloaded)
	if visibleTask.Assets[1].TaskID != taskID || visibleTask.Assets[1].SlotIndex != 1 {
		t.Fatalf("visible asset = %+v, want task id and original slot", visibleTask.Assets[1])
	}
}

func TestGenerationServiceListSelectedGenerationAssets(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	projectID := "project-selected-assets"
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

	response, err := workflow.ListSelectedGenerationAssets(projectID)
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
}

func TestGenerationServiceUpdateSelectedGenerationAssetFromTask(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	projectID := "project-selected-from-task"
	taskID := "task-select-source"
	service := NewGenerationTaskService(dbPath, nil)
	workflow := &GenerationService{generationTasks: service}
	if err := service.Upsert(GenerationTaskRecord{
		ID:        taskID,
		ProjectID: projectID,
		Kind:      "image",
		Status:    "completed",
		Prompt:    "character",
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
		response.Asset.ResourceType != "character" ||
		response.Asset.MediaAssetID != "image-a" ||
		response.Asset.Title != "陈远" {
		t.Fatalf("response = %+v, want selected task asset", response)
	}

	reloaded, ok, err := service.Get(taskID)
	if err != nil || !ok {
		t.Fatalf("getting task ok=%v error=%v", ok, err)
	}
	if !reloaded.Assets[0].Selected || reloaded.Assets[0].Title != "陈远" || reloaded.CapabilityID != "character" {
		t.Fatalf("task = %+v, want mirrored selected asset state", reloaded)
	}

	listed, err := workflow.ListSelectedGenerationAssets(projectID)
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
	listed, err = workflow.ListSelectedGenerationAssets(projectID)
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
		response.Asset.TaskID != taskID ||
		response.Asset.AssetIndex != 0 ||
		response.Asset.ResourceType != "scene" ||
		response.Asset.MediaAssetID != "scene-direct" ||
		response.Asset.Kind != "image" ||
		response.Asset.SourceType != "generated" ||
		response.Asset.Title != "湖南校门口晨光" {
		t.Fatalf("response = %+v, want selected direct asset with task source metadata", response)
	}

	listed, err := workflow.ListSelectedGenerationAssets(projectID)
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

func TestGenerationTaskServiceDeletePendingAssetSlotPersistsAcrossTaskUpdates(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings.db")
	taskID := "task-delete-pending-slot"

	service := NewGenerationTaskService(dbPath, nil)
	if err := service.Upsert(GenerationTaskRecord{
		ID:     taskID,
		Kind:   "image",
		Status: "running",
		Prompt: "portrait set",
		Assets: []GenerationAsset{
			{Kind: "image", URL: "/api/v1/media-assets/image-a/content"},
		},
	}); err != nil {
		t.Fatalf("upserting task: %v", err)
	}

	task, deleted, err := service.DeleteAsset(taskID, 2)
	if err != nil {
		t.Fatalf("deleting pending slot: %v", err)
	}
	if !deleted {
		t.Fatal("delete returned false, want true")
	}
	if len(task.DeletedAssetSlots) != 1 || task.DeletedAssetSlots[0] != 2 {
		t.Fatalf("deleted slots = %#v, want slot 2", task.DeletedAssetSlots)
	}

	task.Status = "completed"
	task.Assets = []GenerationAsset{
		{Kind: "image", URL: "/api/v1/media-assets/image-a/content"},
		{Kind: "image", URL: "/api/v1/media-assets/image-b/content"},
		{Kind: "image", URL: "/api/v1/media-assets/image-c/content"},
		{Kind: "image", URL: "/api/v1/media-assets/image-d/content"},
	}
	if err := service.Upsert(task); err != nil {
		t.Fatalf("upserting completed task: %v", err)
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
