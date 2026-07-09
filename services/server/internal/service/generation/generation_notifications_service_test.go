package generation

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

func TestGenerationNotificationServicePublishesCompletedTask(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "workspace.db")
	seedGenerationTaskProject(t, dbPath, "project-a")
	seedGenerationTaskAsset(t, dbPath, "image-1", "image", "project-a")
	task := GenerationTaskRecord{
		ID:        "task-1",
		ProjectID: "project-a",
		Kind:      "image",
		Status:    "completed",
		Assets:    []GenerationAsset{{Kind: "image", URL: "/api/v1/media-assets/image-1/content"}},
	}
	taskService := NewGenerationTaskService(dbPath, nil)
	if err := taskService.Upsert(task); err != nil {
		t.Fatalf("Upsert(task) error = %v", err)
	}
	repos, err := repository.OpenWorkspaceRepositories(dbPath)
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	service := NewGenerationNotificationServiceFromRepository(repos.GenerationNotifications, nil, func(prefix string) (string, error) {
		return prefix + "-1", nil
	})
	events, unsubscribe := service.Subscribe()
	defer unsubscribe()

	target := &GenerationNotificationTarget{
		Kind:          "document-section",
		ProjectID:     "project-a",
		DocumentID:    "doc-a",
		DocumentTitle: "第一集",
		Section: GenerationNotificationSectionTarget{
			BlockID:           "section-a",
			DocumentID:        "doc-a",
			HeadingLevel:      2,
			HeadingOccurrence: 1,
			HeadingText:       "画面",
			Markdown:          "## 画面",
			PlainText:         "画面",
			Prompt:            "生成画面",
		},
	}

	if err := service.TrackTaskTarget(task, target); err != nil {
		t.Fatalf("TrackTaskTarget() error = %v", err)
	}
	service.SyncTask(task)

	select {
	case event := <-events:
		if event.Type != generationNotificationCompletedEventType {
			t.Fatalf("event.Type = %q, want completed", event.Type)
		}
		if event.Notification.TaskID != task.ID || event.Notification.Description != "第一集 · 画面 已生成图片。" {
			t.Fatalf("event.Notification = %+v", event.Notification)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for notification event")
	}

	response, err := service.ListNotifications("project-a")
	if err != nil {
		t.Fatalf("ListNotifications() error = %v", err)
	}
	if len(response.Notifications) != 1 || response.Notifications[0].TaskID != task.ID {
		t.Fatalf("ListNotifications() = %+v, want completed task notification", response.Notifications)
	}

	service.SyncTask(task)
	select {
	case event := <-events:
		t.Fatalf("unexpected duplicate event: %+v", event)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestGenerationNotificationServicePublishesCompletedVideoTask(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "workspace.db")
	seedGenerationTaskProject(t, dbPath, "project-a")
	seedGenerationTaskAsset(t, dbPath, "video-1", "video", "project-a")
	task := GenerationTaskRecord{
		ID:        "task-video",
		ProjectID: "project-a",
		Kind:      "video",
		Status:    "completed",
		Assets:    []GenerationAsset{{Kind: "video", URL: "/api/v1/media-assets/video-1/content"}},
	}
	taskService := NewGenerationTaskService(dbPath, nil)
	if err := taskService.Upsert(task); err != nil {
		t.Fatalf("Upsert(task) error = %v", err)
	}
	repos, err := repository.OpenWorkspaceRepositories(dbPath)
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	service := NewGenerationNotificationServiceFromRepository(repos.GenerationNotifications, nil, func(prefix string) (string, error) {
		return prefix + "-video", nil
	})
	events, unsubscribe := service.Subscribe()
	defer unsubscribe()

	target := &GenerationNotificationTarget{
		Kind:          "document-section",
		ProjectID:     "project-a",
		DocumentID:    "doc-a",
		DocumentTitle: "第一集",
		Section: GenerationNotificationSectionTarget{
			BlockID:           "clip-a",
			DocumentID:        "doc-a",
			HeadingLevel:      2,
			HeadingOccurrence: 1,
			HeadingText:       "分镜 01",
			Markdown:          "## 分镜 01",
			PlainText:         "分镜 01",
			Prompt:            "生成视频",
		},
	}

	if err := service.TrackTaskTarget(task, target); err != nil {
		t.Fatalf("TrackTaskTarget() error = %v", err)
	}
	service.SyncTask(task)

	select {
	case event := <-events:
		if event.Type != generationNotificationCompletedEventType {
			t.Fatalf("event.Type = %q, want completed", event.Type)
		}
		if event.Notification.TaskID != task.ID ||
			event.Notification.TaskKind != "video" ||
			event.Notification.Description != "第一集 · 分镜 01 已生成视频。" {
			t.Fatalf("event.Notification = %+v", event.Notification)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for notification event")
	}
}

func TestGenerationNotificationServiceAnnouncesUntrackedTaskCompletion(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "workspace.db")
	repos, err := repository.OpenWorkspaceRepositories(dbPath)
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	service := NewGenerationNotificationServiceFromRepository(repos.GenerationNotifications, nil, nil)
	events, unsubscribe := service.Subscribe()
	defer unsubscribe()

	// 无通知记录的后台任务完成也要广播，前端才能刷新资源封面/计数。
	completed := GenerationTaskRecord{
		ID:        "task-untracked",
		ProjectID: "project-a",
		Kind:      "image",
		Status:    "completed",
		UpdatedAt: "2026-07-10T00:00:00Z",
	}
	service.SyncTask(completed)

	select {
	case event := <-events:
		if event.Type != "generation.task.completed" || event.ProjectID != "project-a" {
			t.Fatalf("event = %+v, want untracked task-completed announcement", event)
		}
	case <-time.After(time.Second):
		t.Fatal("no event published for untracked completed task")
	}

	// 同一任务重复 sync 不再重复广播。
	service.SyncTask(completed)
	select {
	case event := <-events:
		t.Fatalf("unexpected duplicate event %+v", event)
	case <-time.After(100 * time.Millisecond):
	}

	// 仍在运行的任务不广播。
	service.SyncTask(GenerationTaskRecord{ID: "task-running", ProjectID: "project-a", Status: "running"})
	select {
	case event := <-events:
		t.Fatalf("unexpected event for running task %+v", event)
	case <-time.After(100 * time.Millisecond):
	}
}
