package generation

import "fmt"

// ListGenerationNotifications lists completed generation notifications.
func (workflow *GenerationService) ListGenerationNotifications(projectID string) (GenerationNotificationsResponse, error) {
	if workflow.generationNotifications == nil {
		return GenerationNotificationsResponse{Notifications: []GenerationNotificationRecord{}}, nil
	}
	return workflow.generationNotifications.ListNotifications(projectID)
}

// MarkGenerationNotificationRead marks one generation notification read.
func (workflow *GenerationService) MarkGenerationNotificationRead(id string) (GenerationNotificationRecord, bool, error) {
	if workflow.generationNotifications == nil {
		return GenerationNotificationRecord{}, false, nil
	}
	return workflow.generationNotifications.MarkNotificationRead(id)
}

// MarkAllGenerationNotificationsRead marks all completed generation notifications read.
func (workflow *GenerationService) MarkAllGenerationNotificationsRead(projectID string) error {
	if workflow.generationNotifications == nil {
		return nil
	}
	return workflow.generationNotifications.MarkAllNotificationsRead(projectID)
}

// SubscribeGenerationNotifications subscribes to live generation notification events.
func (workflow *GenerationService) SubscribeGenerationNotifications() (<-chan GenerationNotificationEvent, func()) {
	if workflow.generationNotifications == nil {
		events := make(chan GenerationNotificationEvent)
		close(events)
		return events, func() {}
	}
	return workflow.generationNotifications.Subscribe()
}

// GenerationNotificationConnectedEvent returns an SSE connection event.
func (workflow *GenerationService) GenerationNotificationConnectedEvent(projectID string) GenerationNotificationEvent {
	if workflow.generationNotifications == nil {
		return GenerationNotificationEvent{
			ID:        "generation-notification-connected",
			Type:      generationNotificationConnectedEventType,
			ProjectID: projectID,
		}
	}
	return workflow.generationNotifications.ConnectedEvent(projectID)
}

// RequireGenerationNotifications reports whether notification streaming is available.
func (workflow *GenerationService) RequireGenerationNotifications() error {
	if workflow.generationNotifications == nil {
		return fmt.Errorf("generation notifications are unavailable")
	}
	return nil
}
