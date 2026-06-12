package generation

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/repository"
)

func TestGenerationNotificationServicePublishesCompletedTask(t *testing.T) {
	repo, err := repository.NewGenerationNotificationRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationNotificationRepository() error = %v", err)
	}
	service := NewGenerationNotificationServiceFromRepository(repo, nil, func(prefix string) (string, error) {
		return prefix + "-1", nil
	})
	events, unsubscribe := service.Subscribe()
	defer unsubscribe()

	task := GenerationTaskRecord{
		ID:     "task-1",
		Kind:   "image",
		Status: "completed",
		Assets: []GenerationAsset{{Kind: "image", URL: "/api/v1/media-assets/image-1/content"}},
	}
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
	repo, err := repository.NewGenerationNotificationRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewGenerationNotificationRepository() error = %v", err)
	}
	service := NewGenerationNotificationServiceFromRepository(repo, nil, func(prefix string) (string, error) {
		return prefix + "-video", nil
	})
	events, unsubscribe := service.Subscribe()
	defer unsubscribe()

	task := GenerationTaskRecord{
		ID:     "task-video",
		Kind:   "video",
		Status: "completed",
		Assets: []GenerationAsset{{Kind: "video", URL: "/api/v1/media-assets/video-1/content"}},
	}
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
