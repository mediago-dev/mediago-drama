package repository

import (
	"errors"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
)

func TestGenerationTaskRepositoryLifecycle(t *testing.T) {
	repo, err := NewGenerationTaskRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}

	conversation := domain.GenerationConversationModel{
		ID:        "session-1",
		ScopeID:   "studio",
		Kind:      "video",
		Title:     "Video session",
		CreatedAt: "2026-05-22T00:00:00Z",
		UpdatedAt: "2026-05-22T00:00:00Z",
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
	agentConversation := domain.GenerationConversationModel{
		ID:        "project-alpha",
		ScopeID:   "agent",
		Kind:      "video",
		Title:     "Project Alpha",
		CreatedAt: "2026-05-22T00:00:00Z",
		UpdatedAt: "2026-05-22T00:00:01Z",
	}
	if err := repo.UpsertGenerationConversation(agentConversation); err != nil {
		t.Fatalf("UpsertGenerationConversation(agent) error = %v", err)
	}
	allConversations, err := repo.ListGenerationConversations("", "video")
	if err != nil {
		t.Fatalf("ListGenerationConversations(all) error = %v", err)
	}
	if len(allConversations) != 2 {
		t.Fatalf("ListGenerationConversations(all) = %+v, want studio and agent conversations", allConversations)
	}

	task := domain.GenerationTaskModel{
		ID:                    "task-1",
		ProviderTaskID:        "dmx.seedance-2.0-fast:cgt-1",
		ConversationID:        conversation.ID,
		ProjectID:             "alpha",
		CapabilityID:          "video.generate",
		Kind:                  "video",
		RouteID:               "route",
		FamilyID:              "family",
		VersionID:             "version",
		Provider:              "provider",
		ModelID:               "model-id",
		Model:                 "model",
		Prompt:                "make it move",
		ReferenceURLsJSON:     "[]",
		ReferenceAssetIDsJSON: "[]",
		ParamsJSON:            "{}",
		Status:                " Submitted ",
		Message:               "queued",
		AssetsJSON:            "[]",
		UsageJSON:             "{}",
		ErrorCode:             "policy_violation",
		ErrorType:             "policy_violation",
		Retryable:             false,
		CreatedAt:             "2026-05-22T00:00:00Z",
		UpdatedAt:             "2026-05-22T00:00:00Z",
	}
	if err := repo.UpsertGenerationTask(task); err != nil {
		t.Fatalf("UpsertGenerationTask() error = %v", err)
	}

	got, err := repo.GetGenerationTask(task.ID)
	if err != nil {
		t.Fatalf("GetGenerationTask() error = %v", err)
	}
	if got.Status != "submitted" ||
		got.ProjectID != task.ProjectID ||
		got.CapabilityID != task.CapabilityID ||
		got.ProviderTaskID != task.ProviderTaskID {
		t.Fatalf("GetGenerationTask() = %+v, want status %q, project %q, capability %q, provider task %q", got, "submitted", task.ProjectID, task.CapabilityID, task.ProviderTaskID)
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
	otherProjectTasks, err := repo.ListGenerationTasksByProject("video", "beta")
	if err != nil {
		t.Fatalf("ListGenerationTasksByProject(other) error = %v", err)
	}
	if len(otherProjectTasks) != 0 {
		t.Fatalf("ListGenerationTasksByProject(other) = %+v, want empty", otherProjectTasks)
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
		CreatedAt: "2026-05-22T00:02:00Z",
	}
	if err := repo.CreateGenerationTaskAttempt(attempt); err != nil {
		t.Fatalf("CreateGenerationTaskAttempt() error = %v", err)
	}
	attempts, err := repo.ListGenerationTaskAttempts(task.ID, 10)
	if err != nil {
		t.Fatalf("ListGenerationTaskAttempts() error = %v", err)
	}
	if len(attempts) != 1 {
		t.Fatalf("ListGenerationTaskAttempts() len = %d, want 1", len(attempts))
	}
	if attempts[0].Status != "submitted" {
		t.Fatalf("attempt status = %q, want submitted", attempts[0].Status)
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

	deleteConversation := domain.GenerationConversationModel{
		ID:        "session-delete",
		ScopeID:   "studio",
		Kind:      "image",
		Title:     "Delete session",
		CreatedAt: "2026-05-22T00:03:00Z",
		UpdatedAt: "2026-05-22T00:03:00Z",
	}
	if err := repo.UpsertGenerationConversation(deleteConversation); err != nil {
		t.Fatalf("UpsertGenerationConversation(delete) error = %v", err)
	}
	deleteTask := task
	deleteTask.ID = "task-delete"
	deleteTask.Kind = "image"
	deleteTask.ConversationID = deleteConversation.ID
	deleteTask.CreatedAt = "2026-05-22T00:03:00Z"
	deleteTask.UpdatedAt = "2026-05-22T00:03:00Z"
	if err := repo.UpsertGenerationTask(deleteTask); err != nil {
		t.Fatalf("UpsertGenerationTask(delete) error = %v", err)
	}
	if err := repo.CreateGenerationTaskAttempt(domain.GenerationTaskAttemptModel{
		ID:        "attempt-delete",
		TaskID:    deleteTask.ID,
		Action:    "create",
		Status:    "completed",
		CreatedAt: "2026-05-22T00:04:00Z",
	}); err != nil {
		t.Fatalf("CreateGenerationTaskAttempt(delete) error = %v", err)
	}
	deleted, err = repo.DeleteGenerationConversation(deleteConversation.ID)
	if err != nil {
		t.Fatalf("DeleteGenerationConversation() error = %v", err)
	}
	if !deleted {
		t.Fatal("DeleteGenerationConversation() deleted = false, want true")
	}
	if _, err := repo.GetGenerationConversation(deleteConversation.ID); !errors.Is(err, ErrRecordNotFound) {
		t.Fatalf("GetGenerationConversation() after delete error = %v, want ErrRecordNotFound", err)
	}
	if _, err := repo.GetGenerationTask(deleteTask.ID); !errors.Is(err, ErrRecordNotFound) {
		t.Fatalf("GetGenerationTask(delete) after conversation delete error = %v, want ErrRecordNotFound", err)
	}
	attempts, err = repo.ListAllGenerationTaskAttempts(deleteTask.ID)
	if err != nil {
		t.Fatalf("ListAllGenerationTaskAttempts(delete) after conversation delete error = %v", err)
	}
	if len(attempts) != 0 {
		t.Fatalf("ListAllGenerationTaskAttempts(delete) len = %d, want 0", len(attempts))
	}
}

func TestGenerationTaskRepositoryListDefaultLimitAndOffset(t *testing.T) {
	repo, err := NewGenerationTaskRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationTaskRepository() error = %v", err)
	}

	total := defaultGenerationTaskListLimit + 5
	for index := 0; index < total; index++ {
		task := generationTaskTestModel(
			fmt.Sprintf("task-%03d", index),
			"completed",
			fmt.Sprintf("2026-05-22T00:00:%03dZ", index),
		)
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

func generationTaskTestModel(id string, status string, updatedAt string) domain.GenerationTaskModel {
	return domain.GenerationTaskModel{
		ID:                    id,
		ProviderTaskID:        id + "-provider",
		ConversationID:        "session-list",
		ProjectID:             "project-list",
		CapabilityID:          "video.generate",
		Kind:                  "video",
		RouteID:               "route",
		FamilyID:              "family",
		VersionID:             "version",
		Provider:              "provider",
		ModelID:               "model-id",
		Model:                 "model",
		Prompt:                "prompt",
		ReferenceURLsJSON:     "[]",
		ReferenceAssetIDsJSON: "[]",
		ParamsJSON:            "{}",
		Status:                status,
		Message:               "done",
		AssetsJSON:            "[]",
		UsageJSON:             "{}",
		CreatedAt:             "2026-05-22T00:00:000Z",
		UpdatedAt:             updatedAt,
	}
}

func generationTaskModelIDs(tasks []domain.GenerationTaskModel) []string {
	ids := make([]string, 0, len(tasks))
	for _, task := range tasks {
		ids = append(ids, task.ID)
	}
	return ids
}
