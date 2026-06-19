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
		asset.Title != "角色图" ||
		asset.URL != "/api/v1/media-assets/character/content" {
		t.Fatalf("asset = %+v, want selected character image summary", asset)
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
