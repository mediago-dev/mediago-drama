package repository

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

func TestGenerationTaskRepositoryLifecycle(t *testing.T) {
	repo, err := NewGenerationTaskRepository(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	seedGenerationProject(t, repo, "alpha")

	conversation := domain.GenerationConversationModel{
		ID:        "session-1",
		ScopeID:   "studio",
		Kind:      "video",
		Title:     "Video session",
		CreatedAt: domain.TimeFromString("2026-05-22T00:00:00Z"),
		UpdatedAt: domain.TimeFromString("2026-05-22T00:00:00Z"),
	}
	if err := repo.UpsertGenerationConversation(conversation); err != nil {
		t.Fatalf("UpsertGenerationConversation() error = %v", err)
	}
	conversations, err := repo.ListGenerationConversations("studio", "video")
	if err != nil {
		t.Fatalf("ListGenerationConversations() error = %v", err)
	}
	if len(conversations) != 1 || conversations[0].ID != conversation.ID {
		t.Fatalf("ListGenerationConversations() = %+v, want seeded conversation", conversations)
	}

	task := generationTaskTestModel("task-1", " Submitted ", "2026-05-22T00:00:00Z")
	task.ConversationID = domain.StringPtr(conversation.ID)
	task.ProjectID = domain.StringPtr("alpha")
	task.ErrorCode = "policy_violation"
	task.ErrorType = "policy_violation"
	if err := repo.UpsertGenerationTask(task); err != nil {
		t.Fatalf("UpsertGenerationTask() error = %v", err)
	}

	got, err := repo.GetGenerationTask(task.ID)
	if err != nil {
		t.Fatalf("GetGenerationTask() error = %v", err)
	}
	if got.Status != "submitted" ||
		domain.StringValue(got.ProjectID) != "alpha" ||
		domain.StringValue(got.CapabilityID) != "video.generate" ||
		got.ProviderTaskID != task.ProviderTaskID {
		t.Fatalf("GetGenerationTask() = %+v, want normalized persisted task", got)
	}

	asset := domain.AssetModel{
		ID:            "asset-1",
		ProjectID:     domain.StringPtr("alpha"),
		Kind:          "video",
		Filename:      "clip.mp4",
		MIMEType:      "video/mp4",
		RelPath:       "project-alpha/generated/clip.mp4",
		URL:           "/api/v1/media-assets/asset-1/content",
		Source:        "generated",
		StorageStatus: "ready",
		CreatedAt:     domain.TimeFromString("2026-05-22T00:00:00Z"),
		UpdatedAt:     domain.TimeFromString("2026-05-22T00:00:00Z"),
	}
	if err := repo.db.Create(&asset).Error; err != nil {
		t.Fatalf("creating asset fixture: %v", err)
	}
	if err := repo.ReplaceGenerationTaskReferenceRows(task.ID, []domain.GenerationTaskReferenceModel{{
		TaskID:    task.ID,
		RefIndex:  0,
		URL:       domain.StringPtr("https://example.test/reference.png"),
		CreatedAt: domain.TimeFromString("2026-05-22T00:00:00Z"),
	}}); err != nil {
		t.Fatalf("ReplaceGenerationTaskReferenceRows() error = %v", err)
	}
	if err := repo.ReplaceGenerationTaskAssetRows(task.ID, []domain.GenerationTaskAssetModel{{
		TaskID:    task.ID,
		SlotIndex: 0,
		AssetID:   asset.ID,
		Selected:  true,
		CreatedAt: domain.TimeFromString("2026-05-22T00:00:00Z"),
		UpdatedAt: domain.TimeFromString("2026-05-22T00:00:00Z"),
	}}); err != nil {
		t.Fatalf("ReplaceGenerationTaskAssetRows() error = %v", err)
	}
	got, err = repo.GetGenerationTask(task.ID)
	if err != nil {
		t.Fatalf("GetGenerationTask() after row replacement error = %v", err)
	}
	if len(got.References) != 1 || domain.StringValue(got.References[0].URL) != "https://example.test/reference.png" {
		t.Fatalf("References = %+v, want normalized reference row", got.References)
	}
	if len(got.Assets) != 1 || got.Assets[0].AssetID != asset.ID || got.Assets[0].Asset.URL != asset.URL {
		t.Fatalf("Assets = %+v, want normalized asset row with preloaded asset", got.Assets)
	}

	pending, err := repo.ListPendingGenerationTasks("video", []string{" submitted ", "SUBMITTED"}, 10)
	if err != nil {
		t.Fatalf("ListPendingGenerationTasks() error = %v", err)
	}
	if len(pending) != 1 {
		t.Fatalf("ListPendingGenerationTasks() len = %d, want 1", len(pending))
	}
	conversationTasks, err := repo.ListGenerationTasksByConversation("video", conversation.ID, false)
	if err != nil {
		t.Fatalf("ListGenerationTasksByConversation() error = %v", err)
	}
	if len(conversationTasks) != 1 || conversationTasks[0].ID != task.ID {
		t.Fatalf("ListGenerationTasksByConversation() = %+v, want seeded task", conversationTasks)
	}
	projectTasks, err := repo.ListGenerationTasksByProject("video", "alpha")
	if err != nil {
		t.Fatalf("ListGenerationTasksByProject() error = %v", err)
	}
	if len(projectTasks) != 1 || projectTasks[0].ID != task.ID {
		t.Fatalf("ListGenerationTasksByProject() = %+v, want seeded project task", projectTasks)
	}

	if err := repo.RecordGenerationTaskError(
		task.ID,
		"provider unavailable",
		"provider_http_error",
		"provider_error",
		true,
		"2026-05-22T00:01:00Z",
	); err != nil {
		t.Fatalf("RecordGenerationTaskError() error = %v", err)
	}
	got, err = repo.GetGenerationTask(task.ID)
	if err != nil {
		t.Fatalf("GetGenerationTask() after error update error = %v", err)
	}
	if got.Error != "provider unavailable" ||
		got.ErrorCode != "provider_http_error" ||
		got.ErrorType != "provider_error" ||
		!got.Retryable {
		t.Fatalf("updated failure fields = %+v, want structured provider error", got)
	}

	attempt := domain.GenerationTaskAttemptModel{
		ID:        "attempt-1",
		TaskID:    task.ID,
		Action:    "poll",
		Status:    " Submitted ",
		Message:   "still queued",
		CreatedAt: domain.TimeFromString("2026-05-22T00:02:00Z"),
	}
	if err := repo.CreateGenerationTaskAttempt(attempt); err != nil {
		t.Fatalf("CreateGenerationTaskAttempt() error = %v", err)
	}
	attempts, err := repo.ListGenerationTaskAttempts(task.ID, 10)
	if err != nil {
		t.Fatalf("ListGenerationTaskAttempts() error = %v", err)
	}
	if len(attempts) != 1 || attempts[0].Status != "submitted" {
		t.Fatalf("attempts = %+v, want normalized submitted attempt", attempts)
	}

	deleted, err := repo.DeleteGenerationTask(task.ID)
	if err != nil {
		t.Fatalf("DeleteGenerationTask() error = %v", err)
	}
	if !deleted {
		t.Fatal("DeleteGenerationTask() deleted = false, want true")
	}
	if _, err := repo.GetGenerationTask(task.ID); !errors.Is(err, ErrRecordNotFound) {
		t.Fatalf("GetGenerationTask() after delete error = %v, want ErrRecordNotFound", err)
	}
	attempts, err = repo.ListAllGenerationTaskAttempts(task.ID)
	if err != nil {
		t.Fatalf("ListAllGenerationTaskAttempts() after delete error = %v", err)
	}
	if len(attempts) != 0 {
		t.Fatalf("ListAllGenerationTaskAttempts() len = %d, want 0", len(attempts))
	}
}

func TestGenerationTaskRepositoryListDefaultLimitAndOffset(t *testing.T) {
	repo, err := NewGenerationTaskRepository(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	seedGenerationProject(t, repo, "project-list")
	if err := repo.UpsertGenerationConversation(domain.GenerationConversationModel{
		ID:        "session-list",
		ScopeID:   "studio",
		Kind:      "video",
		Title:     "List session",
		CreatedAt: domain.TimeFromString("2026-05-22T00:00:00Z"),
		UpdatedAt: domain.TimeFromString("2026-05-22T00:00:00Z"),
	}); err != nil {
		t.Fatalf("UpsertGenerationConversation() error = %v", err)
	}

	total := defaultGenerationTaskListLimit + 5
	for index := 0; index < total; index++ {
		task := generationTaskTestModel(
			fmt.Sprintf("task-%03d", index),
			"completed",
			fmt.Sprintf("2026-05-22T00:%02d:%02dZ", index/60, index%60),
		)
		task.ConversationID = domain.StringPtr("session-list")
		task.ProjectID = domain.StringPtr("project-list")
		if err := repo.UpsertGenerationTask(task); err != nil {
			t.Fatalf("UpsertGenerationTask(%d) error = %v", index, err)
		}
	}

	tasks, err := repo.ListGenerationTasks()
	if err != nil {
		t.Fatalf("ListGenerationTasks() error = %v", err)
	}
	if len(tasks) != defaultGenerationTaskListLimit {
		t.Fatalf("ListGenerationTasks() len = %d, want %d", len(tasks), defaultGenerationTaskListLimit)
	}
	if tasks[0].ID != "task-204" {
		t.Fatalf("first task = %q, want newest task-204", tasks[0].ID)
	}

	paged, err := repo.ListGenerationTasks(GenerationTaskListOptions{Limit: 3, Offset: 2})
	if err != nil {
		t.Fatalf("ListGenerationTasks(paged) error = %v", err)
	}
	if got := generationTaskModelIDs(paged); fmt.Sprint(got) != "[task-202 task-201 task-200]" {
		t.Fatalf("paged ids = %v, want [task-202 task-201 task-200]", got)
	}
}

func seedGenerationProject(t *testing.T, repo *GenerationTaskRepository, id string) {
	t.Helper()
	now := domain.TimeFromString("2026-05-22T00:00:00Z")
	if err := repo.db.Create(&domain.WorkspaceProjectModel{
		ID:          id,
		Name:        id,
		Category:    "drama",
		Status:      "active",
		RelativeDir: id,
		CreatedAt:   now,
		UpdatedAt:   now,
	}).Error; err != nil {
		t.Fatalf("creating project fixture %q: %v", id, err)
	}
}

func generationTaskTestModel(id string, status string, updatedAt string) domain.GenerationTaskModel {
	return domain.GenerationTaskModel{
		ID:             id,
		ProviderTaskID: id + "-provider",
		CapabilityID:   domain.StringPtr("video.generate"),
		Kind:           "video",
		RouteID:        "route",
		FamilyID:       "family",
		VersionID:      "version",
		Provider:       "provider",
		ModelID:        "model-id",
		Model:          "model",
		Prompt:         "prompt",
		ParamsJSON:     "{}",
		Status:         status,
		Message:        "done",
		CreatedAt:      domain.TimeFromString("2026-05-22T00:00:00Z"),
		UpdatedAt:      domain.TimeFromString(updatedAt),
	}
}

func generationTaskModelIDs(tasks []domain.GenerationTaskModel) []string {
	ids := make([]string, 0, len(tasks))
	for _, task := range tasks {
		ids = append(ids, task.ID)
	}
	return ids
}

func TestCountGenerationTasksWithStatusesUpdatedSince(t *testing.T) {
	repo, err := NewGenerationTaskRepository(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}
	seedGenerationProject(t, repo, "count-active")

	insert := func(id string, status string, updatedAt string) {
		task := generationTaskTestModel(id, status, updatedAt)
		task.ProjectID = domain.StringPtr("count-active")
		if err := repo.UpsertGenerationTask(task); err != nil {
			t.Fatalf("UpsertGenerationTask(%s) error = %v", id, err)
		}
		// autoUpdateTime overwrites UpdatedAt on write; pin it directly so the
		// staleness window under test is deterministic.
		if err := repo.db.Model(&domain.GenerationTaskModel{}).
			Where("id = ?", id).
			UpdateColumn("updated_at", domain.TimeFromString(updatedAt)).Error; err != nil {
			t.Fatalf("pinning updated_at for %s: %v", id, err)
		}
	}

	insert("active-fresh", "running", "2026-05-22T10:00:00Z")
	insert("active-spacing", " Submitted ", "2026-05-22T11:00:00Z") // legacy un-normalized row
	insert("active-stale", "running", "2026-05-20T00:00:00Z")       // orphaned by a crash
	insert("terminal-fresh", "completed", "2026-05-22T10:30:00Z")

	timestamps, err := repo.ListGenerationTaskUpdatedAtsWithStatuses(
		context.Background(),
		[]string{"submitting", "submitted", "running", "pending", "processing", "queued"},
	)
	if err != nil {
		t.Fatalf("ListGenerationTaskUpdatedAtsWithStatuses() error = %v", err)
	}
	// Three active-status rows (terminal excluded by the status filter); the Go-side
	// staleness window is applied by the service, not here.
	if len(timestamps) != 3 {
		t.Fatalf("len(timestamps) = %d, want 3 (active-status rows; terminal excluded)", len(timestamps))
	}

	// The service applies its staleness window on these parsed time.Time values with a
	// plain instant comparison — TZ-independent, unlike a SQL text `updated_at >= ?`.
	// active-fresh(10:00) and active-spacing(11:00) are after a 06:00 cutoff; active-stale
	// (two days earlier) is before it. This locks in the fix for the timezone-skew bug.
	cutoff := domain.TimeFromString("2026-05-22T06:00:00Z")
	fresh := 0
	for _, updatedAt := range timestamps {
		if updatedAt.After(cutoff) {
			fresh++
		}
	}
	if fresh != 2 {
		t.Fatalf("in-window active count = %d, want 2 (stale row excluded by the Go window)", fresh)
	}

	empty, err := repo.ListGenerationTaskUpdatedAtsWithStatuses(context.Background(), nil)
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty status list: timestamps=%v err=%v, want empty,nil", empty, err)
	}
}
