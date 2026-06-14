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
		if len(result.task.Assets) != 1 || result.task.Assets[0].URL != "/api/v1/media-assets/image-b/content" {
			t.Fatalf("assets = %#v, want only second image", result.task.Assets)
		}
		if len(result.task.Attempts) != 1 {
			t.Fatalf("attempts = %#v, want delete response with attempts", result.task.Attempts)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("DeleteAsset timed out, likely waiting on its own attempts summary lock")
	}
}
