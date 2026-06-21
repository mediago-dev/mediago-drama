package generation

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

const (
	generationNotificationCompletedEventType = "generation.notification.completed"
	generationNotificationConnectedEventType = "generation.notification.connected"
	generationNotificationBufferSize         = 128
	generationNotificationListLimit          = 100
)

// GenerationNotificationService persists and publishes generation notifications.
type GenerationNotificationService struct {
	mu          sync.RWMutex
	repo        *repository.GenerationNotificationRepository
	initErr     error
	idGenerator func(string) (string, error)
	broker      *GenerationNotificationBroker
}

type generationNotificationModel = domain.GenerationNotificationModel

// NewGenerationNotificationServiceFromRepository creates a notification service from a repository.
func NewGenerationNotificationServiceFromRepository(repo *repository.GenerationNotificationRepository, initErr error, idGenerator func(string) (string, error)) *GenerationNotificationService {
	if idGenerator == nil {
		idGenerator = defaultGenerationNotificationID
	}
	service := &GenerationNotificationService{
		repo:        repo,
		initErr:     initErr,
		idGenerator: idGenerator,
		broker:      NewGenerationNotificationBroker(),
	}
	if service.initErr == nil && service.repo == nil {
		service.initErr = errors.New("generation notification repository is nil")
	}
	return service
}

// TrackTaskTarget stores the notification target for a generation task.
func (service *GenerationNotificationService) TrackTaskTarget(task GenerationTaskRecord, target *GenerationNotificationTarget) error {
	if service == nil || target == nil {
		return nil
	}
	if service.initErr != nil {
		return service.initErr
	}
	taskID := strings.TrimSpace(task.ID)
	if taskID == "" {
		return nil
	}
	normalizedTarget := normalizeGenerationNotificationTarget(*target)
	if normalizedTarget.Kind == "" || normalizedTarget.ProjectID == "" {
		return nil
	}
	targetJSON, err := json.Marshal(normalizedTarget)
	if err != nil {
		return fmt.Errorf("encoding generation notification target: %w", err)
	}

	notificationID, err := service.notificationIDForTask(taskID)
	if err != nil {
		return err
	}
	now := timestamp.NowRFC3339Nano()
	model := generationNotificationModel{
		ID:         notificationID,
		TaskID:     taskID,
		TaskKind:   strings.TrimSpace(task.Kind),
		TaskStatus: "pending",
		ProjectID:  domain.StringPtr(normalizedTarget.ProjectID),
		TargetJSON: string(targetJSON),
		CreatedAt:  domain.TimeFromString(now),
		UpdatedAt:  domain.TimeFromString(now),
	}

	service.mu.Lock()
	defer service.mu.Unlock()

	return service.repo.UpsertGenerationNotification(model)
}

// SyncTask updates and publishes a notification for a generation task if needed.
func (service *GenerationNotificationService) SyncTask(task GenerationTaskRecord) {
	if service == nil || service.initErr != nil || strings.TrimSpace(task.ID) == "" {
		return
	}

	model, err := service.completeTaskNotification(task)
	if errors.Is(err, repository.ErrRecordNotFound) {
		return
	}
	if err != nil {
		slog.Warn("generation notification sync failed", "task_id", task.ID, "error", err)
		return
	}
	if strings.TrimSpace(model.ID) == "" || model.TaskStatus != "completed" {
		return
	}

	record, err := generationNotificationRecordFromModel(model)
	if err != nil {
		slog.Warn("generation notification record decode failed", "notification_id", model.ID, "error", err)
		return
	}
	service.broker.Publish(GenerationNotificationEvent{
		ID:           record.ID,
		Type:         generationNotificationCompletedEventType,
		ProjectID:    record.ProjectID,
		Notification: record,
		CreatedAt:    record.UpdatedAt,
	})
}

// ListNotifications lists completed generation notifications.
func (service *GenerationNotificationService) ListNotifications(projectID string) (GenerationNotificationsResponse, error) {
	if service.initErr != nil {
		return GenerationNotificationsResponse{}, service.initErr
	}

	service.mu.RLock()
	models, err := service.repo.ListGenerationNotifications(projectID, generationNotificationListLimit)
	service.mu.RUnlock()
	if err != nil {
		return GenerationNotificationsResponse{}, err
	}

	notifications := make([]GenerationNotificationRecord, 0, len(models))
	for _, model := range models {
		notification, err := generationNotificationRecordFromModel(model)
		if err != nil {
			return GenerationNotificationsResponse{}, err
		}
		notifications = append(notifications, notification)
	}
	return GenerationNotificationsResponse{Notifications: notifications}, nil
}

// MarkNotificationRead marks one generation notification read.
func (service *GenerationNotificationService) MarkNotificationRead(id string) (GenerationNotificationRecord, bool, error) {
	if service.initErr != nil {
		return GenerationNotificationRecord{}, false, service.initErr
	}

	service.mu.Lock()
	model, err := service.repo.MarkGenerationNotificationRead(id, timestamp.NowRFC3339Nano())
	service.mu.Unlock()
	if errors.Is(err, repository.ErrRecordNotFound) {
		return GenerationNotificationRecord{}, false, nil
	}
	if err != nil {
		return GenerationNotificationRecord{}, false, err
	}

	record, err := generationNotificationRecordFromModel(model)
	return record, err == nil, err
}

// MarkAllNotificationsRead marks completed generation notifications read.
func (service *GenerationNotificationService) MarkAllNotificationsRead(projectID string) error {
	if service.initErr != nil {
		return service.initErr
	}

	service.mu.Lock()
	defer service.mu.Unlock()

	return service.repo.MarkAllGenerationNotificationsRead(projectID, timestamp.NowRFC3339Nano())
}

// Subscribe subscribes to live generation notification events.
func (service *GenerationNotificationService) Subscribe() (<-chan GenerationNotificationEvent, func()) {
	return service.broker.Subscribe()
}

// ConnectedEvent returns a stream connection event.
func (service *GenerationNotificationService) ConnectedEvent(projectID string) GenerationNotificationEvent {
	now := timestamp.NowRFC3339Nano()
	return GenerationNotificationEvent{
		ID:        "generation-notification-connected",
		Type:      generationNotificationConnectedEventType,
		ProjectID: domain.CleanProjectID(projectID),
		CreatedAt: now,
	}
}

func (service *GenerationNotificationService) completeTaskNotification(task GenerationTaskRecord) (generationNotificationModel, error) {
	service.mu.Lock()
	defer service.mu.Unlock()

	model, err := service.repo.GetGenerationNotificationByTaskID(task.ID)
	if err != nil {
		return generationNotificationModel{}, err
	}
	currentStatus := strings.TrimSpace(model.TaskStatus)
	nextStatus := generationNotificationTaskStatus(task)
	if currentStatus == "completed" {
		return generationNotificationModel{}, nil
	}

	model.TaskKind = strings.TrimSpace(task.Kind)
	model.TaskStatus = nextStatus
	model.UpdatedAt = domain.TimeFromString(timestamp.NowRFC3339Nano())
	if nextStatus != "completed" {
		if err := service.repo.UpsertGenerationNotification(model); err != nil {
			return generationNotificationModel{}, err
		}
		return generationNotificationModel{}, nil
	}

	target, err := generationNotificationTargetFromModel(model)
	if err != nil {
		return generationNotificationModel{}, err
	}
	assetCount := generationNotificationAssetCount(task)
	if assetCount <= 0 {
		model.TaskStatus = "failed"
		if err := service.repo.UpsertGenerationNotification(model); err != nil {
			return generationNotificationModel{}, err
		}
		return generationNotificationModel{}, nil
	}
	model.AssetCount = assetCount
	model.Title = "生成完成"
	model.Description = generationNotificationDescription(task, target, assetCount)
	if err := service.repo.UpsertGenerationNotification(model); err != nil {
		return generationNotificationModel{}, err
	}
	return model, nil
}

func (service *GenerationNotificationService) notificationIDForTask(taskID string) (string, error) {
	model, err := service.repo.GetGenerationNotificationByTaskID(taskID)
	if err == nil && strings.TrimSpace(model.ID) != "" {
		return model.ID, nil
	}
	if err != nil && !errors.Is(err, repository.ErrRecordNotFound) {
		return "", err
	}
	return service.idGenerator("generation-notification")
}

func generationNotificationTaskStatus(task GenerationTaskRecord) string {
	status := strings.ToLower(strings.TrimSpace(task.Status))
	if status == "" {
		return "pending"
	}
	if status == "completed" {
		return "completed"
	}
	if IsTerminalGenerationTaskStatus(status) {
		return "failed"
	}
	return "pending"
}

func generationNotificationAssetCount(task GenerationTaskRecord) int {
	count := 0
	for _, asset := range GenerationTaskForClient(task).Assets {
		if strings.TrimSpace(asset.Kind) != strings.TrimSpace(task.Kind) {
			continue
		}
		if strings.TrimSpace(asset.URL) == "" && strings.TrimSpace(asset.Base64) == "" {
			continue
		}
		count++
	}
	return count
}

func generationNotificationDescription(task GenerationTaskRecord, target GenerationNotificationTarget, assetCount int) string {
	documentTitle := strings.TrimSpace(target.DocumentTitle)
	if documentTitle == "" {
		documentTitle = "未命名文档"
	}
	sectionTitle := strings.TrimSpace(target.Section.HeadingText)
	if sectionTitle == "" {
		sectionTitle = "未命名章节"
	}
	if strings.TrimSpace(task.Kind) == "image" {
		if assetCount > 1 {
			return fmt.Sprintf("%s · %s 已生成 %d 张图片。", documentTitle, sectionTitle, assetCount)
		}
		return fmt.Sprintf("%s · %s 已生成图片。", documentTitle, sectionTitle)
	}
	if strings.TrimSpace(task.Kind) == "video" {
		if assetCount > 1 {
			return fmt.Sprintf("%s · %s 已生成 %d 个视频。", documentTitle, sectionTitle, assetCount)
		}
		return fmt.Sprintf("%s · %s 已生成视频。", documentTitle, sectionTitle)
	}
	return fmt.Sprintf("%s · %s 生成已完成。", documentTitle, sectionTitle)
}

func generationNotificationRecordFromModel(model generationNotificationModel) (GenerationNotificationRecord, error) {
	target, err := generationNotificationTargetFromModel(model)
	if err != nil {
		return GenerationNotificationRecord{}, err
	}
	return GenerationNotificationRecord{
		ID:          model.ID,
		TaskID:      model.TaskID,
		TaskKind:    model.TaskKind,
		TaskStatus:  model.TaskStatus,
		ProjectID:   domain.StringValue(model.ProjectID),
		Title:       model.Title,
		Description: model.Description,
		AssetCount:  model.AssetCount,
		ReadAt:      domain.StringFromTime(generationTimePtrValue(model.ReadAt)),
		Target:      target,
		CreatedAt:   domain.StringFromTime(model.CreatedAt),
		UpdatedAt:   domain.StringFromTime(model.UpdatedAt),
	}, nil
}

func generationTimePtrValue(value *time.Time) time.Time {
	if value == nil {
		return time.Time{}
	}
	return *value
}

func generationNotificationTargetFromModel(model generationNotificationModel) (GenerationNotificationTarget, error) {
	target := GenerationNotificationTarget{}
	if err := json.Unmarshal([]byte(model.TargetJSON), &target); err != nil {
		return GenerationNotificationTarget{}, fmt.Errorf("decoding generation notification target: %w", err)
	}
	return normalizeGenerationNotificationTarget(target), nil
}

func normalizeGenerationNotificationTarget(target GenerationNotificationTarget) GenerationNotificationTarget {
	target.Kind = strings.TrimSpace(target.Kind)
	target.ProjectID = domain.CleanProjectID(target.ProjectID)
	target.DocumentID = strings.TrimSpace(target.DocumentID)
	target.DocumentTitle = strings.TrimSpace(target.DocumentTitle)
	target.Section.BlockID = strings.TrimSpace(target.Section.BlockID)
	target.Section.DocumentID = strings.TrimSpace(target.Section.DocumentID)
	target.Section.HeadingText = strings.TrimSpace(target.Section.HeadingText)
	target.Section.Markdown = strings.TrimSpace(target.Section.Markdown)
	target.Section.PlainText = strings.TrimSpace(target.Section.PlainText)
	target.Section.Prompt = strings.TrimSpace(target.Section.Prompt)
	return target
}

// GenerationNotificationBroker fans out notification events.
type GenerationNotificationBroker struct {
	mu          sync.RWMutex
	subscribers map[chan GenerationNotificationEvent]struct{}
}

// NewGenerationNotificationBroker returns an initialized generation notification broker.
func NewGenerationNotificationBroker() *GenerationNotificationBroker {
	return &GenerationNotificationBroker{subscribers: map[chan GenerationNotificationEvent]struct{}{}}
}

// Subscribe subscribes to live generation notification events.
func (broker *GenerationNotificationBroker) Subscribe() (<-chan GenerationNotificationEvent, func()) {
	events := make(chan GenerationNotificationEvent, generationNotificationBufferSize)

	broker.mu.Lock()
	broker.subscribers[events] = struct{}{}
	broker.mu.Unlock()

	return events, func() {
		broker.mu.Lock()
		delete(broker.subscribers, events)
		broker.mu.Unlock()
	}
}

// Publish publishes one notification event.
func (broker *GenerationNotificationBroker) Publish(event GenerationNotificationEvent) {
	broker.mu.RLock()
	defer broker.mu.RUnlock()

	for subscriber := range broker.subscribers {
		select {
		case subscriber <- event:
		default:
			slog.Warn("generation notification event dropped", "notification_id", event.ID)
		}
	}
}

func defaultGenerationNotificationID(prefix string) (string, error) {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return prefix + "-" + hex.EncodeToString(bytes[:]), nil
}
