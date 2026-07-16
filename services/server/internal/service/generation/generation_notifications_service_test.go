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

func TestGenerationTaskStartedTransitionAnnouncesActiveCycles(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "workspace.db")
	seedGenerationTaskProject(t, dbPath, "project-a")
	repos, err := repository.OpenWorkspaceRepositories(dbPath)
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	notifications := NewGenerationNotificationServiceFromRepository(repos.GenerationNotifications, nil, nil)
	tasks := NewGenerationTaskService(dbPath, nil)
	workflow := NewGenerationService(nil, tasks, nil)
	workflow.SetGenerationNotifications(notifications)
	events, unsubscribe := notifications.Subscribe()
	defer unsubscribe()

	expectStarted := func(reason string) {
		t.Helper()
		select {
		case event := <-events:
			if event.Type != generationTaskStartedEventType || event.ProjectID != "project-a" {
				t.Fatalf("%s: event = %+v", reason, event)
			}
		case <-time.After(time.Second):
			t.Fatalf("%s: no event published", reason)
		}
	}
	expectSilence := func(reason string) {
		t.Helper()
		select {
		case event := <-events:
			t.Fatalf("%s: unexpected event %+v", reason, event)
		case <-time.After(100 * time.Millisecond):
		}
	}

	task := GenerationTaskRecord{
		ID:        "task-started",
		ProjectID: "project-a",
		Kind:      "image",
		Status:    "submitted",
	}
	if err := tasks.Upsert(task); err != nil {
		t.Fatalf("Upsert(submitted) error = %v", err)
	}
	expectStarted("first active state")

	task.Status = "running"
	if err := tasks.Upsert(task); err != nil {
		t.Fatalf("Upsert(running) error = %v", err)
	}
	expectSilence("active-to-active transition")

	task.Status = "failed"
	if err := tasks.Upsert(task); err != nil {
		t.Fatalf("Upsert(failed) error = %v", err)
	}
	expectSilence("terminal transition")

	task.Status = "submitting"
	if err := tasks.Upsert(task); err != nil {
		t.Fatalf("Upsert(retry submitting) error = %v", err)
	}
	expectStarted("retry active cycle")

	if err := tasks.Upsert(task); err != nil {
		t.Fatalf("re-Upsert(submitting) error = %v", err)
	}
	expectSilence("same active status rewrite")
}

func TestGenerationTaskCompletionTransitionAnnouncesUntrackedTasks(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "workspace.db")
	repos, err := repository.OpenWorkspaceRepositories(dbPath)
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	seedGenerationTaskProject(t, dbPath, "project-a")
	notifications := NewGenerationNotificationServiceFromRepository(repos.GenerationNotifications, nil, nil)
	tasks := NewGenerationTaskService(dbPath, nil)
	tasks.SetTaskCompletionListener(notifications.AnnounceTaskCompletion)
	events, unsubscribe := notifications.Subscribe()
	defer unsubscribe()

	expectEvent := func(reason string) {
		t.Helper()
		select {
		case event := <-events:
			if event.Type != "generation.task.completed" || event.ProjectID != "project-a" {
				t.Fatalf("%s: event = %+v", reason, event)
			}
		case <-time.After(time.Second):
			t.Fatalf("%s: no event published", reason)
		}
	}
	expectSilence := func(reason string) {
		t.Helper()
		select {
		case event := <-events:
			t.Fatalf("%s: unexpected event %+v", reason, event)
		case <-time.After(100 * time.Millisecond):
		}
	}

	task := GenerationTaskRecord{ID: "task-1", ProjectID: "project-a", Kind: "image", Status: "running"}
	if err := tasks.Upsert(task); err != nil {
		t.Fatalf("Upsert(running) error = %v", err)
	}
	expectSilence("running task must not announce")

	task.Status = "completed"
	if err := tasks.Upsert(task); err != nil {
		t.Fatalf("Upsert(completed) error = %v", err)
	}
	expectEvent("first completion transition")

	// 已完成任务被读路径/轮询重复 upsert：无迁移，不再广播。
	if err := tasks.Upsert(task); err != nil {
		t.Fatalf("re-Upsert(completed) error = %v", err)
	}
	expectSilence("re-upsert of completed task must not announce")

	// 重试：completed→submitting→completed 是一次新迁移，必须再次广播。
	task.Status = "submitting"
	if err := tasks.Upsert(task); err != nil {
		t.Fatalf("Upsert(submitting) error = %v", err)
	}
	expectSilence("retry submit must not announce")
	task.Status = "completed"
	if err := tasks.Upsert(task); err != nil {
		t.Fatalf("Upsert(retry completed) error = %v", err)
	}
	expectEvent("retry completion transition")
}

func TestAnnounceTaskCompletionSkipsTrackedTasks(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "workspace.db")
	repos, err := repository.OpenWorkspaceRepositories(dbPath)
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	seedGenerationTaskProject(t, dbPath, "project-a")
	notifications := NewGenerationNotificationServiceFromRepository(repos.GenerationNotifications, nil, nil)
	tasks := NewGenerationTaskService(dbPath, nil)
	task := GenerationTaskRecord{ID: "task-tracked", ProjectID: "project-a", Kind: "image", Status: "completed"}
	if err := tasks.Upsert(task); err != nil {
		t.Fatalf("Upsert(task) error = %v", err)
	}
	if err := notifications.TrackTaskTarget(task, &GenerationNotificationTarget{
		Kind:       "document-section",
		ProjectID:  "project-a",
		DocumentID: "doc-a",
		Section:    GenerationNotificationSectionTarget{BlockID: "b", DocumentID: "doc-a", HeadingText: "h"},
	}); err != nil {
		t.Fatalf("TrackTaskTarget() error = %v", err)
	}
	events, unsubscribe := notifications.Subscribe()
	defer unsubscribe()

	notifications.AnnounceTaskCompletion(task)
	select {
	case event := <-events:
		t.Fatalf("tracked task must not double-announce, got %+v", event)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestTrackedSynchronousCompletionPublishesOnlyRichNotification(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "workspace.db")
	seedGenerationTaskProject(t, dbPath, "project-a")
	seedGenerationTaskAsset(t, dbPath, "image-1", "image", "project-a")
	repos, err := repository.OpenWorkspaceRepositories(dbPath)
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	notifications := NewGenerationNotificationServiceFromRepository(repos.GenerationNotifications, nil, nil)
	tasks := NewGenerationTaskService(dbPath, nil)
	tasks.SetTaskCompletionListener(notifications.AnnounceTaskCompletion)
	events, unsubscribe := notifications.Subscribe()
	defer unsubscribe()

	task := GenerationTaskRecord{
		ID:        "task-synchronous",
		ProjectID: "project-a",
		Kind:      "image",
		Status:    "completed",
		Assets:    []GenerationAsset{{Kind: "image", URL: "/api/v1/media-assets/image-1/content"}},
	}
	if err := tasks.UpsertWithoutCompletionListener(task); err != nil {
		t.Fatalf("UpsertWithoutCompletionListener() error = %v", err)
	}
	select {
	case event := <-events:
		t.Fatalf("completion must wait for the tracked notification, got %+v", event)
	case <-time.After(100 * time.Millisecond):
	}

	if err := notifications.TrackTaskTarget(task, &GenerationNotificationTarget{
		Kind:       "document-section",
		ProjectID:  "project-a",
		DocumentID: "doc-a",
		Section:    GenerationNotificationSectionTarget{BlockID: "b", DocumentID: "doc-a", HeadingText: "h"},
	}); err != nil {
		t.Fatalf("TrackTaskTarget() error = %v", err)
	}
	notifications.SyncTask(task)

	select {
	case event := <-events:
		if event.Type != generationNotificationCompletedEventType || event.Notification.TaskID != task.ID {
			t.Fatalf("event = %+v, want one rich completion notification", event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for rich completion notification")
	}
	select {
	case event := <-events:
		t.Fatalf("unexpected duplicate completion event: %+v", event)
	case <-time.After(100 * time.Millisecond):
	}
}
