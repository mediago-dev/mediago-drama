package repository

import (
	"path/filepath"
	"testing"

	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
)

func TestGenerationNotificationRepositoryLifecycle(t *testing.T) {
	repo, err := NewGenerationNotificationRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationNotificationRepository() error = %v", err)
	}

	notification := domain.GenerationNotificationModel{
		ID:         "notification-1",
		TaskID:     "task-1",
		TaskKind:   "image",
		TaskStatus: "pending",
		ProjectID:  "project-a",
		TargetJSON: `{"kind":"document-section","projectId":"project-a","documentId":"doc-a","documentTitle":"第一集","section":{"blockId":"section-a","documentId":"doc-a","headingLevel":2,"headingOccurrence":1,"headingText":"画面","markdown":"## 画面","plainText":"画面","prompt":"生成画面"}}`,
		CreatedAt:  "2026-06-09T00:00:00Z",
		UpdatedAt:  "2026-06-09T00:00:00Z",
	}
	if err := repo.UpsertGenerationNotification(notification); err != nil {
		t.Fatalf("UpsertGenerationNotification() error = %v", err)
	}

	notification.TaskStatus = "completed"
	notification.Title = "生成完成"
	notification.Description = "第一集 · 画面 已生成图片。"
	notification.AssetCount = 1
	notification.UpdatedAt = "2026-06-09T00:01:00Z"
	if err := repo.UpsertGenerationNotification(notification); err != nil {
		t.Fatalf("UpsertGenerationNotification(completed) error = %v", err)
	}

	got, err := repo.GetGenerationNotificationByTaskID("task-1")
	if err != nil {
		t.Fatalf("GetGenerationNotificationByTaskID() error = %v", err)
	}
	if got.ID != notification.ID || got.TaskStatus != "completed" || got.AssetCount != 1 {
		t.Fatalf("notification = %+v, want completed seeded notification", got)
	}

	list, err := repo.ListGenerationNotifications("project-a", 10)
	if err != nil {
		t.Fatalf("ListGenerationNotifications() error = %v", err)
	}
	if len(list) != 1 || list[0].ID != notification.ID {
		t.Fatalf("ListGenerationNotifications() = %+v, want seeded notification", list)
	}

	read, err := repo.MarkGenerationNotificationRead(notification.ID, "2026-06-09T00:02:00Z")
	if err != nil {
		t.Fatalf("MarkGenerationNotificationRead() error = %v", err)
	}
	if read.ReadAt == "" {
		t.Fatalf("ReadAt = empty, want timestamp")
	}
}
